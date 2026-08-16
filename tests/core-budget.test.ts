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
