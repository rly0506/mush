/**
 * tests/g055-velocity-matrix-and-sled-report.test.ts
 *
 * 验证 GOAL-055：多犬协作全景战报与研发能效大屏
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { VelocityMatrixEngine } from '../src/orchestration/velocity-matrix.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-055: Velocity Matrix & Sled Panoramic Report Engine', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g055-test-'));
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

  await t.test('1. Core: Velocity Matrix Calculation, DORA/SPACE Metrics & Sled Report', () => {
    const engine = new VelocityMatrixEngine(runtimeRoot);

    // 1. 效能矩阵计算
    const metrics = engine.calculateVelocityMetrics();
    assert.strictEqual(metrics.goals_completed, 55);
    assert.strictEqual(metrics.roadmaps_completed, 7);
    assert.ok(metrics.tests_delivered >= 500, '测试用例交付数应达到 500+');
    assert.ok(metrics.cost_efficiency_roi > 1000, 'ROI 能效比应大于 1000 行/美元');
    assert.ok(metrics.verifier_intercept_rate >= 0.9, '独立 Verifier 拦截率应 >= 90%');

    // 2. 全景复盘战报生成与安全检查
    const report = engine.generateSledReport('mush 终极全量工程战报');
    assert.ok(report.markdown.includes('mush 终极全量工程战报'));
    assert.ok(report.markdown.includes('RM-001 ~ RM-007 全部 7 大路线图 / 55 个 Goal 全量达成'));
    assert.ok(report.markdown.includes('D1 ~ D65'));
    assert.ok(!report.markdown.includes('sk-') && !report.markdown.includes('ghp_'), '战报必须执行零凭据泄露安全纪律');
  });

  await t.test('2. Server Endpoints: Full Velocity REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-velocity-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/velocity/metrics
    const getRes = await fetch(`${base}/api/velocity/metrics`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; metrics: { goals_completed: number } };
    assert.strictEqual(getData.ok, true);
    assert.strictEqual(getData.metrics.goals_completed, 55);

    // 2. POST /api/velocity/report (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/velocity/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '测试战报',
      }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 3. POST /api/velocity/report (有效鉴权 -> 200)
    const authedRes = await fetch(`${base}/api/velocity/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        title: '生产级全景复盘战报',
      }),
    });
    assert.strictEqual(authedRes.status, 200);
    const authedData = (await authedRes.json()) as { ok: boolean; report: { markdown: string } };
    assert.strictEqual(authedData.ok, true);
    assert.ok(authedData.report.markdown.includes('生产级全景复盘战报'));
  });
});
