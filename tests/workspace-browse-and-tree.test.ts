import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

test('2. Native picker success cascades full workspace-switch refresh', () => {
  const html = renderBoardPage();
  const m = /postJson\('\/api\/workspaces\/browse-native'[\s\S]{0,500}?onWorkspaceSwitched\(\)/.exec(html);
  assert.ok(m, 'browse-native handler must cascade onWorkspaceSwitched');
});

test('3. GET /api/workspaces/fs-tree returns drives or subdirectories', async () => {
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

test('4. browse-folder.ps1 hosts a TopMost owner form so the dialog cannot hide behind the browser', () => {
  const ps = readFileSync(path.resolve('scripts/browse-folder.ps1'), 'utf8');
  assert.match(ps, /\$owner\.TopMost\s*=\s*\$true/, 'owner form must be TopMost');
  assert.match(ps, /ShowDialog\(\$owner\)/, 'dialog must be owned by the topmost form');
});

test('5. browse-native reaps its dialog child only on premature client disconnect', () => {
  const src = readFileSync(path.resolve('src/web/server.ts'), 'utf8');
  const idx = src.indexOf("route === 'POST /api/workspaces/browse-native'");
  assert.ok(idx > 0, 'browse-native route must exist');
  const block = src.slice(idx, idx + 2600);
  assert.match(block, /response\.once\('close'/, 'must guard on response close');
  assert.match(block, /!response\.writableEnded/, 'normal completion must not kill the child');
  assert.doesNotMatch(block, /request\.once\('close'/, 'request close fires on full body receipt and would insta-kill the dialog');
});

test('6. aborted browse-native call does not wedge the server', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-test-browse-'));
  const approvalRoot = path.join(root, 'approval-requests');
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  // 无 UI 桩脚本：睡 8 秒模拟用户未关弹窗；测试中途主动断开。
  const stubScript = path.join(root, 'stub-browse.ps1');
  writeFileSync(stubScript, 'Start-Sleep -Seconds 8\n', 'utf8');

  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath: path.join(root, 'runtime', 'budget-ledger.jsonl'),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'browse-abort-test',
    assignmentEpoch: 1,
    workspaceRoot,
    ledgerPath: path.join(root, 'runtime', 'board-ledger.jsonl'),
    dispatch: pipeline,
    port: 0,
    host: '127.0.0.1',
    browseFolderScript: stubScript,
  });
  const base = `http://127.0.0.1:${server.port}`;

  const ac = new AbortController();
  const outcome = fetch(`${base}/api/workspaces/browse-native`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: ac.signal,
  }).then(
    () => 'resolved' as const,
    (e: unknown) => (e instanceof Error && e.name === 'AbortError' ? 'aborted' as const : 'other' as const),
  );
  await new Promise((r) => setTimeout(r, 1000));
  ac.abort();
  assert.equal(await outcome, 'aborted', 'pending dialog call must drop on client abort');

  const health = await fetch(`${base}/api/workspaces/fs-tree`);
  assert.equal(((await health.json()) as any).ok, true, 'server must stay healthy after abort');

  await server.close();
});
