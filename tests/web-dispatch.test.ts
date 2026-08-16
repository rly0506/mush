import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, InputError, type DispatchLifecycleEvent, type RunAdapterFn } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { LoopStateMachine } from '../src/loop/loop.ts';
import { createLoopBridge } from '../src/web/loop-stream.ts';

// GOAL-006 U2：派发管线（fake runner 路径全覆盖）+ USD 台账 + 生命周期事件。
// 契约：src/web/api-contract.md。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'web-dispatch', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk: RunAdapterFn = async () => ({ exitCode: 0, stdout: 'MUSH-DISPATCH-OK', stderr: '', timedOut: false, childKilled: false });

function makePipeline(root: string, overrides: Partial<ConstructorParameters<typeof DispatchPipeline>[0]> = {}) {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    runAdapter: fakeOk,
    ...overrides,
  });
}

test('dispatch input is fail-closed on schema violations (400 surface)', async () => {
  const pipeline = makePipeline(fixtureRoot());
  await assert.rejects(() => pipeline.dispatch({}), InputError);
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'made-up', prompt: 'x' }), /unknown adapter/i);
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: '   ' }), /prompt/i);
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', effort: 'MEDIUM' }), /effort/i);
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', cap_usd: -1 }), /cap_usd/i);
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', workspace: 'Z:\\no-such-dir' }), /workspace/i);
});

test('dry-run executes the fake adapter and records admission + full lifecycle in append-only ledger', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'fixture task', effort: 'HIGH' });
  assert.equal(record.status, 'DRY_RUN');
  assert.equal(record.admission?.decision, 'ADMITTED');
  assert.ok(existsSync(record.receipt_path as string));
  assert.deepEqual(record.events.map((event) => event.phase), ['ADMISSION', 'EXECUTE', 'REPORT', 'REVIEW']);
  const ledger = readFileSync(path.join(root, 'budget-ledger.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 1);
  assert.equal(JSON.parse(ledger[0]).decision, 'ADMITTED');
  assert.ok(pipeline.get(record.dispatch_id) !== null);
  assert.equal(pipeline.recent(10).length, 1);
});

test('over-cap admission is DENIED with 402-surface status and still event-ized', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', cap_usd: 5, amount_usd: 6 });
  assert.equal(record.status, 'FAIL');
  assert.equal(record.admission?.decision, 'DENIED');
  assert.equal(record.error, 'budget admission denied');
  assert.equal(record.events[0].phase, 'ADMISSION');
});

test('real dispatch requires owner approval record; with it, PASS is recorded', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', real: true });
  assert.equal(blocked.status, 'BLOCKED_WAITING_OWNER');
  const approvalRoot = path.join(root, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  writeFileSync(path.join(approvalRoot, 'fake-t1.approved.json'), JSON.stringify({ schema_version: 1, adapter_id: 'fake-t1', approved_by: 'owner', scope: 'one bounded dispatch' }) + '\n', 'utf8');
  // G009：犬只批准目录与看板审批目录分离（dispatchApprovalRoot 默认
  // <root>/goals/receipts/dispatch-approvals）——测试显式指向 fixture approvals。
  const passed = await makePipeline(root, { dispatchApprovalRoot: approvalRoot }).dispatch({ adapter_id: 'fake-t1', prompt: 'x', real: true });
  assert.equal(passed.status, 'PASS');
  assert.equal(passed.events.at(-1)?.status, 'PASS');
});

test('workspaces list/select persists selection and is fail-closed on missing paths', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const list = pipeline.listWorkspaces([path.join(root, 'other-ws')]);
  assert.equal(list.some((ws) => ws.path === root), true);
  const selected = path.join(root, 'selected-ws');
  mkdirSync(selected, { recursive: true });
  assert.equal(pipeline.selectWorkspace(selected), selected);
  assert.ok(existsSync(path.join(selected, '.mush', 'workspace.json')));
  const after = pipeline.listWorkspaces();
  assert.equal(after.some((ws) => ws.path === selected && ws.mush_managed === true), true);
  assert.throws(() => pipeline.selectWorkspace(path.join(root, 'no-such')), InputError);
});

test('budget projection reports per-actor spent/cap/entries from the ledger', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', cap_usd: 5, amount_usd: 1.5 });
  await pipeline.dispatch({ adapter_id: 'codex', prompt: 'y', cap_usd: 5, amount_usd: 2 });
  const projection = pipeline.budgetProjection();
  const fake = projection.actors.find((actor) => actor.actor_id === 'fake-t1');
  const codex = projection.actors.find((actor) => actor.actor_id === 'codex');
  assert.equal(fake?.spent_usd, 1.5);
  assert.equal(codex?.spent_usd, 2);
  assert.equal(fake?.entries.length, 1);
  assert.equal(codex?.entries.length, 1);
});

test('fake full-flow smoke: dispatch lifecycle + loop lifecycle both stream, ledger lands on disk', async () => {
  const root = fixtureRoot();
  const streamEvents: Array<{ kind: string }> = [];
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    runAdapter: fakeOk,
  });
  pipeline.setEventListener((event) => streamEvents.push(event));
  await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'full-flow smoke' });
  const loop = new LoopStateMachine('board-loop-run');
  const bridge = createLoopBridge(loop, (event) => streamEvents.push(event));
  bridge.transition('RECOMMEND', { candidate: 'm5-board' });
  bridge.transition('CONFIRM', { owner_evidence: 'fixture' });
  assert.equal(streamEvents.filter((event) => event.kind === 'dispatch').length, 4, 'dispatch lifecycle events streamed');
  assert.equal(streamEvents.filter((event) => event.kind === 'loop').length, 2, 'loop lifecycle events streamed');
  assert.ok(existsSync(path.join(root, 'budget-ledger.jsonl')), 'USD ledger landed on disk');
});

test('board server exposes dispatch/workspaces/budget endpoints per contract v1', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const servers: BoardServer[] = [];
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'board-dispatch-run',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  servers.push(server);
  after(async () => {
    for (const s of servers) await s.close();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const bad = await fetch(base + '/api/dispatch', {
    method: 'POST',
    body: JSON.stringify({ adapter_id: 'nope', prompt: 'x' }),
  });
  assert.equal(bad.status, 400);

  const over = await fetch(base + '/api/dispatch', {
    method: 'POST',
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'x', cap_usd: 5, amount_usd: 6 }),
  });
  assert.equal(over.status, 402);

  const created = await fetch(base + '/api/dispatch', {
    method: 'POST',
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'contract smoke', effort: 'HIGH' }),
  });
  assert.equal(created.status, 202);
  const createdBody = (await created.json()) as { dispatch_id: string; status: string; admission: { decision: string } };
  assert.equal(createdBody.admission.decision, 'ADMITTED');

  const detail = await fetch(base + '/api/dispatch/' + createdBody.dispatch_id);
  assert.equal(detail.status, 200);
  const detailBody = (await detail.json()) as { dispatch: { status: string; events: unknown[] } };
  assert.equal(detailBody.dispatch.events.length, 4);

  const workspaces = await fetch(base + '/api/workspaces');
  assert.equal(workspaces.status, 200);

  const select = await fetch(base + '/api/workspaces/select', {
    method: 'POST',
    body: JSON.stringify({ path: root }),
  });
  assert.equal(select.status, 201);

  const budget = await fetch(base + '/api/budget');
  assert.equal(budget.status, 200);
  const budgetBody = (await budget.json()) as { actors: unknown[] };
  assert.ok((budgetBody.actors as unknown[]).length >= 1);
});

test('SSE receives dispatch lifecycle events during a dry-run dispatch (DoD smoke)', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'board-sse-run',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  const streamResponse = await fetch(base + '/api/stream');
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = streamResponse.body?.getReader();
  assert.ok(reader);

  const dispatchPromise = fetch(base + '/api/dispatch', {
    method: 'POST',
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'sse smoke' }),
  });
  const decoder = new TextDecoder();
  let sawDispatch = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !sawDispatch) {
    const chunk = await Promise.race([
      reader?.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => setTimeout(() => resolve({ done: false, value: undefined }), 250)),
    ]);
    if (chunk === undefined || chunk.done) break;
    const text = decoder.decode(chunk.value, { stream: true });
    if (text.includes('"kind":"dispatch"')) sawDispatch = true;
  }
  await dispatchPromise;
  assert.equal(sawDispatch, true, 'SSE must deliver dispatch lifecycle frames');
});
