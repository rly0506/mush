import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsdBudgetLedger, addBudgetUsage, createLocalBudget, testBudget } from '../src/core/budget.ts';

// PS 源追溯（黄金参照，只读）：
//   bridge-quota.tests.ps1 L67-L74
//     本地预算记账：calls/elapsed/evidence 三维上限；超限 allowed=False；
//     reason 机器可读（MODEL_CALL_LIMIT 等）
//   CONSTITUTION.md §1.1 + GOAL-002：per-actor USD cap + admission 门（非阻断记账）

test('local budget accounts calls/elapsed/evidence and pauses at configured limits (PS L67-L74)', () => {
  let budget = createLocalBudget({ maxCalls: 3, maxWallClockSeconds: 60, maxEvidenceBytes: 1000 });
  budget = addBudgetUsage(budget, { calls: 2, elapsedSeconds: 5, evidenceBytes: 100 });
  assert.equal(budget.callsUsed, 2);
  assert.deepEqual(testBudget(budget, { calls: 1, elapsedSeconds: 5, evidenceBytes: 100 }), {
    allowed: true,
    reason: null,
  });
  budget = addBudgetUsage(budget, { calls: 1, elapsedSeconds: 5, evidenceBytes: 100 });
  assert.deepEqual(testBudget(budget, { calls: 1 }), { allowed: false, reason: 'MODEL_CALL_LIMIT' });
});

test('local budget pauses with machine-readable reasons for clock and evidence limits', () => {
  const callBudget = addBudgetUsage(createLocalBudget({ maxCalls: 1, maxWallClockSeconds: 60, maxEvidenceBytes: 1000 }), {
    calls: 1,
    elapsedSeconds: 0,
    evidenceBytes: 0,
  });
  assert.deepEqual(testBudget(callBudget, { calls: 1 }), { allowed: false, reason: 'MODEL_CALL_LIMIT' });
  const clockBudget = addBudgetUsage(createLocalBudget({ maxCalls: 10, maxWallClockSeconds: 10, maxEvidenceBytes: 1000 }), {
    calls: 0,
    elapsedSeconds: 9,
    evidenceBytes: 0,
  });
  assert.deepEqual(testBudget(clockBudget, { calls: 0, elapsedSeconds: 2 }), {
    allowed: false,
    reason: 'WALL_CLOCK_LIMIT',
  });
  const evidenceBudget = addBudgetUsage(createLocalBudget({ maxCalls: 10, maxWallClockSeconds: 60, maxEvidenceBytes: 100 }), {
    calls: 0,
    elapsedSeconds: 0,
    evidenceBytes: 90,
  });
  assert.deepEqual(testBudget(evidenceBudget, { calls: 0, elapsedSeconds: 0, evidenceBytes: 20 }), {
    allowed: false,
    reason: 'EVIDENCE_BYTES_LIMIT',
  });
});

test('per-actor USD ledger admits within cap and denies over cap (event-ized, non-blocking)', () => {
  const ledger = new UsdBudgetLedger();
  const admitted = ledger.admit({
    actorId: 'actor-a',
    capUsd: 5,
    amountUsd: 0.3,
    meta: { unit: 'U1' },
  });
  assert.equal(admitted.decision, 'ADMITTED');
  assert.equal(admitted.remainingUsd, 4.7);
  assert.equal(ledger.spentUsd('actor-a'), 0.3);
  assert.equal(ledger.remainingUsd('actor-a', 5), 4.7);
  const denied = ledger.admit({ actorId: 'actor-a', capUsd: 5, amountUsd: 4.8, meta: { unit: 'U1' } });
  assert.equal(denied.decision, 'DENIED');
  assert.equal(denied.remainingUsd, 4.7, 'denied admission must not change remaining budget');
  assert.equal(ledger.spentUsd('actor-a'), 0.3);
});

test('USD ledger keeps every admission as a hash-chained audit entry and isolates actors', () => {
  const ledger = new UsdBudgetLedger();
  ledger.admit({ actorId: 'actor-a', capUsd: 5, amountUsd: 1, meta: { unit: 'U1' } });
  ledger.admit({ actorId: 'actor-a', capUsd: 5, amountUsd: 99, meta: { unit: 'U2' } });
  ledger.admit({ actorId: 'actor-b', capUsd: 5, amountUsd: 2, meta: { unit: 'U1' } });
  const entriesA = ledger.entries('actor-a');
  assert.equal(entriesA.length, 2, 'both admitted and denied events must be recorded');
  assert.equal(entriesA[0].decision, 'ADMITTED');
  assert.equal(entriesA[1].decision, 'DENIED');
  assert.equal(entriesA[1].previous_sha256, entriesA[0].sha256);
  assert.doesNotThrow(() => ledger.verify('actor-a'));
  assert.equal(ledger.spentUsd('actor-b'), 2, 'per-actor accounts stay isolated');
  assert.equal(ledger.spentUsd('actor-a'), 1);
});

/** GOAL-085（独立审核发现的实际缺陷，2026-10-05）：实付超 cap 时此前被记 DENIED 且
 *  完全不计入 spentUsd，导致"钱已经花了但账本当没花"，后续请求继续被放行。
 *  正确语义：**已经发生的消耗必须计入支出**，并据此阻断后续准入。 */
test('GOAL-085：实付超过 cap 时仍必须计入支出，并阻断后续准入', () => {
  const ledger = new UsdBudgetLedger();
  const reserve = ledger.admit({ actorId: 'claude-code', capUsd: 0.1, amountUsd: 0, meta: { dispatch_id: 'd1' } });
  assert.equal(reserve.decision, 'ADMITTED', '零预估的准入行本身应通过');
  const actual = ledger.recordActualUsage({
    actorId: 'claude-code', capUsd: 0.1, actualCostUsd: 0.34339, meta: { dispatch_id: 'd1' },
  });
  // 实付行本身可以因超 cap 被标 DENIED（它不是在申请额度，而是在登记已花掉的钱），
  // 但金额**必须**进入支出。
  assert.equal(actual.amountUsd, 0.34339);
  assert.equal(ledger.spentUsd('claude-code'), 0.34339, '实付必须计入 spentUsd，哪怕该行被标 DENIED');
  const next = ledger.admit({ actorId: 'claude-code', capUsd: 0.1, amountUsd: 0, meta: { dispatch_id: 'd2' } });
  assert.equal(next.decision, 'DENIED', '已超 cap 后，后续请求必须被拒绝');
  assert.equal(next.spentBeforeUsd, 0.34339, '门禁看到的 spentBefore 必须含这笔实付');
  // 幂等对账：重复登记同一笔实付不会让支出翻倍之外地丢失（金额如实累加，哈希链可校验）。
  assert.doesNotThrow(() => ledger.verify('claude-code'));
});

/** GOAL-085 第二轮边界（独立复核发现）：有预估时，实付必须**替代**预估而不是叠加。
 *  覆盖判定不得要求实付行是 ADMITTED——实付行可能因超 cap 被标 DENIED，
 *  但它仍然是"这笔钱已经花了"的事实记录。 */
test('GOAL-085：同派发的实付替代预估，不受实付行 decision 影响（不重复计费）', () => {
  const cases = [
    { reserved: 0, actual: 0.34339, expected: 0.34339 },
    { reserved: 0.05, actual: 0.34339, expected: 0.34339 },
    { reserved: 0.08, actual: 0.09, expected: 0.09 },
  ];
  for (const c of cases) {
    const ledger = new UsdBudgetLedger();
    ledger.admit({ actorId: 'fixture', capUsd: 0.1, amountUsd: c.reserved, meta: { dispatch_id: 'one' } });
    ledger.recordActualUsage({ actorId: 'fixture', capUsd: 0.1, actualCostUsd: c.actual, meta: { dispatch_id: 'one' } });
    assert.equal(ledger.spentUsd('fixture'), c.expected,
      `预估 ${c.reserved} + 实付 ${c.actual} 的支出应为 ${c.expected}（实付替代预估）`);
  }
});
