/**
 * GOAL-035: 看板 Git Diff 视觉审查器与单文件回滚测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  classifyDiffSensitivity,
  parseUnifiedDiff,
  captureWorkspaceDiff,
  revertWorkspaceFile,
} from '../src/orchestration/diff-collector.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-035: Dispatch Git Diff Viewer & Safe Revert', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g035-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Sensitivity Classification & Unified Diff Parsing', () => {
    // 敏感度分类
    assert.strictEqual(classifyDiffSensitivity('CONSTITUTION.md'), 'critical');
    assert.strictEqual(classifyDiffSensitivity('DECISIONS.md'), 'critical');
    assert.strictEqual(classifyDiffSensitivity('.env.local'), 'critical');
    assert.strictEqual(classifyDiffSensitivity('runtime/budget.jsonl'), 'generated');
    assert.strictEqual(classifyDiffSensitivity('dist/bundle.js'), 'generated');
    assert.strictEqual(classifyDiffSensitivity('src/web/server.ts'), 'normal');

    // 解析 Unified Diff 文本
    const sampleDiff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..89abcdef 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
 import { foo } from './foo';
-const a = 1;
+const a = 2;
+const b = 3;
 export default a;
diff --git a/CONSTITUTION.md b/CONSTITUTION.md
index 1111111..2222222 100644
--- a/CONSTITUTION.md
+++ b/CONSTITUTION.md
@@ -10,3 +10,4 @@
 Rule 1
+Rule 2
`;

    const parsed = parseUnifiedDiff(sampleDiff);
    assert.strictEqual(parsed.length, 2);

    const f1 = parsed[0];
    assert.strictEqual(f1.new_path, 'src/index.ts');
    assert.strictEqual(f1.additions, 2);
    assert.strictEqual(f1.deletions, 1);
    assert.strictEqual(f1.sensitivity, 'normal');
    assert.strictEqual(f1.hunks.length, 1);

    const f2 = parsed[1];
    assert.strictEqual(f2.new_path, 'CONSTITUTION.md');
    assert.strictEqual(f2.sensitivity, 'critical');
    assert.strictEqual(f2.additions, 1);
  });

  test('2. Live Git Diff Capture & Safe Revert in Git Workspace', () => {
    // 初始化临时 git 仓库
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'TestRunner'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });

    const fileA = path.join(tmpDir, 'hello.txt');
    writeFileSync(fileA, 'Line 1\nLine 2\n', 'utf-8');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });

    // 修改文件
    writeFileSync(fileA, 'Line 1\nLine 2 modified\nLine 3 added\n', 'utf-8');

    // 采集 diff
    const diffResult = captureWorkspaceDiff(tmpDir);
    assert.strictEqual(diffResult.total_files, 1);
    assert.strictEqual(diffResult.files[0].new_path, 'hello.txt');
    assert.strictEqual(diffResult.files[0].additions, 2);
    assert.strictEqual(diffResult.files[0].deletions, 1);

    // 路径越界保护
    const traversal = revertWorkspaceFile(tmpDir, '../outside.txt');
    assert.strictEqual(traversal.ok, false);

    // 冻结区保护
    const frozen = revertWorkspaceFile(tmpDir, '.agent-bridge/test.txt');
    assert.strictEqual(frozen.ok, false);

    // 正常单文件回滚
    const reverted = revertWorkspaceFile(tmpDir, 'hello.txt');
    assert.strictEqual(reverted.ok, true);

    // 回滚后 diff 为空
    const postRevertDiff = captureWorkspaceDiff(tmpDir);
    assert.strictEqual(postRevertDiff.total_files, 0);
  });

  test('3. Server Endpoints: GET /api/diff, GET /api/dispatch/:id/diff, POST /api/dispatch/:id/revert', async () => {
    // 初始化临时 git 仓库
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'TestRunner'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });

    const testFile = path.join(tmpDir, 'code.ts');
    writeFileSync(testFile, 'export const x = 1;\n', 'utf-8');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'Initial'], { cwd: tmpDir });

    writeFileSync(testFile, 'export const x = 2;\nexport const y = 3;\n', 'utf-8');

    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-diff-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // GET /api/diff
    const diffRes = await fetch(`${base}/api/diff`);
    assert.strictEqual(diffRes.status, 200);
    const diffData = (await diffRes.json()) as { ok: boolean; diff: { total_files: number } };
    assert.strictEqual(diffData.ok, true);
    assert.strictEqual(diffData.diff.total_files, 1);

    // GET /api/dispatch/disp-123/diff
    const dispDiffRes = await fetch(`${base}/api/dispatch/disp-123/diff`);
    assert.strictEqual(dispDiffRes.status, 200);
    const dispDiffData = (await dispDiffRes.json()) as { ok: boolean; dispatch_id: string };
    assert.strictEqual(dispDiffData.dispatch_id, 'disp-123');

    // POST /api/dispatch/disp-123/revert (无 auth -> 401)
    const unauthedRevert = await fetch(`${base}/api/dispatch/disp-123/revert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'code.ts' }),
    });
    assert.strictEqual(unauthedRevert.status, 401);

    // POST /api/dispatch/disp-123/revert (有效 auth)
    const authedRevert = await fetch(`${base}/api/dispatch/disp-123/revert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ file: 'code.ts' }),
    });
    assert.strictEqual(authedRevert.status, 200);
    const authedData = (await authedRevert.json()) as { ok: boolean; message: string };
    assert.strictEqual(authedData.ok, true);
  });
});
