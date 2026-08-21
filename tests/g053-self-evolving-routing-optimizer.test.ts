/**
 * tests/g053-self-evolving-routing-optimizer.test.ts
 *
 * 验证 GOAL-053：战绩反馈闭环与自适应路由权重自进化
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SelfEvolvingRoutingOptimizer } from '../src/orchestration/route-optimizer.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-053: Self-Evolving Routing Optimizer', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g053-test-'));
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

  await t.test('1. Core: Online Gradient Weight Evolution, Anti-Overfitting & Budget Pareto Selection', () => {
    const optimizer = new SelfEvolvingRoutingOptimizer(runtimeRoot);

    const initialWeights = optimizer.getDomainWeights('refactoring');
    const initClaudeWeight = initialWeights['claude-code'];

    // 1. 注入多次 claude-code 在重构领域的正面实战反馈
    for (let i = 0; i < 5; i++) {
      optimizer.recordFeedback({
        task_id: `task-rf-${i}`,
        domain: 'refactoring',
        adapter_id: 'claude-code',
        human_accepted: true,
        test_passed: true,
        cost_usd: 0.03,
      });
    }

    const evolvedWeights = optimizer.getDomainWeights('refactoring');
    assert.ok(evolvedWeights['claude-code'] > initClaudeWeight, 'claude-code 权重应当在连续正面反馈后上升');

    // 2. 注入多次 agy 负面反馈，验证防过拟合保底 (>= 0.02)
    for (let i = 0; i < 10; i++) {
      optimizer.recordFeedback({
        task_id: `task-rf-fail-${i}`,
        domain: 'refactoring',
        adapter_id: 'agy',
        human_accepted: false,
        test_passed: false,
        cost_usd: 0.04,
      });
    }

    const weightsAfterFail = optimizer.getDomainWeights('refactoring');
    assert.ok(weightsAfterFail.agy >= 0.02, '即使遭遇多次失败，权重仍应保持 >= 0.02 防永久冰封');

    // 3. 帕累托预算求解推荐
    // 无限制情况下推荐权重最高者
    const freeRec = optimizer.recommendBestDog('refactoring');
    assert.ok(freeRec.adapter_id);

    // 极严苛预算限制 (cap_usd: 0.008) -> 应当自动过滤昂贵模型，推荐高性价比模型 (如 deepseek-code 或 kimi-code)
    const cheapRec = optimizer.recommendBestDog('refactoring', 0.008);
    assert.ok(['deepseek-code', 'kimi-code'].includes(cheapRec.adapter_id));
    assert.ok(cheapRec.estimated_cost_usd <= 0.008);
  });

  await t.test('2. Server Endpoints: Full Routing REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-routing-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/routing/weights
    const getRes = await fetch(`${base}/api/routing/weights`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; weights: { refactoring: Record<string, number> } };
    assert.strictEqual(getData.ok, true);
    assert.ok(getData.weights.refactoring);

    // 2. GET /api/routing/recommend
    const recRes = await fetch(`${base}/api/routing/recommend?domain=audit&cap_usd=0.02`);
    assert.strictEqual(recRes.status, 200);
    const recData = (await recRes.json()) as { ok: boolean; recommendation: { adapter_id: string } };
    assert.strictEqual(recData.ok, true);
    assert.ok(recData.recommendation.adapter_id);

    // 3. POST /api/routing/feedback (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/routing/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task_id: 'task-rest-fb-01',
        domain: 'debug',
        adapter_id: 'deepseek-code',
        human_accepted: true,
        test_passed: true,
      }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 4. POST /api/routing/feedback (有效鉴权 -> 200)
    const fbRes = await fetch(`${base}/api/routing/feedback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        task_id: 'task-rest-fb-01',
        domain: 'debug',
        adapter_id: 'deepseek-code',
        human_accepted: true,
        test_passed: true,
        cost_usd: 0.005,
      }),
    });
    assert.strictEqual(fbRes.status, 200);
    const fbData = (await fbRes.json()) as { ok: boolean; feedback: { adapter_id: string } };
    assert.strictEqual(fbData.ok, true);
    assert.strictEqual(fbData.feedback.adapter_id, 'deepseek-code');
  });
});
