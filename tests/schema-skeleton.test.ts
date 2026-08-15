import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBridgeEventV2, type BridgeEventV2 } from '../src/schema/events.ts';
import { parseOrchestratorStateV2, type OrchestratorStateV2 } from '../src/schema/state.ts';
import { buildEpochIndex } from '../src/schema/epoch.ts';

// U4 M2 骨架：事件/状态/epoch 三类 TS 类型定义 + 已录 epoch50 fixture 校验。
// 黄金参照（只读副本 + 哈希清单）：
//   D:\意向项目\.agent-bridge\runtime\orchestrator\RM065-GOAL-010-epoch50\state.json
//   D:\意向项目\.agent-bridge\runtime\orchestrator\RM065-GOAL-010-epoch50\events\active\*.json

const ROOT = path.resolve(process.cwd(), 'tests', 'fixtures', 'replay', 'RM065-GOAL-010-epoch50');

function sha256Of(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
}

function loadState(): OrchestratorStateV2 {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(ROOT, 'state.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  return parseOrchestratorStateV2(raw);
}

function loadEvents(): BridgeEventV2[] {
  return [
    parseBridgeEventV2(JSON.parse(readFileSync(path.join(ROOT, 'events', '000001-ce85e797c58f476898f75ebc3b890342.json'), 'utf8'))),
    parseBridgeEventV2(JSON.parse(readFileSync(path.join(ROOT, 'events', '000002-7bb36410abdc40f59de0e626c8845312.json'), 'utf8'))),
  ];
}

test('copied epoch50 state.json matches its hash manifest', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'state-manifest.json'), 'utf8').replace(/^\uFEFF/, ''),
  ) as { schema_version: number; file: string; sha256: string };
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.file, 'state.json');
  assert.equal(sha256Of(path.join(ROOT, 'state.json')), manifest.sha256);
});

test('epoch50 state parses as TS-typed orchestrator state (schema v2)', () => {
  const state = loadState();
  assert.equal(state.schema_version, 2);
  assert.equal(state.assignment_epoch, 50);
  assert.equal(state.status, 'DONE');
  assert.equal(state.sequence, 2);
  assert.equal(state.dispatch_status, 'IDLE');
  assert.match(state.config_digest, /^[0-9A-F]{64}$/i);
  assert.ok(!Number.isNaN(Date.parse(state.updated_at_utc)), 'updated_at_utc must be parseable');
  assert.ok('backend_executor' in state.actor_bindings, 'backend_executor binding must exist');
  assert.ok('parent_reviewer' in state.actor_bindings, 'parent_reviewer binding must exist');
  assert.equal(state.actor_bindings.backend_executor.adapter_id, 'pi');
});

test('epoch50 events parse through the production schema module (events.ts)', () => {
  const events = loadEvents();
  assert.equal(events.length, 2);
  assert.equal(events[0].schema_version, 2);
  assert.equal(events[0].event_type, 'review_ready');
  assert.equal(events[1].schema_version, 2);
  assert.equal(events[1].event_type, 'approved');
});

test('epoch index links state and event chain (sequence, last_event_id, event count)', () => {
  const state = loadState();
  const events = loadEvents();
  const epoch = buildEpochIndex(state, events);
  assert.equal(epoch.assignment_epoch, 50);
  assert.equal(epoch.event_count, 2);
  assert.equal(epoch.first_sequence, 1);
  assert.equal(epoch.last_sequence, 2);
  assert.equal(epoch.last_event_id, state.last_event_id);
  assert.equal(epoch.last_event_id, events[1].event_id);
  assert.deepEqual(epoch.event_ids, events.map((event) => event.event_id));
});
