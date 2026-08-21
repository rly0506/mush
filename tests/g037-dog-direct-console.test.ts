/**
 * GOAL-037: 犬只直连会话控制台与 Transcript 回看测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DirectSessionManager } from '../src/orchestration/direct-session.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-037: Dog Direct Console & Session Management', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g037-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. DirectSessionManager: Create, Messages, Resume, Transcript', () => {
    const manager = new DirectSessionManager(tmpDir);

    // 创建会话
    const sess = manager.createSession('claude-code', 'claude-3-7-sonnet');
    assert.strictEqual(sess.adapter_id, 'claude-code');
    assert.strictEqual(sess.status, 'ACTIVE');

    // 发送人犬消息
    const msg1 = manager.postMessage(sess.session_id, 'human', '请帮我写个单测');
    assert.strictEqual(msg1.sender, 'human');
    const msg2 = manager.postMessage(sess.session_id, 'dog', '好的，已生成单测代码');
    assert.strictEqual(msg2.sender, 'dog');

    // 获取会话
    const fetched = manager.getSession(sess.session_id);
    assert.strictEqual(fetched?.messages.length, 2);

    // 续接会话
    const resumed = manager.resumeSession(sess.session_id);
    assert.strictEqual(resumed.status, 'ACTIVE');

    // 获取 Transcript
    const transcript = manager.getTranscript('claude-code');
    assert.strictEqual(transcript.length, 2);

    // 模拟持久化重载
    const newManager = new DirectSessionManager(tmpDir);
    const reloaded = newManager.getSession(sess.session_id);
    assert.strictEqual(reloaded?.messages.length, 2);
  });

  test('2. Server Endpoints: GET/POST /api/dogs/:id/sessions, messages, resume, transcript', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-direct-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. 创建直连会话 POST /api/dogs/kimi-code/sessions
    const createRes = await fetch(`${base}/api/dogs/kimi-code/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model_id: 'kimi-k1.5' }),
    });
    assert.strictEqual(createRes.status, 201);
    const createData = (await createRes.json()) as { ok: boolean; session: { session_id: string; adapter_id: string } };
    assert.strictEqual(createData.ok, true);
    assert.strictEqual(createData.session.adapter_id, 'kimi-code');

    const sessionId = createData.session.session_id;

    // 2. 发送消息 POST /api/dogs/kimi-code/sessions/:id/messages
    const msgRes = await fetch(`${base}/api/dogs/kimi-code/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Hello Kimi', sender: 'human' }),
    });
    assert.strictEqual(msgRes.status, 201);
    const msgData = (await msgRes.json()) as { ok: boolean; message: { content: string } };
    assert.strictEqual(msgData.ok, true);
    assert.strictEqual(msgData.message.content, 'Hello Kimi');

    // 3. 查询会话列表 GET /api/dogs/kimi-code/sessions
    const listRes = await fetch(`${base}/api/dogs/kimi-code/sessions`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; sessions: Array<{ session_id: string }> };
    assert.strictEqual(listData.ok, true);
    assert.strictEqual(listData.sessions.length, 1);

    // 4. 续接会话 POST /api/dogs/kimi-code/sessions/:id/resume
    const resumeRes = await fetch(`${base}/api/dogs/kimi-code/sessions/${sessionId}/resume`, {
      method: 'POST',
    });
    assert.strictEqual(resumeRes.status, 200);
    const resumeData = (await resumeRes.json()) as { ok: boolean; session: { status: string } };
    assert.strictEqual(resumeData.session.status, 'ACTIVE');

    // 5. 查询 Transcript GET /api/dogs/kimi-code/transcript
    const transRes = await fetch(`${base}/api/dogs/kimi-code/transcript`);
    assert.strictEqual(transRes.status, 200);
    const transData = (await transRes.json()) as { ok: boolean; messages: unknown[] };
    assert.strictEqual(transData.messages.length, 1);
  });
});
