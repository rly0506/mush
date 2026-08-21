/**
 * GOAL-036: Langfuse 式 Trace 步骤树与耗时瀑布测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDispatchTrace,
  addTraceStep,
  recordTokenPoint,
  finishDispatchTrace,
  saveDispatchTrace,
  loadDispatchTrace,
  listDispatchTraces,
} from '../src/orchestration/trace.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-036: Dispatch Trace Waterfall & Step Tree', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g036-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Trace Lifecycle: Create, Steps, Token Points, Save & Load', () => {
    const trace = createDispatchTrace('disp-test-1', 'claude-code');
    assert.strictEqual(trace.dispatch_id, 'disp-test-1');
    assert.strictEqual(trace.adapter_id, 'claude-code');

    // 步骤 1: Carve-out 校验 (0~50ms)
    addTraceStep(trace, {
      step_id: 'step-1',
      name: 'carveout_check',
      status: 'ok',
      start_ms: 0,
      duration_ms: 50,
      summary: 'Carveout whitelist verified',
    });

    // 步骤 2: 模型推理 (50~850ms)
    addTraceStep(trace, {
      step_id: 'step-2',
      name: 'execute',
      status: 'ok',
      start_ms: 50,
      duration_ms: 800,
      summary: 'Execution stream completed',
      detail: 'Generated 45 lines of diff',
    });

    // 记录 Token 曲线
    recordTokenPoint(trace, {
      stage: 'execute_start',
      tokens_in: 1200,
      tokens_out: 0,
      timestamp_utc: new Date().toISOString(),
    });
    recordTokenPoint(trace, {
      stage: 'execute_end',
      tokens_in: 1200,
      tokens_out: 350,
      timestamp_utc: new Date().toISOString(),
    });

    finishDispatchTrace(trace);
    assert.strictEqual(trace.total_duration_ms, 850);
    assert.strictEqual(trace.steps.length, 2);
    assert.strictEqual(trace.token_curve.length, 2);

    // 持久化与反序列化
    saveDispatchTrace(tmpDir, trace);
    const loaded = loadDispatchTrace(tmpDir, 'disp-test-1');
    assert.ok(loaded);
    assert.strictEqual(loaded.dispatch_id, 'disp-test-1');
    assert.strictEqual(loaded.total_duration_ms, 850);
    assert.strictEqual(loaded.steps[1].name, 'execute');

    // 列表查询
    const list = listDispatchTraces(tmpDir);
    assert.strictEqual(list.length, 1);
  });

  test('2. Server Endpoints: GET /api/traces and GET /api/dispatch/:id/trace', async () => {
    // 预埋一条 Trace
    const trace = createDispatchTrace('disp-live-99', 'agy');
    addTraceStep(trace, {
      step_id: 'step-init',
      name: 'prompt_assemble',
      status: 'ok',
      start_ms: 0,
      duration_ms: 120,
    });
    finishDispatchTrace(trace);
    saveDispatchTrace(tmpDir, trace);

    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-trace-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // GET /api/traces
    const tracesRes = await fetch(`${base}/api/traces`);
    assert.strictEqual(tracesRes.status, 200);
    const tracesData = (await tracesRes.json()) as { ok: boolean; traces: Array<{ dispatch_id: string }> };
    assert.strictEqual(tracesData.ok, true);
    assert.strictEqual(tracesData.traces.length, 1);
    assert.strictEqual(tracesData.traces[0].dispatch_id, 'disp-live-99');

    // GET /api/dispatch/disp-live-99/trace
    const singleRes = await fetch(`${base}/api/dispatch/disp-live-99/trace`);
    assert.strictEqual(singleRes.status, 200);
    const singleData = (await singleRes.json()) as { ok: boolean; trace: { total_duration_ms: number } };
    assert.strictEqual(singleData.ok, true);
    assert.strictEqual(singleData.trace.total_duration_ms, 120);

    // GET 未知 trace -> 404
    const unknownRes = await fetch(`${base}/api/dispatch/disp-nonexistent/trace`);
    assert.strictEqual(unknownRes.status, 404);
  });
});
