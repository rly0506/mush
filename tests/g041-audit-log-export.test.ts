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
    // 模拟 budget ledger
    const ledgerPath = path.join(tmpDir, 'budget-ledger.jsonl');
    writeFileSync(
      ledgerPath,
      JSON.stringify({ status: 'PASS', amount_usd: 0.05, actor_id: 'claude-code' }) + '\n' +
      JSON.stringify({ status: 'PASS', amount_usd: 0.02, actor_id: 'agy' }) + '\n',
      'utf-8'
    );

    // 模拟 events log
    const eventsPath = path.join(tmpDir, 'events.jsonl');
    writeFileSync(eventsPath, '{"kind":"epoch_start"}\n{"kind":"task_created"}\n', 'utf-8');

    const report = generateAuditReport({ runtime_root: tmpDir });
    assert.strictEqual(report.summary.total_dispatches, 2);
    assert.strictEqual(report.summary.total_events, 2);
    assert.strictEqual(report.summary.total_cost_usd, 0.07);
    assert.ok(report.markdown_content.includes('mush 运营审计与证据链归档报告'));
    assert.ok(report.markdown_content.includes('$0.0700'));

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
