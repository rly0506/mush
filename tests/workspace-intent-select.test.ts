import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline, centralWorkspaceDataDir, type RunAdapterFn } from '../src/web/dispatch.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

// D85（2026-09-06，owner 裁定）：意向项目可选为工作区处理业务——selectWorkspace
// 不再因路径含"意向项目"拒绝；.agent-bridge 仍为冻结区；createWorkspace 防误建不变。

function pipelineAt(root: string): DispatchPipeline {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
  });
}

test('D85: selecting a workspace under 意向项目 succeeds (business switch is legitimate)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'd85-'));
  try {
    const intent = path.join(root, '意向项目');
    mkdirSync(intent, { recursive: true });
    const pipeline = pipelineAt(root);
    const selected = pipeline.selectWorkspace(intent);
    assert.equal(selected, intent);
    const info = pipeline.listWorkspaces().find((w) => w.path === intent);
    assert.ok(info, '意向项目 workspace listed after select');
    assert.equal(info?.selected, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D85: .agent-bridge remains a frozen zone for select and create', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'd85-bridge-'));
  try {
    const bridge = path.join(root, 'legacy.agent-bridge');
    mkdirSync(bridge, { recursive: true });
    const pipeline = pipelineAt(root);
    assert.throws(() => pipeline.selectWorkspace(bridge), /Cannot select frozen/);
    assert.throws(() => pipeline.createWorkspace(path.join(root, 'new.agent-bridge')), /Cannot create workspace in frozen/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D85: createWorkspace still refuses creating new dirs inside 意向项目 (typo guard)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'd85-create-'));
  try {
    const pipeline = pipelineAt(root);
    assert.throws(
      () => pipeline.createWorkspace(path.join(root, '意向项目', 'accidental-new')),
      /Cannot create workspace in frozen/,
      'board must not create new directories inside the intent project (create manually then select)',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- D86（2026-09-06）：外部工作区数据面集中托管（宿主 runtime/workspaces/），目标文件夹零足迹。

const fakeOk: RunAdapterFn = async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false });

test('D86: centralWorkspaceDataDir——宿主在库、外部集中、确定性派生', () => {
  const host = path.resolve(path.join(tmpdir(), 'd86-host-xx'));
  assert.equal(centralWorkspaceDataDir(host, host), path.resolve(host), '宿主根自身返回在库位置');
  const ext = path.resolve(path.join(tmpdir(), 'some-external-project'));
  const dir = centralWorkspaceDataDir(host, ext);
  assert.ok(dir.startsWith(path.join(path.resolve(host), 'runtime', 'workspaces', path.sep)), `集中目录须在宿主 runtime/workspaces 下：${dir}`);
  assert.match(path.basename(dir), /^some-external-project-[0-9a-fA-F]{8}$/, '目录名 = <slug>-<路径哈希8>（哈希大小写随仓库 sha256Hex 惯例）');
  assert.equal(centralWorkspaceDataDir(host, ext), dir, '同路径确定性派生');
  const weird = path.resolve(path.join(tmpdir(), '名 称 空格!项目'));
  assert.match(path.basename(centralWorkspaceDataDir(host, weird)), /^[A-Za-z0-9_-]+-[0-9a-fA-F]{8}$/, 'slug 非法字符被替换');
});

test('D86: 热切换外部工作区零足迹——数据落宿主集中目录，目标文件夹不落任何条目', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'd86-live-'));
  const host = path.join(root, 'host');
  const ext = path.join(root, 'ext-project');
  mkdirSync(path.join(host, 'runtime'), { recursive: true });
  mkdirSync(ext, { recursive: true });
  const before = [...readdirSync(ext)];
  let server: BoardServer | undefined;
  try {
    const injected = new DispatchPipeline({
      workspaceRoot: host,
      approvalRoot: path.join(host, 'goals', 'receipts', 'approval-requests'),
      ledgerPath: path.join(host, 'runtime', 'budget-ledger.jsonl'),
      persistence: new BoardPersistence(path.join(host, 'runtime')),
      runAdapter: fakeOk,
    });
    server = await startBoardServer({
      approvalRoot: path.join(host, 'approvals'),
      workspaceRoot: host,
      runtimeRoot: path.join(host, 'runtime'),
      runId: 'd86-zero-footprint',
      assignmentEpoch: 1,
      callerToken: 'd86_token',
      enforceCallerToken: true,
      dispatch: injected,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'content-type': 'application/json', 'x-mush-caller-auth': 'd86_token' };

    const sel = await fetch(`${base}/api/workspaces/select`, { method: 'POST', headers, body: JSON.stringify({ path: ext }) });
    assert.equal(sel.status, 201);
    const created = await fetch(`${base}/api/tasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'D86 zero footprint' }) });
    assert.equal(created.status, 201);

    // 目标文件夹零足迹：除原有条目外无任何新增（无 .mush / runtime / goals）。
    const after = [...readdirSync(ext)];
    assert.deepEqual(after, before, '外部工作区目录不得出现任何 mush 条目');

    // 数据真实落盘在宿主集中目录。
    const central = centralWorkspaceDataDir(host, ext);
    assert.ok(existsSync(path.join(central, 'runtime', 'tasks.jsonl')), `任务池须落集中目录：${central}`);
    assert.ok(existsSync(path.join(host, '.mush', 'workspace.json')), '选择登记簿钉在宿主 .mush');

    // DEF-10 单点恢复：宿主登记簿记录外部工作区为当前选择。
    const reg = JSON.parse(readFileSync(path.join(host, '.mush', 'workspace.json'), 'utf8')) as { selected?: string };
    assert.equal(reg.selected, ext);

    // 切回宿主：任务池清零（隔离），集中数据仍在。
    const back = await fetch(`${base}/api/workspaces/select`, { method: 'POST', headers, body: JSON.stringify({ path: host }) });
    assert.equal(back.status, 201);
    const list = (await (await fetch(`${base}/api/tasks`)).json()) as { tasks: unknown[] };
    assert.equal(list.tasks.length, 0, '切回宿主后外部任务不可见');
    assert.ok(existsSync(path.join(central, 'runtime', 'tasks.jsonl')), '集中数据持久');
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
