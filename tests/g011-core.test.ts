import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractSessionId, buildHeadDogContract, HEAD_DOG_T1_CHARTER } from '../src/adapters/head-dog.ts';
import { DispatchPipeline, type RunAdapterFn } from '../src/web/dispatch.ts';
import { ChatService } from '../src/web/chat.ts';
import { startBoardServer } from '../src/web/server.ts';

// GOAL-011 M1：会话续跑 + head-dog 适配器 + 聊天 API + roster role + DEF-10。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g011', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk: RunAdapterFn = async () => ({
  exitCode: 0,
  stdout: 'MUSH-CHAT-OK session_id=sess-abc123',
  stderr: '',
  timedOut: false,
  childKilled: false,
});

test('session_id extraction finds session ids in runner output (dsh --resume / claude --continue shapes)', () => {
  assert.equal(extractSessionId('done session_id=sess-abc123'), 'sess-abc123');
  assert.equal(extractSessionId('{"sessionId":"sess-xyz"}'), 'sess-xyz');
  assert.equal(extractSessionId('no session here'), null);
});

test('head-dog contract has role=head, deepseek-dsh channel, and charter injection text', () => {
  const contract = buildHeadDogContract();
  assert.equal(contract.adapter_id, 'head-dog');
  assert.equal(contract.executable, 'dsh');
  assert.equal(contract.role, 'head');
  assert.equal(contract.expected_provider, 'deepseek');
  assert.match(HEAD_DOG_T1_CHARTER, /宪法/);
  assert.match(HEAD_DOG_T1_CHARTER, /派发/);
});

test('roster exposes role field per contract (head vs executor)', () => {
  const pipeline = new DispatchPipeline({
    workspaceRoot: fixtureRoot(),
    approvalRoot: fixtureRoot(),
    ledgerPath: fixtureRoot() + '/ledger.jsonl',
  });
  const roster = pipeline.roster();
  const head = roster.find((entry) => entry.adapter_id === 'head-dog');
  assert.equal(head?.role, 'head');
  assert.equal(roster.find((entry) => entry.adapter_id === 'fake-t1')?.role ?? 'executor', 'executor');
});

test('ChatService persists turns in runtime/chat/<session>.jsonl and reads history', async () => {
  const root = fixtureRoot();
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: fakeOk,
  });
  const chat = new ChatService({ pipeline, runtimeRoot: path.join(root, 'runtime') });
  const first = await chat.post({ message: '第一轮' });
  assert.equal(first.role, 'head');
  assert.ok(first.session_id.length > 0);
  const second = await chat.post({ message: '第二轮', resume: first.session_id });
  assert.equal(second.session_id, first.session_id);
  // GOAL-021 异步化：chat.post 202 即返，回复后台落盘——await 在途后再对账。
  await Promise.all([chat.whenSettled(first.dispatch_id), chat.whenSettled(second.dispatch_id)]);
  const history = await chat.history(first.session_id, 10);
  assert.equal(history.turns.length, 4, 'two posts = two user/head turn pairs');
  // GOAL-021 异步化：两轮并发后台执行，落盘顺序可能 user1,user2,head1,head2
  // （而非严格交替）——只断言 user/head 各两轮、语义不变。
  assert.equal(history.turns.filter((t) => t.role === 'user').length, 2);
  assert.equal(history.turns.filter((t) => t.role === 'head').length, 2);
  assert.equal(history.turns[0].role, 'user');
  const file = path.join(root, 'runtime', 'chat', `${first.session_id}.jsonl`);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 4);
});

test('DEF-10: pipeline restores persisted .mush/workspace.json selection as default workspace', async () => {
  const root = fixtureRoot();
  const selected = path.join(root, 'selected-ws');
  mkdirSync(selected, { recursive: true });
  const mushDir = path.join(root, '.mush');
  mkdirSync(mushDir, { recursive: true });
  writeFileSync(
    path.join(mushDir, 'workspace.json'),
    JSON.stringify({ schema_version: 1, selected, selected_at_utc: '2026-08-17T00:00:00.000Z' }) + '\n',
    'utf8',
  );
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
  });
  assert.equal(pipeline.defaultWorkspace(), selected);
});
