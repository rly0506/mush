import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BoardPersistence, LockError } from '../src/web/persistence.ts';
import type { DispatchLifecycleEvent, DispatchRecord } from '../src/web/dispatch.ts';

// GP-03：持久化三件套 + 单实例锁（F-42）。宪法 §2：哈希链可重建、append-only。

function fixtureRuntime(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'persistence', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function makeRecord(id: string): DispatchRecord {
  return {
    dispatch_id: id,
    adapter_id: 'fake-t1',
    status: 'DRY_RUN',
    receipt_path: null,
    admission: { decision: 'ADMITTED', remaining_usd: 5 },
    error: null,
    events: [],
  };
}

function makeEvent(phase: DispatchLifecycleEvent['phase'], status: string): DispatchLifecycleEvent {
  return {
    kind: 'dispatch',
    phase,
    status: status as DispatchLifecycleEvent['status'],
    adapter_id: 'fake-t1',
    dispatch_id: 'd1',
    at_utc: '2026-08-17T00:00:00.000Z',
    payload: {},
  };
}

test('dispatch records persist header + events and reload across instances', () => {
  const root = fixtureRuntime();
  const first = new BoardPersistence(root);
  const record = makeRecord('d1');
  first.saveDispatchHeader(record);
  first.appendDispatchEvent(record, makeEvent('ADMISSION', 'ADMITTED'));
  first.appendDispatchEvent(record, makeEvent('EXECUTE', 'DRY_RUN'));
  first.appendDispatchEvent(record, makeEvent('REPORT', 'DRY_RUN'));
  first.appendDispatchEvent(record, makeEvent('REVIEW', 'DRY_RUN'));

  const second = new BoardPersistence(root);
  const loaded = second.loadDispatchRecords();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].dispatch_id, 'd1');
  assert.equal(loaded[0].events.length, 4);
  assert.deepEqual(loaded[0].events.map((e) => e.phase), ['ADMISSION', 'EXECUTE', 'REPORT', 'REVIEW']);
});

test('GP-10: dispatch header persists request snapshot so rerun works across restart', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  const record = makeRecord('d2');
  record.request = {
    adapter_id: 'fake-t1',
    prompt: 'rerun after restart',
    effort: 'HIGH',
    workspace: 'D:/ws',
    timeout_s: 30,
    cap_usd: 3,
    real: false,
  };
  persistence.saveDispatchHeader(record);

  const loaded = new BoardPersistence(root).loadDispatchRecords();
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].request, record.request);
});

test('ledger lines are hash-chained and verification survives reload', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  persistence.appendLedger({ atUtc: '2026-08-17T00:00:00.000Z', actorId: 'fake-t1', decision: 'ADMITTED', amountUsd: 1, capUsd: 5, spentBeforeUsd: 0, remainingUsd: 4, meta: { unit: 'p3' } });
  persistence.appendLedger({ atUtc: '2026-08-17T00:00:01.000Z', actorId: 'fake-t1', decision: 'DENIED', amountUsd: 9, capUsd: 5, spentBeforeUsd: 1, remainingUsd: 4, meta: { unit: 'p3' } });
  assert.doesNotThrow(() => persistence.verifyLedgerChain());
  const lines = persistence.loadLedgerLines();
  assert.equal(lines.length, 2);
  assert.equal(lines[1].previous_sha256, lines[0].sha256);
  assert.match(lines[0].sha256 as string, /^[0-9A-F]{64}$/i);
});

test('event log lines carry chain anchors and reload', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  persistence.appendEventLog('run-p3', {
    sequence: 1,
    event_id: 'a'.repeat(32),
    sha256: 'A'.repeat(64),
    previous_sha256: null,
    event: { schema_version: 2 },
  } as never);
  persistence.appendEventLog('run-p3', {
    sequence: 2,
    event_id: 'b'.repeat(32),
    sha256: 'B'.repeat(64),
    previous_sha256: 'A'.repeat(64),
    event: { schema_version: 2 },
  } as never);
  const lines = persistence.loadEventLogLines('run-p3');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].previous_sha256, 'A'.repeat(64));
  assert.ok(existsSync(path.join(root, 'event-log-run-p3.jsonl')));
});

test('single-instance lock refuses a live foreign instance and takes over stale PID', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root, { isAlive: () => true });
  const lock = persistence.acquireLock();
  assert.equal(lock.pid, process.pid);
  // 同进程重入：测试/嵌入宿主允许（返回同一把锁）。
  assert.equal(persistence.acquireLock().pid, process.pid);

  // 模拟一个“另一个活进程”持有锁：注入 isAlive 恒真 + 伪造 pid。
  writeFileSync(
    persistence.lockPath(),
    JSON.stringify({ pid: 99999999, acquired_at_utc: '2026-08-17T00:00:00.000Z', released_at_utc: null }) + '\n',
    'utf8',
  );
  assert.throws(() => persistence.acquireLock(), LockError);

  // 陈锁：isAlive 恒假 → 接管。
  const stale = new BoardPersistence(root, { isAlive: () => false });
  const taken = stale.acquireLock();
  assert.equal(taken.pid, process.pid);

  stale.releaseLock();
  const released = JSON.parse(readFileSync(stale.lockPath(), 'utf8')) as { released_at_utc: string | null };
  assert.equal(typeof released.released_at_utc, 'string');
});
