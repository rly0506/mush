import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, InputError, type RunAdapterFn } from '../src/web/dispatch.ts';
import { ChatService } from '../src/web/chat.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { BoardPersistence } from '../src/web/persistence.ts';

// GOAL-017A（rm004-p17a）调度自由·后端：适配器 CRUD / 头犬解耦 / budget caps / 计数。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g017a', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk: RunAdapterFn = async () => ({ exitCode: 0, stdout: 'OK', stderr: '', timedOut: false, childKilled: false });

function makePipeline(root: string, overrides: Partial<ConstructorParameters<typeof DispatchPipeline>[0]> = {}) {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: fakeOk,
    ...overrides,
  });
}

test('GOAL-017A U1: listAdapters merges base + user override with origin markers', () => {
  const root = fixtureRoot();
  const adaptersPath = path.join(root, 'adapters.json');
  writeFileSync(
    adaptersPath,
    JSON.stringify({
      schema_version: 1,
      adapters: [
        { adapter_id: 'claude-code', template: 'claude', params: { model_id: 'claude-sonnet-4-5' }, removed: false },
        { adapter_id: 'my-dsh', template: 'dsh', params: { profile: 'headless-pro' }, removed: false },
      ],
    }),
    'utf8',
  );
  const pipeline = makePipeline(root, { adaptersPath });
  const adapters = pipeline.listAdapters();
  const claude = adapters.find((entry) => entry.adapter_id === 'claude-code');
  const myDsh = adapters.find((entry) => entry.adapter_id === 'my-dsh');
  const codex = adapters.find((entry) => entry.adapter_id === 'codex');
  assert.equal(claude?.origin, 'user-override');
  assert.equal(claude?.expected_model_id, 'claude-sonnet-4-5');
  assert.equal(myDsh?.origin, 'user');
  assert.equal(myDsh?.template, 'dsh');
  assert.equal(myDsh?.verified, true);
  assert.equal(codex?.origin, 'base');
  assert.equal(codex?.verified, false);
});

test('GOAL-017A U1: upsertAdapter persists and rebuilds contracts', async () => {
  const root = fixtureRoot();
  const adaptersPath = path.join(root, 'adapters.json');
  const pipeline = makePipeline(root, { adaptersPath });
  const view = pipeline.upsertAdapter({ template: 'dsh', adapter_id: 'custom-dsh', params: { profile: 'custom' } });
  assert.equal(view.adapter_id, 'custom-dsh');
  assert.equal(view.origin, 'user');
  assert.ok(existsSync(adaptersPath));
  const record = await pipeline.dispatch({ adapter_id: 'custom-dsh', prompt: 'hello' });
  assert.equal(record.status, 'DRY_RUN');
  assert.equal(record.request?.adapter_id, 'custom-dsh');
});

test('GOAL-017A U1: upsertAdapter rejects template-external fields fail-closed', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root, { adaptersPath: path.join(root, 'adapters.json') });
  assert.throws(
    () => pipeline.upsertAdapter({ template: 'dsh', adapter_id: 'evil', params: { executable: 'rm' } }),
    /not allowed/,
  );
});

test('GOAL-017A U1: removeAdapter soft-deletes and hides from roster', () => {
  const root = fixtureRoot();
  const adaptersPath = path.join(root, 'adapters.json');
  const pipeline = makePipeline(root, { adaptersPath });
  assert.ok(pipeline.roster().some((entry) => entry.adapter_id === 'claude-code'));
  pipeline.removeAdapter('claude-code');
  assert.equal(pipeline.roster().some((entry) => entry.adapter_id === 'claude-code'), false);
  assert.equal(pipeline.listAdapters().some((entry) => entry.adapter_id === 'claude-code'), false);
  const saved = JSON.parse(readFileSync(adaptersPath, 'utf8')) as { adapters: Array<{ adapter_id: string; removed?: boolean }> };
  assert.equal(saved.adapters.find((entry) => entry.adapter_id === 'claude-code')?.removed, true);
});

test('GOAL-017A U1: HTTP adapters CRUD endpoints work', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root, { adaptersPath: path.join(root, 'adapters.json') });
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'g017a-adapters',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const listRes = await fetch(base + '/api/adapters');
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { adapters: Array<{ adapter_id: string }> };
  assert.ok(list.adapters.length > 0);

  const postRes = await fetch(base + '/api/adapters', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'kimi', adapter_id: 'kimi-2', params: { model_id: 'kimi-k3' } }),
  });
  assert.equal(postRes.status, 201);
  const post = (await postRes.json()) as { adapter: { adapter_id: string; verified: boolean } };
  assert.equal(post.adapter.adapter_id, 'kimi-2');
  assert.equal(post.adapter.verified, true);

  const delRes = await fetch(base + '/api/adapters/kimi-2', { method: 'DELETE' });
  assert.equal(delRes.status, 200);
  const afterList = (await (await fetch(base + '/api/adapters')).json()) as { adapters: Array<{ adapter_id: string }> };
  assert.equal(afterList.adapters.some((entry) => entry.adapter_id === 'kimi-2'), false);
});

test('GOAL-017A U2: verifiedAdapters exposes whitelist and hides codex/opencode', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const verified = pipeline.verifiedAdapters();
  for (const id of ['deepseek-dsh', 'claude-code', 'kimi-code', 'zcode', 'head-dog']) {
    assert.ok(verified.includes(id), `${id} must be verified`);
  }
  assert.equal(verified.includes('codex'), false);
  assert.equal(verified.includes('opencode'), false);
});

test('GOAL-017A U2: chat accepts verified executor harness and rejects codex', async () => {
  const root = fixtureRoot();
  const approvalDir = path.join(root, 'goals', 'receipts', 'dispatch-approvals');
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(path.join(approvalDir, 'deepseek-dsh.approved.json'), JSON.stringify({ approved: true }) + '\n', 'utf8');
  const pipeline = makePipeline(root);
  const chat = new ChatService({ pipeline, runtimeRoot: path.join(root, 'runtime') });
  const result = await chat.post({ message: '用 deepseek 当头犬', adapter_id: 'deepseek-dsh' });
  assert.equal(result.role, 'head');
  await assert.rejects(() => chat.post({ message: 'x', adapter_id: 'codex' }), /UNVERIFIED/);
});

test('GOAL-017A U3: setBudgetCap persists and appends CAP_CHANGE ledger row', () => {
  const root = fixtureRoot();
  const runtimeRoot = path.join(root, 'runtime');
  const persistence = new BoardPersistence(runtimeRoot);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(runtimeRoot, 'budget-ledger.jsonl'),
    budgetCapsPath: path.join(runtimeRoot, 'budget-caps.json'),
    runAdapter: fakeOk,
    persistence,
  });
  pipeline.setBudgetCap('codex', 10);
  assert.equal(pipeline.getBudgetCaps()['codex'], 10);
  const lines = persistence.loadLedgerLines();
  assert.ok(lines.some((line) => line.meta?.kind === 'CAP_CHANGE'));
  assert.doesNotThrow(() => persistence.verifyLedgerChain());
});

test('GOAL-017A U3: HTTP GET/PUT budget caps endpoints work', async () => {
  const root = fixtureRoot();
  const capsPath = path.join(root, 'budget-caps.json');
  const pipeline = makePipeline(root, { budgetCapsPath: capsPath });
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'g017a-caps',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  const putRes = await fetch(base + '/api/budget/caps/codex', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cap_usd: 8 }),
  });
  assert.equal(putRes.status, 200);
  const put = (await putRes.json()) as { actor_id: string; cap_usd: number };
  assert.equal(put.actor_id, 'codex');
  assert.equal(put.cap_usd, 8);
  const getRes = await fetch(base + '/api/budget/caps');
  assert.equal(getRes.status, 200);
  const get = (await getRes.json()) as { caps: Record<string, number> };
  assert.equal(get.caps['codex'], 8);
});

test('GOAL-017A U3/U4: budgetProjection reads persisted cap and counts admission only', async () => {
  const root = fixtureRoot();
  const capsPath = path.join(root, 'budget-caps.json');
  writeFileSync(capsPath, JSON.stringify({ schema_version: 1, caps: { codex: 12 } }) + '\n', 'utf8');
  const pipeline = makePipeline(root, { budgetCapsPath: capsPath });
  await pipeline.dispatch({ adapter_id: 'codex', prompt: 'dry' });
  const projection = pipeline.budgetProjection();
  const codex = projection.actors.find((actor) => actor.actor_id === 'codex');
  assert.equal(codex?.cap_usd, 12);
  assert.equal(codex?.admission_count, 1);
  assert.equal(codex?.spent_usd, 0);
});
