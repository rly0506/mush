/**
 * GOAL-074：PUT /api/unattended/policy 放闸就绪门禁
 * 档位提升必须证据链 READY（fail-closed）；同级设置与任何降级（含回落 L0）恒放行。
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { saveUnattendedPolicy } from '../src/core/unattended-policy.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';

interface PolicyBody {
  ok?: boolean;
  error?: string;
  policy?: { level?: string };
  readiness?: { ready?: boolean; failing?: string[] };
  items?: Array<Record<string, unknown>>;
  markdown?: string;
}

async function put(server: BoardServer, urlPath: string, body: unknown): Promise<{ status: number; body: PolicyBody }> {
  const res = await fetch(`http://127.0.0.1:${server.port}${urlPath}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as PolicyBody };
}

async function get(server: BoardServer, urlPath: string): Promise<{ status: number; body: PolicyBody }> {
  const res = await fetch(`http://127.0.0.1:${server.port}${urlPath}`);
  return { status: res.status, body: (await res.json()) as PolicyBody };
}

function seedReadyEvidence(repoRoot: string, runtimeRoot: string): void {
  const docs = path.join(repoRoot, 'docs', 'dispatch');
  mkdirSync(docs, { recursive: true });
  mkdirSync(path.join(repoRoot, 'tests'), { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(path.join(docs, 'rm011-m1-drill-report.md'), '……宣告「实战绿」……', 'utf8');
  writeFileSync(path.join(docs, 'rm011-m1-dual-drill.md'), '判定：**17/17 全绿**', 'utf8');
  writeFileSync(
    path.join(repoRoot, 'tests', 'g072-chaos-injection.test.ts'),
    '// 犬进程中途击杀 服务重启 竞争写入 重复消费',
    'utf8',
  );
  writeFileSync(path.join(runtimeRoot, 'soak-summary.json'), JSON.stringify({ minutes: 480, fail: 4, pass: 399 }), 'utf8');
  const rows: string[] = [];
  for (let i = 0; i < 20; i++) {
    const rss = i < 2 ? 69 - i : 38 + (i % 3);
    rows.push(JSON.stringify({ kind: i === 0 ? 'start' : 'round_ok', round: i, rss_mb: rss, handles: i % 3 }));
  }
  writeFileSync(path.join(runtimeRoot, 'soak-metrics.jsonl'), rows.join('\n') + '\n', 'utf8');
  writeFileSync(
    path.join(runtimeRoot, 'unattended-policy.json'),
    JSON.stringify({ level: 'L0', auto_approve_cap_usd: 0, daily_auto_budget_usd: 0, task_whitelist_prefixes: [] }),
    'utf8',
  );
  // 预置熔断器事件链，保证 E5 可过
  new CircuitBreaker(path.join(runtimeRoot, 'unattended-breaker.json')).recordSuccess();
}

describe('GOAL-074: PUT policy 放闸就绪门禁', () => {
  let root: string;
  let repoRoot: string;
  let runtimeRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mush-test-g074-gate-'));
    repoRoot = path.join(root, 'repo');
    runtimeRoot = path.join(root, 'runtime');
    seedReadyEvidence(repoRoot, runtimeRoot);
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function start(): Promise<void> {
    server = await startBoardServer({
      workspaceRoot: repoRoot,
      approvalRoot: path.join(runtimeRoot, 'approvals'),
      runtimeRoot,
      runId: 'g074-gate',
      assignmentEpoch: 1,
    });
  }

  test('证据齐备 → 提升 L1 解锁并落盘广播级语义生效', async () => {
    await start();
    const r = await put(server, '/api/unattended/policy', { level: 'L1', auto_approve_cap_usd: 0.5 });
    assert.equal(r.status, 200);
    assert.equal(r.body.policy?.level, 'L1');
    const cur = await get(server, '/api/unattended/policy');
    assert.equal(cur.body.policy?.level, 'L1');
  });

  test('NOT_READY → 提升被 409 拒绝且不落盘；同档重设不受限', async () => {
    await start();
    unlinkSync(path.join(runtimeRoot, 'soak-summary.json')); // E4 失据
    const r = await put(server, '/api/unattended/policy', { level: 'L1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.ok, false);
    assert.ok(r.body.readiness?.failing?.includes('E4-soak-8h-clean'), '409 必须点名失败项');
    const cur = await get(server, '/api/unattended/policy');
    assert.equal(cur.body.policy?.level, 'L0', '被拒后不得提升');

    const same = await put(server, '/api/unattended/policy', { level: 'L0', auto_approve_cap_usd: 0 });
    assert.equal(same.status, 200, '同级设置恒放行');
  });

  test('降级逃生门：已处 L1 时即使 NOT_READY 也可回退 L0，再提升复又被拒', async () => {
    saveUnattendedPolicy(runtimeRoot, { level: 'L1', auto_approve_cap_usd: 0.5, daily_auto_budget_usd: 1, task_whitelist_prefixes: [] });
    await start();
    unlinkSync(path.join(runtimeRoot, 'soak-summary.json'));
    const down = await put(server, '/api/unattended/policy', { level: 'L0' });
    assert.equal(down.status, 200);
    assert.equal(down.body.policy?.level, 'L0');
    const up = await put(server, '/api/unattended/policy', { level: 'L2' });
    assert.equal(up.status, 409, '降级后再次提升仍受门禁约束');
  });

  test('GET /api/unattended/readiness 返回契约字段（evidence_hash，无旧字段名）', async () => {
    await start();
    const r = await get(server, '/api/unattended/readiness');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.markdown, 'string');
    for (const item of r.body.items ?? []) {
      assert.equal('evidence_sha256' in item, false, '旧字段名不得残留');
      if (item.id !== 'E5-breaker-chain') {
        assert.match(String(item.evidence_hash ?? ''), /^[0-9a-fA-F]{64}$/);
      }
    }
  });
});
