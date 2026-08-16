import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeNonce, verifyNonceProbe } from '../src/adapters/deepseek.ts';
import { runT1 } from '../src/adapters/t1-runner.ts';
import {
  buildZcodeContract,
  evaluateZcodeIdentity,
  parseZcodeJsonOutput,
} from '../src/adapters/zcode.ts';
import type { ChildProcessLike, SpawnFn } from '../src/adapters/t1-runner.ts';

// GOAL-004 首任务（owner 已选）：zcode 适配器接入。
// 预探测：docs/capability-probes/zcode-2026-08-16.md
//   zcode --prompt / --print / --cwd / --max-turns / --mode yolo / --json / app-server。
// 真实 nonce 探测需单独 owner 授权（zcode 为 OAuth 登录、预算 UNKNOWN），本批只做
// 合同 + fake/录制回放级协议解析。

const WORKSPACE = path.resolve(process.cwd(), '.test-fixtures', 'adapters');
const EVIDENCE = path.join(WORKSPACE, 'nonce-zcode-evidence.json');

function fakeChild(stdout: string): ChildProcessLike {
  return {
    stdinWrite: () => {},
    stdinEnd: () => {},
    onStdout: (listener) => setTimeout(() => listener(stdout), 1),
    onStderr: () => {},
    onExit: (listener) => setTimeout(() => listener(0), 2),
    kill: () => {},
  } as unknown as ChildProcessLike;
}

test('zcode contract matches the pre-probe CLI surface (T1 single-shot)', () => {
  const contract = buildZcodeContract();
  assert.equal(contract.adapter_id, 'zcode');
  assert.equal(contract.executable, 'zcode');
  assert.deepEqual(contract.arguments, ['--prompt', '--json', '--max-turns', '1']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
});

test('zcode --json output parser extracts machine-readable model/text fields', () => {
  const parsed = parseZcodeJsonOutput(
    '{"model":"z-ai-model-x","text":"fixture answer","usage":{"total_cost":0.001}}',
  );
  assert.equal(parsed.modelId, 'z-ai-model-x');
  assert.equal(parsed.text, 'fixture answer');
  assert.equal(parsed.totalCost, 0.001);
  assert.equal(parsed.parsed, true);
});

test('zcode identity from output is UNKNOWN when the stream does not prove a model (D13)', () => {
  assert.equal(evaluateZcodeIdentity('{"model":"z-ai-model-x"}').modelId, 'z-ai-model-x');
  assert.equal(evaluateZcodeIdentity('{"model":"z-ai-model-x"}').proven, true);
  const unknown = evaluateZcodeIdentity('plain text without machine identity');
  assert.equal(unknown.modelId, 'UNKNOWN');
  assert.equal(unknown.proven, false);
});

test('zcode nonce probe through T1 runner writes evidence and verifies fail-closed', async () => {
  const nonce = makeNonce();
  const spawn: SpawnFn = () => fakeChild('{"model":"z-ai-model-x","text":"' + nonce.expectedSha256 + '"}');
  const run = await runT1({
    contract: buildZcodeContract(),
    prompt: 'Reply with exactly one line: MUSH-M3-DISPATCH-OK ' + nonce.expectedSha256,
    workspaceRoot: WORKSPACE,
    receiptPath: EVIDENCE + '.t1-receipt.json',
    timeoutMs: 1000,
    spawn,
  });
  assert.equal(run.exitCode, 0);
  assert.ok(run.stdout.includes(nonce.expectedSha256));
  const parsed = parseZcodeJsonOutput(run.stdout);
  assert.equal(parsed.modelId, 'z-ai-model-x');
  const evidence = JSON.parse(readFileSync(EVIDENCE + '.t1-receipt.json', 'utf8')) as Record<string, unknown>;
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.adapter_id, 'zcode');
  assert.equal(evidence.timed_out, false);
});

test('zcode registration stays UNKNOWN and gated until a runtime nonce probe proves identity', () => {
  const contract = buildZcodeContract();
  assert.equal(contract.expected_model_id, 'UNKNOWN', 'contract must not assume a model before runtime proof');
  const failedProbe = {
    adapterId: 'zcode',
    nonce: 'a'.repeat(32),
    expectedSha256: 'b'.repeat(64),
    observed: null,
    matched: false,
    evidencePath: EVIDENCE,
    stdoutSha256: 'A'.repeat(64),
    exitCode: 124,
  };
  assert.throws(() => verifyNonceProbe(failedProbe), /nonce/i);
});
