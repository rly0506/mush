/**
 * tests/g043-chat-collaboration-bus.test.ts
 *
 * 验证 GOAL-043：聊天底栏协作模式快捷开关与调度总线
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  recommendCollaborationPair,
  buildCollaborationPacket,
} from '../src/orchestration/collaboration-bus.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-043: Chat Collaboration Bus', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g043-test-'));
  const approvalRoot = path.join(tmpDir, 'approvals');
  let server: BoardServer | null = null;

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. recommendCollaborationPair adapts to domain and mode', () => {
    const pairDebate = recommendCollaborationPair('编写高并发分布式锁算法与状态机', 'debate');
    assert.ok(pairDebate.primaryDog);
    assert.ok(pairDebate.opposingDog);
    assert.notStrictEqual(pairDebate.primaryDog, pairDebate.opposingDog);
    assert.ok(pairDebate.reason.includes('对席交叉质询'));

    const pairVerify = recommendCollaborationPair('测试并审计 API 越权漏洞', 'verify');
    assert.ok(pairVerify.reason.includes('Verifier'));

    const pairPipeline = recommendCollaborationPair('从零实现一个微服务全栈项目', 'pipeline');
    assert.ok(pairPipeline.reason.includes('需求与架构工序'));
  });

  await t.test('2. buildCollaborationPacket produces clean structured packet', () => {
    const packet = buildCollaborationPacket({
      topic: '重构前端页面巨石',
      mode: 'debate',
      workspaceRoot: tmpDir,
      primaryDog: 'claude-code',
      opposingDog: 'deepseek-chat',
      maxBudgetUsd: 1.5,
    });

    assert.ok(packet.packetId.startsWith('collab-'));
    assert.strictEqual(packet.topic, '重构前端页面巨石');
    assert.strictEqual(packet.mode, 'debate');
    assert.strictEqual(packet.primaryDog, 'claude-code');
    assert.strictEqual(packet.opposingDog, 'deepseek-chat');
    assert.strictEqual(packet.maxBudgetUsd, 1.5);
    assert.ok(packet.createdAtUtc);
  });

  await t.test('3. Server Endpoints: POST /api/collaboration/recommend-pair & POST /api/collaboration/dispatch', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-collab-bus',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. recommend-pair (未鉴权 -> 401, 有效鉴权 -> 200)
    const unauthedRec = await fetch(`${base}/api/collaboration/recommend-pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '编写安全密码哈希函数', mode: 'verify' }),
    });
    assert.strictEqual(unauthedRec.status, 401);

    const recRes = await fetch(`${base}/api/collaboration/recommend-pair`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ topic: '编写安全密码哈希函数', mode: 'verify' }),
    });
    assert.strictEqual(recRes.status, 200);
    const recData = (await recRes.json()) as { ok: boolean; primaryDog: string; opposingDog: string; reason: string };
    assert.strictEqual(recData.ok, true);
    assert.ok(recData.primaryDog);
    assert.ok(recData.opposingDog);

    // 2. dispatch (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/collaboration/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '重构持久化层', mode: 'debate' }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 3. dispatch (有效鉴权 -> 200)
    const authedRes = await fetch(`${base}/api/collaboration/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ topic: '重构持久化层', mode: 'debate', max_budget_usd: 3.0 }),
    });
    assert.strictEqual(authedRes.status, 200);
    const authedData = (await authedRes.json()) as { ok: boolean; packet: { packetId: string; topic: string; mode: string } };
    assert.strictEqual(authedData.ok, true);
    assert.strictEqual(authedData.packet.topic, '重构持久化层');
    assert.strictEqual(authedData.packet.mode, 'debate');
  });
});
