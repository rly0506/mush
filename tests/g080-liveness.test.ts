import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { evaluateLiveness, createLivenessGate } from '../src/core/liveness-ladder.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';
import type { LivenessGate, LivenessResult } from '../src/core/liveness-ladder.ts';

// GOAL-080：犬链探针阶梯——恒零成本检测（不发任何 LLM 请求）+ 预检门 + 故障转移。

function contractOf(id: string, extra: Partial<AdapterContract> = {}): AdapterContract {
  return validateAdapterContract({
    adapter_id: id,
    executable: id + '.exe',
    arguments: ['--headless'],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'fake',
    expected_model_id: id + '-model',
    ...extra,
  });
}

function okResult(id: string, level: 1 | 2 | 3): LivenessResult {
  return {
    adapter_id: id,
    level_reached: level,
    ok: true,
    label: level === 1 ? 'AUTH_VERIFIED' : level === 2 ? 'FREE_ROUND_VERIFIED' : 'PAID_ROUND_VERIFIED',
    detail: 'stub',
    checked_at_utc: new Date().toISOString(),
  };
}

test('GOAL-080 阶梯：L0 失败 → DEAD（fail-closed）', async () => {
  const r = await evaluateLiveness('a', contractOf('a'), {
    spawnFn: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.label, 'DEAD');
  assert.equal(r.level_reached, 0);
});

test('GOAL-080 阶梯：L0 过+无 L1 声明 → PROCESS_ONLY（诚实：可调度·未实弹）', async () => {
  const calls: string[][] = [];
  const r = await evaluateLiveness('a', contractOf('a'), {
    spawnFn: async (_exe, args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: 'v1.0', stderr: '' };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.label, 'PROCESS_ONLY');
  assert.deepEqual(calls, [['--version']], 'L0 只发 --version（恒零成本）');
});

test('GOAL-080 阶梯：L1 通过 + 实弹台账（free→L2 / 付费→L3 / 过期回退 L1）', async () => {
  const spawnFn = async () => ({ exitCode: 0, stdout: 'ok', stderr: '' });
  const decl = { liveness: { l1_args: ['--dump-config'] as const } };
  const fresh = { adapter_id: 'a', status: 'ONLINE' as const, live_models: [], checked_at_utc: new Date().toISOString(), model_tiers: { 'm-free': 'T1_VERIFIED' as const } };
  const free = await evaluateLiveness('a', contractOf('a', decl), { spawnFn, probeRecord: fresh });
  assert.equal(free.level_reached, 2);
  assert.equal(free.label, 'FREE_ROUND_VERIFIED');
  const paid = await evaluateLiveness('a', contractOf('a', decl), {
    spawnFn,
    probeRecord: { ...fresh, model_tiers: { 'm-pro': 'T1_VERIFIED' as const } },
  });
  assert.equal(paid.level_reached, 3);
  const stale = await evaluateLiveness('a', contractOf('a', decl), {
    spawnFn,
    probeRecord: { ...fresh, checked_at_utc: new Date(Date.now() - 25 * 3_600_000).toISOString() },
  });
  assert.equal(stale.level_reached, 1, '>24h 台账不再充当实弹凭证');
  assert.equal(stale.label, 'AUTH_VERIFIED');
});

test('GOAL-080 Gate：TTL 缓存——TTL 内只探一次，过期自动复检', async () => {
  let spawnCount = 0;
  let fakeNow = new Date('2026-08-29T10:00:00Z');
  const gate = createLivenessGate({
    contracts: { a: contractOf('a') },
    ttlMs: 10 * 60_000,
    now: () => fakeNow,
    spawnFn: async () => {
      spawnCount += 1;
      return { exitCode: 0, stdout: 'v', stderr: '' };
    },
  });
  await gate.check('a');
  await gate.check('a');
  assert.equal(spawnCount, 1, 'TTL 内命中缓存');
  fakeNow = new Date(fakeNow.getTime() + 11 * 60_000);
  await gate.check('a');
  assert.equal(spawnCount, 2, '过期后自动复检');
});

test('GOAL-080 阶梯：L1 鉴权失败（exit 1）→ DEAD（fail-closed）', async () => {
  const r = await evaluateLiveness('a', contractOf('a', { liveness: { l1_args: ['--dump-config'] } }), {
    spawnFn: async (_exe, args) => (args[0] === '--dump-config' ? { exitCode: 1, stdout: '', stderr: '401 unauthorized' } : { exitCode: 0, stdout: 'v', stderr: '' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.label, 'DEAD');
  assert.equal(r.level_reached, 1);
  assert.match(r.detail, /401/);
});

function makePipeline(root: string, opts: {
  contracts: Record<string, AdapterContract>;
  gate: LivenessGate;
  runs: Array<{ adapter: string; exitCode: number }>;
  breakerFailuresBefore?: number;
}) {
  let call = 0;
  const breaker = new CircuitBreaker(path.join(root, 'breaker.json'));
  for (let i = 0; i < (opts.breakerFailuresBefore ?? 0); i++) breaker.recordFailure({ seed: i });
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    approvalTokensPath: path.join(root, 'tokens'),
    contracts: opts.contracts,
    registryPath: path.join(root, 'registry.json'),
    unattended: {
      policy: { level: 'L1', auto_approve_cap_usd: 1, daily_auto_budget_usd: 100, task_whitelist_prefixes: [] },
      breaker,
    },
    liveness: {
      check: async (id: string) => opts.gate.check(id),
      refresh: async (id: string) => opts.gate.refresh(id),
      snapshot: () => opts.gate.snapshot(),
    },
    runAdapter: async (contract) => {
      call += 1;
      const run = opts.runs[call - 1] ?? { adapter: contract.adapter_id, exitCode: 0 };
      return { exitCode: run.exitCode, stdout: run.exitCode === 0 ? 'ok' : '', stderr: run.exitCode === 0 ? '' : 'boom', timedOut: false, childKilled: false };
    },
  });
  return { pipeline, breaker, getCall: () => call };
}

test('GOAL-080 预检门：通道死亡 → REJECTED 零台账副作用，且探针只发零成本 argv', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g080-preflight-'));
  const spawnCalls: string[][] = [];
  const gate = createLivenessGate({
    contracts: { 'fake-t1': contractOf('fake-t1') },
    ttlMs: 60_000,
    spawnFn: async (_exe, args) => {
      spawnCalls.push([...args]);
      return { exitCode: 1, stdout: '', stderr: 'not found' };
    },
  });
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    approvalTokensPath: path.join(root, 'tokens'),
    contracts: { 'fake-t1': contractOf('fake-t1') },
    liveness: gate,
    runAdapter: async () => ({ exitCode: 0, stdout: 'should-not-run', stderr: '', timedOut: false, childKilled: false }),
  });
  try {
    const rec = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'hello', real: true, cap_usd: 0.1 });
    assert.equal(rec.status, 'REJECTED');
    assert.match(rec.error ?? '', /preflight gate/);
    assert.equal(rec.admission, null, '预检拒绝零台账副作用');
    assert.ok(spawnCalls.every((args) => args[0] === '--version'), '探针只发 --version（零 LLM 请求）');
    assert.equal(existsSync(path.join(root, 'ledger.jsonl')), false, '台账文件根本不该被创建');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-080 故障转移：首犬失败 → 换 verified 备犬重试成功，failover_from 留痕', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g080-failover-'));
  mkdirSync(path.join(root, 'ws'), { recursive: true });
  writeFileSync(
    path.join(root, 'registry.json'),
    JSON.stringify({ adapters: [{ adapter_id: 'fake-t2', verified: true }] }),
    'utf8',
  );
  const contracts = { 'fake-t1': contractOf('fake-t1'), 'fake-t2': contractOf('fake-t2') };
  const { pipeline, getCall } = makePipeline(root, {
    contracts,
    gate: {
      check: async (id) => okResult(id, 3),
      refresh: async (id) => okResult(id, 3),
      snapshot: () => [okResult('fake-t1', 3), okResult('fake-t2', 3)],
    },
    runs: [
      { adapter: 'fake-t1', exitCode: 1 },
      { adapter: 'fake-t2', exitCode: 0 },
    ],
  });
  try {
    const rec = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'task', real: true, cap_usd: 0.5 });
    assert.equal(rec.status, 'PASS', `换道后应通过：${rec.error ?? ''}`);
    assert.equal(rec.failover_from, 'fake-t1');
    assert.equal(getCall(), 2, '恰好两次尝试');
    const events = rec.events.map((e) => `${e.phase}:${e.status}`).join('|');
    assert.match(events, /EXECUTE/);
    const ledger = readFileSync(path.join(root, 'ledger.jsonl'), 'utf8');
    assert.equal((ledger.match(/"decision":"ADMITTED"/g) ?? []).length, 1, '同一已批单预算包络：仅一次 admission');
    assert.ok(existsSync(path.join(root, 'ws', '.mush-receipts', 'dispatch-' + rec.dispatch_id + '.attempt1.json')), '失败尝试旁路回执留痕');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-080 故障转移：候选犬探针死亡 → 不换道（预检覆盖换道目标）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g080-deadcand-'));
  mkdirSync(path.join(root, 'ws'), { recursive: true });
  writeFileSync(
    path.join(root, 'registry.json'),
    JSON.stringify({ adapters: [{ adapter_id: 'fake-t2', verified: true }] }),
    'utf8',
  );
  const contracts = { 'fake-t1': contractOf('fake-t1'), 'fake-t2': contractOf('fake-t2') };
  const { pipeline, getCall } = makePipeline(root, {
    contracts,
    gate: {
      // 首犬存活、候选 fake-t2 探针死亡
      check: async (id) =>
        id === 'fake-t1'
          ? okResult('fake-t1', 1)
          : { adapter_id: 'fake-t2', level_reached: 0 as const, ok: false, label: 'DEAD' as const, detail: 'candidate dead', checked_at_utc: new Date().toISOString() },
      refresh: async (id) =>
        id === 'fake-t1'
          ? okResult('fake-t1', 1)
          : { adapter_id: 'fake-t2', level_reached: 0 as const, ok: false, label: 'DEAD' as const, detail: 'candidate dead', checked_at_utc: new Date().toISOString() },
      snapshot: () => [okResult('fake-t1', 1)],
    },
    runs: [{ adapter: 'fake-t1', exitCode: 1 }],
  });
  try {
    const rec = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'task', real: true, cap_usd: 0.1 });
    assert.equal(rec.status, 'FAIL');
    assert.equal(getCall(), 1, '候选犬死亡：不换道，不浪费第二次尝试');
    assert.equal(rec.failover_from, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-080 熔断协同：三连败停机 → 停链不换道；停机期新单 REJECTED', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g080-breaker-'));
  mkdirSync(path.join(root, 'ws'), { recursive: true });
  writeFileSync(
    path.join(root, 'registry.json'),
    JSON.stringify({ adapters: [{ adapter_id: 'fake-t2', verified: true }] }),
    'utf8',
  );
  const contracts = { 'fake-t1': contractOf('fake-t1'), 'fake-t2': contractOf('fake-t2') };
  const { pipeline, getCall, breaker } = makePipeline(root, {
    contracts,
    gate: {
      check: async (id) => okResult(id, 3),
      refresh: async (id) => okResult(id, 3),
      snapshot: () => [okResult('fake-t1', 3), okResult('fake-t2', 3)],
    },
    runs: [
      { adapter: 'fake-t1', exitCode: 1 },
      { adapter: 'fake-t2', exitCode: 0 },
    ],
    breakerFailuresBefore: 2,
  });
  try {
    const rec = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'task', real: true, cap_usd: 0.1 });
    assert.equal(rec.status, 'FAIL');
    assert.equal(getCall(), 1, '首败即触发停机：停链不换道（保险丝优先）');
    assert.equal(breaker.snapshot().halted, true);
    assert.equal(rec.failover_from, undefined, '未发生换道');
    const next = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'again', real: true, cap_usd: 0.1 });
    assert.equal(next.status, 'REJECTED', '停机期真实单拒绝');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
