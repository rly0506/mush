import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReadableStreamReadResult } from 'node:stream/web';
import { DispatchPipeline, type RunAdapterFn, type RunAdapterResult } from '../src/web/dispatch.ts';
import { ChatService } from '../src/web/chat.ts';
import { startBoardServer } from '../src/web/server.ts';

// GOAL-012B（派发包 rm003-p12）聊天体验四缺陷修复 —— 后端授权小改 A/B 的契约测试。
// A：chat.post() 参数化 {adapter_id?, effort?}（head-only fail-closed，缺省 head-dog/HIGH）；
// B：POST /api/chat 响应体加 reply/status（同步语义），前端 reply 直渲气泡（D3）。
// GOAL-017A U2：head-only 语义升级为 verified-harness 语义（deepseek-dsh 可任头犬，
// codex 因 F-50 仍拒绝）。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g012b', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk = async (): Promise<RunAdapterResult> => ({
  exitCode: 0,
  stdout: '头犬回报：已派活完毕 session_id=sess-012b',
  stderr: '',
  timedOut: false,
  childKilled: false,
});

function makeChat(root: string, captured?: { adapter_id?: string; effort?: string }, onEvent?: (event: import('../src/web/chat.ts').ChatFrameEvent) => void): ChatService {
  const spyRunner: RunAdapterFn = async (contract, prompt, opts) => {
    void contract;
    void prompt;
    void opts;
    return fakeOk();
  };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: spyRunner,
  });
  // real 聊天需 approval 记录在案（D6）：测试夹具内补 head-dog 批准记录。
  const approvalDir = path.join(root, 'goals', 'receipts', 'dispatch-approvals');
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(path.join(approvalDir, 'head-dog.approved.json'), JSON.stringify({ approved: true }) + '\n', 'utf8');
  if (captured) {
    const original = pipeline.dispatch.bind(pipeline);
    pipeline.dispatch = async (input: unknown) => {
      const typed = input as { adapter_id?: string; effort?: string };
      captured.adapter_id = typed.adapter_id;
      captured.effort = typed.effort;
      return original(input as Parameters<DispatchPipeline['dispatch']>[0]);
    };
  }
  return new ChatService({ pipeline, runtimeRoot: path.join(root, 'runtime'), onEvent });
}

test('D1-A: chat.post 缺省 adapter=head-dog / effort=HIGH（向后兼容）', async () => {
  const captured: { adapter_id?: string; effort?: string } = {};
  const chat = makeChat(fixtureRoot(), captured);
  const result = await chat.post({ message: '默认参数' });
  assert.equal(captured.adapter_id, 'head-dog');
  assert.equal(captured.effort, 'HIGH');
  assert.equal(result.role, 'head');
});

test('D1-A: chat.post 接受显式 effort 档位（LOW/XHIGH 透传）', async () => {
  const captured: { adapter_id?: string; effort?: string } = {};
  const chat = makeChat(fixtureRoot(), captured);
  await chat.post({ message: '低档', effort: 'LOW' });
  assert.equal(captured.effort, 'LOW');
  await chat.post({ message: '超档', effort: 'XHIGH' });
  assert.equal(captured.effort, 'XHIGH');
});

test('D1-A/GOAL-017A: verified executor harness can be head; UNVERIFIED codex and unknown are rejected', async () => {
  const chat = makeChat(fixtureRoot());
  // deepseek-dsh 是 verified 白名单 harness，即使 role=executor 也可任头犬。
  const result = await chat.post({ message: 'x', adapter_id: 'deepseek-dsh' });
  assert.equal(result.role, 'head');
  await assert.rejects(() => chat.post({ message: 'x', adapter_id: 'codex' }), /UNVERIFIED/);
  await assert.rejects(() => chat.post({ message: 'x', adapter_id: 'no-such-dog' }), /verified/);
  await assert.rejects(() => chat.post({ message: 'x', effort: 'MEDIUM' as 'HIGH' }), /effort/);
});

test('D3-B: chat.post 返回 202 ack；后台执行后会话 JSONL 完整含头犬回复', async () => {
  const frames: Array<{ phase: string; payload: Record<string, unknown> }> = [];
  const chat = makeChat(fixtureRoot(), undefined, (event) => frames.push({ phase: event.phase, payload: event.payload }));
  const ack = await chat.post({ message: '给我回复' });
  // GOAL-021 异步化：ack 不含回复（202 语义），携带 dispatch_id/session_id。
  assert.equal(ack.status, 'PENDING');
  assert.equal(ack.role, 'head');
  assert.ok(ack.dispatch_id.length > 0);
  assert.ok(ack.session_id.length > 0);
  assert.ok(!('reply' in ack), 'ack 不携带同步 reply（回复走 SSE chat 帧）');
  await chat.whenSettled(ack.dispatch_id);
  const report = frames.find((f) => f.phase === 'REPORT');
  assert.ok(report, 'must emit a chat REPORT frame');
  assert.equal(typeof report.payload.status, 'string');
  assert.match(String(report.payload.reply), /头犬回报/);
});

test('GOAL-021 U1: POST /api/chat 202 即返 {dispatch_id, session_id}，回复经 SSE chat 帧 REPORT 推送', async () => {
  const root = fixtureRoot();
  const approvalRoot = path.join(root, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot,
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: fakeOk,
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g012b-async',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(root, 'runtime'),
  });
  try {
    // 先挂 SSE，再发 chat：断言 chat 阶段帧依序到达（ADMITTED→…→REPORT 含回复全文）。
    const base = `http://127.0.0.1:${server.port}`;
    const streamRes = await fetch(base + '/api/stream');
    const reader = streamRes.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    const frames: Array<{ phase?: string; payload?: Record<string, unknown> }> = [];
    const framePromise = (async () => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !frames.some((f) => f.phase === 'REPORT')) {
        const chunk = await Promise.race([
          reader?.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => setTimeout(() => resolve({ done: false, value: undefined } as unknown as ReadableStreamReadResult<Uint8Array>), 250)),
        ]);
        if (chunk === undefined || chunk.done) break;
        const text = decoder.decode(chunk.value, { stream: true });
        for (const line of text.split('\n')) {
          const m = /^data: (\{.*\})\s*$/.exec(line);
          if (m === null) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(m[1]);
          } catch {
            continue;
          }
          if ((parsed as { kind?: string }).kind === 'chat') {
            frames.push(parsed as { phase?: string; payload?: Record<string, unknown> });
          }
        }
      }
    })();

    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '冒烟一句' }),
    });
    assert.equal(res.status, 202, '异步受理 202（非同步 200）');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(typeof body.session_id, 'string');
    assert.equal(typeof body.dispatch_id, 'string');
    assert.ok(!('reply' in body), '202 响应体不含同步 reply');

    await framePromise;
    const report = frames.find((f) => f.phase === 'REPORT');
    assert.ok(report, 'SSE 必须收到 chat REPORT 帧');
    assert.match(String(report.payload?.reply), /头犬回报/);
    // 会话 JSONL 语义不变：user+head 两轮完整落盘。
    const chatFile = path.join(root, 'runtime', 'chat', `${body.session_id}.jsonl`);
    assert.ok(existsSync(chatFile));
    assert.equal(readFileSync(chatFile, 'utf8').trim().split('\n').length, 2);
  } finally {
    await server.close();
  }
});

test('D1-A/GOAL-017A: POST /api/chat 传 UNVERIFIED codex → 400（verified-only fail-closed）', async () => {
  const root = fixtureRoot();
  const approvalRoot = path.join(root, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  // D6：real 聊天需 head-dog 批准记录在案（测试夹具补一条）。
  mkdirSync(path.join(root, 'goals', 'receipts', 'dispatch-approvals'), { recursive: true });
  writeFileSync(
    path.join(root, 'goals', 'receipts', 'dispatch-approvals', 'head-dog.approved.json'),
    JSON.stringify({ approved: true }) + '\\n',
    'utf8',
  );
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot,
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: fakeOk,
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g012b-guard',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(root, 'runtime'),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '伪装 codex', adapter_id: 'codex' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.match(String(body.error), /UNVERIFIED/);
  } finally {
    await server.close();
  }
});
