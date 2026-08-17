import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, InputError, type RunAdapterFn } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { collectBoardSnapshot } from '../src/web/sources.ts';
import { BoardPersistence } from '../src/web/persistence.ts';

// GP-32（D30 逐单审批）：无令牌自动停卡生成审批请求；批准=单次令牌+approved_via
// 重跑消费（原单折 SUPERSEDED）；否决=REJECTED；常设 .approved.json 不再放行。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'gp32-approvals', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
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

test('GP-32: real dispatch without token blocks and auto-creates an approval request with full briefing', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'gp32 brief', effort: 'HIGH', real: true });
  assert.equal(record.status, 'BLOCKED_WAITING_OWNER');
  const requestPath = path.join(root, 'goals', 'receipts', 'approval-requests', `dispatch-${record.dispatch_id}.json`);
  assert.ok(existsSync(requestPath), 'approval request file must be created');
  const file = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
  assert.equal(file.kind, 'dispatch');
  assert.equal(file.dispatch_id, record.dispatch_id);
  assert.equal(file.prompt, 'gp32 brief');
  assert.equal(file.effort, 'HIGH');
  assert.equal(file.actor_id, 'fake-t1');
  assert.equal(typeof file.cap_usd, 'number');
  assert.equal(typeof file.actor_spent_usd, 'number');
});

test('GP-32: standing <adapter>.approved.json no longer grants real dispatch (D30 abolition)', async () => {
  const root = fixtureRoot();
  const standingDir = path.join(root, 'goals', 'receipts', 'dispatch-approvals');
  mkdirSync(standingDir, { recursive: true });
  writeFileSync(path.join(standingDir, 'fake-t1.approved.json'), '{"standing":true}', 'utf8');
  const pipeline = makePipeline(root);
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', effort: 'HIGH', real: true });
  assert.equal(record.status, 'BLOCKED_WAITING_OWNER');
});

test('GP-32: grant token + approved_via rerun executes once, consumes token, folds original SUPERSEDED', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'gp32 rerun', effort: 'HIGH', real: true });
  assert.equal(blocked.status, 'BLOCKED_WAITING_OWNER');

  // 无令牌的 approved_via 重跑 fail-closed
  await assert.rejects(() => pipeline.rerun(blocked.dispatch_id, { real: true, approved_via: blocked.dispatch_id }), InputError);

  pipeline.grantApprovalToken(blocked.dispatch_id);
  const tokenPath = path.join(root, 'runtime', 'approval-tokens', `dispatch-${blocked.dispatch_id}.token.json`);
  assert.ok(existsSync(tokenPath));
  const rerunRecord = await pipeline.rerun(blocked.dispatch_id, { real: true, approved_via: blocked.dispatch_id });
  assert.equal(rerunRecord.status, 'PASS');
  assert.notEqual(rerunRecord.dispatch_id, blocked.dispatch_id);
  assert.equal(pipeline.get(blocked.dispatch_id)?.status, 'SUPERSEDED');
  assert.ok(!existsSync(tokenPath), 'token must be consumed (single-use)');
});

test('GP-32: rejectDispatch folds the blocked record to terminal REJECTED', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'gp32 reject', effort: 'HIGH', real: true });
  const rejected = pipeline.rejectDispatch(blocked.dispatch_id);
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(pipeline.get(blocked.dispatch_id)?.status, 'REJECTED');
});

test('GP-32: approvals snapshot carries dispatch briefing fields for the dialog', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root, { approvalRoot: path.join(root, 'approvals') });
  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'snapshot briefing', effort: 'HIGH', real: true });
  assert.equal(blocked.status, 'BLOCKED_WAITING_OWNER');
  const snapshot = collectBoardSnapshot({ approvalRoot: path.join(root, 'goals', 'receipts', 'approval-requests') });
  const entry = snapshot.approvals.find((a) => a.request_file === `dispatch-${blocked.dispatch_id}.json`);
  assert.ok(entry !== undefined, 'blocked dispatch appears in approvals list');
  assert.equal(entry.status, 'WAITING');
  assert.ok(entry.dispatch !== undefined, 'dispatch briefing projected');
  assert.equal(entry.dispatch?.adapter_id, 'fake-t1');
  assert.equal(entry.dispatch?.prompt_preview, 'snapshot briefing');
});

test('GP-32: HTTP respond APPROVED drives token + auto rerun; REJECTED folds record', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const servers: BoardServer[] = [];
  const server = await startBoardServer({
    // 与管线默认 approvalRequestRoot 同路径（生产形态一致），respond 才能看到自动生成的请求。
    approvalRoot: path.join(root, 'goals', 'receipts', 'approval-requests'),
    runId: 'gp32-respond-run',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  servers.push(server);
  after(async () => {
    for (const s of servers) await s.close();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'http approve', effort: 'HIGH', real: true });
  const requestFile = `dispatch-${blocked.dispatch_id}.json`;

  const approved = await fetch(base + '/api/approvals/respond', {
    method: 'POST',
    body: JSON.stringify({ request_file: requestFile, decision: 'APPROVED' }),
  });
  assert.equal(approved.status, 201);
  const approvedBody = (await approved.json()) as { ok: boolean; dispatch?: { rerun?: string } };
  assert.equal(approvedBody.dispatch?.rerun, 'STARTED', 'respond returns fast; rerun is async (AD-39)');
  // 异步重跑：轮询等新派发落地（fake 适配器瞬时完成）。
  let rerunId: string | null = null;
  for (let i = 0; i < 40 && rerunId === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const record of pipeline.recent(20)) {
      if (record.dispatch_id !== blocked.dispatch_id && record.adapter_id === 'fake-t1') rerunId = record.dispatch_id;
    }
  }
  assert.ok(rerunId !== null, 'async rerun created a new dispatch');
  assert.equal(pipeline.get(rerunId)?.status, 'PASS');
  assert.equal(pipeline.get(blocked.dispatch_id)?.status, 'SUPERSEDED');
  assert.ok(
    !existsSync(path.join(root, 'runtime', 'approval-tokens', `dispatch-${blocked.dispatch_id}.token.json`)),
    'token consumed after auto rerun',
  );

  // 否决路径（append-only：同文件二次应答 409，用新派发验证 REJECTED）
  const blocked2 = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'http reject', effort: 'HIGH', real: true });
  const rejected = await fetch(base + '/api/approvals/respond', {
    method: 'POST',
    body: JSON.stringify({ request_file: `dispatch-${blocked2.dispatch_id}.json`, decision: 'REJECTED' }),
  });
  assert.equal(rejected.status, 201);
  assert.equal(pipeline.get(blocked2.dispatch_id)?.status, 'REJECTED');
});

test('GP-32: replay backfills approval request files for legacy blocked records', async () => {
  const root = fixtureRoot();
  const runtimeRoot = path.join(root, 'runtime');
  const persistence = new BoardPersistence(runtimeRoot);
  const pipeline = makePipeline(root, { persistence });
  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'legacy card', effort: 'HIGH', real: true });
  const requestPath = path.join(root, 'goals', 'receipts', 'approval-requests', `dispatch-${blocked.dispatch_id}.json`);
  assert.ok(existsSync(requestPath));
  // 模拟 GP-32 之前的旧卡：请求文件缺失（如手工删除/旧版本拦截）。
  const { rmSync } = await import('node:fs');
  rmSync(requestPath);
  // 重启（同根新管线回放）→ 请求文件补建，owner 有卡可批。
  const revived = makePipeline(root, { persistence: new BoardPersistence(runtimeRoot) });
  assert.equal(revived.get(blocked.dispatch_id)?.status, 'BLOCKED_WAITING_OWNER');
  assert.ok(existsSync(requestPath), 'backfilled on replay');
});

test('GP-32: approval request carries goal_id for human recognition (owner 2026-08-17 feedback)', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const blocked = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'goal labeled', effort: 'HIGH', real: true, goal_id: 'MUSH-GOAL-019' });
  assert.equal(blocked.status, 'BLOCKED_WAITING_OWNER');
  const file = JSON.parse(readFileSync(
    path.join(root, 'goals', 'receipts', 'approval-requests', `dispatch-${blocked.dispatch_id}.json`),
    'utf8',
  )) as Record<string, unknown>;
  assert.equal(file.goal_id, 'MUSH-GOAL-019');
  assert.ok(String(file.title).includes('MUSH-GOAL-019'));
  assert.ok(String(file.reason).startsWith('MUSH-GOAL-019'));
  const snapshot = collectBoardSnapshot({ approvalRoot: path.join(root, 'goals', 'receipts', 'approval-requests') });
  const entry = snapshot.approvals.find((a) => a.request_file === `dispatch-${blocked.dispatch_id}.json`);
  assert.equal(entry?.dispatch?.goal_id, 'MUSH-GOAL-019');
});
