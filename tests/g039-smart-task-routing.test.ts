/**
 * GOAL-039: 异构犬能力感知智能路由测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyTaskPrompt,
  recommendDogs,
  DEFAULT_DOG_PROFILES,
} from '../src/orchestration/router.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-039: Smart Task Routing & Dog Profiling', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g039-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Task Dimension Classification & Complexity Estimation', () => {
    // 编码任务
    const codingTask = classifyTaskPrompt('请实现一个完整的用户认证模块', ['src/auth.ts']);
    assert.strictEqual(codingTask.primary_dimension, 'coding');
    assert.ok(codingTask.dimensions.coding > 0.5);

    // 文档任务
    const docTask = classifyTaskPrompt('请撰写系统部署指南和 API 使用说明', ['docs/guide.md']);
    assert.strictEqual(docTask.primary_dimension, 'docs');

    // 审查审计任务
    const reviewTask = classifyTaskPrompt('审查最新合并的代码是否存在安全漏洞', []);
    assert.strictEqual(reviewTask.primary_dimension, 'review');

    // 测试任务
    const testTask = classifyTaskPrompt('编写单元测试覆盖率达标验证 spec', ['tests/auth.test.ts']);
    assert.strictEqual(testTask.primary_dimension, 'test');
  });

  test('2. Dog Recommendation & T0 Exclusion Guard', () => {
    const profile = classifyTaskPrompt('重构系统架构，实现高并发流水线调度');
    const recommendations = recommendDogs(profile, DEFAULT_DOG_PROFILES);

    assert.ok(recommendations.length > 0);

    // 确保 T0 (受阻犬 codex) 被坚决排除
    const codexInRecs = recommendations.find((r) => r.adapter_id === 'codex');
    assert.strictEqual(codexInRecs, undefined);

    // T1 旗舰犬应名列前茅
    assert.ok(recommendations[0].score >= 80);
    assert.ok(['claude-code', 'agy'].includes(recommendations[0].adapter_id));
  });

  test('3. Server Endpoint: POST /api/route/recommend', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-router-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    const recRes = await fetch(`${base}/api/route/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '修复前端渲染崩溃并补充单元测试',
        files: ['src/web/page.ts', 'tests/page.test.ts'],
      }),
    });

    assert.strictEqual(recRes.status, 200);
    const recData = (await recRes.json()) as {
      ok: boolean;
      task_profile: { primary_dimension: string };
      recommendations: Array<{ adapter_id: string; score: number }>;
    };

    assert.strictEqual(recData.ok, true);
    assert.ok(recData.recommendations.length >= 3);
    assert.ok(recData.recommendations[0].score > 50);
  });
});
