import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateCompletion, validateTaskPacket } from './support/pi-rpc-completion.ts';
import { readStrictUtf8 } from './support/strict-utf8.ts';
import {
  agentSettled,
  messageEnd,
  promptResponseSuccess,
  runRpcSession,
  stateResponse,
  type RpcSessionOptions,
} from './support/pi-rpc-session.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1
//     L188-L202（strict UTF-8 dispatch packet 读取 / task packet 校验矩阵）
//     L291-L312（handshake / settle / commit 三阶段超时状态机）
//     L325-L333（EOF 分支：exited-before-settled / missing-prompt-response）
//     L343-L357（state 响应关联与身份：state-error / missing-runtime-identity / wrong-runtime-model）
//     L402（completion 候选不唯一 → object-missing-or-ambiguous）
//     L405-L462（completion 校验各 fail-closed 分支）

const FIXTURE_ROOT = path.resolve(process.cwd(), '.test-fixtures', 'pi-rpc-edge');
const ALLOWED_A = path.join(FIXTURE_ROOT, 'allowed-a.txt');
const ALLOWED_B = path.join(FIXTURE_ROOT, 'allowed-b.txt');
const EVIDENCE_A = path.join(FIXTURE_ROOT, 'evidence-a.json');
const EVIDENCE_B = path.join(FIXTURE_ROOT, 'evidence-b.json');

let hashA = '';
let hashB = '';
let taskPacket: Record<string, unknown>;
let promptContent: string;

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

before(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(ALLOWED_A, 'allowed-a', 'utf8');
  writeFileSync(ALLOWED_B, 'allowed-b', 'utf8');
  writeFileSync(EVIDENCE_A, '{"verdict":"PASS-A"}', 'utf8');
  writeFileSync(EVIDENCE_B, '{"verdict":"PASS-B"}', 'utf8');
  hashA = sha256File(EVIDENCE_A);
  hashB = sha256File(EVIDENCE_B);
  taskPacket = {
    schema_version: 1,
    packet_type: 'managed_pi_task',
    objective: 'Edge-case task.',
    allowed_paths_and_hashes: [
      { path: ALLOWED_A, sha256: sha256File(ALLOWED_A) },
      { path: ALLOWED_B, sha256: sha256File(ALLOWED_B) },
      { path: EVIDENCE_A, sha256: hashA },
      { path: EVIDENCE_B, sha256: hashB },
    ],
    allowed_operations: ['read'],
    required_evidence: [
      { path: EVIDENCE_A, sha256: hashA },
      { path: EVIDENCE_B, sha256: hashB },
    ],
    stop_conditions: ['scope growth'],
  };
  promptContent = JSON.stringify(taskPacket);
});

function sessionOptions(overrides: Partial<RpcSessionOptions> = {}): RpcSessionOptions {
  return {
    expectedProvider: 'deepseek',
    expectedModelId: 'deepseek-v4-pro',
    promptContent,
    dispatchPacketPath: path.join(FIXTURE_ROOT, 'dispatch-packet.json'),
    goalPacketPath: path.join(FIXTURE_ROOT, 'goal-packet.json'),
    runRoot: FIXTURE_ROOT,
    maxNonTerminalTurns: 8,
    handshakeTimeoutMs: 60,
    settleTimeoutMs: 60,
    exitTimeoutMs: 60,
    processTimeoutMs: 300,
    childScript: async function* () {
      yield agentSettled();
    },
    ...overrides,
  };
}

const hangForever = async function* (): AsyncGenerator<string | null, void, void> {
  await new Promise<never>(() => {
    // 子进程保持存活且不产出任何行。
  });
};

test('state response failure fails closed as state-error with no event (PS L343-L346)', async () => {
  const result = await runRpcSession(
    sessionOptions({
      childScript: async function* (api) {
        yield stateResponse(api.stateCommandId, { success: false });
      },
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'state-error');
  assert.equal(result.event, null);
});

test('empty runtime identity fails closed as missing-runtime-identity (PS L351)', async () => {
  const result = await runRpcSession(
    sessionOptions({
      childScript: async function* (api) {
        yield stateResponse(api.stateCommandId, { provider: '' });
      },
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'missing-runtime-identity');
  assert.equal(result.event, null);
});

test('prompt handshake deadline after state confirmation fails closed (PS L297-L298, L475-L481)', async () => {
  const result = await runRpcSession(
    sessionOptions({
      childScript: async function* (api) {
        yield stateResponse(api.stateCommandId);
        yield* hangForever();
      },
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'prompt-handshake-timeout');
  assert.equal(result.event, null);
  assert.equal(result.childKilled, true, 'prompt handshake timeout must leave no surviving child');
});

test('child EOF during settle fails closed as agent-exited-before-settled (PS L326)', async () => {
  const result = await runRpcSession(
    sessionOptions({
      childScript: async function* (api) {
        yield stateResponse(api.stateCommandId);
        yield promptResponseSuccess(api.promptCommandId);
        // EOF：prompt 已确认、settle 未到，子进程退出。
      },
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'agent-exited-before-settled');
  assert.equal(result.event, null);
});

test('commit-phase exit deadline fails closed after the signed event (PS L309-L311)', async () => {
  const result = await runRpcSession(
    sessionOptions({
      childScript: async function* (api) {
        yield stateResponse(api.stateCommandId);
        yield promptResponseSuccess(api.promptCommandId);
        yield messageEnd({
          completion: {
            schema_version: 1,
            summary: 'done',
            changed_paths: [],
            tests_run: ['t'],
            test_results: ['PASS'],
            evidence_paths_and_hashes: [
              { path: EVIDENCE_A, sha256: hashA },
              { path: EVIDENCE_B, sha256: hashB },
            ],
            open_findings: [],
            requested_decision: 'APPROVE',
            next_step: 'Parent review.',
          },
        });
        yield agentSettled();
        yield* hangForever();
      },
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'process-timeout');
  assert.ok(result.event !== null, 'signed event was already emitted before the commit deadline');
  assert.equal(result.childKilled, true, 'commit timeout must leave no surviving child');
});

test('more than one completion candidate in one message fails closed (PS L402)', async () => {
  const completion = {
    schema_version: 1,
    summary: 'done',
    changed_paths: [],
    tests_run: ['t'],
    test_results: ['PASS'],
    evidence_paths_and_hashes: [
      { path: EVIDENCE_A, sha256: hashA },
      { path: EVIDENCE_B, sha256: hashB },
    ],
    open_findings: [],
    requested_decision: 'APPROVE',
    next_step: 'Parent review.',
  };
  const result = await runRpcSession(
    sessionOptions({
      childScript: async function* (api) {
        yield stateResponse(api.stateCommandId);
        yield promptResponseSuccess(api.promptCommandId);
        yield messageEnd({
          content: [
            { type: 'text', text: JSON.stringify(completion) },
            { type: 'text', text: JSON.stringify(completion) },
          ],
        });
        yield agentSettled();
      },
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'completion-object-missing-or-ambiguous');
  assert.equal(result.event, null);
});

test('task packet validation matrix rejects every malformed variant (PS L193-L201)', () => {
  const cases: Array<Record<string, unknown>> = [
    { ...taskPacket, schema_version: 2 },
    { ...taskPacket, packet_type: 'other' },
    { ...taskPacket, objective: '   ' },
    { ...taskPacket, allowed_paths_and_hashes: [] },
    { ...taskPacket, allowed_operations: ['write'] },
    { ...taskPacket, required_evidence: [] },
    { ...taskPacket, stop_conditions: [] },
  ];
  for (const variant of cases) {
    assert.throws(
      () => {
        const reason = validateTaskPacket(variant);
        if (reason !== null) throw new Error(reason);
      },
      /completion-task-packet-invalid/,
      JSON.stringify(variant),
    );
  }
});

test('packet/evidence fail-closed branch matrix stays exact (PS L414-L460)', () => {
  const realResolver = {
    fullPath: (p: string) => path.resolve(p),
    existsSha256: (p: string) => {
      const map: Record<string, string> = {
        [path.resolve(ALLOWED_A).toLowerCase()]: sha256File(ALLOWED_A).toUpperCase(),
        [path.resolve(ALLOWED_B).toLowerCase()]: sha256File(ALLOWED_B).toUpperCase(),
        [path.resolve(EVIDENCE_A).toLowerCase()]: hashA.toUpperCase(),
        [path.resolve(EVIDENCE_B).toLowerCase()]: hashB.toUpperCase(),
      };
      return map[path.resolve(p).toLowerCase()] ?? null;
    },
  };
  const run = (packet: Record<string, unknown>, completion: Record<string, unknown>): string | null => {
    const result = validateCompletion(completion, { packet, runRoot: FIXTURE_ROOT, resolver: realResolver });
    return result.ok ? null : result.reason;
  };
  void run;

  const validCompletion = {
    schema_version: 1,
    summary: 'done',
    changed_paths: [],
    tests_run: ['t'],
    test_results: ['PASS'],
    evidence_paths_and_hashes: [
      { path: EVIDENCE_A, sha256: hashA },
      { path: EVIDENCE_B, sha256: hashB },
    ],
    open_findings: [],
    requested_decision: 'APPROVE',
    next_step: 'Parent review.',
  };

  const cases: Array<{ packet: Record<string, unknown>; completion: Record<string, unknown>; reason: string }> = [
    {
      packet: { ...taskPacket, allowed_paths_and_hashes: [{ path: ALLOWED_A }] },
      completion: validCompletion,
      reason: 'completion-task-packet-path-shape-invalid',
    },
    {
      packet: { ...taskPacket, allowed_paths_and_hashes: [{ path: ALLOWED_A, sha256: 'F'.repeat(64) }] },
      completion: validCompletion,
      reason: 'completion-allowed-path-hash-mismatch',
    },
    {
      packet: { ...taskPacket, allowed_paths_and_hashes: [...(taskPacket.allowed_paths_and_hashes as unknown[]), { path: ALLOWED_A, sha256: sha256File(ALLOWED_A) }] },
      completion: validCompletion,
      reason: 'completion-task-packet-path-duplicate',
    },
    {
      packet: { ...taskPacket, required_evidence: [] },
      completion: validCompletion,
      reason: 'completion-task-packet-evidence-empty',
    },
    {
      packet: { ...taskPacket, required_evidence: [{ path: '  ' }] },
      completion: validCompletion,
      reason: 'completion-task-packet-evidence-shape-invalid',
    },
    {
      packet: { ...taskPacket, required_evidence: [...(taskPacket.required_evidence as unknown[]), { path: EVIDENCE_A, sha256: hashA }] },
      completion: validCompletion,
      reason: 'completion-task-packet-evidence-duplicate',
    },
    {
      packet: { ...taskPacket, required_evidence: [{ path: 'C:\\outside\\x.txt', sha256: 'A'.repeat(64) }] },
      completion: validCompletion,
      reason: 'completion-task-packet-evidence-outside-allowlist',
    },
    {
      packet: taskPacket,
      completion: { ...validCompletion, evidence_paths_and_hashes: [{ path: EVIDENCE_A, sha256: hashA }, { path: EVIDENCE_A, sha256: hashA }] },
      reason: 'completion-evidence-duplicate',
    },
    {
      packet: taskPacket,
      completion: { ...validCompletion, evidence_paths_and_hashes: [{ path: EVIDENCE_A, sha256: hashA }, { path: EVIDENCE_B, sha256: 'F'.repeat(64) }] },
      reason: 'completion-evidence-unexpected',
    },
    {
      packet: taskPacket,
      completion: { ...validCompletion, summary: '   ' },
      reason: 'completion-shape-invalid',
    },
  ];

  for (const entry of cases) {
    const result = validateCompletion(entry.completion, {
      packet: entry.packet,
      runRoot: FIXTURE_ROOT,
      resolver: realResolver,
    });
    assert.equal(result.ok ? null : result.reason, entry.reason, JSON.stringify(entry.packet));
  }
});

test('strict UTF-8 dispatch packet reader fails closed on missing or invalid bytes (PS L188-L190)', () => {
  assert.throws(() => readStrictUtf8(path.join(FIXTURE_ROOT, 'no-such-packet.json')), /dispatch-packet-read-error/i);
  const invalidPath = path.join(FIXTURE_ROOT, 'invalid-utf8-packet.json');
  writeFileSync(invalidPath, Buffer.from([0x7b, 0xc3, 0x28, 0x7d]));
  assert.throws(() => readStrictUtf8(invalidPath), /dispatch-packet-read-error/i);
  assert.equal(readStrictUtf8(path.join(FIXTURE_ROOT, 'evidence-a.json')), '{"verdict":"PASS-A"}');
});
