import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPiContract, extractPiIdentity } from '../src/adapters/pi.ts';
import { runPiRpc, type PiRpcSpawnFn } from '../src/adapters/pi-rpc-runner.ts';

// GP-29：pi-rpc runner 黄金线协议矩阵（fake 子进程；黄金参照语义对照
// invoke-managed-pi-agent.ps1：id/type/command/success 关联、身份 fail-closed、
// assistant 终态、三段超时）。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'pi-rpc', `${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

interface FakeChildHandle {
  spawn: PiRpcSpawnFn;
  stdinWrites: string[];
}

/** fake 子进程：script(lines) 收到 stdin 累积串，返回要往 stdout 写的行。 */
function makeFakeChild(script: (writes: () => string) => AsyncGenerator<string>): FakeChildHandle {
  const handle: FakeChildHandle = { spawn: () => undefined as never, stdinWrites: [] };
  let exitListener: ((code: number | null) => void) | null = null;
  let errorListener: ((error: Error) => void) | null = null;
  let stdoutListener: ((chunk: Buffer) => void) | null = null;
  let stderrListener: ((chunk: Buffer) => void) | null = null;
  handle.spawn = () => ({
    stdin: {
      write: (chunk: string) => {
        handle.stdinWrites.push(chunk);
        void drive();
      },
      end: () => {
        setTimeout(() => exitListener?.(0), 5);
      },
    },
    stdout: { on: (_e: 'data', l: (chunk: Buffer) => void) => (stdoutListener = l) },
    stderr: { on: (_e: 'data', l: (chunk: Buffer) => void) => (stderrListener = l) },
    on: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => {
      if (event === 'exit') exitListener = listener as (code: number | null) => void;
      if (event === 'error') errorListener = listener as (error: Error) => void;
    },
    kill: () => exitListener?.(1),
  });
  let driven = false;
  async function drive() {
    if (driven) return;
    driven = true;
    await new Promise((r) => setTimeout(r, 5));
    for await (const line of script(() => handle.stdinWrites.join(''))) {
      stdoutListener?.(Buffer.from(line + '\n', 'utf8'));
      await new Promise((r) => setTimeout(r, 2));
    }
  }
  return handle;
}

const STATE_OK = (id: string) =>
  JSON.stringify({ id, type: 'response', command: 'get_state', success: true, data: { model: { provider: 'google', id: 'gemini-2.5-pro' }, session: { id: 'session-abc-123' } } });
const PROMPT_OK = (id: string) => JSON.stringify({ id, type: 'response', command: 'prompt', success: true });
const ASSISTANT_END = (text: string) =>
  JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const USER_END = JSON.stringify({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'lifecycle' }] } });

test('pi contract is rpc-protocol with UNKNOWN identity (D13) and resume flag', () => {
  const contract = buildPiContract();
  assert.equal(contract.protocol, 'pi-rpc');
  assert.equal(contract.prompt_transport, 'rpc');
  assert.equal(contract.expected_provider, 'UNKNOWN');
  assert.equal(contract.resume_flag, '--session-id');
});

test('happy path: handshake identity + assistant completion + session anchor', async () => {
  const handle = makeFakeChild(async function* (writes) {
    while (!writes().includes('prompt')) await Promise.resolve();
    const stateId = JSON.parse(writes().split('\n')[0]).id as string;
    const promptId = JSON.parse(writes().split('\n')[1]).id as string;
    yield STATE_OK(stateId);
    yield PROMPT_OK(promptId);
    yield USER_END; // 生命周期事件：非完成候选
    yield ASSISTANT_END('第一段');
    yield ASSISTANT_END('第二段');
  });
  const root = fixtureRoot();
  const receiptPath = path.join(root, 'receipt.json');
  const result = await runPiRpc(buildPiContract(), '做点事', {
    workspaceRoot: root,
    receiptPath,
    timeoutMs: 5_000,
    spawn: handle.spawn,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.failClosedReason, null);
  assert.equal(result.confirmedProvider, 'google');
  assert.equal(result.confirmedModelId, 'gemini-2.5-pro');
  assert.ok(result.stdout.includes('第一段\n第二段'), 'assistant 文本按序拼接');
  assert.ok(result.stdout.includes('session_id: session-abc-123'), '会话锚点追加');
  assert.ok(handle.stdinWrites[0].split('\n').length >= 2, '双命令一次写入（T8-001）');
  assert.ok(existsSync(receiptPath));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.confirmed_provider, 'google');
});

test('wrong-runtime-model is fail-closed when expectation is concrete', async () => {
  const handle = makeFakeChild(async function* (writes) {
    while (!writes().includes('prompt')) await Promise.resolve();
    const stateId = JSON.parse(writes().split('\n')[0]).id as string;
    yield JSON.stringify({ id: stateId, type: 'response', command: 'get_state', success: true, data: { model: { provider: 'google', id: 'gemini-2.5-pro' } } });
  });
  const contract = { ...buildPiContract(), expected_provider: 'anthropic', expected_model_id: 'claude-sonnet-5' };
  const result = await runPiRpc(contract, 'x', { workspaceRoot: fixtureRoot(), receiptPath: path.join(fixtureRoot(), 'r.json'), timeoutMs: 3_000, spawn: handle.spawn });
  assert.equal(result.exitCode, 1);
  assert.match(result.failClosedReason ?? '', /^wrong-runtime-model: got google\/gemini-2\.5-pro want anthropic\/claude-sonnet-5/);
});

test('UNKNOWN expectation accepts any runtime identity (D13 honest record)', async () => {
  const handle = makeFakeChild(async function* (writes) {
    while (!writes().includes('prompt')) await Promise.resolve();
    const stateId = JSON.parse(writes().split('\n')[0]).id as string;
    const promptId = JSON.parse(writes().split('\n')[1]).id as string;
    yield JSON.stringify({ id: stateId, type: 'response', command: 'get_state', success: true, data: { model: { provider: 'whatever', id: 'whatever-9' } } });
    yield PROMPT_OK(promptId);
    yield ASSISTANT_END('ok');
  });
  const result = await runPiRpc(buildPiContract(), 'x', { workspaceRoot: fixtureRoot(), receiptPath: path.join(fixtureRoot(), 'r.json'), timeoutMs: 3_000, spawn: handle.spawn });
  assert.equal(result.exitCode, 0);
  assert.equal(result.confirmedProvider, 'whatever');
});

test('state-error and settle-timeout are fail-closed', async () => {
  const bad = makeFakeChild(async function* (writes) {
    while (!writes().includes('prompt')) await Promise.resolve();
    const stateId = JSON.parse(writes().split('\n')[0]).id as string;
    yield JSON.stringify({ id: stateId, type: 'response', command: 'get_state', success: false, error: 'auth' });
  });
  const r1 = await runPiRpc(buildPiContract(), 'x', { workspaceRoot: fixtureRoot(), receiptPath: path.join(fixtureRoot(), 'r1.json'), timeoutMs: 2_000, spawn: bad.spawn });
  assert.equal(r1.failClosedReason, 'state-error');
  assert.equal(r1.exitCode, 1);

  const silent = makeFakeChild(async function* (writes) {
    while (!writes().includes('prompt')) await Promise.resolve();
    const stateId = JSON.parse(writes().split('\n')[0]).id as string;
    const promptId = JSON.parse(writes().split('\n')[1]).id as string;
    yield STATE_OK(stateId);
    yield PROMPT_OK(promptId);
    // 之后沉默：settle 超时路径。
  });
  const r2 = await runPiRpc(buildPiContract(), 'x', { workspaceRoot: fixtureRoot(), receiptPath: path.join(fixtureRoot(), 'r2.json'), timeoutMs: 150, spawn: silent.spawn });
  assert.equal(r2.failClosedReason, 'agent-settle-timeout');
  assert.equal(r2.timedOut, true);
});

test('spawn throw is contained DEF-02 style (exit 127)', async () => {
  const boom: PiRpcSpawnFn = () => {
    throw new Error('ENOENT simulated');
  };
  const result = await runPiRpc(buildPiContract(), 'x', { workspaceRoot: fixtureRoot(), receiptPath: path.join(fixtureRoot(), 'r.json'), timeoutMs: 1_000, spawn: boom });
  assert.equal(result.exitCode, 127);
  assert.equal(result.failClosedReason, 'spawn-error');
});

test('extractPiIdentity is defensive across field spellings', () => {
  assert.deepEqual(extractPiIdentity({ model: { provider: 'p', id: 'm' }, session_id: 's1' }), { provider: 'p', modelId: 'm', sessionId: 's1' });
  assert.deepEqual(extractPiIdentity({ model: { provider: 'p', model: 'm2' }, sessionId: 's2' }), { provider: 'p', modelId: 'm2', sessionId: 's2' });
  assert.deepEqual(extractPiIdentity(null), { provider: '', modelId: '', sessionId: null });
});
