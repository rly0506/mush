import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MissionSupervisor, type SupervisorHooks } from '../src/core/mission-supervisor.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { validateAdapterContract } from '../src/adapters/contract.ts';
import { appendTask, createTask, loadTasks } from '../src/web/tasks.ts';

// GOAL-082：任务监理——滞判、干预阶梯（换道→重排→升级）、受阻自解冻、完成核验门。
// 审计修正后语义：FAIL/REJECTED 不复位心跳；一级钩子三态（true/'rejected'/false）。

function makeSupervisor(opts: { thresholdMs?: number; hooks?: SupervisorHooks; startAt?: string } = {}) {
  let now = new Date(opts.startAt ?? '2026-08-29T10:00:00Z');
  const supervisor = new MissionSupervisor({
    now: () => now,
    stallThresholdMs: opts.thresholdMs ?? 5 * 60_000,
    hooks: opts.hooks,
  });
  return {
    supervisor,
    advanceMinutes(min: number): void {
      now = new Date(now.getTime() + min * 60_000);
    },
  };
}

const IN_FLIGHT = { dispatch_id: 'd1', task_id: 't1', adapter_id: 'dogA', status: 'ADMITTED', error: null, real: true };

test('GOAL-082 滞判与一级干预：超阈值 → 换道重试（钩子被调）', async () => {
  const retryCalls: string[] = [];
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: { retryDispatch: async (taskId) => { retryCalls.push(taskId); return true; } },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  advanceMinutes(2);
  let sweep = await supervisor.sweep();
  assert.equal(sweep.swept, 0, '阈值内不算滞');
  advanceMinutes(6);
  sweep = await supervisor.sweep();
  assert.equal(sweep.swept, 1);
  assert.deepEqual(retryCalls, ['t1']);
  assert.equal(supervisor.overview()[0].phase, 'RETRYING');
  assert.match(supervisor.eventLog().at(-1)?.detail ?? '', /滞涩/);
});

test('GOAL-082 审计 P0：失败终态不复位心跳——死通道反复重试也会滞判升级', async () => {
  const steps: string[] = [];
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: {
      retryDispatch: async () => {
        steps.push('retry');
        return true;
      },
      escalate: (taskId, question) => {
        steps.push('escalate');
        assert.match(question, /t1/);
        assert.match(question, /累计失败 5 次/);
      },
    },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  // 反复失败重试：每次 FAIL 都是新事件，但都不是进展
  for (let i = 0; i < 5; i++) {
    advanceMinutes(3);
    supervisor.observeDispatch({ ...IN_FLIGHT, dispatch_id: 'df' + i, status: 'FAIL', error: 'exit 1' });
  }
  advanceMinutes(3);
  await supervisor.sweep(); // 一级 retry
  advanceMinutes(10);
  await supervisor.sweep(); // 二级 replan
  advanceMinutes(10);
  await supervisor.sweep(); // 三级 escalate——失败循环不能永远停在一级
  assert.deepEqual(steps, ['retry', 'escalate'], '持续失败必须升级，不许一级死循环');
});

test('GOAL-082 审计 P0：一级被熔断拒绝（rejected）→ 直接跳三级，不空转', async () => {
  const steps: string[] = [];
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: {
      retryDispatch: async () => {
        steps.push('retry');
        return 'rejected';
      },
      replanRequest: async () => {
        steps.push('replan');
      },
      escalate: () => {
        steps.push('escalate');
      },
    },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  advanceMinutes(10);
  const first = await supervisor.sweep();
  assert.deepEqual(steps, ['retry', 'escalate'], '熔断拒绝当轮直接升级');
  assert.deepEqual(first.escalated, ['t1']);
  assert.equal(supervisor.overview()[0].phase, 'ESCALATED');
  advanceMinutes(10);
  const second = await supervisor.sweep();
  assert.equal(second.swept, 0, '升级后停手');
});

test('GOAL-082 干预阶梯：入队失败（false）→ 升二级 → 三级，升级后停手', async () => {
  const steps: string[] = [];
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: {
      retryDispatch: async () => {
        steps.push('retry');
        return false;
      },
      replanRequest: async (_taskId, report) => {
        steps.push('replan:' + report.failure_count + ':' + (report.last_dispatch_id ?? 'none') + ':real=' + report.last_real);
      },
      escalate: () => {
        steps.push('escalate');
      },
    },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  advanceMinutes(10);
  await supervisor.sweep(); // 一级 retry（入队失败→当轮升二级）
  assert.equal(supervisor.overview()[0].phase, 'REPLAN_PENDING');
  advanceMinutes(10);
  await supervisor.sweep(); // 二级 replan
  advanceMinutes(10);
  await supervisor.sweep(); // 三级 escalate
  assert.deepEqual(steps, ['retry', 'replan:0:d1:real=true', 'escalate']);
  advanceMinutes(10);
  const fourth = await supervisor.sweep();
  assert.equal(fourth.swept, 0, 'ESCALATED 后移交 owner');
});

test('GOAL-082 恢复语义：ADMITTED/PASS 复位心跳，ESCALATED 不被自动拉回', async () => {
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: { retryDispatch: async () => true },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  advanceMinutes(10);
  await supervisor.sweep(); // 一级
  supervisor.observeDispatch({ ...IN_FLIGHT, dispatch_id: 'd2', status: 'PASS' });
  assert.equal(supervisor.overview()[0].phase, 'HEALTHY', '真进展复位');
  advanceMinutes(2);
  assert.equal((await supervisor.sweep()).swept, 0);
  // 升级后的任务：即使有新事件也不自动降级（owner 终裁）——独立时钟实例
  const escalated = makeSupervisor({ hooks: { retryDispatch: async () => 'rejected' } });
  escalated.supervisor.observeDispatch(IN_FLIGHT);
  escalated.advanceMinutes(10);
  await escalated.supervisor.sweep();
  assert.equal(escalated.supervisor.overview()[0].phase, 'ESCALATED');
  escalated.supervisor.observeDispatch({ ...IN_FLIGHT, dispatch_id: 'd9', status: 'PASS' });
  assert.equal(escalated.supervisor.overview()[0].phase, 'ESCALATED', 'owner 终裁前不复活');
});

test('GOAL-082 受阻自解冻：归因犬恢复在线 → 自动转就绪；unblock 失败不记假证据', () => {
  const unblocked: string[] = [];
  const { supervisor } = makeSupervisor();
  supervisor.noteBlocked('t-a', 'dogA');
  supervisor.noteBlocked('t-stale', 'dogB');
  const unfrozen = supervisor.unfreezeRecovered(new Set(['dogA']), (taskId) => {
    if (taskId === 't-stale') throw new Error('stale task');
    unblocked.push(taskId);
  });
  assert.deepEqual(unfrozen, ['t-a'], '解冻失败者不进清单不发假事件');
  assert.deepEqual(unblocked, ['t-a']);
  assert.equal(supervisor.eventLog().filter((e) => e.kind === 'unfrozen').length, 1);
});

test('GOAL-082 完成核验门：虚假完工声明被拦截；无钩子时诚实 unverified 放行', async () => {
  const gated = makeSupervisor({
    hooks: { verifyCompletion: async (_taskId, claim) => (claim.includes('全部完成') ? { ok: true } : { ok: false, reason: 'GoD 未满足：测试未跑' }) },
  });
  const rejected = await gated.supervisor.approveCompletion('t1', '做了一半');
  assert.equal(rejected.done, false);
  assert.match(rejected.reason ?? '', /GoD 未满足/);
  assert.equal(gated.supervisor.eventLog().at(-1)?.kind, 'completion-rejected');
  const passed = await gated.supervisor.approveCompletion('t1', '全部完成');
  assert.deepEqual([passed.done, passed.verified], [true, true]);

  const ungated = makeSupervisor();
  const honest = await ungated.supervisor.approveCompletion('t2', '宣称完成');
  assert.deepEqual([honest.done, honest.verified], [true, false], '无验证钩子=放行但明示 unverified');
  assert.equal(ungated.supervisor.eventLog().at(-1)?.kind, 'unverified-done');
});

test('GOAL-082 管线级完成门：completionGate 拒绝 → G024 自动推进不落 DONE', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g082-gate-'));
  mkdirSync(path.join(root, 'ws'), { recursive: true });
  const tasksPath = path.join(root, 'tasks.jsonl');
  const seed = createTask({ title: '审计用任务', priority: '中', source: 'g082' }, () => new Date());
  appendTask(tasksPath, seed);
  let gatedCalls = 0;
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    approvalTokensPath: path.join(root, 'tokens'),
    tasksPath,
    contracts: {
      'fake-t1': validateAdapterContract({
        adapter_id: 'fake-t1',
        executable: 'fake.exe',
        arguments: ['--headless'],
        protocol: 't1',
        prompt_transport: 'stdin',
        expected_provider: 'fake',
        expected_model_id: 'fake-model',
      }),
    },
    completionGate: async () => {
      gatedCalls += 1;
      return { done: false, reason: 'GoD 未满足：验收物缺失' };
    },
    runAdapter: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false }),
  });
  try {
    const rec = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'task', dry_run: true, task_id: seed.task_id });
    assert.equal(rec.status, 'DRY_RUN');
    assert.equal(gatedCalls, 1, 'PASS 后完成门被询问');
    const events = JSON.stringify(rec.events);
    assert.match(events, /completion_rejected/);
    const task = loadTasks(tasksPath).find((t) => t.task_id === seed.task_id);
    assert.notEqual(task?.status, 'DONE', '被拦下：不许自动落 DONE');
    assert.equal(task?.status, 'IN_FLIGHT', '留在监理视野');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
