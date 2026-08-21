/**
 * tests/g049-time-travel-state-kernel.test.ts
 *
 * 验证 GOAL-049：会话与代码时空状态树与因果时间旅行快照
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { TimeTravelKernel } from '../src/orchestration/time-travel.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-049: Time-Travel State Kernel', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g049-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const runtimeRoot = path.join(tmpDir, 'runtime');
  const approvalRoot = path.join(tmpDir, 'approvals');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(approvalRoot, { recursive: true });

  const testFileRel = 'src/app.ts';
  const testFileAbs = path.join(workspaceRoot, testFileRel);
  mkdirSync(path.dirname(testFileAbs), { recursive: true });
  writeFileSync(testFileAbs, 'export const version = "v1.0.0";\n', 'utf-8');

  let server: BoardServer | null = null;

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Core: Micro-Snapshots, Causality Tree, Fork & Exact Time Travel', () => {
    const kernel = new TimeTravelKernel(workspaceRoot, runtimeRoot);

    // 1. 创建初始快照 A
    const snapA = kernel.createSnapshot('Initial v1.0.0 state', [testFileRel], 'main');
    assert.strictEqual(snapA.branch_name, 'main');
    assert.strictEqual(snapA.files.length, 1);
    assert.strictEqual(snapA.files[0].content, 'export const version = "v1.0.0";\n');

    // 2. 修改文件并创建快照 B
    writeFileSync(testFileAbs, 'export const version = "v2.0.0-modified";\n', 'utf-8');
    const snapB = kernel.createSnapshot('Update to v2.0.0', [testFileRel], 'main');
    assert.strictEqual(snapB.parent_id, snapA.node_id);
    assert.strictEqual(snapB.files[0].content, 'export const version = "v2.0.0-modified";\n');

    // 3. 从快照 A 派生平行实验分支
    const snapFork = kernel.forkBranch(snapA.node_id, 'experiment-parallel', '探索性重构分支');
    assert.strictEqual(snapFork.parent_id, snapA.node_id);
    assert.strictEqual(snapFork.branch_name, 'experiment-parallel');
    assert.strictEqual(snapFork.files[0].content, 'export const version = "v1.0.0";\n');

    // 4. 树形因果拓扑验证
    const tree = kernel.getTree();
    assert.strictEqual(tree.nodes.length, 3);
    assert.ok(tree.branches['main']);
    assert.strictEqual(tree.branches['main'].length, 2);
    assert.ok(tree.branches['experiment-parallel']);
    assert.strictEqual(tree.branches['experiment-parallel'].length, 1);

    // 5. 破坏工作区文件，执行时空倒流回滚至 snapA
    writeFileSync(testFileAbs, 'CORRUPTED_CRASH_SYNTAX_ERROR', 'utf-8');
    const revertResA = kernel.travelToNode(snapA.node_id);
    assert.strictEqual(revertResA.ok, true);
    assert.strictEqual(revertResA.restored_files_count, 1);

    // 验证文件精确还原回 v1.0.0
    const restoredContentA = readFileSync(testFileAbs, 'utf-8');
    assert.strictEqual(restoredContentA, 'export const version = "v1.0.0";\n');

    // 6. 时空前进至 snapB
    const revertResB = kernel.travelToNode(snapB.node_id);
    assert.strictEqual(revertResB.ok, true);
    const restoredContentB = readFileSync(testFileAbs, 'utf-8');
    assert.strictEqual(restoredContentB, 'export const version = "v2.0.0-modified";\n');
  });

  await t.test('2. Server Endpoints: Full Time-Travel REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-timetravel-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/time-travel/tree
    const treeRes = await fetch(`${base}/api/time-travel/tree`);
    assert.strictEqual(treeRes.status, 200);
    const treeData = (await treeRes.json()) as { ok: boolean; total_nodes: number; nodes: Array<{ node_id: string }> };
    assert.strictEqual(treeData.ok, true);
    assert.ok(treeData.total_nodes >= 3);

    const firstNodeId = treeData.nodes[0].node_id;

    // 2. GET /api/time-travel/nodes/:id
    const nodeRes = await fetch(`${base}/api/time-travel/nodes/${firstNodeId}`);
    assert.strictEqual(nodeRes.status, 200);
    const nodeData = (await nodeRes.json()) as { ok: boolean; node: { node_id: string } };
    assert.strictEqual(nodeData.node.node_id, firstNodeId);

    // 3. POST /api/time-travel/snapshot (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/time-travel/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Unauthed snapshot' }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 4. POST /api/time-travel/snapshot (有效鉴权 -> 200)
    const snapRes = await fetch(`${base}/api/time-travel/snapshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        reason: 'REST API Snapshot',
        files: [testFileRel],
        branch_name: 'main',
      }),
    });
    assert.strictEqual(snapRes.status, 200);
    const snapData = (await snapRes.json()) as { ok: boolean; node: { node_id: string; reason: string } };
    assert.strictEqual(snapData.node.reason, 'REST API Snapshot');

    // 5. POST /api/time-travel/fork (鉴权 -> 200)
    const forkRes = await fetch(`${base}/api/time-travel/fork`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        from_node_id: snapData.node.node_id,
        branch_name: 'feature-rest-fork',
        reason: 'Forked via REST API',
      }),
    });
    assert.strictEqual(forkRes.status, 200);
    const forkData = (await forkRes.json()) as { ok: boolean; node: { branch_name: string } };
    assert.strictEqual(forkData.node.branch_name, 'feature-rest-fork');

    // 6. POST /api/time-travel/revert (鉴权 -> 200)
    const revertRes = await fetch(`${base}/api/time-travel/revert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        node_id: firstNodeId,
      }),
    });
    assert.strictEqual(revertRes.status, 200);
    const revertData = (await revertRes.json()) as { ok: boolean; restored_files_count: number };
    assert.strictEqual(revertData.ok, true);
    assert.strictEqual(revertData.restored_files_count, 1);
  });
});
