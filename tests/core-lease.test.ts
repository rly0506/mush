import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeaseManager, type LeaseHolder, type LeaseRecord } from '../src/core/lease.ts';
import { assertRuntimeIdentity } from '../src/core/identity.ts';

// PS 源追溯（黄金参照，只读）：
//   bridge-orchestrator.lease.tests.ps1 L247-L277
//     并发 runner 的 run lease：同 run root 第二持有者被拒（'already leased'），
//     不同 Goal/run root 可并发完成
//   bridge-orchestrator.rebind.tests.ps1 L641（stale-actor rejection + capability
//     rotation）、L655（rebind rejects a held run lease）
//   invoke-managed-pi-agent.ps1 L351-L352（运行时身份 fail-closed：
//     wrong-runtime-model 即停）
//   start-goal-orchestrator.ps1 L1858-L1868（身份 tuple 绑定校验同源规则）

function makeHolder(overrides: Partial<LeaseHolder> = {}): LeaseHolder {
  return {
    role: 'backend_executor',
    instanceId: 'executor-instance-1',
    provider: 'deepseek',
    modelId: 'deepseek-v4-pro',
    ...overrides,
  };
}

function fixedClock(startIso: string): { now: () => Date; advance: (ms: number) => void } {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test('lease grant creates a GRANTED lease with ttl and an anchored audit history', () => {
  const clock = fixedClock('2026-08-17T00:00:00.000Z');
  const manager = new LeaseManager(clock.now);
  const lease = manager.grant({
    runId: 'run-lease-fixture',
    assignmentEpoch: 1,
    holder: makeHolder(),
    ttlMs: 30_000,
  });
  assert.equal(lease.state, 'GRANTED');
  assert.match(lease.leaseId, /^[0-9a-f]{32}$/i);
  assert.equal(lease.expiresAtUtc, '2026-08-17T00:00:30.000Z');
  assert.equal(lease.history.length, 1);
  assert.equal(lease.history[0].transition, 'GRANTED');
});

test('duplicate grant on the same run root is rejected while active; the original holder survives', () => {
  const manager = new LeaseManager();
  const first = manager.grant({
    runId: 'run-lease-fixture',
    assignmentEpoch: 1,
    holder: makeHolder(),
    ttlMs: 30_000,
  });
  assert.throws(
    () =>
      manager.grant({
        runId: 'run-lease-fixture',
        assignmentEpoch: 1,
        holder: makeHolder({ instanceId: 'executor-instance-2' }),
        ttlMs: 30_000,
      }),
    /already leased/i,
  );
  assert.equal(manager.get('run-lease-fixture')?.holder.instanceId, first.holder.instanceId);
});

test('independent run roots are leased concurrently (PS L268-L277)', () => {
  const manager = new LeaseManager();
  const first = manager.grant({
    runId: 'run-1',
    assignmentEpoch: 1,
    holder: makeHolder(),
    ttlMs: 30_000,
  });
  const second = manager.grant({
    runId: 'run-2',
    assignmentEpoch: 1,
    holder: makeHolder({ instanceId: 'executor-run-2' }),
    ttlMs: 30_000,
  });
  assert.equal(first.runId, 'run-1');
  assert.equal(second.runId, 'run-2');
  assert.notEqual(first.leaseId, second.leaseId);
});

test('active lease holder check is fail-closed on wrong holder and on expiry', () => {
  const clock = fixedClock('2026-08-17T00:00:00.000Z');
  const manager = new LeaseManager(clock.now);
  const holder = makeHolder();
  manager.grant({ runId: 'run-x', assignmentEpoch: 1, holder, ttlMs: 1_000 });
  assert.doesNotThrow(() => manager.assertHolder('run-x', holder));
  assert.throws(() => manager.assertHolder('run-x', makeHolder({ instanceId: 'other' })), /holder|lease/i);
  clock.advance(1_001);
  assert.throws(() => manager.assertHolder('run-x', holder), /expired/i);
});

test('rebind transitions GRANTED -> REBOUND and rotates the holder (PS rebind L641)', () => {
  const manager = new LeaseManager();
  const oldHolder = makeHolder();
  manager.grant({ runId: 'run-rebind', assignmentEpoch: 1, holder: oldHolder, ttlMs: 30_000 });
  const newHolder = makeHolder({ instanceId: 'executor-instance-2', provider: 'gpt', modelId: 'gpt-5.6-sol-xhigh' });
  const rebound = manager.rebind('run-rebind', newHolder);
  assert.equal(rebound.state, 'REBOUND');
  assert.equal(rebound.holder.instanceId, 'executor-instance-2');
  assert.throws(() => manager.assertHolder('run-rebind', oldHolder), /holder|lease/i, 'stale actor must be rejected');
  assert.doesNotThrow(() => manager.assertHolder('run-rebind', newHolder));
});

test('rebind on an expired lease is rejected with the recover path (PS rebind L655 held-lease spirit)', () => {
  const clock = fixedClock('2026-08-17T00:00:00.000Z');
  const manager = new LeaseManager(clock.now);
  manager.grant({ runId: 'run-expired-rebind', assignmentEpoch: 1, holder: makeHolder(), ttlMs: 1_000 });
  clock.advance(1_001);
  assert.throws(() => manager.rebind('run-expired-rebind', makeHolder({ instanceId: 'x' })), /expired|recover/i);
});

test('expiry marks the lease EXPIRED but keeps the record and history', () => {
  const clock = fixedClock('2026-08-17T00:00:00.000Z');
  const manager = new LeaseManager(clock.now);
  manager.grant({ runId: 'run-expiry', assignmentEpoch: 1, holder: makeHolder(), ttlMs: 500 });
  clock.advance(501);
  const lease = manager.get('run-expiry') as LeaseRecord;
  assert.equal(lease.state, 'EXPIRED');
  assert.equal(lease.history.some((entry) => entry.transition === 'EXPIRED'), true);
});

test('recovery transitions EXPIRED -> RECOVERED and binds the replacement holder', () => {
  const clock = fixedClock('2026-08-17T00:00:00.000Z');
  const manager = new LeaseManager(clock.now);
  const oldHolder = makeHolder();
  manager.grant({ runId: 'run-recovery', assignmentEpoch: 1, holder: oldHolder, ttlMs: 500 });
  clock.advance(501);
  const newHolder = makeHolder({ instanceId: 'recovery-instance' });
  const recovered = manager.recover('run-recovery', newHolder);
  assert.equal(recovered.state, 'RECOVERED');
  assert.doesNotThrow(() => manager.assertHolder('run-recovery', newHolder));
  assert.throws(() => manager.assertHolder('run-recovery', oldHolder), /holder|lease/i);
});

test('recovery of a non-expired lease fails closed (PS recovery L241 spirit)', () => {
  const manager = new LeaseManager();
  manager.grant({ runId: 'run-active-recovery', assignmentEpoch: 1, holder: makeHolder(), ttlMs: 30_000 });
  assert.throws(
    () => manager.recover('run-active-recovery', makeHolder({ instanceId: 'recovery-x' })),
    /not expired|recover/i,
  );
});

test('runtime identity is fail-closed: provider, model, and instance must match exactly', () => {
  const expected = {
    provider: 'deepseek',
    modelId: 'deepseek-v4-pro',
    role: 'backend_executor',
    instanceId: 'executor-instance-1',
  };
  assert.doesNotThrow(() =>
    assertRuntimeIdentity(
      { provider: 'deepseek', modelId: 'deepseek-v4-pro', role: 'backend_executor', instanceId: 'executor-instance-1' },
      expected,
    ),
  );
  assert.throws(
    () => assertRuntimeIdentity({ provider: 'other', modelId: 'deepseek-v4-pro', role: 'backend_executor', instanceId: 'executor-instance-1' }, expected),
    /provider|identity/i,
  );
  assert.throws(
    () => assertRuntimeIdentity({ provider: 'deepseek', modelId: 'wrong-model', role: 'backend_executor', instanceId: 'executor-instance-1' }, expected),
    /model|identity/i,
  );
  assert.throws(
    () => assertRuntimeIdentity({ provider: 'deepseek', modelId: 'deepseek-v4-pro', role: 'backend_executor', instanceId: 'other-instance' }, expected),
    /instance|identity/i,
  );
});
