import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import type { RunAdapterResult } from '../src/web/dispatch.ts';

// GOAL-005 U2：零依赖 node:http 服务 + SSE 推送 + 审批动作闭环。
// 审批 = 写 append-only owner-response 文件（与 approval-requests 现有流程同构）；
// 事件经 POST /api/events 追加进内存 EventLog（哈希链/sequence 由核心层 fail-closed）。

const servers: BoardServer[] = [];

after(async () => {
  for (const server of servers) await server.close();
});

function makeEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 2,
    event_id: 'a'.repeat(32),
    goal_id: 'MUSH-GOAL-005',
    run_id: 'board-server-run',
    assignment_epoch: 1,
    sequence: 1,
    parent_instance_id: 'head-dog',
    actor_role: 'executor',
    actor_instance_id: 'deepseek-dsh-001',
    dispatch_id: 'b'.repeat(32),
    event_type: 'DISPATCHED',
    phase: 1,
    finding_ids: [],
    packet_path: 'goals/receipts/x.json',
    packet_sha256: 'c'.repeat(64),
    config_digest: 'd'.repeat(64),
    capability_id: 'e'.repeat(32),
    signature: 'f'.repeat(64),
    provider: 'deepseek',
    model_id: 'deepseek-chat',
    created_at_utc: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeApprovalRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-board-server-'));
  writeFileSync(
    path.join(root, 'req-waiting.json'),
    JSON.stringify({
      schema_version: 1,
      gate: 'BUDGET_GATE',
      actor_id: 'some-dog',
      cap_usd: 0.01,
      amount_usd: 0.02,
      reason: 'test waiting request',
      requested_at_utc: '2026-08-17T01:00:00.000Z',
      status: 'WAITING_OWNER_APPROVAL',
    }),
    'utf8',
  );
  return root;
}

async function boot(approvalRoot: string): Promise<{ server: BoardServer; base: string }> {
  const server = await startBoardServer({
    approvalRoot,
    runId: 'board-server-run',
    assignmentEpoch: 1,
  });
  servers.push(server);
  return { server, base: `http://127.0.0.1:${server.port}` };
}

test('server binds 127.0.0.1 by default and serves the board page at GET /', async () => {
  const { server, base } = await boot(makeApprovalRoot());
  assert.equal(server.host, '127.0.0.1');
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  const html = await response.text();
  assert.match(html, /mush/i);
  // 零外链红线：不得引用任何 http(s) 外部资源。
  assert.ok(!/src=["']https?:/i.test(html), 'no external script sources');
  assert.ok(!/href=["']https?:/i.test(html), 'no external stylesheet/font links');
});

test('GET /api/snapshot returns actors/epochs/approvals projection', async () => {
  const { base } = await boot(makeApprovalRoot());
  const response = await fetch(base + '/api/snapshot');
  assert.equal(response.status, 200);
  const snapshot = (await response.json()) as {
    actors: unknown[];
    epochs: unknown[];
    approvals: { request_file: string; status: string }[];
  };
  assert.deepEqual(snapshot.actors, []);
  assert.deepEqual(snapshot.epochs, []);
  assert.equal(snapshot.approvals.length, 1);
  assert.equal(snapshot.approvals[0].request_file, 'req-waiting.json');
  assert.equal(snapshot.approvals[0].status, 'WAITING');
});

test('POST /api/events appends to the hash chain; snapshot reflects it; bad sequence is 409', async () => {
  const { base } = await boot(makeApprovalRoot());
  const first = await fetch(base + '/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(makeEvent({ event_id: '1'.repeat(32), event_type: 'EPOCH_STARTED' })),
  });
  assert.equal(first.status, 201);

  const snapshot = (await (await fetch(base + '/api/snapshot')).json()) as {
    epochs: { event_count: number; chain_verified: boolean; events: { event_type: string }[] }[];
    actors: { actor_instance_id: string }[];
  };
  assert.equal(snapshot.epochs.length, 1);
  assert.equal(snapshot.epochs[0].event_count, 1);
  assert.equal(snapshot.epochs[0].chain_verified, true);
  assert.equal(snapshot.actors.length, 1);
  assert.equal(snapshot.actors[0].actor_instance_id, 'deepseek-dsh-001');

  // sequence 不连续 → 核心层 fail-closed → 409
  const bad = await fetch(base + '/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(makeEvent({ event_id: '9'.repeat(32), sequence: 5 })),
  });
  assert.equal(bad.status, 409);

  // schema 违规 → 400
  const malformed = await fetch(base + '/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema_version: 2, event_id: 'nope' }),
  });
  assert.equal(malformed.status, 400);
});

test('POST /api/approvals/respond writes an append-only owner-response file', async () => {
  const approvalRoot = makeApprovalRoot();
  const { base } = await boot(approvalRoot);
  const response = await fetch(base + '/api/approvals/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request_file: 'req-waiting.json', decision: 'APPROVED', evidence: 'owner ok via board' }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { ok: boolean; response_path: string };
  assert.equal(body.ok, true);

  const expectedPath = path.join(approvalRoot, 'req-waiting.json.owner-response.json');
  assert.equal(path.resolve(body.response_path), path.resolve(expectedPath));
  assert.ok(existsSync(expectedPath), 'owner-response file must land on disk');
  const written = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, unknown>;
  assert.equal(written.schema_version, 1);
  assert.equal(written.request_file, 'req-waiting.json');
  assert.equal(written.owner_decision, 'APPROVED');
  assert.equal(written.owner_evidence, 'owner ok via board');
  assert.ok(typeof written.responded_at_utc === 'string');

  // 快照立即反映 APPROVED
  const snapshot = (await (await fetch(base + '/api/snapshot')).json()) as {
    approvals: { request_file: string; status: string }[];
  };
  assert.equal(snapshot.approvals[0].status, 'APPROVED');
});

test('approval response returns before an approved rerun finishes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-board-approval-rerun-'));
  const approvalRoot = path.join(root, 'approval-requests');
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  let releaseExecution = (): void => {};
  let markExecutionStarted = (): void => {};
  const executionStarted = new Promise<void>((resolve) => { markExecutionStarted = resolve; });
  const executionReleased = new Promise<void>((resolve) => { releaseExecution = resolve; });
  const runAdapter = async (): Promise<RunAdapterResult> => {
    markExecutionStarted();
    await executionReleased;
    return { exitCode: 0, stdout: 'approved rerun output', stderr: '', timedOut: false, childKilled: false };
  };
  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    approvalRequestRoot: approvalRoot,
    ledgerPath: path.join(root, 'runtime', 'budget-ledger.jsonl'),
    runAdapter,
  });
  const server = await startBoardServer({
    approvalRoot,
    workspaceRoot,
    ledgerPath: path.join(root, 'runtime', 'budget-ledger.jsonl'),
    dispatch: pipeline,
    runAdapter,
    runId: 'approval-rerun-run',
    assignmentEpoch: 1,
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;

  const created = await fetch(base + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'approval rerun latency', real: true }),
  });
  assert.equal(created.status, 202);
  const createdBody = (await created.json()) as { dispatch_id: string; status: string };
  assert.equal(createdBody.status, 'BLOCKED_WAITING_OWNER');
  const requestFile = `dispatch-${createdBody.dispatch_id}.json`;

  const responsePromise = fetch(base + '/api/approvals/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request_file: requestFile, decision: 'APPROVED' }),
  });
  const responseOrTimeout = await Promise.race([
    responsePromise.then((response) => ({ response })),
    new Promise<{ timeout: true }>((resolve) => setTimeout(() => resolve({ timeout: true }), 500)),
  ]);
  assert.ok(!('timeout' in responseOrTimeout), 'approval endpoint must not wait for the executor');
  assert.equal(responseOrTimeout.response.status, 201);
  const body = (await responseOrTimeout.response.json()) as { ok: boolean; dispatch?: { rerun?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.dispatch?.rerun, 'STARTED');
  await executionStarted;

  releaseExecution();
  await responsePromise;
});

test('approval respond is fail-closed: unknown request 404, double respond 409, bad decision 400, traversal 400', async () => {
  const approvalRoot = makeApprovalRoot();
  const { base } = await boot(approvalRoot);
  const respond = (payload: Record<string, unknown>) =>
    fetch(base + '/api/approvals/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  assert.equal((await respond({ request_file: 'missing.json', decision: 'APPROVED' })).status, 404);
  assert.equal((await respond({ request_file: 'req-waiting.json', decision: 'MAYBE' })).status, 400);
  assert.equal((await respond({ request_file: '../escape.json', decision: 'APPROVED' })).status, 400);
  assert.equal((await respond({ request_file: 'req-waiting.json.owner-response.json', decision: 'APPROVED' })).status, 400);

  assert.equal((await respond({ request_file: 'req-waiting.json', decision: 'REJECTED', note: 'too expensive' })).status, 201);
  // append-only：已应答的请求不可二次应答
  assert.equal((await respond({ request_file: 'req-waiting.json', decision: 'APPROVED' })).status, 409);
});

test('SSE stream pushes new events posted to /api/events', async () => {
  const { base } = await boot(makeApprovalRoot());
  const controller = new AbortController();
  const response = await fetch(base + '/api/stream', { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  const readLoop = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
      if (received.includes('DISPATCHED')) break;
    }
  })();

  // 等 SSE 连接注册后再推事件
  await new Promise((resolve) => setTimeout(resolve, 100));
  const posted = await fetch(base + '/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(makeEvent({ event_id: '1'.repeat(32) })),
  });
  assert.equal(posted.status, 201);

  await readLoop;
  assert.match(received, /^data: /m);
  assert.match(received, /DISPATCHED/);
  controller.abort();
});

test('unknown routes return 404 JSON', async () => {
  const { base } = await boot(makeApprovalRoot());
  const response = await fetch(base + '/api/nope');
  assert.equal(response.status, 404);
});
