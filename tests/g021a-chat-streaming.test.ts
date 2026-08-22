import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  runT1,
  type ChildProcessLike,
  type SpawnFn,
} from '../src/adapters/t1-runner.ts';
import { validateAdapterContract } from '../src/adapters/contract.ts';
import {
  DispatchPipeline,
  createThrottledStream,
  type RunAdapterFn,
} from '../src/web/dispatch.ts';
import { ChatService, type ChatFrameEvent } from '../src/web/chat.ts';

// GOAL-021（派发包 rm004-p20a）后端聊天流式——U1 异步 202 ack、U2 SSE chat 帧、
// U3 t1 增量 stdout 透传 + 节流合帧。测试即验收规格（342± → 必须全绿）。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g021a', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function makeContract() {
  return validateAdapterContract({
    adapter_id: 'fake-t1',
    executable: 'fake.exe',
    arguments: ['--headless'],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'fake-provider',
    expected_model_id: 'fake-model',
  });
}

/** 逐个 chunk 异步吐出的 fake 子进程（验证 onStdout 增量透传）。 */
interface MultiChunkChild extends ChildProcessLike {
  emitStdout(chunks: string[]): void;
}

function makeMultiChunkChild(): MultiChunkChild {
  const stdoutListeners: Array<(chunk: Buffer | string) => void> = [];
  const handle: ChildProcessLike = {
    stdinWrite(): void {},
    stdinEnd(): void {},
    onStdout(listener: (chunk: Buffer | string) => void): void {
      stdoutListeners.push(listener);
    },
    onStderr(): void {},
    onExit(listener: (code: number | null) => void): void {
      setTimeout(() => listener(0), 10);
    },
    kill(): void {},
  };
  const child = handle as MultiChunkChild;
  child.emitStdout = (chunks: string[]) => {
    for (let i = 0; i < chunks.length; i += 1) {
      setTimeout(() => {
        for (const listener of stdoutListeners) listener(chunks[i]);
      }, 1 + i * 2);
    }
  };
  return child;
}

test('GOAL-021 U3: runT1 onStdout delivers each raw stdout chunk incrementally + cumulative stdout intact', async () => {
  const chunks = ['chunk-one ', 'chunk-two ', 'chunk-three'];
  const mkSpawn: SpawnFn = () => {
    const child = makeMultiChunkChild();
    child.emitStdout(chunks);
    return child;
  };
  const seen: string[] = [];
  const result = await runT1({
    contract: makeContract(),
    prompt: 'p',
    workspaceRoot: fixtureRoot(),
    receiptPath: path.join(fixtureRoot(), 'r.json'),
    timeoutMs: 1000,
    spawn: mkSpawn,
    onStdout: (c) => seen.push(c),
  });
  assert.deepEqual(seen, chunks, 'each raw stdout chunk must be forwarded');
  assert.equal(result.stdout, chunks.join(''), 'full stdout accumulation unchanged');
});

test('GOAL-021 U3: createThrottledStream merges ≥512B or ≥200ms into frames, flush drains tail', () => {
  const frames: string[] = [];
  let t = 0;
  const ts = createThrottledStream({
    emit: (text) => frames.push(text),
    minIntervalMs: 200,
    minBytes: 512,
    now: () => t,
  });
  // 首帧立即出（流式首字即时可见）。
  ts.push('a');
  assert.deepEqual(frames, ['a']);
  // 小块未满 200ms/512B → 不入帧。
  ts.push('b');
  assert.deepEqual(frames, ['a']);
  // 累计 ≥512B → 强制合帧。
  ts.push('c'.repeat(600));
  assert.equal(frames.length, 2);
  assert.equal(frames[1], 'b' + 'c'.repeat(600));
  // ≥200ms 后小帧也到点出帧。
  frames.length = 0;
  ts.push('x');
  t += 200;
  ts.push('y');
  assert.equal(frames.length, 1);
  assert.equal(frames[0], 'xy');
  // flush 强制吐剩余尾部。
  frames.length = 0;
  ts.push('tail');
  ts.flush();
  assert.deepEqual(frames, ['tail']);
});

test('GOAL-021 U3: dispatch emits EXECUTE incremental stream frames only when streaming requested (plain dispatch unchanged)', async () => {
  const root = fixtureRoot();
  const runAdapter: RunAdapterFn = async (_contract, _prompt, opts) => {
    opts.onStdout?.('frag-one ');
    opts.onStdout?.('frag-two');
    return { exitCode: 0, stdout: 'frag-one frag-two', stderr: '', timedOut: false, childKilled: false };
  };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter,
  });
  // 无线流回调 → 既有事件序列不变（背向兼容）。
  const plain = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'plain' });
  assert.deepEqual(plain.events.map((e) => e.phase), ['ADMISSION', 'EXECUTE', 'REPORT', 'REVIEW']);
  assert.ok(!plain.events.some((e) => (e.payload as Record<string, unknown>).progress === 'stream'));

  // 注流式回调 → EXECUTE 增量帧（progress:'stream'）+ 宿主收到合并文本。
  const hostChunks: string[] = [];
  const streamed = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'stream' }, { onStdout: (chunk) => hostChunks.push(chunk) });
  const streamFrames = streamed.events.filter((e) => (e.payload as Record<string, unknown>).progress === 'stream');
  assert.ok(streamFrames.length >= 1, 'must emit at least one EXECUTE incremental frame');
  assert.equal(hostChunks.join(''), 'frag-one frag-two', 'host receives merged stream text');
});

test('GOAL-021 U2/U3: chat frames stream ADMITTED→EXECUTE→HEARTBEAT→REPORT and JSONL stores full reply', async () => {
  const root = fixtureRoot();
  const runAdapter: RunAdapterFn = async (_contract, _prompt, opts) => {
    opts.onStdout?.('part-one ');
    opts.onStdout?.('part-two');
    return { exitCode: 0, stdout: 'part-one part-two', stderr: '', timedOut: false, childKilled: false };
  };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter,
  });
  const frames: ChatFrameEvent[] = [];
  const chat = new ChatService({
    pipeline,
    runtimeRoot: path.join(root, 'runtime'),
    onEvent: (e) => frames.push(e),
  });
  const ack = await chat.post({ message: '流式' });
  assert.equal(ack.status, 'PENDING');
  await chat.whenSettled(ack.dispatch_id);

  assert.deepEqual(
    frames.map((f) => f.phase),
    ['ADMITTED', 'HEARTBEAT', 'EXECUTE', 'HEARTBEAT', 'EXECUTE', 'REPORT'],
    'phase order = ADMITTED → (HEARTBEAT+EXECUTE)* → REPORT',
  );
  assert.ok(frames.every((f) => f.session_id === ack.session_id && f.dispatch_id === ack.dispatch_id));
  const heartbeat = frames.find((f) => f.phase === 'HEARTBEAT');
  assert.equal(typeof heartbeat?.payload.elapsed_ms, 'number');
  const report = frames.find((f) => f.phase === 'REPORT');
  assert.equal(report?.payload.reply, 'part-one part-two', 'REPORT 含回复全文（非截断 tail）');
  assert.equal(typeof report?.payload.elapsed_ms, 'number');
  for (const exe of frames.filter((f) => f.phase === 'EXECUTE')) {
    assert.equal(typeof exe.payload.stream_text, 'string');
    assert.ok(String(exe.payload.stream_text).length > 0);
  }

  // 会话 JSONL 语义不变：user+head 两轮，head 为回复全文。
  const file = path.join(root, 'runtime', 'chat', `${ack.session_id}.jsonl`);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).role, 'user');
  assert.equal(JSON.parse(lines[1]).role, 'head');
  assert.equal(JSON.parse(lines[1]).text, 'part-one part-two');
});

test('GOAL-021 U1: 202 ack 即刻返回（后台执行未完成），user turn 先落盘、head turn 于 settle 后落盘', async () => {
  const root = fixtureRoot();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const runAdapter: RunAdapterFn = async (_contract, _prompt, opts) => {
    started = true;
    opts.onStdout?.('慢速回复');
    await gate; // 阻塞后台执行，验证 ack 已先返回（异步受理）。
    return { exitCode: 0, stdout: '慢速回复', stderr: '', timedOut: false, childKilled: false };
  };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter,
  });
  const chat = new ChatService({ pipeline, runtimeRoot: path.join(root, 'runtime') });
  const ackP = chat.post({ message: '慢活' });
  // 后台被 gate 阻塞：post 仍应在受理后立即 resolve（202 异步）。
  const ack = (await Promise.race([ackP, new Promise<null>((r) => setTimeout(() => r(null), 100))])) as
    | { dispatch_id: string; session_id: string; status: string }
    | null;
  assert.ok(ack !== null, 'ack 必须在后台执行完成前返回（202 异步受理）');
  assert.equal(ack.status, 'PENDING');
  assert.equal(started, true, '后台已启动但未完成');
  // 受理即落 user turn；head turn 尚未落盘（仍在途）。
  const userFile = path.join(root, 'runtime', 'chat', `${ack.session_id}.jsonl`);
  assert.equal(readFileSync(userFile, 'utf8').trim().split('\n').length, 1);
  assert.equal(JSON.parse(readFileSync(userFile, 'utf8').trim().split('\n')[0]).role, 'user');
  release();
  await chat.whenSettled(ack.dispatch_id);
  // settle 后 head turn 落盘（回复全文）。
  const settled = readFileSync(userFile, 'utf8').trim().split('\n');
  assert.equal(settled.length, 2);
  assert.equal(JSON.parse(settled[1]).role, 'head');
  assert.equal(JSON.parse(settled[1]).text, '慢速回复');
});
