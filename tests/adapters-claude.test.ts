import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildClaudeContract,
  parseClaudeStreamJson,
  runClaudeStreamNonceProbe,
  verifyNonceProbeResult,
  type StreamIdentity,
} from '../src/adapters/claude.ts';
import { makeNonce } from '../src/adapters/deepseek.ts';
import type { ChildProcessLike, SpawnFn } from '../src/adapters/t1-runner.ts';

// GOAL-003 U3：Claude Code 犬 = claude -p --output-format stream-json（T2 通道）。
// 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md（claude 行）。
// 真实长任务不在沙箱跑；用录制/fake JSON 流做协议 fixture；nonce 探测同 D13。

const WORKSPACE = path.resolve(process.cwd(), '.test-fixtures', 'adapters');
const EVIDENCE = path.join(WORKSPACE, 'nonce-claude-evidence.json');

function makeFakeChild(stdout: string, exitCode = 0): ChildProcessLike {
  return {
    stdinWrite: () => {},
    stdinEnd: () => {},
    onStdout: (listener) => setTimeout(() => listener(stdout), 1),
    onStderr: () => {},
    onExit: (listener) => setTimeout(() => listener(exitCode), 2),
    kill: () => {},
  } as unknown as ChildProcessLike;
}

const STREAM_FIXTURE = [
  '{"type":"system","subtype":"init","model":"claude-sonnet-4-5","session_id":"s1"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"thinking..."}]}}',
  '{"type":"result","subtype":"success","result":"final answer","total_cost_usd":0.0042,"session_id":"s1"}',
].join('\n');

test('Claude contract is stream-json with prompt as final argument (landscape claude row)', () => {
  const contract = buildClaudeContract('claude-sonnet-4-5');
  assert.equal(contract.adapter_id, 'claude-code');
  assert.equal(contract.executable, 'claude');
  // claude-real-008 教训：--model 必须显式下发，否则渠道服务其默认模型。
  assert.deepEqual(contract.arguments, ['-p', '--model', 'claude-sonnet-4-5', '--output-format', 'stream-json', '--verbose']);
  assert.equal(contract.protocol, 'stream-json');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.expected_model_id, 'claude-sonnet-4-5');
});

test('stream-json parser extracts identity, final result, and bounded cost from recorded fixture', () => {
  const parsed = parseClaudeStreamJson(STREAM_FIXTURE);
  assert.equal(parsed.identity.modelId, 'claude-sonnet-4-5');
  assert.equal(parsed.resultText, 'final answer');
  assert.equal(parsed.totalCostUsd, 0.0042);
  assert.equal(parsed.ended, true);
  assert.equal(parsed.messageCount, 2);
});

test('stream-json parser tolerates blank lines and unknown event types (never drops a valid line)', () => {
  const parsed = parseClaudeStreamJson('\n{"type":"progress"}\n' + STREAM_FIXTURE + '\n');
  assert.equal(parsed.resultText, 'final answer');
  assert.equal(parsed.ended, true);
});

test('claude nonce probe computes the expected digest through stream result text and writes evidence', async () => {
  const nonce = makeNonce();
  const stream = [
    '{"type":"system","subtype":"init","model":"claude-sonnet-4-5"}',
    '{"type":"result","subtype":"success","result":"' + nonce.expectedSha256 + '","total_cost_usd":0.0001}',
  ].join('\n');
  const spawn: SpawnFn = () => makeFakeChild(stream);
  const probe = await runClaudeStreamNonceProbe({
    contract: buildClaudeContract('claude-sonnet-4-5'),
    workspaceRoot: WORKSPACE,
    evidencePath: EVIDENCE,
    timeoutMs: 1000,
    nonce,
    spawn,
  });
  assert.equal(probe.matched, true);
  assert.equal(probe.identity.modelId, 'claude-sonnet-4-5');
  assert.ok(existsSync(EVIDENCE));
  const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Record<string, unknown>;
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.adapter_id, 'claude-code');
  assert.equal(evidence.nonce, nonce.nonce);
  assert.equal(evidence.observed, nonce.expectedSha256);
  assert.equal(evidence.matched, true);
  assert.equal(evidence.stdout_sha256, createHash('sha256').update(stream, 'utf8').digest('hex').toUpperCase());
  assert.doesNotThrow(() => verifyNonceProbeResult(probe));
});

test('claude nonce mismatch and missing model are recorded honestly and verify fail-closed', async () => {
  const nonce = makeNonce();
  const spawn: SpawnFn = () =>
    makeFakeChild('{"type":"result","subtype":"success","result":"' + 'f'.repeat(64) + '","total_cost_usd":0.0001}');
  const probe = await runClaudeStreamNonceProbe({
    contract: buildClaudeContract('claude-sonnet-4-5'),
    workspaceRoot: WORKSPACE,
    evidencePath: EVIDENCE,
    timeoutMs: 1000,
    nonce,
    spawn,
  });
  assert.equal(probe.matched, false);
  assert.equal(probe.identity.modelId, 'UNKNOWN', 'missing model in stream must be UNKNOWN');
  assert.throws(() => verifyNonceProbeResult(probe), /nonce|identity/i);
});

test('DEF-01: claude contract fails closed when the runtime stream serves a non-claude model family', async () => {
  const nonce = makeNonce();
  const stream = [
    '{"type":"system","subtype":"init","model":"deepseek-v4-flash"}',
    '{"type":"result","subtype":"success","result":"' + nonce.expectedSha256 + '","total_cost_usd":0.0001}',
  ].join('\n');
  const spawn: SpawnFn = () => makeFakeChild(stream);
  const probe = await runClaudeStreamNonceProbe({
    contract: buildClaudeContract('claude-sonnet-4-5'),
    workspaceRoot: WORKSPACE,
    evidencePath: EVIDENCE,
    timeoutMs: 1000,
    nonce,
    spawn,
  });
  assert.equal(probe.matched, true, 'nonce matches, but that only proves a consistent backend');
  assert.equal(probe.identityMismatch, true, 'deepseek model under anthropic contract must be flagged');
  assert.throws(() => verifyNonceProbeResult(probe), /identity|mismatch/i);
  const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Record<string, unknown>;
  assert.equal(evidence.identity_mismatch, true);
  assert.equal(evidence.identity_proven, false);
});

test('identity extraction returns proven only when stream declares a non-UNKNOWN model', () => {
  const withModel: StreamIdentity = parseClaudeStreamJson(
    '{"type":"system","subtype":"init","model":"claude-opus-4-6"}',
  ).identity;
  assert.equal(withModel.proven, true);
  const withoutModel: StreamIdentity = parseClaudeStreamJson('{"type":"system","subtype":"init"}').identity;
  assert.equal(withoutModel.modelId, 'UNKNOWN');
  assert.equal(withoutModel.proven, false);
});
