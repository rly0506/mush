import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildDeepSeekContract,
  evaluateDshIdentity,
  makeNonce,
  parseNonceResponse,
  runT1NonceProbe,
  verifyNonceProbe,
} from '../src/adapters/deepseek.ts';
import type { ChildProcessLike, SpawnFn } from '../src/adapters/t1-runner.ts';

// GOAL-003 U2：DeepSeek 犬（经 dsh T1 / pi pi-rpc 二通道）。
// nonce 身份探测 = 本地生成 nonce → headless 一句求值 → 回值比对 + 磁盘证据
// （D13 fail-closed）；探测属派发包明文"不花钱部分"。
// 沙箱 piped-stdio spawn EPERM（AD-02）→ 测试注入 fake 子进程；真实探测经 shell。

const WORKSPACE = path.resolve(process.cwd(), '.test-fixtures', 'adapters');
const EVIDENCE = path.join(WORKSPACE, 'nonce-deepseek-evidence.json');

function makeFakeChild(stdout: string): ChildProcessLike {
  let ended = false;
  return {
    stdinWrite: () => {},
    stdinEnd: () => {
      ended = true;
    },
    onStdout: (listener) => setTimeout(() => listener(stdout), 1),
    onStderr: () => {},
    onExit: (listener) => setTimeout(() => listener(0), 2),
    kill: () => {},
    ended,
  } as unknown as ChildProcessLike;
}

test('DeepSeek dsh channel builds a T1 contract (profile headless, prompt as final arg)', () => {
  const contract = buildDeepSeekContract('dsh');
  assert.equal(contract.adapter_id, 'deepseek-dsh');
  assert.equal(contract.executable, 'dsh');
  assert.deepEqual(contract.arguments, ['--profile', 'headless']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
});

test('DeepSeek pi channel builds a pi-rpc contract (stdin prompt transport)', () => {
  const contract = buildDeepSeekContract('pi');
  assert.equal(contract.adapter_id, 'deepseek-pi');
  assert.equal(contract.executable, 'pi');
  assert.deepEqual(contract.arguments, ['--mode', 'rpc']);
  assert.equal(contract.protocol, 'pi-rpc');
  assert.equal(contract.prompt_transport, 'stdin');
});

test('dsh --dump-config identity is parsed; missing model is recorded UNKNOWN (D13)', () => {
  const identity = evaluateDshIdentity('{"provider":"deepseek","model":"deepseek-v4-pro"}');
  assert.equal(identity.provider, 'deepseek');
  assert.equal(identity.modelId, 'deepseek-v4-pro');
  assert.equal(identity.proven, true);
  const unknown = evaluateDshIdentity('{"provider":"deepseek"}');
  assert.equal(unknown.provider, 'deepseek');
  assert.equal(unknown.modelId, 'UNKNOWN');
  assert.equal(unknown.proven, false);
});

test('nonce probe material is 32-hex input with a 64-hex expected SHA-256', () => {
  const nonce = makeNonce();
  assert.match(nonce.nonce, /^[0-9a-f]{32}$/);
  assert.match(nonce.expectedSha256, /^[0-9a-f]{64}$/);
  assert.equal(nonce.expectedSha256, createHash('sha256').update(nonce.nonce, 'utf8').digest('hex'));
});

test('nonce response parser finds the hex answer among prose; mismatch stays fail-closed', () => {
  const nonce = makeNonce();
  const good = parseNonceResponse('thinking...\n' + nonce.expectedSha256 + '\ndone', nonce.expectedSha256);
  assert.equal(good.matched, true);
  assert.equal(good.observed, nonce.expectedSha256);
  const bad = parseNonceResponse('f'.repeat(64), nonce.expectedSha256);
  assert.equal(bad.matched, false);
  const empty = parseNonceResponse('no answer', nonce.expectedSha256);
  assert.equal(empty.matched, false);
});

test('T1 nonce probe writes disk evidence with hash anchors and verifies fail-closed', async () => {
  const nonce = makeNonce();
  const spawn: SpawnFn = () => makeFakeChild(nonce.expectedSha256 + '\n');
  const probe = await runT1NonceProbe({
    contract: buildDeepSeekContract('dsh'),
    workspaceRoot: WORKSPACE,
    evidencePath: EVIDENCE,
    timeoutMs: 1000,
    nonce,
    spawn,
  });
  assert.equal(probe.matched, true);
  assert.ok(existsSync(EVIDENCE), 'nonce evidence must be written to disk');
  const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Record<string, unknown>;
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.adapter_id, 'deepseek-dsh');
  assert.equal(evidence.nonce, nonce.nonce);
  assert.equal(evidence.expected_sha256, nonce.expectedSha256);
  assert.equal(evidence.observed, nonce.expectedSha256);
  assert.equal(evidence.matched, true);
  assert.doesNotThrow(() => verifyNonceProbe(probe));
});

test('nonce mismatch writes honest evidence and verification throws (fail-closed)', async () => {
  const nonce = makeNonce();
  const spawn: SpawnFn = () => makeFakeChild('f'.repeat(64) + '\n');
  const probe = await runT1NonceProbe({
    contract: buildDeepSeekContract('dsh'),
    workspaceRoot: WORKSPACE,
    evidencePath: EVIDENCE,
    timeoutMs: 1000,
    nonce,
    spawn,
  });
  assert.equal(probe.matched, false);
  const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Record<string, unknown>;
  assert.equal(evidence.matched, false);
  assert.throws(() => verifyNonceProbe(probe), /nonce/i);
});
