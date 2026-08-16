import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LoopStateMachine } from '../src/loop/loop.ts';
import { advanceAfterReview, machineReview } from '../src/loop/review.ts';
import { buildRoleSwap, recordRoleSwap } from '../src/loop/role-swap.ts';

// GOAL-004 U3/U4：头犬机检审核门（FAIL 不得进 ACCEPT）+
// 头犬/执行犬对调实验骨架（ROLE_SWAP 证据，真跑待凭据）。

test('machineReview PASS requires exit 0, not timed out, identity ok, nonce proven at runtime', () => {
  const pass = machineReview({
    schema_version: 1,
    exit_code: 0,
    timed_out: false,
    identity_fail_closed: false,
    nonce_matched: true,
    stdout_sha256: 'A'.repeat(64),
  });
  assert.equal(pass.verdict, 'PASS');
  assert.deepEqual(pass.reasons, []);
});

test('machineReview FAILs on exit code, timeout, identity fail-closed, or missing runtime nonce proof', () => {
  assert.equal(machineReview({ schema_version: 1, exit_code: 63, timed_out: false, identity_fail_closed: false }).verdict, 'FAIL');
  assert.equal(machineReview({ schema_version: 1, exit_code: 0, timed_out: true, identity_fail_closed: false }).verdict, 'FAIL');
  assert.equal(machineReview({ schema_version: 1, exit_code: 0, timed_out: false, identity_fail_closed: true }).verdict, 'FAIL');
  const noNonce = machineReview({ schema_version: 1, exit_code: 0, timed_out: false, identity_fail_closed: false, nonce_matched: false });
  assert.equal(noNonce.verdict, 'FAIL');
  assert.ok(noNonce.reasons.some((reason) => /nonce/i.test(reason)));
});

test('REVIEW gate: PASS advances REVIEW->ACCEPT; FAIL stays REVIEW and can never reach ACCEPT', () => {
  const passLoop = new LoopStateMachine('run-review-pass');
  for (const step of ['RECOMMEND', 'CONFIRM', 'DISPATCH', 'EXECUTE', 'REPORT'] as const) {
    passLoop.transition(step, {});
  }
  const passResult = advanceAfterReview(passLoop, { schema_version: 1, exit_code: 0, timed_out: false, identity_fail_closed: false, nonce_matched: true });
  assert.equal(passResult.verdict, 'PASS');
  assert.equal(passLoop.state, 'ACCEPT');
  assert.doesNotThrow(() => passLoop.verifyChain());

  const failLoop = new LoopStateMachine('run-review-fail');
  for (const step of ['RECOMMEND', 'CONFIRM', 'DISPATCH', 'EXECUTE', 'REPORT'] as const) {
    failLoop.transition(step, {});
  }
  const failResult = advanceAfterReview(failLoop, { schema_version: 1, exit_code: 1, timed_out: false, identity_fail_closed: false });
  assert.equal(failResult.verdict, 'FAIL');
  assert.equal(failLoop.state, 'REVIEW');
  assert.throws(() => failLoop.transition('ACCEPT', {}), /verdict|ACCEPT/i, 'FAIL must not reach ACCEPT through the state machine');
});

test('role swap skeleton records swapped head/executor with a hash anchor', () => {
  const assignment = buildRoleSwap('claude-code', 'deepseek-dsh');
  assert.deepEqual(assignment, { head: 'claude-code', executor: 'deepseek-dsh', swapped: true });
  const evidencePath = path.resolve(process.cwd(), '.test-fixtures', 'role-swap-evidence.json');
  const record = recordRoleSwap(evidencePath, assignment);
  assert.ok(existsSync(evidencePath));
  assert.equal(record.swapped, true);
  assert.equal(record.head, 'claude-code');
  assert.equal(record.executor, 'deepseek-dsh');
  assert.match(record.sha256, /^[0-9A-F]{64}$/i);
  const onDisk = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
  assert.equal(onDisk.schema_version, 1);
  assert.equal(onDisk.swapped, true);
  const expected = createHash('sha256')
    .update(JSON.stringify({ schema_version: 1, swapped_at_utc: record.swapped_at_utc, head: 'claude-code', executor: 'deepseek-dsh', swapped: true }))
    .digest('hex')
    .toUpperCase();
  assert.equal(record.sha256, expected);
});
