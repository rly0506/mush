/**
 * GOAL-041: 看板审计日志归档导出测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateAuditReport,
  saveAuditReport,
  listAuditReports,
} from '../src/web/audit-export.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-041: Audit Log Export', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g041-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Generate Structured Markdown Report from Runtime Data', () => {
    // GOAL-067（P0-5）：fixture 对齐真实持久化 schema——
    // 派发单 = dispatches/<id>.jsonl（header + 生命周期事件）；
    // 事件链 = event-log-<run>.jsonl；台账行 = {at_utc,...,meta:{kind},sha256}。
    const nowIso = new Date().toISOString();
    const oldIso = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    mkdirSync(path.join(tmpDir, 'dispatches'), { recursive: true });

    // 派发单 1：PASS（末事件投影终态），事件发生在 10 天前（用于 week 过滤反例）
    writeFileSync(
      path.join(tmpDir, 'dispatches', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jsonl'),
      JSON.stringify({ kind: 'header', dispatch_id: 'a'.repeat(32), adapter_id: 'kimi', status: 'ADMITTED' }) + '\n' +
      JSON.stringify({ kind: 'event', phase: 'ADMISSION', status: 'ADMITTED', adapter_id: 'kimi', at_utc: oldIso, dispatch_id: 'a'.repeat(32), payload: {} }) + '\n' +
      JSON.stringify({ kind: 'event', phase: 'REPORT', status: 'PASS', adapter_id: 'kimi', at_utc: oldIso, dispatch_id: 'a'.repeat(32), payload: {} }) + '\n',
      'utf-8',
    );
    // 派发单 2：TIMEOUT（执行性失败），事件发生在现在
    writeFileSync(
      path.join(tmpDir, 'dispatches', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jsonl'),
      JSON.stringify({ kind: 'header', dispatch_id: 'b'.repeat(32), adapter_id: 'agy', status: 'ADMITTED' }) + '\n' +
      JSON.stringify({ kind: 'event', phase: 'EXECUTE', status: 'TIMEOUT', adapter_id: 'agy', at_utc: nowIso, dispatch_id: 'b'.repeat(32), payload: {} }) + '\n',
      'utf-8',
    );

    // 事件链：3 个有效节点 + 1 行撕裂半行 JSON（必须被跳过而不是崩掉导出）
    writeFileSync(
      path.join(tmpDir, 'event-log-goal067test.jsonl'),
      '{"kind":"event","sequence":1,"sha256":"aa"}\n' +
      '{"kind":"event","sequence":2,"sha256":"bb"}\n' +
      '{"kind":"event","sequence":3,"sha256":"cc"}\n' +
      '{"kind":"event","sequ\n',
      'utf-8',
    );

    // 台账：经 BoardPersistence 写入，保证哈希链真实有效（VALID 断言的前提）
    const persistence = new BoardPersistence(tmpDir);
    persistence.appendLedger({
      atUtc: oldIso,
      actorId: 'kimi',
      decision: 'DENIED',
      amountUsd: 5,
      capUsd: 5,
      spentBeforeUsd: 4.95,
      remainingUsd: 0,
      meta: { kind: 'ADMISSION_ESTIMATE', dispatch_id: 'x1' },
    });
    persistence.appendLedger({
      atUtc: nowIso,
      actorId: 'agy',
      decision: 'ADMITTED',
      amountUsd: 0.05,
      capUsd: 5,
      spentBeforeUsd: 4.95,
      remainingUsd: 4.95,
      meta: { kind: 'ACTUAL_COST', dispatch_id: 'b'.repeat(32) },
    });

    // 审批目录：1 组请求+应答 + 1 张未批复请求 → 应计 2（排除应答文件）
    writeFileSync(path.join(approvalRoot, 'req-a.json'), '{}\n', 'utf-8');
    writeFileSync(path.join(approvalRoot, 'req-a.json.owner-response.json'), '{}\n', 'utf-8');
    writeFileSync(path.join(approvalRoot, 'req-b.json'), '{}\n', 'utf-8');

    const report = generateAuditReport({ runtime_root: tmpDir, approval_root: approvalRoot });
    assert.strictEqual(report.summary.total_dispatches, 2);
    assert.strictEqual(report.summary.pass_dispatches, 1);
    assert.strictEqual(report.summary.failed_dispatches, 1);
    assert.strictEqual(report.summary.terminal_dispatches, 2);
    assert.strictEqual(report.summary.success_rate, 50);
    assert.strictEqual(report.summary.total_cost_usd, 0.05); // 仅 ACTUAL_COST；DENIED 预估 5 不混入
    assert.strictEqual(report.summary.actual_cost_entries, 1);
    assert.strictEqual(report.summary.total_events, 3); // 撕裂行被跳过
    assert.strictEqual(report.summary.ledger_chain_status, 'VALID');
    assert.strictEqual(report.summary.total_approvals, 2); // 不含 .owner-response.json
    assert.ok(report.markdown_content.includes('mush 运营审计与证据链归档报告'));
    assert.ok(report.markdown_content.includes('$0.0500'));

    // time_range 真过滤：week 只含今天的派发单与台账行
    const weekReport = generateAuditReport({ runtime_root: tmpDir, approval_root: approvalRoot, time_range: 'week' });
    assert.strictEqual(weekReport.summary.total_dispatches, 1);
    assert.strictEqual(weekReport.summary.total_cost_usd, 0.05);

    // 保存与列出
    const savedPath = saveAuditReport(tmpDir, report);
    assert.ok(savedPath.endsWith('.md'));

    const list = listAuditReports(tmpDir);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].file_name, report.file_name);
  });

  test('2. Server Endpoints: POST /api/audit/export, GET /api/audit/exports', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-audit-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/audit/export
    const exportRes = await fetch(`${base}/api/audit/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ time_range: 'week' }),
    });

    assert.strictEqual(exportRes.status, 201);
    const exportData = (await exportRes.json()) as { ok: boolean; report: { file_name: string; markdown_content: string } };
    assert.strictEqual(exportData.ok, true);
    assert.ok(exportData.report.file_name.startsWith('audit-report-'));

    const fileName = exportData.report.file_name;

    // 2. GET /api/audit/exports/:filename
    const getRes = await fetch(`${base}/api/audit/exports/${fileName}`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; markdown_content: string };
    assert.strictEqual(getData.ok, true);
    assert.ok(getData.markdown_content.includes('运营审计'));

    // 3. GET /api/audit/exports
    const listRes = await fetch(`${base}/api/audit/exports`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; reports: unknown[] };
    assert.strictEqual(listData.reports.length, 1);
  });
});
