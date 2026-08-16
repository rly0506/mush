import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventLog, eventSha256, type EventLogEntry } from '../src/core/event-log.ts';
import { collectBoardSnapshot, type BoardSnapshot } from '../src/web/sources.ts';

// GOAL-005 U1：看板数据源层——只读消费事件流 + approval-requests 目录。
// 红线：绝不写任何状态、绝不引入第二状态源；快照 = 内存事件日志 + 磁盘审批文件。

function makeEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 2,
    event_id: 'a'.repeat(32),
    goal_id: 'MUSH-GOAL-005',
    run_id: 'board-test-run',
    assignment_epoch: 1,
    sequence: 1,
    parent_instance_id: 'head-dog',
    actor_role: 'executor',
    actor_instance_id: 'deepseek-dsh-001',
    dispatch_id: 'b'.repeat(32),
    event_type: 'DISPATCHED',
    phase: 1,
    finding_ids: [],
    packet_path: 'goals/receipts/x.json',
    packet_sha256: 'c'.repeat(64),
    config_digest: 'd'.repeat(64),
    capability_id: 'e'.repeat(32),
    signature: 'f'.repeat(64),
    provider: 'deepseek',
    model_id: 'deepseek-chat',
    created_at_utc: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeLog(...events: Record<string, unknown>[]): EventLog {
  const log = new EventLog('board-test-run', 1);
  events.forEach((event, index) => log.append({ ...event, sequence: index + 1 }));
  return log;
}

test('empty snapshot: no actors, no events, no approvals', () => {
  const snapshot = collectBoardSnapshot({ eventLogs: [], approvalRoot: '/nonexistent/board-test-dir' });
  assert.deepEqual(snapshot.actors, []);
  assert.deepEqual(snapshot.epochs, []);
  assert.deepEqual(snapshot.approvals, []);
  assert.ok(typeof snapshot.generated_at_utc === 'string');
});

test('snapshot projects event log into epoch chain with verified hashes', () => {
  const log = makeLog(
    makeEvent({ event_id: '1'.repeat(32), event_type: 'EPOCH_STARTED', actor_role: 'head', actor_instance_id: 'kimi-k3-head' }),
    makeEvent({ event_id: '2'.repeat(32), event_type: 'DISPATCHED' }),
  );
  const snapshot = collectBoardSnapshot({ eventLogs: [log], approvalRoot: '/nonexistent/board-test-dir' });
  assert.equal(snapshot.epochs.length, 1);
  const epoch = snapshot.epochs[0];
  assert.equal(epoch.run_id, 'board-test-run');
  assert.equal(epoch.assignment_epoch, 1);
  assert.equal(epoch.events.length, 2);
  assert.equal(epoch.chain_verified, true);
  assert.equal(epoch.events[0].previous_sha256, null);
  assert.equal(epoch.events[1].previous_sha256, epoch.events[0].sha256);
  assert.equal(epoch.events[0].sha256, eventSha256(log.events()[0].event));
  assert.equal(epoch.events[0].event_type, 'EPOCH_STARTED');
  assert.equal(epoch.events[0].actor_instance_id, 'kimi-k3-head');
});

test('actors are derived from the event stream (identity fields only, no credentials)', () => {
  const log = makeLog(
    makeEvent({ actor_instance_id: 'claude-sonnet-5-001', actor_role: 'executor', provider: 'anthropic', model_id: 'claude-sonnet-5', capability_id: 'a'.repeat(32) }),
    makeEvent({ actor_instance_id: 'claude-sonnet-5-001', actor_role: 'executor', provider: 'anthropic', model_id: 'claude-sonnet-5', capability_id: 'a'.repeat(32) }),
    makeEvent({ actor_instance_id: 'kimi-k3-head', actor_role: 'head', provider: 'moonshot', model_id: 'kimi-k3', capability_id: 'b'.repeat(32) }),
  );
  const snapshot = collectBoardSnapshot({ eventLogs: [log], approvalRoot: '/nonexistent/board-test-dir' });
  assert.equal(snapshot.actors.length, 2);
  const claude = snapshot.actors.find((actor) => actor.actor_instance_id === 'claude-sonnet-5-001');
  assert.ok(claude);
  assert.equal(claude.role, 'executor');
  assert.equal(claude.provider, 'anthropic');
  assert.equal(claude.model_id, 'claude-sonnet-5');
  assert.equal(claude.event_count, 2);
  // 密钥红线：actor 投影只允许身份/角色字段。
  assert.deepEqual(
    Object.keys(claude).sort(),
    ['actor_instance_id', 'capability_id', 'event_count', 'last_event_type', 'model_id', 'provider', 'role'].sort(),
  );
});

test('approvals: WAITING requests and responded requests are listed with status', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-board-approvals-'));
  writeFileSync(
    path.join(root, 'req-waiting.json'),
    JSON.stringify({
      schema_version: 1,
      gate: 'BUDGET_GATE',
      actor_id: 'some-dog',
      reason: 'test waiting',
      requested_at_utc: '2026-08-17T01:00:00.000Z',
      status: 'WAITING_OWNER_APPROVAL',
    }),
    'utf8',
  );
  writeFileSync(
    path.join(root, 'req-approved.json'),
    JSON.stringify({
      schema_version: 1,
      gate: 'BUDGET_GATE',
      actor_id: 'other-dog',
      reason: 'test approved',
      requested_at_utc: '2026-08-17T00:00:00.000Z',
      status: 'WAITING_OWNER_APPROVAL',
    }),
    'utf8',
  );
  writeFileSync(
    path.join(root, 'req-approved.json.owner-response.json'),
    JSON.stringify({
      schema_version: 1,
      request_file: 'req-approved.json',
      responded_at_utc: '2026-08-17T00:30:00.000Z',
      owner_decision: 'APPROVED',
      owner_evidence: 'owner ok',
    }),
    'utf8',
  );

  const snapshot = collectBoardSnapshot({ eventLogs: [], approvalRoot: root });
  assert.equal(snapshot.approvals.length, 2);
  const waiting = snapshot.approvals.find((approval) => approval.request_file === 'req-waiting.json');
  const approved = snapshot.approvals.find((approval) => approval.request_file === 'req-approved.json');
  assert.equal(waiting?.status, 'WAITING');
  assert.equal(waiting?.response, null);
  assert.equal(approved?.status, 'APPROVED');
  assert.equal(approved?.response?.owner_decision, 'APPROVED');
  assert.equal(approved?.response?.responded_at_utc, '2026-08-17T00:30:00.000Z');
});

test('malformed approval files are skipped fail-open for read but never crash the board', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-board-approvals-'));
  writeFileSync(path.join(root, 'broken.json'), '{not json', 'utf8');
  writeFileSync(
    path.join(root, 'good.json'),
    JSON.stringify({ schema_version: 1, gate: 'X', actor_id: 'a', requested_at_utc: '2026-08-17T00:00:00.000Z', status: 'WAITING_OWNER_APPROVAL' }),
    'utf8',
  );
  const snapshot = collectBoardSnapshot({ eventLogs: [], approvalRoot: root });
  assert.equal(snapshot.approvals.length, 1);
  assert.equal(snapshot.approvals[0].request_file, 'good.json');
});

test('source collection is read-only: no files written to approval root or workspace', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-board-approvals-'));
  writeFileSync(
    path.join(root, 'req.json'),
    JSON.stringify({ schema_version: 1, gate: 'X', actor_id: 'a', requested_at_utc: '2026-08-17T00:00:00.000Z', status: 'WAITING_OWNER_APPROVAL' }),
    'utf8',
  );
  const before = readFileSync(path.join(root, 'req.json'), 'utf8');
  collectBoardSnapshot({ eventLogs: [], approvalRoot: root });
  assert.equal(readFileSync(path.join(root, 'req.json'), 'utf8'), before, 'snapshot collection must not mutate data sources');
});
