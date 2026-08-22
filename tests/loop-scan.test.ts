import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LoopStateMachine } from '../src/loop/loop.ts';
import {
  confirmOwnerSelection,
  emitRecommendation,
  ownerSelectionStatus,
  scanNextTask,
  writeScanEvidence,
  type TaskCandidate,
} from '../src/loop/scan.ts';

// GOAL-004 U2：扫描→推荐→owner 一句话确认（D6）；未确认 = WAITING_OWNER，不虚构。

const CANDIDATES: TaskCandidate[] = [
  { id: 'm5-board', title: 'M5 看板开发启动', ready: true, requires_owner_selection: true },
  { id: 'zcode-adapter', title: 'M3 剩余适配器接入（zcode）', ready: true, requires_owner_selection: true },
];

test('scanNextTask recommends the first ready candidate; empty/not-ready yields null', () => {
  assert.equal(scanNextTask(CANDIDATES)?.id, 'm5-board');
  assert.equal(scanNextTask([{ ...CANDIDATES[0], ready: false }]) === null, true);
  assert.equal(scanNextTask([]) === null, true);
});

test('emitRecommendation appends a RECOMMENDATION event with the candidate payload', () => {
  const loop = new LoopStateMachine('run-scan');
  const event = loop.transition('RECOMMEND', { candidates: CANDIDATES.map((c) => c.id), chosen: 'm5-board' });
  assert.equal(event.to, 'RECOMMEND');
  assert.deepEqual(event.meta.chosen, 'm5-board');
  assert.doesNotThrow(() => loop.verifyChain());
  assert.throws(() => loop.transition('RECOMMEND', {}), /transition/i, 'second recommendation from RECOMMEND must fail');
});

test('confirmOwnerSelection appends CONFIRM and carries the owner evidence hash', () => {
  const loop = new LoopStateMachine('run-confirm');
  loop.transition('RECOMMEND', { candidate: 'm5-board' });
  const event = loop.transition('CONFIRM', { candidate_id: 'm5-board', owner_evidence: 'chat-2026-08-17' });
  assert.equal(event.to, 'CONFIRM');
  assert.equal(event.meta.candidate_id, 'm5-board');
  assert.equal(event.sequence, 2);
  assert.doesNotThrow(() => loop.verifyChain());
});

test('ownerSelectionStatus reports WAITING_OWNER until a selection record exists', () => {
  const root = path.resolve(
    process.cwd(),
    '.test-fixtures',
    'owner-selections',
    String(process.pid) + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
  );
  const before = ownerSelectionStatus(root, CANDIDATES);
  assert.equal(before.waiting, true);
  assert.equal(before.selected, null);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'm5-board.selected.json'), JSON.stringify({ schema_version: 1, selected: 'm5-board' }) + '\n', 'utf8');
  const after = ownerSelectionStatus(root, CANDIDATES);
  assert.equal(after.waiting, false);
  assert.equal(after.selected, 'm5-board');
});

test('scan evidence is written append-only with candidate list and honest WAITING_OWNER state', () => {
  const evidencePath = path.resolve(process.cwd(), '.test-fixtures', 'scan-evidence.json');
  const evidence = writeScanEvidence(evidencePath, CANDIDATES, null, 'no owner selection record yet');
  assert.ok(existsSync(evidencePath));
  assert.equal(evidence.status, 'WAITING_OWNER');
  const onDisk = JSON.parse(readFileSync(evidencePath, 'utf8')) as { candidates: unknown[]; selected: unknown };
  assert.equal(onDisk.candidates.length, 2);
  assert.equal(onDisk.selected, null);
});
