import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  arbitrateUnattended,
  clampPolicyToMasterCap,
  DEFAULT_POLICY,
  loadUnattendedPolicy,
  saveUnattendedPolicy,
} from '../src/core/unattended-policy.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

// GOAL-073：无人值守分级授权 + 失控熔断。

test('GOAL-073 Unit：默认恒 L0（缺失/损坏文件 fail-closed）', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g073-a-'));
  assert.equal(loadUnattendedPolicy(root).level, 'L0', '缺省必须 L0');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'unattended-policy.json'), '{{{corrupt', 'utf8');
  const p = loadUnattendedPolicy(root);
  assert.equal(p.level, 'L0');
  assert.deepEqual(p.task_whitelist_prefixes, []);
  rmSync(root, { recursive: true, force: true });
});

test('GOAL-073 Unit：仲裁规则（L0 全弹卡/L1 超额弹卡/L2 白名单）与 master clamp', () => {
  assert.equal(arbitrateUnattended({ level: 'L0', cap_usd: 0.1, auto_approve_cap_usd: 1, daily_auto_spent_usd: 0 }).decision, 'defer-to-owner');
  assert.equal(
    arbitrateUnattended({ level: 'L1', cap_usd: 0.5, auto_approve_cap_usd: 1, daily_auto_spent_usd: 0 }).decision,
    'auto-approve',
  );
  assert.equal(
    arbitrateUnattended({ level: 'L1', cap_usd: 2, auto_approve_cap_usd: 1, daily_auto_spent_usd: 0 }).reason,
    '超额：$2 > 单笔上限 $1',
  );
  assert.equal(
    arbitrateUnattended({ level: 'L1', cap_usd: 0.5, auto_approve_cap_usd: 1, daily_auto_budget_usd: 1, daily_auto_spent_usd: 0.9 }).decision,
    'defer-to-owner',
    '当日硬顶',
  );
  assert.equal(
    arbitrateUnattended({ level: 'L2', cap_usd: 0.5, auto_approve_cap_usd: 1, daily_auto_spent_usd: 0, goal_id: 'RM-011-x' , task_whitelist_prefixes: ['RM-011'] }).decision,
    'auto-approve',
  );
  assert.equal(
    arbitrateUnattended({ level: 'L2', cap_usd: 0.5, auto_approve_cap_usd: 1, daily_auto_spent_usd: 0, goal_id: 'OTHER' , task_whitelist_prefixes: ['RM-011'] }).decision,
    'defer-to-owner',
  );
  const clamped = clampPolicyToMasterCap({ ...DEFAULT_POLICY, level: 'L1', auto_approve_cap_usd: 10, daily_auto_budget_usd: 50 }, 2);
  assert.equal(clamped.auto_approve_cap_usd, 2, '档位额度不得越过 master cap');
  assert.equal(clamped.daily_auto_budget_usd, 2);
});

function makeGatePipeline(root: string, opts: { level: 'L1' | 'L2'; cap: number; adapterExitCode?: number[] }) {
  let call = 0;
  const executed: string[] = [];
  const breaker = new CircuitBreaker(path.join(root, 'breaker.json'));
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    approvalTokensPath: path.join(root, 'tokens'),
    unattended: {
      policy: { level: opts.level, auto_approve_cap_usd: opts.cap, daily_auto_budget_usd: opts.cap * 100, task_whitelist_prefixes: ['RM-011'] },
      breaker,
    },
    runAdapter: async () => {
      call += 1;
      const code = opts.adapterExitCode ? (opts.adapterExitCode[call - 1] ?? 0) : 0;
      return { exitCode: code, stdout: code === 0 ? 'ok' : '', stderr: '', timedOut: false, childKilled: false };
    },
  });
  return { pipeline, breaker, executed, getCall: () => call };
}

test('GOAL-073 Gate：L1 低额自动批全程无人工（自铸令牌+台账留痕）；超额必弹卡', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g073-b-'));
  const { pipeline, executed, getCall } = makeGatePipeline(root, { level: 'L1', cap: 1 });
  try {
    // 低额真实派发：无需任何预置审批令牌
    const okRec = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'small task', real: true, cap_usd: 0.5 });
    assert.equal(okRec.status, 'PASS');
    assert.equal(getCall(), 1);
    const ledger = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8'));
    assert.ok(ledger.includes('"auto_approved":true'), 'ledger must carry auto_approved marker');

    // 超额：弹审批卡，不执行
    const over = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'big task', real: true, cap_usd: 5 });
    assert.equal(over.status, 'BLOCKED_WAITING_OWNER');
    assert.equal(getCall(), 1, 'over-cap must not execute');
    void executed;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-073 熔断：连败三次停机→真实单 REJECTED、干跑放行；reset 恢复；链完整', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g073-c-'));
  const { pipeline, breaker } = makeGatePipeline(root, {
    level: 'L1',
    cap: 1,
    adapterExitCode: [1, 1, 1, 0],
  });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'fail ' + i, real: true, cap_usd: 0.1 });
      if (i < 2) assert.notEqual(r.status, 'REJECTED');
    }
    assert.equal(breaker.snapshot().halted, true, '3 consecutive failures must trip');
    const rejected = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'while halted', real: true, cap_usd: 0.1 });
    assert.equal(rejected.status, 'REJECTED');
    assert.match(rejected.error ?? '', /circuit breaker halted/);
    const dry = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'diagnose', dry_run: true });
    assert.equal(dry.status, 'DRY_RUN', 'dry-run must stay available for diagnosis');

    breaker.reset('owner');
    assert.equal(breaker.snapshot().halted, false);
    const recovered = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'after reset', real: true, cap_usd: 0.1 });
    assert.equal(recovered.status, 'PASS');
    assert.equal(breaker.verifyEventChain(), true, 'audit replay chain must stay intact');
    const bundle = JSON.parse(breaker.exportBundle());
    assert.equal(bundle.chain_intact, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-073 熔断：预算斜率与单任务超时硬顶即停', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g073-d-'));
  const slopeBreaker = new CircuitBreaker(path.join(root, 'b-slope.json'), { budget_slope_usd_per_min: 5 });
  slopeBreaker.recordAutoSpend(6);
  assert.equal(slopeBreaker.snapshot().halted, true, 'slope $6/min > $5/min must trip');

  const timeoutBreaker = new CircuitBreaker(path.join(root, 'b-timeout.json'), { hard_timeout_ms: 900_000 });
  timeoutBreaker.recordTimeout(960_000, 'dispatch-x');
  assert.equal(timeoutBreaker.snapshot().halted, true, 'hard timeout must trip immediately');
  rmSync(root, { recursive: true, force: true });
});
