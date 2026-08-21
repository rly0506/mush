/**
 * tests/g054-floating-sled-desktop-companion.test.ts
 *
 * 验证 GOAL-054：极简系统托盘常驻伴侣与全局热键雪橇浮窗
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FloatingSledCompanion } from '../src/companion/tray-service.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-054: Floating Sled Desktop Companion & Tray Service', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g054-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const runtimeRoot = path.join(tmpDir, 'runtime');
  const approvalRoot = path.join(tmpDir, 'approvals');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(approvalRoot, { recursive: true });

  let server: BoardServer | null = null;

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Core: Tray Lifecycle, Window Toggle & Approval Handling', () => {
    const companion = new FloatingSledCompanion('http://127.0.0.1:8765', 'test-token');

    assert.strictEqual(companion.status, 'IDLE');
    assert.strictEqual(companion.isWindowVisible, false);

    // 1. 窗口显隐切换 (Alt+Space)
    assert.strictEqual(companion.toggleWindow(), true);
    assert.strictEqual(companion.isWindowVisible, true);
    assert.strictEqual(companion.toggleWindow(), false);
    assert.strictEqual(companion.isWindowVisible, false);

    // 2. 审批事件通知拦截
    companion.handleApprovalNotification('appr-g054-001');
    assert.strictEqual(companion.status, 'PENDING_APPROVAL');
    assert.strictEqual(companion.pendingApprovalId, 'appr-g054-001');
  });

  await t.test('2. Server Endpoints: Spotlight HTML & Quick-Action REST API', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-companion-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /companion/spotlight (返回纯原生 HTML，零外部资源引用)
    const spotlightRes = await fetch(`${base}/companion/spotlight`);
    assert.strictEqual(spotlightRes.status, 200);
    const html = await spotlightRes.text();
    assert.ok(html.includes('mush Spotlight Sled'));
    assert.ok(html.includes('Alt+Space 快速唤起'));
    assert.ok(!html.includes('http://') && !html.includes('https://cdn'), '必须遵守零外部静态资源红线');

    // 2. POST /api/companion/quick-action (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/companion/quick-action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action_type: 'DEBATE',
        prompt: '评估状态树设计',
      }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 3. POST /api/companion/quick-action (有效鉴权 -> 200)
    const companion = new FloatingSledCompanion(base, server.callerToken);
    const actionResult = await companion.triggerQuickAction({
      action_type: 'REVIEW',
      prompt: '审查以下核心函数的安全性',
      selected_code: 'function evalCode(s: string) { return eval(s); }',
    });

    assert.strictEqual(actionResult.ok, true);
    assert.strictEqual(actionResult.mode, 'REVIEW');
    assert.ok(actionResult.dispatch_id);
    assert.strictEqual(companion.status, 'IDLE');
  });
});
