import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkDispatchClosure } from '../src/loop/closure.ts';
import { writeApprovalRequest } from '../src/loop/approval-gate.ts';

// GOAL-004 U5/U6：dispatch 闭环前置检查（READY/BLOCKED_ENV/BLOCKED_WAITING_OWNER
// 诚实输出）+ 触发门机制真实验证（预算门 APPROVAL_REQUEST 事件化，等 owner 应答）。

test('closure checker: READY requires approval + PASS dispatch evidence + ready env for every dog', () => {
  const result = checkDispatchClosure({
    approvals: ['deepseek-dsh.approved.json', 'claude-code.approved.json'],
    dispatchEvents: [
      { adapter_id: 'deepseek-dsh', status: 'PASS', exit_code: 0, nonce_matched: true },
      { adapter_id: 'claude-code', status: 'PASS', exit_code: 0, nonce_matched: true },
    ],
    envReady: { deepseek: true, claude: true },
  });
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.reasons, []);
});

test('closure checker: missing approval record = BLOCKED_WAITING_OWNER (never fabricated)', () => {
  const result = checkDispatchClosure({
    approvals: [],
    dispatchEvents: [],
    envReady: { deepseek: false, claude: false },
  });
  assert.equal(result.status, 'BLOCKED_WAITING_OWNER');
  assert.ok(result.reasons.some((reason) => /owner/i.test(reason)));
});

test('closure checker: credential environment not ready = BLOCKED_ENV with per-dog reasons', () => {
  const result = checkDispatchClosure({
    approvals: ['deepseek-dsh.approved.json', 'claude-code.approved.json'],
    dispatchEvents: [
      { adapter_id: 'deepseek-dsh', status: 'FAIL', exit_code: 1, nonce_matched: false },
      { adapter_id: 'claude-code', status: 'FAIL', exit_code: 1, nonce_matched: false },
    ],
    envReady: { deepseek: false, claude: false },
  });
  assert.equal(result.status, 'BLOCKED_ENV');
  assert.ok(result.reasons.some((reason) => /deepseek/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /claude/i.test(reason)));
});

test('budget gate writes an APPROVAL_REQUEST event and waits for owner (small artificial scenario)', () => {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'approval-requests');
  const request = writeApprovalRequest(root, 'actor-fixture', 0.01, 0.02, 'fixture budget gate trigger');
  assert.equal(request.schema_version, 1);
  assert.equal(request.gate, 'BUDGET_GATE');
  assert.equal(request.status, 'WAITING_OWNER_APPROVAL');
  assert.ok(existsSync(request.path));
  const onDisk = JSON.parse(readFileSync(request.path, 'utf8')) as Record<string, unknown>;
  assert.equal(onDisk.actor_id, 'actor-fixture');
  assert.equal(onDisk.cap_usd, 0.01);
  assert.equal(onDisk.amount_usd, 0.02);
  assert.equal(onDisk.reason, 'fixture budget gate trigger');
});

test('budget gate requests use unique paths and keep append-only evidence distinct', () => {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'approval-requests');
  const first = writeApprovalRequest(root, 'actor-a', 0.01, 0.02, 'first');
  const second = writeApprovalRequest(root, 'actor-a', 0.01, 0.02, 'second');
  assert.notEqual(first.path, second.path);
});
