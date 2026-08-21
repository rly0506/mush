/**
 * GOAL-033 / GP-31 会话工作流生命周期控制面与交接编辑器测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkstreamStore } from '../src/web/workstreams.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-033: Workstream Lifecycle & Handoff Editor', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let runtimeRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g033-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    runtimeRoot = path.join(tmpDir, 'runtime');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. WorkstreamStore Core Lifecycle: Create, Update 4-States, Append-Only Persistence', () => {
    const storeFile = path.join(runtimeRoot, 'workstreams.jsonl');
    const store = new WorkstreamStore(storeFile);

    // 1. 创建新流
    const s1 = store.create({ title: 'Feature Alpha', description: 'Initial feature flow' });
    assert.strictEqual(s1.title, 'Feature Alpha');
    assert.strictEqual(s1.status, 'ACTIVE');
    assert.strictEqual(s1.parent_stream_id, null);
    assert.strictEqual(s1.handoff_block, null);

    // 2. 状态流转 ACTIVE -> PAUSED -> ARCHIVED
    const paused = store.update(s1.stream_id, { status: 'PAUSED' });
    assert.strictEqual(paused.status, 'PAUSED');

    const archived = store.update(s1.stream_id, { status: 'ARCHIVED' });
    assert.strictEqual(archived.status, 'ARCHIVED');

    // 3. 持久化重载
    const reloadedStore = new WorkstreamStore(storeFile);
    const loaded = reloadedStore.get(s1.stream_id);
    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.status, 'ARCHIVED');
    assert.strictEqual(loaded!.title, 'Feature Alpha');
  });

  test('2. Structured Handoff Block Management', () => {
    const storeFile = path.join(runtimeRoot, 'workstreams.jsonl');
    const store = new WorkstreamStore(storeFile);
    const s = store.create({ title: 'Refactor Core' });

    // 写入交接块
    const withHandoff = store.update(s.stream_id, {
      handoff_block: {
        decisions_made: ['Adopt TypeScript strict mode', 'Use Node test runner'],
        files_touched: ['src/core/engine.ts', 'src/web/server.ts'],
        next_actions: ['Migrate remaining tests', 'Benchmark performance'],
        handoff_markdown: '### 核心交接摘要\n已完成基础重构，剩余测试待迁移。',
      },
    });

    assert.ok(withHandoff.handoff_block !== null);
    assert.strictEqual(withHandoff.handoff_block!.decisions_made.length, 2);
    assert.strictEqual(withHandoff.handoff_block!.files_touched[0], 'src/core/engine.ts');
    assert.ok(withHandoff.handoff_block!.handoff_markdown.includes('### 核心交接摘要'));
  });

  test('3. Fork Stream Inherits Parent Handoff Context', () => {
    const storeFile = path.join(runtimeRoot, 'workstreams.jsonl');
    const store = new WorkstreamStore(storeFile);
    const parent = store.create({ title: 'Main Stream' });
    store.update(parent.stream_id, {
      handoff_block: {
        decisions_made: ['Decision 1'],
        files_touched: ['src/a.ts'],
        next_actions: ['Next 1'],
        handoff_markdown: 'Parent handoff notes',
      },
    });

    // 从父流派生分支流
    const child = store.fork(parent.stream_id, { title: 'Child Feature Branch' });
    assert.strictEqual(child.title, 'Child Feature Branch');
    assert.strictEqual(child.parent_stream_id, parent.stream_id);
    assert.strictEqual(child.status, 'ACTIVE');
    assert.ok(child.handoff_block !== null);
    assert.strictEqual(child.handoff_block!.decisions_made[0], 'Decision 1');
    assert.strictEqual(child.handoff_block!.handoff_markdown, 'Parent handoff notes');
  });

  test('4. Server REST Endpoints with Caller Auth & Lifecycle Flows', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot,
      runId: 'test-workstream-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/streams 创建流（无 token 401 拦截）
    const unauthedPost = await fetch(base + '/api/streams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'REST Stream' }),
    });
    assert.strictEqual(unauthedPost.status, 401);

    // 2. 带 token 创建流 201
    const createRes = await fetch(base + '/api/streams', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ title: 'REST Stream', description: 'Created via API' }),
    });
    assert.strictEqual(createRes.status, 201);
    const createdData = (await createRes.json()) as { ok: boolean; stream: { stream_id: string; title: string; status: string } };
    assert.strictEqual(createdData.ok, true);
    assert.strictEqual(createdData.stream.title, 'REST Stream');
    assert.strictEqual(createdData.stream.status, 'ACTIVE');

    const streamId = createdData.stream.stream_id;

    // 3. GET /api/streams 列表查询
    const listRes = await fetch(base + '/api/streams');
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; managed_streams: Array<{ stream_id: string }> };
    assert.ok(listData.managed_streams.some((s) => s.stream_id === streamId));

    // 4. PATCH /api/streams/:id 更新交接与状态
    const patchRes = await fetch(base + '/api/streams/' + streamId, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        status: 'PAUSED',
        handoff_block: {
          decisions_made: ['REST decision'],
          files_touched: ['src/rest.ts'],
          next_actions: ['REST test'],
          handoff_markdown: 'REST markdown',
        },
      }),
    });
    assert.strictEqual(patchRes.status, 200);
    const patchedData = (await patchRes.json()) as { ok: boolean; stream: { status: string; handoff_block: { decisions_made: string[] } } };
    assert.strictEqual(patchedData.stream.status, 'PAUSED');
    assert.strictEqual(patchedData.stream.handoff_block.decisions_made[0], 'REST decision');

    // 5. POST /api/streams/:id/fork 分支派生
    const forkRes = await fetch(base + '/api/streams/' + streamId + '/fork', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ title: 'Forked REST Stream' }),
    });
    assert.strictEqual(forkRes.status, 201);
    const forkedData = (await forkRes.json()) as { ok: boolean; stream: { stream_id: string; parent_stream_id: string; handoff_block: { decisions_made: string[] } } };
    assert.strictEqual(forkedData.stream.parent_stream_id, streamId);
    assert.strictEqual(forkedData.stream.handoff_block.decisions_made[0], 'REST decision');
  });
});
