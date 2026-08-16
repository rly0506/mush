import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

// GP-02（packet 008）：workspace 自主登记 + 路径归一。
// 后端：POST /api/workspaces/create（mkdir recursive + 记入 known + 返回 WorkspaceInfo；
// 路径穿越校验；意向项目子树纵深防御提示层在前端）。F-39：listWorkspaces 归一去重。

function makeRoot(): { approvalRoot: string; workspaceRoot: string; ledgerPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-gp02-'));
  const approvalRoot = path.join(root, 'approval-requests');
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  return { approvalRoot, workspaceRoot, ledgerPath: path.join(root, 'runtime', 'ledger.jsonl') };
}

async function boot(): Promise<{ server: BoardServer; base: string; workspaceRoot: string }> {
  const { approvalRoot, workspaceRoot, ledgerPath } = makeRoot();
  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'gp02-run',
    assignmentEpoch: 1,
    workspaceRoot,
    ledgerPath,
    dispatch: pipeline,
  });
  return { server, base: `http://127.0.0.1:${server.port}`, workspaceRoot };
}

test('POST /api/workspaces/create makes the directory, registers it, returns WorkspaceInfo', async () => {
  const { server, base } = await boot();
  try {
    const target = path.join(tmpdir(), 'mush-gp02-created-' + Date.now());
    const response = await fetch(base + '/api/workspaces/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { ok: boolean; workspace: { path: string; is_git: boolean; mush_managed: boolean; selected: boolean } };
    assert.equal(body.ok, true);
    assert.ok(existsSync(target), '目录必须真实创建');
    assert.equal(path.resolve(body.workspace.path), path.resolve(target));
    assert.equal(typeof body.workspace.is_git, 'boolean');
    assert.equal(typeof body.workspace.mush_managed, 'boolean');
    assert.equal(typeof body.workspace.selected, 'boolean');
    // 已登记：select 必须能直接选中（白名单语义）
    const select = await fetch(base + '/api/workspaces/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    assert.equal(select.status, 201);
  } finally {
    await server.close();
  }
});

test('POST /api/workspaces/create is fail-closed: existing dir 409, bad input 400', async () => {
  const { server, base, workspaceRoot } = await boot();
  try {
    const existing = await fetch(base + '/api/workspaces/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: workspaceRoot }),
    });
    assert.equal(existing.status, 409, '已存在目录不得重复 create');
    const noPath = await fetch(base + '/api/workspaces/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noPath.status, 400);
    const relative = await fetch(base + '/api/workspaces/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'relative/escape' }),
    });
    assert.equal(relative.status, 400, '相对路径拒绝（须绝对路径）');
  } finally {
    await server.close();
  }
});

test('F-39: listWorkspaces normalizes and dedupes (forward/backward slash, mixed case)', async () => {
  const { approvalRoot, workspaceRoot, ledgerPath } = makeRoot();
  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  const forward = workspaceRoot.replace(/\\/g, '/');
  const list = pipeline.listWorkspaces([forward, workspaceRoot]);
  const matches = list.filter((w) => path.resolve(w.path) === path.resolve(workspaceRoot));
  assert.equal(matches.length, 1, '同一路径不同形态必须去重为单条目');
  // 归一：返回路径与 path.resolve 形态一致（Windows 反斜杠）
  assert.equal(matches[0].path, path.resolve(workspaceRoot));
});

test('F-39: selectWorkspace stores the normalized form (known list has no slash-form duplicates)', async () => {
  const { approvalRoot, workspaceRoot, ledgerPath } = makeRoot();
  const other = mkdtempSync(path.join(tmpdir(), 'mush-gp02-norm-'));
  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  pipeline.selectWorkspace(other.replace(/\\/g, '/')); // 正斜杠形态提交
  const list = pipeline.listWorkspaces();
  const matches = list.filter((w) => path.resolve(w.path) === path.resolve(other));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].selected, true);
  assert.equal(matches[0].path, path.resolve(other));
});
