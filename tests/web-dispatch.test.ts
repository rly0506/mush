import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, InputError, type DispatchLifecycleEvent, type RunAdapterFn } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { LoopStateMachine } from '../src/loop/loop.ts';
import { createLoopBridge } from '../src/web/loop-stream.ts';
import { BoardPersistence } from '../src/web/persistence.ts';

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

test('budget projection reports per-actor spent/cap/admission_count/entries from the ledger', async () => {
  const root = fixtureRoot();
  const approvalRoot = path.join(root, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  writeFileSync(path.join(approvalRoot, 'fake-t1.approved.json'), JSON.stringify({ schema_version: 1, adapter_id: 'fake-t1', approved_by: 'owner' }) + '\n', 'utf8');
  const pipeline = makePipeline(root, { dispatchApprovalRoot: approvalRoot });
  // real + amount>0 计入 spent；dry-run + amount>0 只进 count 不计 spent。
  await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', cap_usd: 5, amount_usd: 1.5, real: true });
  await pipeline.dispatch({ adapter_id: 'codex', prompt: 'y', cap_usd: 5, amount_usd: 2 });
  const projection = pipeline.budgetProjection();
  const fake = projection.actors.find((actor) => actor.actor_id === 'fake-t1');
  const codex = projection.actors.find((actor) => actor.actor_id === 'codex');
  assert.equal(fake?.spent_usd, 1.5);
  assert.equal(fake?.admission_count, 1);
  assert.equal(codex?.spent_usd, 0);
  assert.equal(codex?.admission_count, 1);
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

test('GP-03 restart replay: new pipeline + new server read back records and chained ledger', async () => {
  const root = fixtureRoot();
  const runtimeRoot = path.join(root, 'runtime');
  const persistence = new BoardPersistence(runtimeRoot);
  const first = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(runtimeRoot, 'budget-ledger.jsonl'),
    runAdapter: fakeOk,
    persistence,
  });
  const record = await first.dispatch({ adapter_id: 'fake-t1', prompt: 'restart replay', amount_usd: 1 });
  persistence.verifyLedgerChain();

  const second = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(runtimeRoot, 'budget-ledger.jsonl'),
    runAdapter: fakeOk,
    persistence,
  });
  assert.ok(second.get(record.dispatch_id) !== null);
  assert.equal(second.recent(10).length, 1);

  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'board-restart-run',
    assignmentEpoch: 1,
    dispatch: second,
    persistence,
  });
  after(async () => {
    await server.close();
  });
  const snapshotResponse = await fetch(`http://127.0.0.1:${server.port}/api/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = (await snapshotResponse.json()) as { dispatches?: unknown[] };
  assert.ok((snapshot.dispatches ?? []).length >= 1, 'dispatches must survive server restart');
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

test('GP-21: profile field is validated against ~/.dsh/profiles and injects --profile', async () => {
  const root = fixtureRoot();
  const profilesRoot = path.join(root, 'profiles');
  mkdirSync(path.join(profilesRoot, 'headless-pro'), { recursive: true });
  let seenArgs: string[] | null = null;
  const runAdapter: RunAdapterFn = async (_contract, _prompt, _opts) => {
    seenArgs = [..._contract.arguments];
    return { exitCode: 0, stdout: 'OK', stderr: '', timedOut: false, childKilled: false };
  };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    runAdapter,
    profilesRoot,
  });
  const record = await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'use preset', profile: 'headless-pro' });
  assert.equal(record.status, 'DRY_RUN');
  assert.ok(seenArgs !== null && seenArgs.includes('--profile') && seenArgs[seenArgs.indexOf('--profile') + 1] === 'headless-pro');
  assert.equal(record.request?.profile, 'headless-pro');

  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'x', profile: 'missing-profile' }), /profile/i);
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', profile: 'headless-pro' }), /does not support profile/i);
});

test('GP-22: effort is validated against the selected contract effort_levels', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  // claude-code declares LOW..MAX; MAX is accepted, ULTRA is rejected.
  const claude = await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'effort max', effort: 'MAX' });
  assert.equal(claude.status, 'DRY_RUN');
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'x', effort: 'ULTRA' }), /effort/i);
  // deepseek-dsh declares single placeholder DEFAULT; no effort uses DEFAULT, HIGH is rejected.
  const dsh = await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'default effort' });
  assert.equal(dsh.request?.effort, 'DEFAULT');
  await assert.rejects(() => pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'x', effort: 'HIGH' }), /effort/i);
});

test('GP-10: rerun clones request snapshot without amount_usd risk field', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const original = await pipeline.dispatch({
    adapter_id: 'fake-t1',
    prompt: 'rerun me',
    effort: 'HIGH',
    timeout_s: 30,
    cap_usd: 3,
  });
  assert.equal(original.request?.prompt, 'rerun me');
  assert.equal('amount_usd' in (original.request ?? {}), false);
  const rerun = await pipeline.rerun(original.dispatch_id);
  assert.notEqual(rerun.dispatch_id, original.dispatch_id);
  assert.equal(rerun.request?.prompt, 'rerun me');
  assert.equal(rerun.request?.effort, 'HIGH');
  assert.equal(rerun.request?.timeout_s, 30);
  assert.equal(rerun.request?.cap_usd, 3);
  assert.equal('amount_usd' in (rerun.request ?? {}), false);
  assert.equal(rerun.status, 'DRY_RUN');
});

test('GP-10: POST /api/dispatch/:id/rerun endpoint creates a new dispatch', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'board-rerun-run',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  const createdResponse = await fetch(base + '/api/dispatch', {
    method: 'POST',
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'rerun endpoint', effort: 'HIGH' }),
  });
  assert.equal(createdResponse.status, 202);
  const created = (await createdResponse.json()) as { dispatch_id: string };
  const rerunResponse = await fetch(base + '/api/dispatch/' + created.dispatch_id + '/rerun', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(rerunResponse.status, 202);
  const rerun = (await rerunResponse.json()) as { dispatch_id: string; status: string };
  assert.notEqual(rerun.dispatch_id, created.dispatch_id);
  assert.equal(rerun.status, 'DRY_RUN');
  const missingResponse = await fetch(base + '/api/dispatch/' + '0'.repeat(32) + '/rerun', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(missingResponse.status, 404);
});

test('roster includes kimi-code and exposes effort metadata', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const kimi = pipeline.roster().find((entry) => entry.adapter_id === 'kimi-code');
  assert.ok(kimi, 'kimi-code must appear in roster');
  assert.equal(kimi?.role, 'executor');
  assert.equal(kimi?.verified, true);
  assert.deepEqual(kimi?.effort_levels, ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(kimi?.effort_injection, { kind: 'none' });
  const claude = pipeline.roster().find((entry) => entry.adapter_id === 'claude-code');
  assert.deepEqual(claude?.effort_injection, { kind: 'flag', name: '--effort' });
});

// owner 2026-08-17：生产名册不得出现测试假犬（fake-t1 属测试夹具）。
test('roster excludes the fake test dog (production-facing projection)', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const ids = pipeline.roster().map((entry) => entry.adapter_id);
  assert.equal(ids.includes('fake-t1'), false, 'fake-t1 must not appear in roster');
  assert.ok(ids.length > 0, 'real dogs must still be listed');
  assert.equal(ids.includes('deepseek-dsh'), true);
});
