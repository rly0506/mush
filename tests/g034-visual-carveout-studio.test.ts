/**
 * GOAL-034 / GP-24 看板 Carve-out 声明式写面可视化工作台测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { renderBoardPage } from '../src/web/page.ts';

describe('GOAL-034: Visual Carve-out Studio & Whitelist Controller', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g034-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Board HTML Rendering of Carve-out Studio & Zero Forbidden Words', () => {
    const html = renderBoardPage();
    assert.match(html, /id="view-carveouts"/, 'carveouts 视图容器');
    assert.match(html, /id="form-grant-carveout"/, 'carveout 授权表单');
    assert.match(html, /id="co-input-paths"/, '路径输入框');
    assert.match(html, /id="carveout-active-wrap"/, '活跃切片展示区');
    assert.match(html, /id="carveouts-history-list"/, '切片历史列表');

    // 零敏感词红线审查
    assert.ok(
      !/credential|api[_-]?key|secret|token/i.test(html.replace(/credential_status|identity/g, '')),
      'no credential material rendered in carveout studio',
    );
  });

  test('2. Server Endpoints: GET /api/carveouts and POST /api/carveout/grant & revoke', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-carveout-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. 初始 GET /api/carveouts
    const initRes = await fetch(base + '/api/carveouts');
    assert.strictEqual(initRes.status, 200);
    const initData = (await initRes.json()) as { ok: boolean; active: unknown; current_token: string };
    assert.strictEqual(initData.ok, true);
    assert.strictEqual(initData.active, null);

    const token = initData.current_token;

    // 2. POST /api/carveout/grant（无 token 401/403 拦截）
    const unauthedGrant = await fetch(base + '/api/carveout/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path_roots: ['src/web'],
        expires_at: '2099-01-01T00:00:00.000Z',
        task_ref: 'GOAL-034',
        reason: 'Studio Test',
        token,
      }),
    });
    assert.strictEqual(unauthedGrant.status, 401);

    // 3. 有效 Caller Token 授权切片 201
    const grantRes = await fetch(base + '/api/carveout/grant', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        path_roots: ['src/web', 'tests'],
        expires_at: '2099-01-01T00:00:00.000Z',
        task_ref: 'GOAL-034',
        reason: 'Studio Test',
        token,
      }),
    });
    assert.strictEqual(grantRes.status, 201);
    const grantData = (await grantRes.json()) as { ok: boolean; carveout: { carveout_id: string; status: string } };
    assert.strictEqual(grantData.ok, true);
    assert.strictEqual(grantData.carveout.status, 'ACTIVE');

    const carveoutId = grantData.carveout.carveout_id;

    // 4. 再次 GET /api/carveouts 验证 ACTIVE 状态
    const activeRes = await fetch(base + '/api/carveouts');
    const activeData = (await activeRes.json()) as { ok: boolean; active: { carveout_id: string }; current_token: string };
    assert.strictEqual(activeData.active?.carveout_id, carveoutId);

    const rotatedToken = activeData.current_token;

    // 5. POST /api/carveout/revoke 撤销切片
    const revokeRes = await fetch(base + '/api/carveout/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        carveout_id: carveoutId,
        token: rotatedToken,
      }),
    });
    assert.strictEqual(revokeRes.status, 200);
    const revokeData = (await revokeRes.json()) as { ok: boolean; status: string };
    assert.strictEqual(revokeData.status, 'REVOKED');

    // 6. 最终 GET /api/carveouts 验证已无 ACTIVE 切片
    const finalRes = await fetch(base + '/api/carveouts');
    const finalData = (await finalRes.json()) as { ok: boolean; active: unknown; carveouts: unknown[] };
    assert.strictEqual(finalData.active, null);
    assert.strictEqual(finalData.carveouts.length, 2); // 1 ACTIVE + 1 REVOKED snapshot
  });
});
