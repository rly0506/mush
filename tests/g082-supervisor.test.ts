import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionSupervisor, type SupervisorHooks } from '../src/core/mission-supervisor.ts';

// GOAL-082：任务监理——滞判、干预阶梯（换道→重排→升级）、受阻自解冻、完成核验门。

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

const IN_FLIGHT = { dispatch_id: 'd1', task_id: 't1', adapter_id: 'dogA', status: 'ADMITTED', error: null };

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

test('GOAL-082 干预阶梯：一→二→三级逐级升级，升级后监理停手', async () => {
  const steps: string[] = [];
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: {
      retryDispatch: async () => {
        steps.push('retry');
        return true;
      },
      replanRequest: async (taskId, report) => {
        steps.push('replan:' + report.failure_count + ':' + (report.last_dispatch_id ?? 'none'));
      },
      escalate: (taskId, question) => {
        steps.push('escalate');
        assert.match(question, /请确认/);
        assert.match(question, /t1/);
      },
    },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  advanceMinutes(10);
  await supervisor.sweep(); // 一级 retry
  advanceMinutes(10);
  await supervisor.sweep(); // 二级 replan
  advanceMinutes(10);
  const third = await supervisor.sweep(); // 三级 escalate
  assert.deepEqual(steps, ['retry', 'replan:0:d1', 'escalate']);
  assert.deepEqual(third.escalated, ['t1']);
  advanceMinutes(10);
  const fourth = await supervisor.sweep();
  assert.equal(fourth.swept, 0, 'ESCALATED 后移交 owner，监理不再自动干预');
});

test('GOAL-082 一级入队失败即升二级；进展信号复位心跳', async () => {
  const { supervisor, advanceMinutes } = makeSupervisor({
    hooks: { retryDispatch: async () => false },
  });
  supervisor.observeDispatch(IN_FLIGHT);
  advanceMinutes(10);
  const first = await supervisor.sweep();
  assert.deepEqual(first.retried, ['t1']);
  assert.equal(supervisor.overview()[0].phase, 'REPLAN_PENDING', '入队失败立即升二级');
  // 恢复：新派发事件=进展
  supervisor.observeDispatch({ ...IN_FLIGHT, dispatch_id: 'd2', status: 'PASS' });
  assert.equal(supervisor.overview()[0].phase, 'HEALTHY');
  advanceMinutes(2);
  const sweep = await supervisor.sweep();
  assert.equal(sweep.swept, 0);
});

test('GOAL-082 受阻自解冻：归因犬恢复在线 → 自动转就绪（只解冻已恢复者）', () => {
  const unblocked: string[] = [];
  const { supervisor } = makeSupervisor();
  supervisor.noteBlocked('t-blocked-a', 'dogA');
  supervisor.noteBlocked('t-blocked-b', 'dogB');
  const unfrozen = supervisor.unfreezeRecovered(new Set(['dogA']), (taskId) => unblocked.push(taskId));
  assert.deepEqual(unfrozen, ['t-blocked-a']);
  assert.deepEqual(unblocked, ['t-blocked-a']);
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
  assert.deepEqual([honest.done, honest.verified], [true, false], '无验证钩子=放行但明示 unverified，绝不冒充已验证');
  assert.equal(ungated.supervisor.eventLog().at(-1)?.kind, 'unverified-done');
});

test('GOAL-082 无任务回链的派发不建档；失败计数只统计失败终态', async () => {
  const { supervisor, advanceMinutes } = makeSupervisor();
  supervisor.observeDispatch({ dispatch_id: 'x1', adapter_id: 'dogA', status: 'ADMITTED', error: null });
  advanceMinutes(30);
  const sweep = await supervisor.sweep();
  assert.equal(sweep.swept, 0, '无 task_id 事件不归监理管');
  supervisor.observeDispatch({ ...IN_FLIGHT, status: 'FAIL', error: 'exit 1' });
  supervisor.observeDispatch({ ...IN_FLIGHT, dispatch_id: 'd2', status: 'FAIL', error: 'exit 1' });
  assert.equal(supervisor.overview()[0].failure_count, 2);
  supervisor.observeDispatch({ ...IN_FLIGHT, dispatch_id: 'd3', status: 'PASS', error: null });
  assert.equal(supervisor.overview()[0].failure_count, 0, '成功清零失败计数');
});
