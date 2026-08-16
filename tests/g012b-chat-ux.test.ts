import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, type RunAdapterFn } from '../src/web/dispatch.ts';
import { ChatService } from '../src/web/chat.ts';
import { startBoardServer } from '../src/web/server.ts';

// GOAL-012B（派发包 rm003-p12）聊天体验四缺陷修复 —— 后端授权小改 A/B 的契约测试。
// A：chat.post() 参数化 {adapter_id?, effort?}（head-only fail-closed，缺省 head-dog/HIGH）；
// B：POST /api/chat 响应体加 reply/status（同步语义），前端 reply 直渲气泡（D3）。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g012b', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk: RunAdapterFn = async () => ({
  exitCode: 0,
  stdout: '头犬回报：已派活完毕 session_id=sess-012b',
  stderr: '',
  timedOut: false,
  childKilled: false,
});

function makeChat(root: string, captured?: { adapter_id?: string; effort?: string }): ChatService {
  const spyRunner: RunAdapterFn = async (args, opts) => {
    void args;
    void opts;
    return fakeOk(args, opts);
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
  return new ChatService({ pipeline, runtimeRoot: path.join(root, 'runtime') });
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

test('D1-A: adapter_id 非 head 角色即 fail-closed（executor/未知一律拒绝）', async () => {
  const chat = makeChat(fixtureRoot());
  await assert.rejects(() => chat.post({ message: 'x', adapter_id: 'deepseek-dsh' }), /head/);
  await assert.rejects(() => chat.post({ message: 'x', adapter_id: 'no-such-dog' }), /head/);
  await assert.rejects(() => chat.post({ message: 'x', effort: 'MEDIUM' as 'HIGH' }), /effort/);
});

test('D3-B: chat.post 结果含 reply（头犬回复文本）与 status', async () => {
  const chat = makeChat(fixtureRoot());
  const result = await chat.post({ message: '给我回复' });
  assert.equal(typeof result.reply, 'string');
  assert.match(result.reply, /头犬回报/);
  assert.equal(typeof result.status, 'string');
});

test('D3-B: POST /api/chat 响应体含 reply/status（200 同步语义，契约 v1.3.1）', async () => {
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
    runId: 'g012b-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(root, 'runtime'),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '冒烟一句' }),
    });
    assert.equal(res.status, 200, '同步返回 200（非 202 异步受理）');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(typeof body.reply, 'string');
    assert.match(String(body.reply), /头犬回报/);
    assert.equal(typeof body.status, 'string');
    assert.equal(typeof body.session_id, 'string');
    // 持久化对账路径不变：jsonl 含 user+head 两轮
    const chatFile = path.join(root, 'runtime', 'chat', `${body.session_id}.jsonl`);
    assert.ok(existsSync(chatFile));
    assert.equal(readFileSync(chatFile, 'utf8').trim().split('\n').length, 2);
  } finally {
    await server.close();
  }
});

test('D1-A: POST /api/chat 传 executor adapter_id → 400（head-only fail-closed）', async () => {
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
      body: JSON.stringify({ message: '伪装 executor', adapter_id: 'deepseek-dsh' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.match(String(body.error), /head/);
  } finally {
    await server.close();
  }
});
