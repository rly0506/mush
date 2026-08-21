import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderBoardPage } from '../src/web/page.ts';
import { startBoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

test('1. Board page HTML renders workspace native browse and tree picker buttons', () => {
  const html = renderBoardPage();
  assert.ok(html.includes('id="btn-workspace-browse-native"'), 'btn-workspace-browse-native must exist');
  assert.ok(html.includes('id="btn-workspace-tree"'), 'btn-workspace-tree must exist');
  assert.ok(html.includes('id="chat-workspace-browse-btn"'), 'chat-workspace-browse-btn must exist');
  assert.ok(html.includes('id="chat-workspace-tree-btn"'), 'chat-workspace-tree-btn must exist');
  assert.ok(html.includes('id="workspace-tree-dialog"'), 'workspace-tree-dialog must exist');
  assert.ok(html.includes('id="ws-dir-list-container"'), 'ws-dir-list-container must exist');
});

test('2. GET /api/workspaces/fs-tree returns drives or subdirectories', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-test-ws-'));
  const approvalRoot = path.join(root, 'approval-requests');
  const workspaceRoot = path.join(root, 'workspace');
  const ledgerPath = path.join(root, 'runtime', 'budget-ledger.jsonl');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const pipeline = new DispatchPipeline({ workspaceRoot, approvalRoot, ledgerPath });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'ws-test-run',
    assignmentEpoch: 1,
    workspaceRoot,
    ledgerPath,
    dispatch: pipeline,
    port: 0,
    host: '127.0.0.1',
  });

  const base = `http://127.0.0.1:${server.port}`;

  // Test root fs-tree (drives)
  const resRoot = await fetch(base + '/api/workspaces/fs-tree');
  const dataRoot = (await resRoot.json()) as any;
  assert.equal(dataRoot.ok, true);
  assert.ok(Array.isArray(dataRoot.drives));
  assert.ok(dataRoot.drives.length > 0);

  // Test specific path
  const resPath = await fetch(base + '/api/workspaces/fs-tree?path=' + encodeURIComponent(process.cwd()));
  const dataPath = (await resPath.json()) as any;
  assert.equal(dataPath.ok, true);
  assert.ok(Array.isArray(dataPath.directories));
  assert.ok(dataPath.directories.some((d: any) => d.name === 'src' || d.name === 'tests' || d.name === 'docs'));

  await server.close();
});
