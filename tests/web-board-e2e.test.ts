import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import type { RunAdapterResult } from '../src/web/dispatch.ts';

// GOAL-007 联调冒烟：页面四件套消费的契约端点与真实 G006 管线（fake runAdapter，dry-run）
// 端到端走一遍：workspaces → select → dispatch dry-run → dispatch/:id → budget → SSE dispatch。

const servers: BoardServer[] = [];
after(async () => {
  for (const server of servers) await server.close();
});

async function bootWithPipeline(): Promise<{ base: string; approvalRoot: string; workspaceRoot: string }> {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g7-e2e-'));
  const approvalRoot = path.join(root, 'approval-requests');
  const workspaceRoot = path.join(root, 'workspace');
  const ledgerPath = path.join(root, 'runtime', 'budget-ledger.jsonl');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const fakeRun = async (): Promise<RunAdapterResult> => ({
    exitCode: 0,
    stdout: 'fake output',
    stderr: '',
    timedOut: false,
    childKilled: false,
  });
  const pipeline = new DispatchPipeline({ workspaceRoot, approvalRoot, ledgerPath, runAdapter: fakeRun });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g7-e2e-run',
    assignmentEpoch: 1,
    workspaceRoot,
    ledgerPath,
    dispatch: pipeline,
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, approvalRoot, workspaceRoot };
}

test('G7 e2e: workspaces list/select → fake dry-run dispatch → tracking → budget → SSE', async () => {
  const { base, workspaceRoot } = await bootWithPipeline();

  // 1. workspace 列表 + 选择持久化
  const ws = (await (await fetch(base + '/api/workspaces')).json()) as {
    ok: boolean;
    workspaces: { path: string; is_git: boolean }[];
  };
  assert.equal(ws.ok, true);
  assert.ok(ws.workspaces.some((w) => path.resolve(w.path) === path.resolve(workspaceRoot)));
  const selected = await fetch(base + '/api/workspaces/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: workspaceRoot }),
  });
  assert.equal(selected.status, 201);

  // 2. SSE 监听 dispatch 生命周期
  const controller = new AbortController();
  const sseResponse = await fetch(base + '/api/stream', { signal: controller.signal });
  assert.equal(sseResponse.status, 200);
  const reader = sseResponse.body!.getReader();
  const decoder = new TextDecoder();
  let sseText = '';
  const readLoop = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseText += decoder.decode(value, { stream: true });
      if (sseText.includes('dispatch')) break;
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 3. 页面提交 → POST /api/dispatch（dry-run，fake-t1）
  const dispatched = await fetch(base + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'G7 e2e fixture task', effort: 'LOW', cap_usd: 5 }),
  });
  assert.equal(dispatched.status, 202);
  const dispatchBody = (await dispatched.json()) as {
    ok: boolean;
    dispatch_id: string;
    status: string;
    admission: { decision: string };
  };
  assert.equal(dispatchBody.ok, true);
  assert.match(dispatchBody.dispatch_id, /^[0-9a-f]{32}$/);
  assert.ok(['ADMITTED', 'DRY_RUN'].includes(dispatchBody.status));
  assert.equal(dispatchBody.admission.decision, 'ADMITTED');

  // 4. 跟踪卡片：GET /api/dispatch/:id 含状态与回执锚点
  const detail = (await (await fetch(base + '/api/dispatch/' + dispatchBody.dispatch_id)).json()) as {
    ok: boolean;
    dispatch: { dispatch_id: string; status: string; receipt_path: string | null; events: unknown[] };
  };
  assert.equal(detail.ok, true);
  assert.equal(detail.dispatch.status, 'DRY_RUN');
  assert.ok(typeof detail.dispatch.receipt_path === 'string' && detail.dispatch.receipt_path.length > 0, '回执锚点');
  assert.ok(detail.dispatch.events.length >= 1, '生命周期事件');

  // 5. 预算真实视图：GET /api/budget 反映本次 admission
  const budget = (await (await fetch(base + '/api/budget')).json()) as {
    ok: boolean;
    actors: { actor_id: string; spent_usd: number; cap_usd: number; entries: unknown[] }[];
  };
  assert.equal(budget.ok, true);
  const fakeActor = budget.actors.find((actor) => actor.actor_id === 'fake-t1');
  assert.ok(fakeActor, 'fake-t1 入账');
  assert.ok(fakeActor.entries.length >= 1);

  // 6. 快照扩展：dispatches 最近 N 条
  const snapshot = (await (await fetch(base + '/api/snapshot')).json()) as {
    dispatches?: { dispatch_id: string; status: string }[];
  };
  assert.ok(
    (snapshot.dispatches ?? []).some((d) => d.dispatch_id === dispatchBody.dispatch_id),
    'snapshot dispatches 含本次派发',
  );

  // 7. SSE 收到 dispatch 生命周期推送
  await readLoop;
  assert.match(sseText, /"kind":"dispatch"|"kind": "dispatch"/);
  controller.abort();
});

test('G7 e2e: real dispatch without approval is BLOCKED_WAITING_OWNER (gate intact)', async () => {
  const { base } = await bootWithPipeline();
  const response = await fetch(base + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'real without approval', real: true }),
  });
  assert.equal(response.status, 202);
  const body = (await response.json()) as { status: string };
  assert.equal(body.status, 'BLOCKED_WAITING_OWNER');
});
