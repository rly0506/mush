import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { certifyUnattendedReadiness, renderReadinessMarkdown } from '../src/core/readiness-certifier.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';

// GOAL-074：放闸就绪认证——任一证据缺失即 NOT_READY（fail-closed）。

function seedEvidence(repoRoot: string, runtimeRoot: string): void {
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
  writeFileSync(
    path.join(runtimeRoot, 'soak-summary.json'),
    JSON.stringify({ minutes: 480, fail: 0, pass: 640 }),
    'utf8',
  );
  writeFileSync(
    path.join(runtimeRoot, 'unattended-policy.json'),
    JSON.stringify({ level: 'L0', auto_approve_cap_usd: 0, daily_auto_budget_usd: 0, task_whitelist_prefixes: [] }),
    'utf8',
  );
}

test('GOAL-074：证据齐备 → READY，逐项带哈希锚点，链完整', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-ready-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  const breaker = new CircuitBreaker(path.join(runtime, 'unattended-breaker.json'));
  breaker.recordSuccess(); // 产生至少一条事件，链可校验
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime, breaker });
  assert.equal(report.ready, true, JSON.stringify(report.items.filter((i) => !i.passed)));
  assert.ok(report.items.every((i) => i.evidence_sha256 !== undefined || i.id === 'E5-breaker-chain'));
  const md = renderReadinessMarkdown(report);
  assert.match(md, /READY（证据链完备）/);
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：soak 缺失/未达标 → NOT_READY（fail-closed）', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-nr-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 120, fail: 2 }), 'utf8');
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  assert.equal(report.ready, false);
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.equal(soak?.passed, false);
  const md = renderReadinessMarkdown(report);
  assert.match(md, /NOT_READY（fail-closed）/);
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：空仓库全缺失 → NOT_READY 且不抛异常', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-empty-'));
  const runtime = path.join(repo, 'runtime');
  mkdirSync(runtime, { recursive: true });
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  assert.equal(report.ready, false);
  assert.ok(report.items.length >= 6);
  rmSync(repo, { recursive: true, force: true });
});
