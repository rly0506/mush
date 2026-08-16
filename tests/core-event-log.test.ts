import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseOrchestratorStateV2, type OrchestratorStateV2 } from '../src/schema/state.ts';
import {
  EventLog,
  canonicalEventJson,
  loadEventLogFromFiles,
  sha256Hex,
} from '../src/core/event-log.ts';
import { EpochStateMachine } from '../src/core/epoch-state-machine.ts';

// PS 源追溯（黄金参照，只读）：
//   start-goal-orchestrator.ps1 L1540-L1541 / L1597-L1598 / L1824
//     sequence = State.sequence + 1（事件 sequence 单调推进）
//   start-goal-orchestrator.ps1 L1858-L1868
//     persisted dispatch tuple 校验：schema_version/goal_id/run_id/assignment_epoch/
//     sequence/capability_id 必须与状态一致（运行时身份 fail-closed 的同源规则）
//   start-goal-orchestrator.ps1 L1824-L1843
//     events/active/{sequence:D6}-{dispatch_id}.json 事件槽位命名
// 黄金 fixture：tests/fixtures/replay/RM065-GOAL-010-epoch50/（事件 + state，带哈希清单）

const REPLAY_ROOT = path.resolve(process.cwd(), 'tests', 'fixtures', 'replay', 'RM065-GOAL-010-epoch50');
const EVENT_1 = path.join(REPLAY_ROOT, 'events', '000001-ce85e797c58f476898f75ebc3b890342.json');
const EVENT_2 = path.join(REPLAY_ROOT, 'events', '000002-7bb36410abdc40f59de0e626c8845312.json');

function loadGoldenState(): OrchestratorStateV2 {
  return parseOrchestratorStateV2(
    JSON.parse(readFileSync(path.join(REPLAY_ROOT, 'state.json'), 'utf8').replace(/^\uFEFF/, '')),
  );
}

function loadGoldenEvents(): unknown[] {
  return [EVENT_1, EVENT_2].map((p) => JSON.parse(readFileSync(p, 'utf8')) as unknown);
}

function makeEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 2,
    event_id: crypto.randomUUID().replace(/-/g, ''),
    goal_id: 'RM065-GOAL-010',
    run_id: 'run-fixture',
    assignment_epoch: 1,
    sequence: 1,
    parent_instance_id: 'parent-fixture',
    actor_role: 'backend_executor',
    actor_instance_id: 'executor-fixture',
    dispatch_id: crypto.randomUUID().replace(/-/g, ''),
    event_type: 'review_ready',
    phase: 1,
    finding_ids: [],
    finding_material_digests: {},
    packet_path: 'C:\\mush\\packet.json',
    packet_sha256: 'A'.repeat(64),
    config_digest: 'B'.repeat(64),
    capability_id: 'C'.repeat(32),
    signature: 'D'.repeat(64),
    created_at_utc: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

test('event log appends with hash-chain anchors and a genesis previous_sha256=null', () => {
  const log = new EventLog('run-fixture', 1);
  const first = log.append(makeEvent({ sequence: 1 }));
  assert.equal(first.sequence, 1);
  assert.equal(first.previous_sha256, null, 'genesis event must carry null previous anchor');
  assert.equal(first.sha256, sha256Hex(canonicalEventJson(first.event)), 'entry hash must cover canonical event JSON');
  assert.equal(log.chainHead(), first.sha256);
  assert.equal(log.length, 1);
});

test('second event anchors the previous event hash; chain stays monotonic', () => {
  const log = new EventLog('run-fixture', 1);
  const first = log.append(makeEvent({ sequence: 1 }));
  const second = log.append(makeEvent({ sequence: 2 }));
  assert.equal(second.previous_sha256, first.sha256, 'each entry must anchor the previous entry hash');
  assert.equal(log.length, 2);
  assert.equal(log.chainHead(), second.sha256);
});

test('append rejects run_id / assignment_epoch / sequence violations fail-closed', () => {
  const log = new EventLog('run-fixture', 1);
  assert.throws(() => log.append(makeEvent({ run_id: 'other-run', sequence: 1 })), /run_id/i);
  assert.throws(() => log.append(makeEvent({ assignment_epoch: 2, sequence: 1 })), /assignment_epoch/i);
  log.append(makeEvent({ sequence: 1 }));
  assert.throws(() => log.append(makeEvent({ sequence: 1 })), /sequence/i, 'equal sequence must be rejected');
  assert.throws(() => log.append(makeEvent({ sequence: 3 })), /sequence/i, 'strictly increasing is required, gaps rejected');
  assert.throws(() => log.append({ not: 'an event', sequence: 2 }), /bridge event/i, 'malformed events fail closed');
});

test('appended entries are immutable snapshots', () => {
  const log = new EventLog('run-fixture', 1);
  const entry = log.append(makeEvent({ sequence: 1 }));
  assert.equal(Object.isFrozen(entry.event), true, 'stored event must be frozen');
  assert.throws(() => {
    (entry.event as unknown as { summary: string }).summary = 'tampered';
  }, TypeError);
  assert.equal(log.chainHead(), entry.sha256, 'chain head must be unaffected by mutation attempts');
});

test('verifyChain recomputes every anchor and rejects a wrong expected head', () => {
  const log = new EventLog('run-fixture', 1);
  const first = log.append(makeEvent({ sequence: 1 }));
  const second = log.append(makeEvent({ sequence: 2 }));
  assert.doesNotThrow(() => log.verifyChain());
  assert.doesNotThrow(() => log.verifyChain(second.sha256));
  assert.throws(() => log.verifyChain(first.sha256), /chain head/i, 'wrong expected head must fail verification');
});

test('JSONL round-trip preserves sequence, ids, and chain head', () => {
  const log = new EventLog('run-fixture', 1);
  const e1 = log.append(makeEvent({ sequence: 1 }));
  const e2 = log.append(makeEvent({ sequence: 2 }));
  const restored = EventLog.fromJsonl(log.toJsonl(), 'run-fixture', 1);
  assert.equal(restored.length, 2);
  assert.equal(restored.head()?.event_id, e2.event_id);
  assert.equal(restored.chainHead(), log.chainHead());
});

test('golden epoch50 events load into an append-only log with a verified hash chain', () => {
  const state = loadGoldenState();
  const log = loadEventLogFromFiles(state.run_id, state.assignment_epoch, [EVENT_1, EVENT_2]);
  assert.equal(log.length, 2);
  assert.deepEqual(log.events().map((e) => e.sequence), [1, 2]);
  assert.equal(log.events()[0].event.event_type, 'review_ready');
  assert.equal(log.events()[1].event.event_type, 'approved');
  assert.equal(log.events()[1].previous_sha256, log.events()[0].sha256);
  assert.doesNotThrow(() => log.verifyChain());
  assert.equal(log.chainHead(), log.events()[1].sha256);
});

test('epoch state machine replays golden epoch50 and matches recorded state', () => {
  const state = loadGoldenState();
  const machine = new EpochStateMachine(state.run_id, state.assignment_epoch);
  for (const raw of loadGoldenEvents()) machine.applyEvent(raw);
  assert.equal(machine.assignmentEpoch, 50);
  assert.equal(machine.view().sequence, state.sequence);
  assert.equal(machine.view().lastEventId, state.last_event_id);
  assert.equal(machine.view().lastPacketPath, state.last_packet_path);
  assert.doesNotThrow(() => machine.log.verifyChain());
});

test('epoch state machine rejects cross-epoch events and double-close', () => {
  const state = loadGoldenState();
  const machine = new EpochStateMachine(state.run_id, state.assignment_epoch);
  const wrongEpoch = JSON.parse(readFileSync(EVENT_1, 'utf8')) as Record<string, unknown>;
  wrongEpoch.assignment_epoch = 51;
  assert.throws(() => machine.applyEvent(wrongEpoch), /assignment_epoch/i);
  machine.applyEvent(JSON.parse(readFileSync(EVENT_1, 'utf8')));
  machine.applyEvent(JSON.parse(readFileSync(EVENT_2, 'utf8')));
  const index = machine.closeEpoch('APPROVED');
  assert.equal(index.assignment_epoch, 50);
  assert.equal(index.event_count, 2);
  assert.equal(index.first_sequence, 1);
  assert.equal(index.last_sequence, 2);
  assert.equal(index.last_event_id, state.last_event_id);
  assert.throws(() => machine.applyEvent(JSON.parse(readFileSync(EVENT_1, 'utf8'))), /closed/i);
  assert.throws(() => machine.closeEpoch('APPROVED'), /closed|close/i);
});

test('epoch advancement opens a clean next epoch after close', () => {
  const state = loadGoldenState();
  const machine = new EpochStateMachine(state.run_id, state.assignment_epoch);
  assert.throws(() => machine.advance(), /closed/i, 'advance before close must be rejected');
  for (const raw of loadGoldenEvents()) machine.applyEvent(raw);
  machine.closeEpoch('APPROVED');
  const next = machine.advance();
  assert.equal(next.assignmentEpoch, 51);
  assert.equal(next.sequence, 0);
  assert.equal(next.status, 'IDLE');
  assert.equal(next.lastEventId, null);
  assert.equal(machine.log.length, 0, 'next epoch must start with an empty append-only log');
});
