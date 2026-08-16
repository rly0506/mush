import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assertEventCreatedAtUtc,
  assertNoReparseAncestry,
  buildManagedPiWrapperLaunch,
  buildOrderlyReceipt,
  runEarlyExitFixture,
} from '../src/core/pi-adapter-extra.ts';
import {
  assertSecretFree,
  validateManagedPiIpcEvent,
} from '../src/core/pi-adapter.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-adapter.tests.ps1
//     L100-L113 trusted PS wrapper host + direct-node target/argv 保留
//     L116-L122 IPC event created_at_utc / listener lifecycle
//     L136-L177 early wrapper exit beats outer IPC wait，保留 stderr/exit code/reason
//     L191-L199 packet ancestry 拒绝 junction/reparse
//     L201-L206 orderly exit + heartbeat + secret-free receipt

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

test('managed Pi IPC uses trusted PowerShell wrapper host while preserving direct-node target and argv (PS L100-L113)', () => {
  const targetArgs = ['fixture-cli.js', '--mode', 'rpc', '--marker', 'wrapper-host-target'];
  const launch = buildManagedPiWrapperLaunch({
    wrapperHostExecutable: POWERSHELL,
    targetExecutable: NODE,
    targetArguments: targetArgs,
  });
  assert.equal(launch.wrapperExecutable.toLowerCase(), POWERSHELL.toLowerCase(), 'wrapper host must stay trusted PS 5.1');
  assert.equal(launch.targetExecutable.toLowerCase(), NODE.toLowerCase(), 'node.exe target must be preserved');
  const expectedBase64 = Buffer.from(JSON.stringify(targetArgs), 'utf8').toString('base64');
  assert.equal(launch.argvBase64, expectedBase64, 'target argv payload must be preserved as UTF-8 base64');
  assert.match(launch.argumentsLine, /-PiExecutable/, 'wrapper args must pass the target through -PiExecutable');
  assert.ok(launch.argumentsLine.includes('-PiArgumentsBase64 ' + expectedBase64), 'wrapper args must carry the exact argv base64');
});

test('early wrapper fail-closed exit beats the outer IPC wait and preserves reason, exit code, and streams (PS L136-L177)', async () => {
  const result = await runEarlyExitFixture({ handshakeTimeoutMs: 15, elapsedBoundMs: 2000 });
  assert.equal(result.reason, 'state-handshake-timeout', 'exact reason must be preserved');
  assert.equal(result.exitCode, 63, 'wrapper fail-closed exit code must be 63');
  assert.match(result.stderr, /state-handshake-timeout/, 'stderr must be preserved');
  assert.match(result.stdout, /bridge_fail_closed/, 'stdout must be preserved');
  assert.ok(result.elapsedMs < result.elapsedBoundMs, 'early exit must beat the outer IPC wait bound');
});

test('Pi packet ancestry rejects a reparse point (junction) inside the run root (PS L191-L199)', () => {
  const fixtureRoot = 'C:\\mush-fixture';
  const worktree = path.join(fixtureRoot, 'worktree');
  const cleanPacket = path.join(worktree, 'goal-packet.json');
  assert.doesNotThrow(() =>
    assertNoReparseAncestry(cleanPacket, fixtureRoot, () => false),
  );
  const junctioned = path.join(fixtureRoot, 'packet-alias', 'goal-packet.json');
  const reparseAt = path.join(fixtureRoot, 'packet-alias');
  assert.throws(
    () =>
      assertNoReparseAncestry(junctioned, fixtureRoot, (segment) =>
        segment.toLowerCase() === reparseAt.toLowerCase(),
      ),
    /reparse/i,
  );
});

test('orderly Pi actor produces DONE + heartbeat receipt without secret material (PS L201-L206)', () => {
  const receipt = buildOrderlyReceipt('deepseek-chat', '[REDACTED]');
  assert.equal(receipt.status, 'DONE');
  assert.equal(receipt.heartbeat, 'ready');
  assert.equal(receipt.profile, 'deepseek-chat');
  assert.doesNotThrow(() => assertSecretFree(receipt.secret_probe));
});

test('IPC review_ready must carry created_at_utc for dispatch ordering (PS L120)', () => {
  assert.doesNotThrow(() => assertEventCreatedAtUtc({ created_at_utc: '2026-08-16T10:00:00.000Z' }));
  assert.throws(() => assertEventCreatedAtUtc({ created_at_utc: '' }), /created_at_utc/i);
});

test('IPC event must be packet-bound: hash, run_id, and dispatch_id all checked (PS L115-L134)', () => {
  const ctx = {
    expectedPacketPath: 'goal-packet.json',
    expectedPacketSha256: 'A'.repeat(64),
    expectedRunId: 'pi-fixture-run',
    expectedDispatchId: 'D'.repeat(32),
    expectedProvider: 'deepseek',
    expectedModelId: 'deepseek-chat',
  };
  const baseEvent = {
    event_type: 'review_ready',
    provider: 'deepseek',
    model_id: 'deepseek-chat',
    signature: 'E'.repeat(64),
    capability_id: 'C'.repeat(32),
    packet_sha256: ctx.expectedPacketSha256,
    run_id: ctx.expectedRunId,
    dispatch_id: ctx.expectedDispatchId,
  };
  assert.deepEqual(validateManagedPiIpcEvent({ ...baseEvent, packet_sha256: 'F'.repeat(64) }, ctx), {
    ok: false,
    reason: 'ipc-event-missing-or-invalid',
  });
  assert.deepEqual(validateManagedPiIpcEvent({ ...baseEvent, run_id: 'other-run' }, ctx), {
    ok: false,
    reason: 'ipc-event-missing-or-invalid',
  });
  assert.deepEqual(validateManagedPiIpcEvent({ ...baseEvent, dispatch_id: 'E'.repeat(32) }, ctx), {
    ok: false,
    reason: 'ipc-event-missing-or-invalid',
  });
});
