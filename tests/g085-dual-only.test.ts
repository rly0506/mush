import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CollaborationBlackboard } from '../src/orchestration/collaboration-blackboard.ts';
import { CollaborationCoordinator } from '../src/orchestration/collaboration-coordinator.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { startBoardServer } from '../src/web/server.ts';
import { renderBoardPage } from '../src/web/page.ts';
import { seedTripleHistory } from './fixtures/collab-history.ts';

test('D97: storage refuses new three-seat sessions without changing existing history', () => {
  const root = mkdtempSync(path.resolve('.test-fixtures/g085-dual-storage-'));
  const bb = CollaborationBlackboard.open(root);
  try {
    const old = seedTripleHistory(bb, root);
    const before = bb.getAuthorizationSnapshot(old);
    assert.throws(() => bb.createSession({ topic: 'new', workspace_root: root, participants: [
      { seat: 'A', adapter_id: 'fixture', is_coordinator: true }, { seat: 'B', adapter_id: 'fixture' }, { seat: 'C', adapter_id: 'fixture' },
    ] }), /仅支持双模型/);
    assert.deepEqual(bb.getAuthorizationSnapshot(old), before);
    assert.equal(bb.getVisibleContext(old, 'C').own[0]?.body, 'C 的历史提案正文');
    assert.equal(bb.listSessions().length, 1);
  } finally { bb.close(); }
});

test('D97: historical three-seat authorization, occupancy and coordinator all refuse before side effects', async () => {
  const root = mkdtempSync(path.resolve('.test-fixtures/g085-dual-run-'));
  const bb = CollaborationBlackboard.open(root);
  try {
    const pending = seedTripleHistory(bb, root, 'pending_approval');
    const authorized = seedTripleHistory(bb, root, 'authorized');
    assert.throws(() => bb.authorizeSession(pending), /历史三席位.*只读/);
    for (const kind of ['normal', 'retry'] as const) assert.throws(() => bb.occupyCall(authorized, kind, 'A'), /历史三席位.*只读/);
    let calls = 0;
    const coordinator = new CollaborationCoordinator(bb, async () => { calls++; return { status: 'PASS' }; });
    await assert.rejects(coordinator.run(authorized), /历史三席位.*只读/);
    assert.equal(calls, 0);
    assert.equal(bb.getSession(pending).status, 'pending_approval');
    assert.equal(bb.getSession(authorized).status, 'authorized');
    assert.equal(bb.getSession(authorized).call_count, 0);
    assert.equal(bb.isRunActive(authorized), false);
    assert.deepEqual(bb.getExecutionLog(authorized), []);
  } finally { bb.close(); }
});

test('D97: both HTTP approval routes and start refuse historical three seats; card and response remain untouched', async () => {
  const root = mkdtempSync(path.resolve('.test-fixtures/g085-dual-http-'));
  const bb = CollaborationBlackboard.open(root);
  const pending = seedTripleHistory(bb, root, 'pending_approval');
  const authorized = seedTripleHistory(bb, root, 'authorized');
  const approvals = path.join(root, 'approvals'); mkdirSync(approvals);
  let calls = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: root, collabBlackboard: bb,
    approvalRoot: approvals, approvalRequestRoot: approvals, ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async () => { calls++; return { exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }; } });
  const card = pipeline.createSessionAuthorizationRequest({ session_id: pending });
  const file = path.join(approvals, card.request_file), before = readFileSync(file);
  const server = await startBoardServer({ workspaceRoot: root, runtimeRoot: path.join(root, 'runtime'), approvalRoot: approvals,
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'dual-only', assignmentEpoch: 1, dispatch: pipeline, port: 0, enforceCallerToken: true });
  const post = async (route: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}` + route, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': server.callerToken }, body: JSON.stringify(body),
  });
  try {
    for (const [route, body] of [
      ['/api/collaboration/sessions/approve', { session_id: pending }],
      ['/api/collaboration/sessions/reject', { session_id: pending }],
      ['/api/collaboration/sessions/cancel', { session_id: pending }],
      ['/api/approvals/respond', { request_file: card.request_file, decision: 'APPROVED' }],
      ['/api/approvals/respond', { request_file: card.request_file, decision: 'REJECTED' }],
      ['/api/collaboration/sessions/start', { session_id: authorized }],
    ] as const) {
      const response = await post(route, body);
      assert.equal(response.status, 409);
      assert.match((await response.json() as { error: string }).error, /历史三席位.*只读/);
    }
    assert.deepEqual(readFileSync(file), before);
    assert.equal(existsSync(file + '.owner-response.json'), false);
    const detail = await post('/api/collaboration/sessions/detail', { session_id: pending });
    const json = await detail.json() as { viewpoints: Record<string, Array<{ body: string }>>; authorization_readiness: { ready: boolean } };
    assert.equal(detail.status, 200);
    assert.equal(json.viewpoints.C[0]?.body, 'C 的历史提案正文');
    assert.equal(json.authorization_readiness.ready, false);
    assert.equal(bb.getSession(pending).status, 'pending_approval');
    assert.equal(bb.getSession(authorized).call_count, 0);
    assert.equal(calls, 0);
    const create = await post('/api/collaboration/sessions', { topic: 'new', participants: [{}, {}, {}] });
    assert.equal(create.status, 400);
  } finally { await server.close(); bb.close(); }
});

test('D97: creation form has only A/B model and effort controls; historical detail still supports C', () => {
  const page = renderBoardPage();
  const form = page.slice(page.indexOf('id="collab-form"'), page.indexOf('function updateCollabModels'));
  assert.doesNotMatch(form, /value="3"|collab-adapter-c|collab-model-c|collab-effort-c|collab-seat-c/);
  assert.match(form, /collab-model-a/); assert.match(form, /collab-effort-b/);
  assert.match(page, /s\.participants/);
});
