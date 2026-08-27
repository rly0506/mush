import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { certifyUnattendedReadiness, renderReadinessMarkdown } from '../src/core/readiness-certifier.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';

// GOAL-074：放闸就绪认证——任一证据缺失即 NOT_READY（fail-closed）。
// 契约字段以 GOAL-074 §2.2 为准：{ id, title, passed, evidence_hash }。

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
    JSON.stringify({ minutes: 480, fail: 4, pass: 399 }),
    'utf8',
  );
  // 健康曲线：RSS 起始 69MB → 结束 38MB（含早期峰值），句柄平稳
  const rows: string[] = [];
  for (let i = 0; i < 20; i++) {
    const rss = i < 2 ? 69 - i : 38 + (i % 3);
    rows.push(JSON.stringify({ kind: i === 0 ? 'start' : 'round_ok', round: i, rss_mb: rss, handles: i === 0 ? 0 : i % 3 }));
  }
  writeFileSync(path.join(runtimeRoot, 'soak-metrics.jsonl'), rows.join('\n') + '\n', 'utf8');
  writeFileSync(
    path.join(runtimeRoot, 'unattended-policy.json'),
    JSON.stringify({ level: 'L0', auto_approve_cap_usd: 0, daily_auto_budget_usd: 0, task_whitelist_prefixes: [] }),
    'utf8',
  );
}

function failingIds(report: ReturnType<typeof certifyUnattendedReadiness>): string {
  return report.items.filter((i) => !i.passed).map((i) => i.id).join(',');
}

test('GOAL-074：证据齐备 → READY，逐项带 evidence_hash 锚点，链完整', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-ready-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  const breaker = new CircuitBreaker(path.join(runtime, 'unattended-breaker.json'));
  breaker.recordSuccess(); // 产生至少一条事件，链可校验
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime, breaker });
  assert.equal(report.ready, true, JSON.stringify(report.items.filter((i) => !i.passed)));
  for (const item of report.items) {
    if (item.id === 'E5-breaker-chain') continue;
    assert.match(item.evidence_hash ?? '', /^[0-9a-fA-F]{64}$/, `${item.id} 必须带决定性哈希锚点`);
    assert.equal('evidence_sha256' in item, false, '旧字段名不得残留（契约漂移）');
  }
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.match(soak?.aux_sha256 ?? '', /^[0-9a-fA-F]{64}$/, 'E4 需锚伴随工件 soak 摘要');
  assert.match(soak?.detail ?? '', /失败 4 次/, '失败数如实陈述');
  const md = renderReadinessMarkdown(report);
  assert.match(md, /READY（证据链完备）/);
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：实跑时长如实显示（505min 不许失真为 480）', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-real-minutes-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 505, fail: 4, pass: 403 }), 'utf8');
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.match(soak?.detail ?? '', /\b505min\b/, 'detail 必须呈现真实时长');
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

test('GOAL-074：8h 完成+零失败但曲线异常增长 → NOT_READY（泄漏趋势门禁）', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-leak-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  // 零失败、时长达标，但 RSS 线性爬升 = 泄漏趋势 → 必须拦下
  const rows: string[] = [];
  for (let i = 0; i < 20; i++) rows.push(JSON.stringify({ kind: 'round_ok', round: i, rss_mb: 40 + i * 5 }));
  writeFileSync(path.join(runtime, 'soak-metrics.jsonl'), rows.join('\n') + '\n', 'utf8');
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 480, fail: 0, pass: 403 }), 'utf8');
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  assert.equal(report.ready, false, 'leak trend must fail E4 even with zero failures');
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：RSS 平稳但句柄爆涨 → NOT_READY（句柄曲线门禁）', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-handle-leak-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  const rows: string[] = [];
  for (let i = 0; i < 20; i++) rows.push(JSON.stringify({ kind: 'round_ok', round: i, rss_mb: 42, handles: 3 + i * 7 }));
  writeFileSync(path.join(runtime, 'soak-metrics.jsonl'), rows.join('\n') + '\n', 'utf8');
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 480, fail: 0, pass: 403 }), 'utf8');
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  assert.equal(report.ready, false, 'handle growth must fail E4');
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.match(soak?.detail ?? '', /增长异常/);
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：指标尾行损坏 + 有失败 → NOT_READY（fail-open 漏洞封堵）', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-corrupt-tail-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  const good: string[] = [];
  for (let i = 0; i < 18; i++) good.push(JSON.stringify({ kind: 'round_ok', round: i, rss_mb: 40, handles: 1 }));
  good.push('{"kind":"round_ok","rss_mb":41,"handles":'); // 截断的尾行
  writeFileSync(path.join(runtime, 'soak-metrics.jsonl'), good.join('\n') + '\n', 'utf8');
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 480, fail: 4 }), 'utf8');
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  assert.equal(report.ready, false, 'corrupted tail must not yield a PASS via stale curve values');
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.match(soak?.detail ?? '', /损坏/);
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：rss_mb 非法（负值）同样计入坏行退回严格口径', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-bad-rss-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  const rows: string[] = [];
  for (let i = 0; i < 19; i++) rows.push(JSON.stringify({ kind: 'round_ok', round: i, rss_mb: i === 10 ? -3 : 40 }));
  writeFileSync(path.join(runtime, 'soak-metrics.jsonl'), rows.join('\n') + '\n', 'utf8');
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 480, fail: 2 }), 'utf8');
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime });
  assert.equal(report.ready, false);
  assert.ok(failingIds(report).includes('E4-soak-8h-clean'));
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.match(soak?.detail ?? '', /退回严格口径/);
  rmSync(repo, { recursive: true, force: true });
});

test('GOAL-074：无逐轮指标但零失败+超时长 → 严格口径放行', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'g074-no-metrics-pass-'));
  const runtime = path.join(repo, 'runtime');
  seedEvidence(repo, runtime);
  rmSync(path.join(runtime, 'soak-metrics.jsonl'));
  writeFileSync(path.join(runtime, 'soak-summary.json'), JSON.stringify({ minutes: 520, fail: 0 }), 'utf8');
  const breaker = new CircuitBreaker(path.join(runtime, 'unattended-breaker.json'));
  breaker.recordSuccess();
  const report = certifyUnattendedReadiness({ repoRoot: repo, runtimeRoot: runtime, breaker });
  assert.equal(report.ready, true, failingIds(report));
  const soak = report.items.find((i) => i.id === 'E4-soak-8h-clean');
  assert.match(soak?.detail ?? '', /无逐轮指标/);
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
