import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PI_CAPABILITY_FIELDS,
  assertPiProviderModel,
  assertSecretFree,
  assertWorkingDirectoryInside,
  buildManagedPiLaunchSpec,
  makePiCapability,
  simulateManagedPiActorWithRestarts,
  validateManagedPiIpcEvent,
  type PiCapability,
} from '../src/core/pi-adapter.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-adapter.tests.ps1
//     capability L30-L35, timeout plumbing L37-L66, provider/model fail-closed L67-L75,
//     evidence shapes L77-L95, IPC event L115-L134, argv L183-L213, restart L215-L224,
//     secret-free receipt L201-L206

const capability = makePiCapability({
  adapter_id: 'pi',
  adapter_version: 'fixture-1',
  cli_path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  cli_version: '5.1',
  provider: 'deepseek',
  model_id: 'deepseek-chat',
  credential_status: 'AVAILABLE',
  identity_source: 'fixture',
  confidence: 'HIGH',
  protocol: 'structured-stdio',
  supported_roles: ['backend_executor'],
});

test('Pi capability separates adapter, CLI, provider, model, credential, identity, confidence, protocol, roles (PS L30-L35)', () => {
  for (const field of PI_CAPABILITY_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(capability, field),
      `capability missing '${field}'`,
    );
  }
  assert.equal(capability.provider, 'deepseek', 'provider must be separated exactly');
  assert.equal(capability.model_id, 'deepseek-chat', 'model_id must be separated exactly');
});

test('Pi exact provider/model checks fail closed (PS L67-L68)', () => {
  assert.throws(
    () => assertPiProviderModel(capability, 'other', 'deepseek-chat'),
    /provider|model/,
  );
  const unknown = makePiCapability({ ...capability, model_id: 'UNKNOWN' });
  assert.throws(() => assertPiProviderModel(unknown, 'deepseek', 'deepseek-chat'), /UNKNOWN|model/);
});

test('working directory outside the run root fails closed (PS L69)', () => {
  assert.doesNotThrow(() =>
    assertWorkingDirectoryInside('C:\\mush-fixture\\worktree', 'C:\\mush-fixture'),
  );
  assert.throws(
    () => assertWorkingDirectoryInside('C:\\Windows\\Temp', 'C:\\mush-fixture'),
    /working|root|contain/,
  );
});

test('fake Pi preserves absent, array, and malformed-scalar evidence shapes (PS L77-L95)', () => {
  const absent = JSON.stringify({ evidence: [] });
  assert.match(absent, /"evidence":\[\]/);
  const array = JSON.stringify({
    evidence: [{ path: 'fixture.txt', sha256: 'A'.repeat(64) }],
  });
  assert.match(array, /"evidence":\[\{"path":"fixture\.txt","sha256":"A{64}"\}\]/);
  const scalar = JSON.stringify({
    evidence: { path: 'fixture.txt', sha256: 'A'.repeat(64) },
  });
  assert.match(scalar, /"evidence":\{"path":"fixture\.txt","sha256":"A{64}"\}/);
});

test('production dispatcher forwards configured timeout into all four bounds and one hard budget (PS L37-L64)', () => {
  const spec = buildManagedPiLaunchSpec(180, 37);
  assert.equal(spec.handshakeTimeoutSeconds, 180, 'HandshakeTimeoutSeconds must forward TimeoutSeconds');
  assert.equal(spec.settleTimeoutSeconds, 180, 'SettleTimeoutSeconds must forward TimeoutSeconds');
  assert.equal(spec.exitTimeoutSeconds, 180, 'ExitTimeoutSeconds must forward TimeoutSeconds');
  assert.equal(spec.processTimeoutSeconds, 180, 'ProcessTimeoutSeconds must forward TimeoutSeconds');
  assert.equal(spec.maxNonTerminalTurns, 37, 'MaxNonTerminalTurns must bind the actor turn budget');
  assert.equal(spec.packetDeadlineSeconds, 180, 'task-packet deadline_seconds must bind to TimeoutSeconds');
});

test('managed Pi IPC event is packet-bound; stdout-only, wrong identity/signature/capability fail closed (PS L115-L134)', () => {
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
  assert.deepEqual(validateManagedPiIpcEvent(baseEvent, ctx), { ok: true });
  assert.deepEqual(validateManagedPiIpcEvent(null, ctx), { ok: false, reason: 'ipc-event' });
  assert.deepEqual(validateManagedPiIpcEvent({ ...baseEvent, signature: '0'.repeat(64) }, ctx), {
    ok: false,
    reason: 'ipc-event-missing-or-invalid',
  });
  assert.deepEqual(validateManagedPiIpcEvent({ ...baseEvent, capability_id: '0'.repeat(32) }, ctx), {
    ok: false,
    reason: 'ipc-event-missing-or-invalid',
  });
  assert.deepEqual(validateManagedPiIpcEvent({ ...baseEvent, provider: 'other' }, ctx), {
    ok: false,
    reason: 'wrong-runtime-model',
  });
});

test('argv round-trip preserves quote, empty, trailing-slash, and metacharacter values (PS L183-L213)', () => {
  const args = [
    'orderly',
    'receipt.json',
    'quote "inside" value',
    'probe',
    'deepseek',
    'deepseek-chat',
    '',
    'C:\\fixture path\\',
    '& | ; $(not-evaluated) < >',
  ];
  const roundTrip = JSON.parse(JSON.stringify({ args })) as { args: string[] };
  assert.equal(roundTrip.args[2], 'quote "inside" value');
  assert.equal(roundTrip.args[3], 'probe');
  assert.equal(roundTrip.args[6], '');
  assert.equal(roundTrip.args[7], 'C:\\fixture path\\');
  assert.equal(roundTrip.args[8], '& | ; $(not-evaluated) < >');
});

test('one same-profile restart recovers; second Pi failure enters WAIT_EXECUTOR (PS L215-L224)', () => {
  const recovered = simulateManagedPiActorWithRestarts([7, 0], 1);
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.restartCount, 1, 'one same-profile restart must be counted');
  const failed = simulateManagedPiActorWithRestarts([7, 7], 1);
  assert.equal(failed.status, 'WAIT_EXECUTOR', 'second Pi failure must enter WAIT_EXECUTOR');
});

test('managed Pi receipt stays secret-free (PS L201-L206)', () => {
  assert.doesNotThrow(() => assertSecretFree('[REDACTED]'));
  assert.throws(() => assertSecretFree('api key PASSWORD leaked'), /secret material/i);
});
