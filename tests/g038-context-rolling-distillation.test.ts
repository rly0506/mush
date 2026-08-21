/**
 * GOAL-038: 多轮长上下文滚动蒸馏与记忆持久化测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateContextPressure,
  distillTranscript,
  saveMemory,
  loadMemory,
  listMemories,
} from '../src/orchestration/distiller.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-038: Context Pressure & Rolling Distillation', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g038-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Context Pressure Evaluation (70%/85%/95% thresholds)', () => {
    const normal = evaluateContextPressure(50000, 200000);
    assert.strictEqual(normal.usage_pct, 25);
    assert.strictEqual(normal.alert_level, 'normal');

    const warning = evaluateContextPressure(145000, 200000);
    assert.strictEqual(warning.usage_pct, 73);
    assert.strictEqual(warning.alert_level, 'warning');

    const critical = evaluateContextPressure(175000, 200000);
    assert.strictEqual(critical.usage_pct, 88);
    assert.strictEqual(critical.alert_level, 'critical');

    const overflow = evaluateContextPressure(195000, 200000);
    assert.strictEqual(overflow.usage_pct, 98);
    assert.strictEqual(overflow.alert_level, 'overflow');
  });

  test('2. Multi-turn Distillation & Memory Persistence', () => {
    const messages = [
      { sender: 'human', content: '我们决定采用 TypeScript 开发，必须遵守 Windows 转义铁律。' },
      { sender: 'dog', content: '好的，我已经修改了 src/web/server.ts 和 src/orchestration/distiller.ts。' },
      { sender: 'human', content: '严禁越权修改 CONSTITUTION.md，下一步编写自动化测试。' },
    ];

    const memory = distillTranscript('sess-test-88', messages);
    assert.strictEqual(memory.session_id, 'sess-test-88');
    assert.ok(memory.decisions.length >= 1);
    assert.ok(memory.constraints.length >= 1);
    assert.ok(memory.files_touched.includes('src/web/server.ts'));
    assert.ok(memory.pending_actions.length >= 1);
    assert.ok(memory.summary_markdown.includes('敲定决策'));

    // 持久化与加载
    saveMemory(tmpDir, memory);
    const loaded = loadMemory(tmpDir, 'sess-test-88');
    assert.ok(loaded);
    assert.strictEqual(loaded.session_id, 'sess-test-88');
    assert.strictEqual(loaded.files_touched.length, memory.files_touched.length);

    const list = listMemories(tmpDir);
    assert.strictEqual(list.length, 1);
  });

  test('3. Server Endpoints: GET /api/context/pressure, GET/POST /api/memory/distill', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-distill-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/context/pressure
    const pressureRes = await fetch(`${base}/api/context/pressure?current=150000&max=200000`);
    assert.strictEqual(pressureRes.status, 200);
    const pressureData = (await pressureRes.json()) as { ok: boolean; alert_level: string };
    assert.strictEqual(pressureData.ok, true);
    assert.strictEqual(pressureData.alert_level, 'warning');

    // 2. POST /api/memory/distill
    const distillRes = await fetch(`${base}/api/memory/distill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: 'sess-live-101',
        messages: [{ sender: 'human', content: '我们决定敲定接口契约 v1.21' }],
      }),
    });
    assert.strictEqual(distillRes.status, 201);
    const distillData = (await distillRes.json()) as { ok: boolean; memory: { session_id: string } };
    assert.strictEqual(distillData.ok, true);
    assert.strictEqual(distillData.memory.session_id, 'sess-live-101');

    // 3. GET /api/memory/sess-live-101
    const getRes = await fetch(`${base}/api/memory/sess-live-101`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; memory: { decisions: string[] } };
    assert.strictEqual(getData.ok, true);
    assert.ok(getData.memory.decisions.length >= 1);

    // 4. GET /api/memories
    const listRes = await fetch(`${base}/api/memories`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; memories: unknown[] };
    assert.strictEqual(listData.memories.length, 1);
  });
});
