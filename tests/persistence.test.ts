import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import childProcess, { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BoardPersistence, LockError, isProcessReallyActive } from '../src/web/persistence.ts';
import { DispatchPipeline, type DispatchLifecycleEvent, type DispatchRecord, type RunAdapterResult } from '../src/web/dispatch.ts';

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
    stdout_tail: null,
    stderr_tail: null,
    session_id: null,
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

test('header update at REPORT persists stdout_tail/session_id while event lines stay untouched', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  const record = makeRecord('d3');
  persistence.saveDispatchHeader(record); // admission 时点：tail 为空
  persistence.appendDispatchEvent(record, makeEvent('ADMISSION', 'ADMITTED'));
  // REPORT 时点：记录获得输出尾与会话 ID——header 回写使输出可事后核验
  record.stdout_tail = { text: '{"body":"FINAL"}', truncated: true };
  record.session_id = 'native-session-abc';
  persistence.saveDispatchHeader(record);

  const loaded = new BoardPersistence(root).loadDispatchRecords();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].stdout_tail?.text, '{"body":"FINAL"}');
  assert.equal(loaded[0].session_id, 'native-session-abc');
  assert.deepEqual(loaded[0].events.map((e) => e.phase), ['ADMISSION'], 'event lines are append-only and untouched by the header rewrite');
});

// GOAL-084 收口：端到端重启恢复——真实走一遍 DispatchPipeline（fake runner），
// 再用**新实例**从磁盘加载，验证首行 header 恢复 status/stdout/session/receipt。
// 同时锁定证据边界：header 是可变投影、不承载 structured_output（完整对象在回执），
// 事件行是原始证据链、不被 header 重写改动。
test('GOAL-084: pipeline-run dispatch restores status/output/session/receipt from header after restart', async () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  const structured = { body: 'PROBE_SCHEMA_OK', stance: 'support' };
  const runAdapter = async (): Promise<RunAdapterResult> => ({
    exitCode: 0,
    stdout: 'MUSH_PERSIST_OK\nsession_id: persist-native-42\n',
    stderr: '',
    timedOut: false,
    childKilled: false,
    structuredOutput: structured,
  });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    persistence,
    runAdapter,
  });
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'restart recovery task', effort: 'HIGH' });
  assert.ok(record.receipt_path !== null && existsSync(record.receipt_path), '回执落盘');
  assert.equal(record.status, 'DRY_RUN');

  const loaded = new BoardPersistence(root).loadDispatchRecords();
  assert.equal(loaded.length, 1);
  const restored = loaded[0];
  assert.equal(restored.dispatch_id, record.dispatch_id);
  assert.equal(restored.status, 'DRY_RUN');
  assert.equal(restored.receipt_path, record.receipt_path);
  assert.equal(restored.session_id, 'persist-native-42');
  assert.ok(restored.stdout_tail !== null && typeof restored.stdout_tail.text === 'string'
    && restored.stdout_tail.text.includes('MUSH_PERSIST_OK'), 'stdout 尾随 header 恢复');
  assert.deepEqual(restored.admission, { decision: 'ADMITTED', remaining_usd: 5 });
  assert.deepEqual(restored.events.map((e) => e.phase), ['ADMISSION', 'EXECUTE', 'REPORT', 'REVIEW']);

  // 边界 1：header 投影里没有 structured_output——不能声称 header 恢复了它。
  const lines = readFileSync(path.join(root, 'dispatches', `${record.dispatch_id}.jsonl`), 'utf8')
    .split('\n').filter((line) => line.trim() !== '');
  const header = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal('structured_output' in header, false, 'header 是可变投影，不含 structured_output');
  // 边界 2：完整结构化对象在回执里。
  const receipt = JSON.parse(readFileSync(record.receipt_path!, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(receipt.structured_output, structured);
  // 边界 3：事件行仍为 append-only 原始证据链（header 重写前后逐行一致）。
  assert.equal(lines.length, 1 + record.events.length);
  for (const line of lines.slice(1)) assert.equal(JSON.parse(line).kind, 'event');
});

// GOAL-084 复核（2026-10-04）：header 重写的异常边界——原子写入失败必须上抛且不改动文件；
// 只有"首行不可解析"才允许走前置补头。回归锁死 header,header,event 双头缺陷。
test('GOAL-084: atomic header rewrite failure propagates and leaves no duplicate header', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  const record = makeRecord('d-fault');
  const file = path.join(root, 'dispatches', 'd-fault.jsonl');
  persistence.saveDispatchHeader(record); // 首行 header（status=DRY_RUN）
  persistence.appendDispatchEvent(record, makeEvent('ADMISSION', 'ADMITTED'));
  const before = readFileSync(file, 'utf8');

  record.status = 'PASS';
  record.stdout_tail = { text: 'after fault', truncated: true };
  const originalRename = fs.renameSync;
  let attempts = 0;
  // 首次 rename 失败、重试成功：旧实现会吞掉该错误并走前置补头，产出双 header。
  // 进程内全部代码共享该 builtin 绑定（syncBuiltinESMExports 生效），与仓库既有故障注入写法一致。
  (fs as { renameSync: typeof fs.renameSync }).renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
    if (++attempts === 1) throw Object.assign(new Error('synthetic first rename failure'), { code: 'EPERM' });
    return (originalRename as (...a: Parameters<typeof fs.renameSync>) => string)(...args);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try {
    assert.throws(() => persistence.saveDispatchHeader(record), /synthetic first rename failure/);
  } finally {
    (fs as { renameSync: typeof fs.renameSync }).renameSync = originalRename;
    syncBuiltinESMExports();
  }
  assert.equal(attempts, 1, '失败后不得自动重试写入');
  assert.equal(readFileSync(file, 'utf8'), before, '写入失败必须保持原文件不变');
  const kinds = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line).kind as string);
  assert.equal(kinds.filter((kind) => kind === 'header').length, 1, '不得出现第二个 header');

  const loaded = new BoardPersistence(root).loadDispatchRecords();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].status, 'DRY_RUN', '文件未被改动，加载仍是故障前状态');

  // 对照：路径畅通时重写正常生效（证明上面的失败来自注入而非逻辑本身）。
  persistence.saveDispatchHeader(record);
  assert.equal(new BoardPersistence(root).loadDispatchRecords()[0].status, 'PASS');
});

test('GOAL-084: a torn first line is repaired by prepending one header, not by dropping event rows', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);
  const record = makeRecord('d-torn');
  const file = path.join(root, 'dispatches', 'd-torn.jsonl');
  persistence.saveDispatchHeader(record);
  persistence.appendDispatchEvent(record, makeEvent('ADMISSION', 'ADMITTED'));
  // 模拟撕裂首行：截断 header（真实成因见 parseJsonLineSafe 注释）。
  const text = readFileSync(file, 'utf8');
  const rows = text.split('\n').filter((line) => line.trim() !== '');
  writeFileSync(file, '{"kind":"header","dispatch_id":"d-torn"\n' + rows.slice(1).join('\n') + '\n', 'utf8');

  // 撕裂行重写前记录原始事件行字节，重写后必须逐字节保留。
  const eventLineBefore = readFileSync(file, 'utf8').trim().split('\n').filter((line) => {
    try { return (JSON.parse(line) as { kind?: string }).kind === 'event'; } catch { return false; }
  });
  record.status = 'PASS';
  persistence.saveDispatchHeader(record);
  // 撕裂行本身就是非法 JSON（加载时按既有规则跳过并告警），这里只统计可解析行。
  const repairedRows = readFileSync(file, 'utf8').trim().split('\n').flatMap((line) => {
    try { return [JSON.parse(line) as { kind?: string; marker?: string }]; } catch { return []; }
  });
  assert.deepEqual(repairedRows.map((row) => row.kind), ['header', 'event'], '补头后只有一条 header，事件行保留');
  for (const line of eventLineBefore) {
    assert.ok(readFileSync(file, 'utf8').includes(line), '原始事件行字节未变：' + line.slice(0, 60));
  }
  const loaded = new BoardPersistence(root).loadDispatchRecords();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].status, 'PASS');
  assert.deepEqual(loaded[0].events.map((e) => e.phase), ['ADMISSION']);
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

test('default lock takeover detects a nonexistent PID', () => {
  const root = fixtureRuntime();
  const persistence = new BoardPersistence(root);

  // A crashed instance left a PID that no longer exists.
  writeFileSync(
    persistence.lockPath(),
    JSON.stringify({
      pid: 99999999,
      acquired_at_utc: '2026-08-29T03:23:25.791Z',
      released_at_utc: null,
      port: 59291,
    }) + '\n',
    'utf8',
  );

  const taken = persistence.acquireLock();
  assert.equal(taken.pid, process.pid);
  assert.equal(taken.released_at_utc, null);

  persistence.releaseLock();
});

async function stopFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
  child.kill();
  await exited;
}

test('default lock checks correlate the listening port with its owning process', { timeout: 30000 }, async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/lock-process.cjs', import.meta.url))], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  });
  t.after(() => stopFixture(child));
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  const port = (message as { port: number }).port;
  const pid = child.pid!;
  const persistence = new BoardPersistence(fixtureRuntime());
  writeFileSync(persistence.lockPath(), JSON.stringify({ pid, port, released_at_utc: null }));

  await t.test('a live foreign Node listener retains its lock', () => {
    assert.equal(isProcessReallyActive(pid, port), true);
    assert.throws(() => persistence.acquireLock(), LockError);
  });
  await t.test('a port prefix is not an exact listening port', () => {
    assert.equal(isProcessReallyActive(pid, Math.floor(port / 10)), false);
  });
  await t.test('a listener belonging to another Node PID is not this instance', () => {
    assert.equal(isProcessReallyActive(process.pid, port), false);
  });
  await t.test('Windows launcher probe also checks listener ownership', { skip: process.platform !== 'win32' }, () => {
    for (const [owner, expected] of [[pid, 'True'], [process.pid, 'False']] as const) {
      const result = spawnSync('powershell.exe', [
        '-NoProfile', '-File', fileURLToPath(new URL('./fixtures/board-launcher-probe.ps1', import.meta.url)),
        '-ScriptPath', fileURLToPath(new URL('../scripts/board-up.ps1', import.meta.url)),
        '-Port', String(port), '-ProcessId', String(owner),
      ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), expected);
    }
  });

  const closed = once(child, 'message', { signal: AbortSignal.timeout(5000) });
  child.send('close-port');
  await closed;
  await t.test('a live Node PID with a closed port leaves a reclaimable lock', () => {
    assert.equal(isProcessReallyActive(pid, port), false);
    assert.equal(persistence.acquireLock().pid, process.pid);
    persistence.releaseLock();
  });
  await t.test('failed inspection tools conservatively retain a live foreign lock', (t) => {
    const probe = t.mock.method(childProcess, 'spawnSync', () => { throw new Error('inspection unavailable'); });
    syncBuiltinESMExports();
    t.after(() => {
      probe.mock.restore();
      syncBuiltinESMExports();
    });
    writeFileSync(persistence.lockPath(), JSON.stringify({ pid, port, released_at_utc: null }));
    assert.equal(isProcessReallyActive(pid, port), true);
    assert.throws(() => persistence.acquireLock(), LockError);
  });
});

test('default lock reclaims a PID recycled into a non-Node Windows process', {
  skip: process.platform !== 'win32', timeout: 15000,
}, async (t) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('./fixtures/lock-process.ps1', import.meta.url))], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(() => stopFixture(child));
  await once(child.stdout!, 'data', { signal: AbortSignal.timeout(5000) });
  const persistence = new BoardPersistence(fixtureRuntime());
  writeFileSync(persistence.lockPath(), JSON.stringify({ pid: child.pid, released_at_utc: null }));
  assert.equal(isProcessReallyActive(child.pid!), false);
  assert.equal(persistence.acquireLock().pid, process.pid);
  persistence.releaseLock();
});
