import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline, type RunAdapterResult } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

// GOAL-007B：owner 实测反馈四类缺陷修复 + 两项向后兼容 server 小改（E1/E2）。
// E1: GET /api/dispatch/:id 增加 stdout_tail（末 2KB，截断标记）/ stderr_tail（256B）。
// E2: listWorkspaces() 增加 selected 字段（D1a 根因）。

function makeRoot(): { root: string; approvalRoot: string; workspaceRoot: string; ledgerPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g7b-'));
  const approvalRoot = path.join(root, 'approval-requests');
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  return { root, approvalRoot, workspaceRoot, ledgerPath: path.join(root, 'runtime', 'ledger.jsonl') };
}

test('E2: listWorkspaces marks the selected workspace (D1a root cause)', async () => {
  const { approvalRoot, workspaceRoot, ledgerPath } = makeRoot();
  const other = mkdtempSync(path.join(tmpdir(), 'mush-g7b-other-'));
  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });

  const before = pipeline.listWorkspaces();
  const unselected = before.find((w) => path.resolve(w.path) === path.resolve(workspaceRoot));
  assert.ok(unselected);
  assert.equal(unselected.selected, false, '未选中的 workspace 必须显式 selected=false');

  pipeline.selectWorkspace(other);
  const after = pipeline.listWorkspaces();
  const selectedWs = after.find((w) => path.resolve(w.path) === path.resolve(other));
  const unselectedAfter = after.find((w) => path.resolve(w.path) === path.resolve(workspaceRoot));
  assert.equal(selectedWs?.selected, true, '选中的 workspace 必须 selected=true');
  assert.equal(unselectedAfter?.selected, false);
});

test('E1: GET /api/dispatch/:id returns stdout_tail (2KB cap + truncation marker) and stderr_tail (256B)', async () => {
  const { root, approvalRoot, workspaceRoot, ledgerPath } = makeRoot();
  const longStdout = 'x'.repeat(3000) + '\nTAIL-MARKER-STDOUT';
  const longStderr = 'e'.repeat(400) + 'TAIL-MARKER-STDERR';
  const fakeRun = async (): Promise<RunAdapterResult> => ({
    exitCode: 0,
    stdout: longStdout,
    stderr: longStderr,
    timedOut: false,
    childKilled: false,
  });
  const pipeline = new DispatchPipeline({ workspaceRoot, approvalRoot, ledgerPath, runAdapter: fakeRun });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g7b-e1-run',
    assignmentEpoch: 1,
    workspaceRoot,
    ledgerPath,
    dispatch: pipeline,
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const dispatched = await fetch(base + '/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'g7b e1 fixture', cap_usd: 5 }),
    });
    assert.equal(dispatched.status, 202);
    const { dispatch_id: dispatchId } = (await dispatched.json()) as { dispatch_id: string };

    const detail = (await (await fetch(base + '/api/dispatch/' + dispatchId)).json()) as {
      ok: boolean;
      dispatch: { stdout_tail?: { text: string; truncated: boolean }; stderr_tail?: { text: string; truncated: boolean } };
    };
    assert.equal(detail.ok, true);
    assert.ok(detail.dispatch.stdout_tail, 'stdout_tail 字段必须存在');
    assert.ok(detail.dispatch.stderr_tail, 'stderr_tail 字段必须存在');
    assert.ok(detail.dispatch.stdout_tail!.text.endsWith('TAIL-MARKER-STDOUT'), '保留末段');
    assert.equal(detail.dispatch.stdout_tail!.truncated, true, '3000B > 2KB 必须标记截断');
    assert.ok(detail.dispatch.stdout_tail!.text.length <= 2048, 'stdout_tail ≤ 2KB');
    assert.equal(detail.dispatch.stderr_tail!.truncated, true, '400B > 256B 必须标记截断');
    assert.ok(detail.dispatch.stderr_tail!.text.endsWith('TAIL-MARKER-STDERR'));
    assert.ok(detail.dispatch.stderr_tail!.text.length <= 256, 'stderr_tail ≤ 256B');
  } finally {
    await server.close();
  }
});

test('E1: short output is not marked truncated', async () => {
  const { approvalRoot, workspaceRoot, ledgerPath } = makeRoot();
  const fakeRun = async (): Promise<RunAdapterResult> => ({
    exitCode: 0,
    stdout: 'short out',
    stderr: 'short err',
    timedOut: false,
    childKilled: false,
  });
  const pipeline = new DispatchPipeline({ workspaceRoot, approvalRoot, ledgerPath, runAdapter: fakeRun });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g7b-e1b-run',
    assignmentEpoch: 1,
    workspaceRoot,
    ledgerPath,
    dispatch: pipeline,
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const dispatched = await fetch(base + '/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'short output fixture' }),
    });
    const { dispatch_id: dispatchId } = (await dispatched.json()) as { dispatch_id: string };
    const detail = (await (await fetch(base + '/api/dispatch/' + dispatchId)).json()) as {
      dispatch: { stdout_tail?: { text: string; truncated: boolean }; stderr_tail?: { text: string; truncated: boolean } };
    };
    assert.equal(detail.dispatch.stdout_tail!.text, 'short out');
    assert.equal(detail.dispatch.stdout_tail!.truncated, false);
    assert.equal(detail.dispatch.stderr_tail!.text, 'short err');
    assert.equal(detail.dispatch.stderr_tail!.truncated, false);
  } finally {
    await server.close();
  }
});
