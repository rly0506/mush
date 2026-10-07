/**
 * GOAL-026 (GP-37): 零 Token 消耗模型探测与四级可调度信度梯队测试套件。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyModelTier,
  recordModelReceipt,
  loadLiveProbeCache,
  probeAdapterLive,
  type LiveProbeRecord,
} from '../src/adapters/live-probe.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { buildKimiContract } from '../src/adapters/kimi.ts';
import { buildDeepSeekContract } from '../src/adapters/deepseek.ts';
import { buildAgyContract } from '../src/adapters/agy.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { renderBoardPage } from '../src/web/page.ts';
import { installModelsFixture } from './fixtures/opencode.ts';

test('GOAL-026: classifyModelTier assigns correct 4 tiers based on ground truth and flags', () => {
  const claude = buildClaudeContract('claude-sonnet-5');
  const kimi = buildKimiContract();
  const now = () => new Date('2026-08-19T00:00:00Z');

  // 1. T1: 24h 内有真实验证记录
  const verifiedModels = {
    'claude-sonnet-4-6': {
      last_verified_at_utc: '2026-08-18T23:00:00Z',
      source: 'dispatch' as const,
      actual_model: 'claude-sonnet-4-6',
    },
    'old-model': {
      last_verified_at_utc: '2026-08-10T00:00:00Z', // 过期 (>24h)
      source: 'dispatch' as const,
    },
  };

  assert.equal(classifyModelTier(claude, 'claude-sonnet-4-6', verifiedModels, now), 'T1_VERIFIED');

  // 2. T2: 默认配置模型
  assert.equal(classifyModelTier(claude, 'claude-sonnet-5', undefined, now), 'T2_CONFIGURED');
  assert.equal(classifyModelTier(kimi, 'tbtk-kimi-k3', undefined, now), 'T2_CONFIGURED');

  // 3. T0: 缺少 CLI 旗标通道的非默认模型（如 kimi 选第三方变体）
  assert.equal(classifyModelTier(kimi, 'some-unsupported-variant', undefined, now), 'T0_BLOCKED');

  // 4. T3: 具备 CLI 旗标切换通道的公共目录候选
  assert.equal(classifyModelTier(claude, 'claude-opus-4-8', undefined, now), 'T3_CATALOG');
});

test('GOAL-026: recordModelReceipt promotes model on dispatch PASS and blocks on 429 quota error', () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-receipt-test-'));
  const cachePath = path.join(tmpDir, 'live-probes.json');

  try {
    // 1. 初始记录 PASS
    recordModelReceipt(cachePath, 'codex', 'gpt-5.6-sol', true, undefined, () => new Date('2026-08-19T00:00:00Z'));
    let cache = loadLiveProbeCache(cachePath);
    assert.equal(cache.codex?.status, 'ONLINE');
    assert.equal(cache.codex?.actual_model_id, 'gpt-5.6-sol');
    assert.equal(cache.codex?.model_tiers?.['gpt-5.6-sol'], 'T1_VERIFIED');
    assert.ok(cache.codex?.verified_models?.['gpt-5.6-sol']);

    // 2. 模拟 429 错误
    recordModelReceipt(cachePath, 'codex', 'gpt-5.6-luna', false, '429 Quota Exceeded for gpt-5.6-luna', () => new Date('2026-08-19T00:05:00Z'));
    cache = loadLiveProbeCache(cachePath);
    assert.equal(cache.codex?.status, 'QUOTA_EXHAUSTED');
    assert.equal(cache.codex?.model_tiers?.['gpt-5.6-luna'], 'T0_BLOCKED');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-026: DispatchPipeline integrates 4-tier model dispatchability into roster and auto-promotes on PASS', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-dispatch-tier-test-'));
  const approvalRoot = path.join(tmpDir, 'approvals');
  const ledgerPath = path.join(tmpDir, 'dispatch-ledger.jsonl');
  const cachePath = path.join(tmpDir, 'live-probes.json');

  try {
    const pipeline = new DispatchPipeline({
      workspaceRoot: tmpDir,
      approvalRoot,
      ledgerPath,
      liveProbesPath: cachePath,
      now: () => new Date('2026-08-19T00:00:00Z'),
      runAdapter: async (contract, prompt) => {
        return { exitCode: 0, stdout: 'mock dispatch success', stderr: '', timedOut: false, childKilled: false };
      },
    });

    installModelsFixture(t, tmpDir);
    await pipeline.probeLiveModels();
    const roster = pipeline.roster();
    const kimi = roster.find((r) => r.adapter_id === 'kimi-code');
    assert.ok(kimi);
    assert.equal(kimi.supports_model_flag, false);
    assert.ok(kimi.model_tiers);
    assert.equal(kimi.model_tiers['tbtk-kimi-k3'], 'T2_CONFIGURED');

    const agy = roster.find((r) => r.adapter_id === 'agy');
    assert.ok(agy);
    assert.equal(agy.supports_model_flag, true);
    assert.ok(agy.model_tiers);

    // 模拟一次 dispatch 成功执行（默认模型 fake-model 自动回填与晋升）
    await pipeline.dispatch({
      adapter_id: 'fake-t1',
      prompt: 'test goal dispatch',
      real: false,
    });

    // 验证 fake-t1 晋升
    const cache = loadLiveProbeCache(cachePath);
    assert.equal(cache['fake-t1']?.actual_model_id, 'fake-model');
    assert.equal(cache['fake-t1']?.model_tiers?.['fake-model'], 'T1_VERIFIED');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-026: Board page JS includes 4-tier badges and channel guard protection', () => {
  const html = renderBoardPage();

  assert.match(html, /🟢 \[实测通过\]/);
  assert.match(html, /🟡 \[配置就绪\]/);
  assert.match(html, /🔴 \[受阻\/无通道\]/);
  assert.match(html, /⚪ \[目录声明\]/);
  assert.match(html, /data-model-tiers/);
  assert.match(html, /该犬不支持命令行传参切换模型/);
});
