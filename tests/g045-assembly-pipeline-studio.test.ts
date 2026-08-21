/**
 * tests/g045-assembly-pipeline-studio.test.ts
 *
 * 验证 GOAL-045：SOP 工序流水线与工件自动接力工作台
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PipelineEngine } from '../src/orchestration/pipeline-engine.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-045: Assembly Pipeline Studio', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g045-test-'));
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

  await t.test('1. PipelineEngine Core Lifecycle: 5-Stages, Auto-Handoff Artifacts & Quality Gates', () => {
    const engine = new PipelineEngine(tmpDir);

    // 1. 初始化 5 阶段流水线
    const pipeline = engine.createPipeline({
      taskTitle: '构建高并发会话分发网关',
      workspaceRoot: tmpDir,
      initialPrompt: '实现支持 10k 并发的 SSE 路由分发器，需具备熔断与 backpressure 保护',
      maxBudgetUsd: 3.0,
    });

    assert.ok(pipeline.pipeline_id.startsWith('pipe-'));
    assert.strictEqual(pipeline.status, 'IN_PROGRESS');
    assert.strictEqual(pipeline.stages.length, 5);
    assert.strictEqual(pipeline.current_stage_index, 0);

    // 阶段 1: SPEC (RUNNING)
    const specStage = pipeline.stages[0];
    assert.strictEqual(specStage.type, 'SPEC');
    assert.strictEqual(specStage.status, 'RUNNING');
    assert.strictEqual(specStage.assigned_dog, 'kimi-code');
    assert.ok(specStage.input_artifact.content.includes('10k 并发'));

    // 2. 完成阶段 1: SPEC -> 自动接力至阶段 2: ARCH
    const afterSpec = engine.completeStage(pipeline.pipeline_id, 'stage-spec', {
      summary: 'API 接口契约 v1.0 定稿',
      content: '定义 POST /api/gateway/route 与 GET /api/gateway/stream 契约',
      files: ['src/gateway/contract.ts'],
    });

    assert.strictEqual(afterSpec.stages[0].status, 'COMPLETED');
    assert.strictEqual(afterSpec.current_stage_index, 1);
    const archStage = afterSpec.stages[1];
    assert.strictEqual(archStage.type, 'ARCH');
    assert.strictEqual(archStage.status, 'RUNNING');
    assert.strictEqual(archStage.assigned_dog, 'claude-code');
    assert.ok(archStage.input_artifact.content.includes('POST /api/gateway/route'));

    // 3. 完成阶段 2: ARCH -> 触发门禁拦截 (BLOCKED_GATE)
    const afterArch = engine.completeStage(pipeline.pipeline_id, 'stage-arch', {
      summary: '分层架构拓扑与 AST 依赖图',
      content: '设计 GatewayCore -> ConnectionPool -> SSERenderer 三层单向依赖',
      files: ['src/gateway/core.ts', 'src/gateway/pool.ts'],
    });

    assert.strictEqual(afterArch.stages[1].status, 'BLOCKED_GATE');
    assert.strictEqual(afterArch.status, 'PAUSED');

    // 4. 批准架构门禁 -> 放行至阶段 3: CODE
    const afterArchApprove = engine.approveGate(pipeline.pipeline_id, 'stage-arch', '架构拓扑经评审无环依赖，准予编码');
    assert.strictEqual(afterArchApprove.stages[1].status, 'COMPLETED');
    assert.strictEqual(afterArchApprove.stages[1].gate_passed, true);
    assert.strictEqual(afterArchApprove.current_stage_index, 2);
    const codeStage = afterArchApprove.stages[2];
    assert.strictEqual(codeStage.type, 'CODE');
    assert.strictEqual(codeStage.status, 'RUNNING');
    assert.strictEqual(codeStage.assigned_dog, 'agy');
    assert.ok(codeStage.input_artifact.content.includes('GatewayCore'));

    // 5. 完成阶段 3 (CODE) + 审批放行
    engine.completeStage(pipeline.pipeline_id, 'stage-code', {
      summary: '核心网关与连接池代码实现',
      content: '完成核心代码编写并通过语法检查',
      files: ['src/gateway/core.ts'],
    });
    engine.approveGate(pipeline.pipeline_id, 'stage-code', '代码审查无敏感词与越权漏洞');

    // 6. 完成阶段 4 (TEST) 与 阶段 5 (AUDIT)
    engine.completeStage(pipeline.pipeline_id, 'stage-test', {
      summary: '破坏性并发与断连测试',
      content: '20 组并发压测用例 100% 通过',
      files: ['tests/gateway.test.ts'],
    });

    const finalPipeline = engine.completeStage(pipeline.pipeline_id, 'stage-audit', {
      summary: '头犬安全门禁审计报告',
      content: '所有证据链哈希对齐，审计通过',
      files: ['docs/audit.md'],
    });

    assert.strictEqual(finalPipeline.status, 'COMPLETED');
    assert.strictEqual(finalPipeline.current_stage_index, 5);

    // 7. 重新从磁盘读取验证持久化
    const reloaded = engine.getPipeline(pipeline.pipeline_id);
    assert.strictEqual(reloaded?.pipeline_id, pipeline.pipeline_id);
    assert.strictEqual(reloaded?.status, 'COMPLETED');
  });

  await t.test('2. Server Endpoints: Full Pipeline REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-pipeline-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/pipelines (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/pipelines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_title: '构建缓存持久化模块' }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 2. POST /api/pipelines (有效鉴权 -> 200)
    const createRes = await fetch(`${base}/api/pipelines`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        task_title: '构建缓存持久化模块',
        initial_prompt: '基于 WAL 日志实现轻量内存缓存持久化',
        max_budget_usd: 2.0,
      }),
    });
    assert.strictEqual(createRes.status, 200);
    const createData = (await createRes.json()) as { ok: boolean; pipeline: { pipeline_id: string; task_title: string; stages: unknown[] } };
    assert.strictEqual(createData.ok, true);
    assert.strictEqual(createData.pipeline.task_title, '构建缓存持久化模块');
    const pipelineId = createData.pipeline.pipeline_id;

    // 3. GET /api/pipelines
    const listRes = await fetch(`${base}/api/pipelines`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; pipelines: Array<{ pipeline_id: string }>; total: number };
    assert.strictEqual(listData.ok, true);
    assert.ok(listData.total >= 1);

    // 4. GET /api/pipelines/:id
    const detailRes = await fetch(`${base}/api/pipelines/${pipelineId}`);
    assert.strictEqual(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { ok: boolean; pipeline: { pipeline_id: string; status: string } };
    assert.strictEqual(detailData.pipeline.pipeline_id, pipelineId);
    assert.strictEqual(detailData.pipeline.status, 'IN_PROGRESS');

    // 5. POST /api/pipelines/:id/stage/:stage_id/complete
    const completeRes = await fetch(`${base}/api/pipelines/${pipelineId}/stage/stage-spec/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        summary: '完成缓存模块需求规格设计',
        content: '接口包含 get, set, flush 与 replayWAL',
        cost_usd: 0.15,
      }),
    });
    assert.strictEqual(completeRes.status, 200);
    const completeData = (await completeRes.json()) as { ok: boolean; pipeline: { current_stage_index: number; stages: Array<{ status: string }> } };
    assert.strictEqual(completeData.ok, true);
    assert.strictEqual(completeData.pipeline.current_stage_index, 1);
    assert.strictEqual(completeData.pipeline.stages[0].status, 'COMPLETED');
    assert.strictEqual(completeData.pipeline.stages[1].status, 'RUNNING');

    // 6. POST /api/pipelines/:id/stage/:stage_id/approve (测试架构门禁放行)
    // 先将 stage-arch 标记为 complete 以触发门禁
    await fetch(`${base}/api/pipelines/${pipelineId}/stage/stage-arch/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        summary: '完成 WAL 架构拓扑',
        content: 'WAL 采用 Append-Only 二进制格式',
      }),
    });

    const approveRes = await fetch(`${base}/api/pipelines/${pipelineId}/stage/stage-arch/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ notes: '架构设计符合 Append-Only 宪法纪律，准予推进' }),
    });
    assert.strictEqual(approveRes.status, 200);
    const approveData = (await approveRes.json()) as { ok: boolean; pipeline: { current_stage_index: number; stages: Array<{ status: string }> } };
    assert.strictEqual(approveData.ok, true);
    assert.strictEqual(approveData.pipeline.current_stage_index, 2);
    assert.strictEqual(approveData.pipeline.stages[1].status, 'COMPLETED');
    assert.strictEqual(approveData.pipeline.stages[2].status, 'RUNNING');
  });
});
