import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBridgeEventV2 } from '../src/schema/events.ts';
import { parseOrchestratorStateV2, type OrchestratorStateV2 } from '../src/schema/state.ts';
import { buildEpochIndex } from '../src/schema/epoch.ts';
import { loadEventLogFromFiles } from '../src/core/event-log.ts';
import { EpochStateMachine } from '../src/core/epoch-state-machine.ts';

// U4 影子回放：黄金参照 RM065-GOAL-010-epoch21..50 run root 的已录状态/事件流
// （只读副本 + SHA-256 索引清单，见 tests/fixtures/replay/epoch21-50-index.json）。
// 诚实记录：epoch21-49 的 events/active 目录存在但为空（事件流未保留），
// 可用事件流只有 epoch50（2 events）；回放断言覆盖“全部可得证据”，缺失记 finding F-13。

const REPLAY_ROOT = path.resolve(process.cwd(), 'tests', 'fixtures', 'replay');

interface IndexEventFile {
  file: string;
  sha256: string;
  source: string;
}

interface IndexEpoch {
  epoch: number;
  state_present: boolean;
  state_sha256: string | null;
  run_id: string | null;
  sequence: number | null;
  event_files: IndexEventFile[];
  events_available: number;
}

interface ReplayIndex {
  schema_version: number;
  source_root: string;
  epochs: IndexEpoch[];
}

function loadIndex(): ReplayIndex {
  return JSON.parse(
    readFileSync(path.join(REPLAY_ROOT, 'epoch21-50-index.json'), 'utf8').replace(/^\uFEFF/, ''),
  ) as ReplayIndex;
}

function sha256Of(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
}

function epochDir(epoch: number): string {
  return path.join(REPLAY_ROOT, `RM065-GOAL-010-epoch${epoch}`);
}

test('replay index is honest about coverage: 28 dirs, 18 states, 2 events (epoch50 only)', () => {
  const index = loadIndex();
  assert.equal(index.schema_version, 1);
  assert.equal(index.epochs.length, 28, 'epoch21-50 存在 28 个 run root（32/34 目录缺失）');
  assert.equal(index.epochs.filter((entry) => entry.state_present).length, 18);
  const eventsTotal = index.epochs.reduce((sum, entry) => sum + entry.events_available, 0);
  assert.equal(eventsTotal, 2, '仅 epoch50 保留 2 个事件 JSON；epoch21-49 events/active 为空');
  assert.deepEqual(index.epochs.filter((entry) => entry.events_available > 0).map((entry) => entry.epoch), [50]);
  assert.deepEqual(
    Array.from({ length: 30 }, (_, i) => 21 + i).filter((epoch) => !index.epochs.some((entry) => entry.epoch === epoch)),
    [32, 34],
  );
});

test('every copied epoch state parses as schema v2, hash matches, and self-describes its epoch', () => {
  const index = loadIndex();
  for (const entry of index.epochs.filter((item) => item.state_present)) {
    const statePath = path.join(epochDir(entry.epoch), 'state.json');
    assert.ok(existsSync(statePath), `epoch${entry.epoch} state.json must exist`);
    assert.equal(sha256Of(statePath), entry.state_sha256, `epoch${entry.epoch} state hash anchor`);
    const state: OrchestratorStateV2 = parseOrchestratorStateV2(
      JSON.parse(readFileSync(statePath, 'utf8').replace(/^\uFEFF/, '')),
    );
    assert.equal(state.assignment_epoch, entry.epoch, `epoch${entry.epoch} state must self-describe`);
    assert.ok(state.sequence >= 0, `epoch${entry.epoch} sequence must be >= 0`);
    assert.match(state.run_id, /^RM065-GOAL-010-/, `epoch${entry.epoch} run_id goal prefix`);
  }
});

test('epoch50 event stream replays through the new implementation and matches the golden state', () => {
  const index = loadIndex();
  const epoch50 = index.epochs.find((entry) => entry.epoch === 50) as IndexEpoch;
  assert.equal(epoch50.event_files.length, 2);
  const eventPaths: string[] = [];
  for (const file of epoch50.event_files) {
    const filePath = path.join(epochDir(50), 'events', file.file);
    assert.ok(existsSync(filePath), `epoch50 event exists: ${file.file}`);
    assert.equal(sha256Of(filePath), file.sha256, `epoch50 event hash anchor: ${file.file}`);
    eventPaths.push(filePath);
  }

  const statePath = path.join(epochDir(50), 'state.json');
  const state: OrchestratorStateV2 = parseOrchestratorStateV2(
    JSON.parse(readFileSync(statePath, 'utf8').replace(/^\uFEFF/, '')),
  );
  const log = loadEventLogFromFiles(state.run_id, state.assignment_epoch, eventPaths);
  assert.equal(log.length, 2);
  assert.doesNotThrow(() => log.verifyChain());

  const machine = new EpochStateMachine(state.run_id, state.assignment_epoch);
  for (const filePath of eventPaths) {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    machine.applyEvent(raw);
    // 每个事件本身必须能过生产 schema 解析（applyEvent 内部已强制，双保险）。
    parseBridgeEventV2(raw);
  }
  assert.equal(machine.view().sequence, state.sequence, 'replayed sequence must equal golden state');
  assert.equal(machine.view().lastEventId, state.last_event_id, 'replayed last_event_id must equal golden state');
  const indexResult = buildEpochIndex(
    { assignment_epoch: state.assignment_epoch, run_id: state.run_id, last_event_id: state.last_event_id },
    log.events().map((entry) => entry.event),
  );
  assert.equal(indexResult.event_count, 2);
  assert.equal(indexResult.first_sequence, 1);
  assert.equal(indexResult.last_sequence, 2);
});
