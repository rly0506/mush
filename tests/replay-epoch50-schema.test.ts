import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBridgeEventV2, type BridgeEventV2 } from '../src/schema/events.ts';

// U3 回放冒烟：用 agent-bridge 已录 epoch50 事件流验证其 schema 可被 TS 类型解析。
// 黄金参照（只读）：
//   D:\意向项目\.agent-bridge\runtime\orchestrator\RM065-GOAL-010-epoch50\events\active\
// 副本与哈希清单：tests/fixtures/replay/RM065-GOAL-010-epoch50/（按 migration-checklist
// “影子回放数据：复制带哈希清单”迁移）。

const ROOT = path.resolve(process.cwd(), 'tests', 'fixtures', 'replay', 'RM065-GOAL-010-epoch50');

interface Manifest {
  schema_version: number;
  files: Array<{ file: string; sha256: string; source: string }>;
}

function loadManifest(): Manifest {
  const text = readFileSync(path.join(ROOT, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text) as Manifest;
}

function sha256Of(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
}

function loadEvent(file: string): BridgeEventV2 {
  const raw: unknown = JSON.parse(readFileSync(path.join(ROOT, 'events', file), 'utf8'));
  return parseBridgeEventV2(raw);
}

test('replay manifest hashes match the copied golden event bytes', () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.files.length, 2, 'epoch50 events/active must contain the two recorded events');
  for (const entry of manifest.files) {
    const filePath = path.join(ROOT, 'events', entry.file);
    assert.ok(existsSync(filePath), `copied event exists: ${entry.file}`);
    assert.equal(sha256Of(filePath), entry.sha256, `copied event hash anchor: ${entry.file}`);
  }
});

test('epoch50 event 1 parses as TS-typed review_ready with full completion fields', () => {
  const event = loadEvent('000001-ce85e797c58f476898f75ebc3b890342.json');
  assert.equal(event.schema_version, 2);
  assert.equal(event.event_type, 'review_ready');
  assert.equal(event.actor_role, 'backend_executor');
  assert.equal(event.sequence, 1);
  assert.equal(event.provider, 'deepseek');
  assert.equal(event.model_id, 'deepseek-v4-pro');
  assert.match(event.signature, /^[0-9A-F]{64}$/i, 'signature must be a 64-hex hash anchor');
  assert.match(event.packet_sha256, /^[0-9A-F]{64}$/i, 'packet_sha256 must be a 64-hex hash anchor');
  assert.ok(!Number.isNaN(Date.parse(event.created_at_utc)), 'created_at_utc must be a parseable timestamp');
  for (const field of ['summary', 'changed_paths', 'tests_run', 'test_results', 'evidence_paths_and_hashes', 'open_findings', 'requested_decision', 'next_step'] as const) {
    assert.ok(field in event, `review_ready event missing completion field '${field}'`);
  }
});

test('epoch50 event 2 parses as TS-typed approved with dispatch ordering anchor', () => {
  const event = loadEvent('000002-7bb36410abdc40f59de0e626c8845312.json');
  assert.equal(event.schema_version, 2);
  assert.equal(event.event_type, 'approved');
  assert.equal(event.actor_role, 'parent_reviewer');
  assert.equal(event.sequence, 2);
  assert.match(event.signature, /^[0-9A-F]{64}$/i);
  assert.match(event.packet_sha256, /^[0-9A-F]{64}$/i);
  assert.ok(!Number.isNaN(Date.parse(event.created_at_utc)));
});

test('replay event order is strictly increasing by sequence (event-chain invariant)', () => {
  const first = loadEvent('000001-ce85e797c58f476898f75ebc3b890342.json');
  const second = loadEvent('000002-7bb36410abdc40f59de0e626c8845312.json');
  assert.equal(first.sequence, 1);
  assert.ok(second.sequence > first.sequence, 'events must form a strictly increasing sequence chain');
});
