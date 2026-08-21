/**
 * GOAL-030 / GP-40 看板调用者身份鉴别与安全握手保护测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-030: Caller Token Authentication & Security Handshake', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g030-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('Server issues unique Caller Token and serves it via session/token endpoint and HTML meta tag', async () => {
    server = await startBoardServer({
      approvalRoot,
      runId: 'test-token-session',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    // 1. GET /api/session/token
    const tokenRes = await fetch(`http://127.0.0.1:${server.port}/api/session/token`);
    assert.strictEqual(tokenRes.status, 200);
    const tokenJson = (await tokenRes.json()) as { ok: boolean; caller_token: string };
    assert.strictEqual(tokenJson.ok, true);
    assert.strictEqual(tokenJson.caller_token, server.callerToken);

    // 2. GET / page contains meta tag
    const pageRes = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.strictEqual(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes(`name="mush-caller-auth" content="${server.callerToken}"`));
  });

  test('Mutating POST/PATCH/DELETE endpoints strictly reject unauthenticated caller requests with 401', async () => {
    server = await startBoardServer({
      approvalRoot,
      runId: 'test-token-auth',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const unauthedPost = await fetch(`http://127.0.0.1:${server.port}/api/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adapter_id: 'fake', prompt: 'test' }),
    });
    assert.strictEqual(unauthedPost.status, 401);
    const postJson = (await unauthedPost.json()) as { ok: boolean; error: string };
    assert.strictEqual(postJson.ok, false);
    assert.ok(postJson.error.includes('Unauthorized'));

    // 伪造错误 token 被拒
    const badTokenPost = await fetch(`http://127.0.0.1:${server.port}/api/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-token': 'wrong-forged-token-1234567890abcdef',
      },
      body: JSON.stringify({ adapter_id: 'fake', prompt: 'test' }),
    });
    assert.strictEqual(badTokenPost.status, 401);
  });

  test('Requests carrying valid Caller Token via header or query param pass through successfully', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-token-pass',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    // 1. 携带合法 Header
    const authedPost = await fetch(`http://127.0.0.1:${server.port}/api/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-token': server.callerToken,
      },
      body: JSON.stringify({
        adapter_id: 'zcode',
        prompt: 'test prompt with caller token',
        workspace: tmpDir,
        real: false,
      }),
    });
    assert.strictEqual(authedPost.status, 202);
    const authedJson = (await authedPost.json()) as { ok: boolean; status: string };
    assert.strictEqual(authedJson.ok, true);

    // 2. 携带合法 Query Param
    const queryAuthedPost = await fetch(
      `http://127.0.0.1:${server.port}/api/dispatch?caller_token=${server.callerToken}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adapter_id: 'zcode',
          prompt: 'test prompt via query token',
          workspace: tmpDir,
          real: false,
        }),
      },
    );
    assert.strictEqual(queryAuthedPost.status, 202);
  });
});
