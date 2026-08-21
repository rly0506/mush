/**
 * tests/g050-shared-blackboard-workspace.test.ts
 *
 * 验证 GOAL-050：跨犬共享黑板协作空间与读写白名单仲裁
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  BlackboardEngine,
  BlackboardAclError,
  type BlackboardEvent,
} from '../src/orchestration/blackboard.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-050: Shared Blackboard Workspace', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g050-test-'));
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

  await t.test('1. Core: 4-Quadrant Sections, Versioning, ACL Enforcement & Pub/Sub', () => {
    const engine = new BlackboardEngine(runtimeRoot, [
      { dog: 'kimi-code', section: 'decisions', permission: 'read' },
    ]);

    // 1. 正常写入 artifacts
    const artItem1 = engine.writeItem(
      'agy',
      'artifacts',
      'API Contract Spec v1.33',
      'Defines 4-quadrant blackboard endpoints',
      ['spec', 'api']
    );
    assert.strictEqual(artItem1.version, 1);
    assert.strictEqual(artItem1.author_dog, 'agy');

    // 2. 同标题更新 -> 版本自增
    const artItem2 = engine.writeItem(
      'claude-code',
      'artifacts',
      'API Contract Spec v1.33',
      'Defines 4-quadrant blackboard endpoints with ACL updates',
      ['spec', 'v2']
    );
    assert.strictEqual(artItem2.id, artItem1.id);
    assert.strictEqual(artItem2.version, 2);
    assert.strictEqual(artItem2.author_dog, 'claude-code');

    // 3. ACL 权限拦截：只读犬写入抛出 BlackboardAclError
    assert.throws(
      () => {
        engine.writeItem('kimi-code', 'decisions', 'Unauthorized Decision', 'Should fail');
      },
      (err: Error) => err instanceof BlackboardAclError && err.message.includes('read-only')
    );

    // 4. 事件订阅与条件唤醒
    const receivedEvents: BlackboardEvent[] = [];
    const unsubscribe = engine.subscribe('issues', (evt) => {
      receivedEvents.push(evt);
    });

    const issueItem = engine.writeItem(
      'deepseek-code',
      'issues',
      'F-99 Concurrency Race Condition',
      'Potential race condition in memory graph node linking',
      ['bug', 'high']
    );

    assert.strictEqual(receivedEvents.length, 1);
    assert.strictEqual(receivedEvents[0].type, 'item_added');
    assert.strictEqual(receivedEvents[0].item.id, issueItem.id);

    unsubscribe();
  });

  await t.test('2. Server Endpoints: Full Blackboard REST API & Bearer Auth', async () => {
    const engine = new BlackboardEngine(runtimeRoot, [
      { dog: 'guest-dog', section: 'decisions', permission: 'read' },
    ]);

    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-blackboard-server',
      assignmentEpoch: 1,
      blackboardEngine: engine,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/blackboard
    const allRes = await fetch(`${base}/api/blackboard`);
    assert.strictEqual(allRes.status, 200);
    const allData = (await allRes.json()) as { ok: boolean; sections: Record<string, unknown[]> };
    assert.strictEqual(allData.ok, true);
    assert.ok(allData.sections.artifacts);
    assert.ok(allData.sections.issues);

    // 2. GET /api/blackboard/artifacts
    const secRes = await fetch(`${base}/api/blackboard/artifacts`);
    assert.strictEqual(secRes.status, 200);
    const secData = (await secRes.json()) as { ok: boolean; count: number; items: Array<{ title: string }> };
    assert.strictEqual(secData.ok, true);
    assert.strictEqual(secData.count, 1);
    assert.strictEqual(secData.items[0].title, 'API Contract Spec v1.33');

    // 3. POST /api/blackboard (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/blackboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        author_dog: 'agy',
        section: 'hypotheses',
        title: 'Micro-kernel Hypothesis',
        content: 'Decoupled state machines reduce cross-agent token tax',
      }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 4. POST /api/blackboard (有效鉴权 -> 200)
    const postRes = await fetch(`${base}/api/blackboard`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        author_dog: 'agy',
        section: 'hypotheses',
        title: 'Micro-kernel Hypothesis',
        content: 'Decoupled state machines reduce cross-agent token tax',
        tags: ['arch', 'poc'],
      }),
    });
    assert.strictEqual(postRes.status, 200);
    const postData = (await postRes.json()) as { ok: boolean; item: { id: string; version: number } };
    assert.strictEqual(postData.ok, true);
    assert.strictEqual(postData.item.version, 1);

    // 5. POST /api/blackboard (只读犬写受限分区 -> 403 Forbidden)
    const readOnlyRes = await fetch(`${base}/api/blackboard`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        author_dog: 'guest-dog',
        section: 'decisions',
        title: 'Unauthorized Decision',
        content: 'Should be rejected',
      }),
    });
    assert.strictEqual(readOnlyRes.status, 403);
  });
});
