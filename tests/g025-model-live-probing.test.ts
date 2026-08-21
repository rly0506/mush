import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  probeAdapterLive,
  loadLiveProbeCache,
  saveLiveProbeCache,
  type LiveProbeRecord,
} from '../src/adapters/live-probe.ts';
import { buildAgyContract } from '../src/adapters/agy.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { renderBoardPage } from '../src/web/page.ts';
import { startBoardServer } from '../src/web/server.ts';

test('GOAL-025 Unit: probeAdapterLive 识别 agy 模型变体与额度告警', async () => {
  const agyContract = buildAgyContract();

  // 1. 成功探测返回 live_models
  const probeSuccess = await probeAdapterLive(
    agyContract,
    async (_cmd, _args) => ({
      exitCode: 0,
      stdout: 'gemini-3.7-flash-high\nclaude-sonnet-4-6\n',
      stderr: '',
    }),
  );
  assert.equal(probeSuccess.status, 'ONLINE');
  assert.ok(probeSuccess.live_models.includes('gemini-3.7-flash-high'));
  assert.ok(probeSuccess.live_models.includes('claude-sonnet-4-6'));

  // 2. 额度耗尽识别
  const probeQuota = await probeAdapterLive(
    agyContract,
    async (_cmd, _args) => ({
      exitCode: 1,
      stdout: '',
      stderr: 'error: rate limit quota exceeded 429',
    }),
  );
  assert.equal(probeQuota.status, 'QUOTA_EXHAUSTED');
});

test('GOAL-025 Unit: LiveProbeCache 缓存文件读写隔离', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-probe-cache-test-'));
  const cachePath = path.join(tmpDir, 'runtime', 'live-probes.json');

  try {
    const mockRecord: LiveProbeRecord = {
      adapter_id: 'agy',
      status: 'ONLINE',
      live_models: ['gemini-3.7-flash-high'],
      checked_at_utc: '2026-08-18T16:00:00.000Z',
    };
    saveLiveProbeCache(cachePath, { agy: mockRecord });
    const loaded = loadLiveProbeCache(cachePath);
    assert.deepEqual(loaded.agy, mockRecord);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-025 Pipeline: probeLiveModels 探测与名册真实回填', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-probe-pipeline-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const approvalRoot = path.join(tmpDir, 'approvals');
  const ledgerPath = path.join(tmpDir, 'budget-ledger.jsonl');

  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
    runAdapter: async (contract, prompt) => {
      return { exitCode: 0, stdout: 'mock live probe output', stderr: '', timedOut: false, childKilled: false };
    },
  });

  try {
    // 1. 执行 live probe
    const probes = await pipeline.probeLiveModels('agy');
    assert.ok(probes.agy);
    assert.equal(probes.agy.status, 'ONLINE');

    // 2. 验证 roster 回填
    const roster = pipeline.roster();
    const agyRoster = roster.find((r) => r.adapter_id === 'agy');
    assert.ok(agyRoster);
    assert.equal(agyRoster.probe_status, 'ONLINE');
    assert.ok(Array.isArray(agyRoster.live_models));
    assert.ok((agyRoster.live_models?.length ?? 0) > 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-025 Server & Frontend: /api/models/probe 接口与前端实测交互断言', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-probe-server-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const approvalRoot = path.join(tmpDir, 'approvals');
  const ledgerPath = path.join(tmpDir, 'budget-ledger.jsonl');

  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
  });

  const server = await startBoardServer({
    runId: 'g025-test',
    assignmentEpoch: 1,
    approvalRoot,
    workspaceRoot,
    dispatch: pipeline,
    runtimeRoot: path.join(workspaceRoot, 'runtime'),
    port: 0,
  });

  try {
    const port = server.port;
    assert.ok(port > 0);

    // 1. 测试 GET /api/models/probe
    const getRes = await fetch(`http://127.0.0.1:${port}/api/models/probe`);
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; probes: unknown };
    assert.equal(getData.ok, true);
    assert.ok(getData.probes);

    // 2. 测试 POST /api/models/probe
    const postRes = await fetch(`http://127.0.0.1:${port}/api/models/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter_id: 'agy' }),
    });
    assert.equal(postRes.status, 200);
    const postData = (await postRes.json()) as { ok: boolean; probes: unknown };
    assert.equal(postData.ok, true);

    // 3. 测试前端 DOM 结构断言
    const html = renderBoardPage({
      actors: [],
      epochs: [],
      approvals: [],
    });
    assert.match(html, /id="btn-models-probe"/);
    assert.match(html, /id="chat-probe-btn"/);
    assert.match(html, /id="dispatch-probe-btn"/);
    assert.match(html, /id="rail-probe-all"/);
    assert.match(html, /data-rail-probe=/);
    assert.match(html, /🔍 实测探测/);
    assert.match(html, /function triggerLiveProbe\(/);
    assert.match(html, /data-live-models=/);
    assert.match(html, /🟢 \[实测/);
  } finally {
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

