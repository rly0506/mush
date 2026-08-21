/**
 * GOAL-040: 跨 Harness 影子分流评测台测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createShadowEvaluation,
  generateShadowReport,
  saveShadowEvaluation,
  loadShadowEvaluation,
  listShadowEvaluations,
} from '../src/orchestration/shadow-split.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-040: Shadow Split Evaluation Bench', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g040-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Shadow Evaluation Data Model & Cross-comparison Report', () => {
    const evalRec = createShadowEvaluation('编写快速排序函数', ['claude-code', 'agy']);
    assert.strictEqual(evalRec.candidates.length, 2);
    assert.ok(evalRec.prompt_sha256.length > 0);

    // 填充两只犬的模拟执行结果
    evalRec.candidates[0].status = 'PASS';
    evalRec.candidates[0].duration_ms = 4500;
    evalRec.candidates[0].tokens = { input: 100, output: 250 };

    evalRec.candidates[1].status = 'PASS';
    evalRec.candidates[1].duration_ms = 3200;
    evalRec.candidates[1].tokens = { input: 100, output: 220 };

    const report = generateShadowReport(evalRec);
    assert.strictEqual(report.fastest_adapter, 'agy');
    assert.strictEqual(report.most_efficient_adapter, 'agy');
    assert.ok(report.consensus_summary.includes('2 只犬'));

    // 持久化与加载
    saveShadowEvaluation(tmpDir, evalRec);
    const loaded = loadShadowEvaluation(tmpDir, evalRec.eval_id);
    assert.ok(loaded);
    assert.strictEqual(loaded.eval_id, evalRec.eval_id);
    assert.strictEqual(loaded.report?.fastest_adapter, 'agy');

    const all = listShadowEvaluations(tmpDir);
    assert.strictEqual(all.length, 1);
  });

  test('2. Server Endpoints: GET/POST /api/evaluations', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-eval-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/evaluations
    const createRes = await fetch(`${base}/api/evaluations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '测试异步流式打字机效果',
        adapters: ['claude-code', 'deepseek-code'],
        candidates: [
          {
            adapter_id: 'claude-code',
            dispatch_id: 'disp-c1',
            status: 'PASS',
            duration_ms: 5000,
            tokens: { input: 200, output: 400 },
          },
          {
            adapter_id: 'deepseek-code',
            dispatch_id: 'disp-d1',
            status: 'PASS',
            duration_ms: 3000,
            tokens: { input: 200, output: 350 },
          },
        ],
      }),
    });

    assert.strictEqual(createRes.status, 201);
    const createData = (await createRes.json()) as { ok: boolean; evaluation: { eval_id: string; report?: { fastest_adapter: string } } };
    assert.strictEqual(createData.ok, true);
    assert.strictEqual(createData.evaluation.report?.fastest_adapter, 'deepseek-code');

    const evalId = createData.evaluation.eval_id;

    // 2. GET /api/evaluations/:id
    const getRes = await fetch(`${base}/api/evaluations/${evalId}`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; evaluation: { eval_id: string } };
    assert.strictEqual(getData.ok, true);
    assert.strictEqual(getData.evaluation.eval_id, evalId);

    // 3. GET /api/evaluations
    const listRes = await fetch(`${base}/api/evaluations`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; evaluations: unknown[] };
    assert.strictEqual(listData.evaluations.length, 1);
  });
});
