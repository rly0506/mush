import test from 'node:test';
import assert from 'node:assert/strict';
import { isFreeModel, findPricingRate, calculateUsageCost, getModelContextLimit } from '../src/web/pricing.ts';
import { classifyModelTier } from '../src/adapters/live-probe.ts';
import { buildOpencodeContract } from '../src/adapters/opencode.ts';
import { startBoardServer } from '../src/web/server.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('1. Free tier models correctly identified and billed at 0 USD', () => {
  const freeModels = [
    'opencode/free',
    'openrouter/free',
    'qwen-2.5-coder-32b:free',
    'deepseek-r1:free',
    'glm-4-flash:free',
    'gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'ollama/qwen2.5-coder',
    'local/deepseek-r1-7b',
  ];

  for (const m of freeModels) {
    assert.equal(isFreeModel(m), true, `${m} should be recognized as a free model`);
    const rate = findPricingRate(m);
    assert.equal(rate.inputPerMillion, 0);
    assert.equal(rate.outputPerMillion, 0);
    assert.equal(rate.cacheReadPerMillion, 0);
    assert.equal(calculateUsageCost(m, { inputTokens: 50000, outputTokens: 20000, cacheReadTokens: 10000 }), 0);
  }

  // Non-free model should have non-zero cost
  assert.equal(isFreeModel('claude-sonnet-5'), false);
  assert.ok(calculateUsageCost('claude-sonnet-5', { inputTokens: 1000000, outputTokens: 1000000 }) > 0);
});

test('2. Dynamic context limits map correctly across all model families', () => {
  // Gemini 1M / 2M
  assert.equal(getModelContextLimit('gemini-3.7-flash-high'), 1048576);
  assert.equal(getModelContextLimit('gemini-3.1-pro-high'), 2097152);
  assert.equal(getModelContextLimit('gemini-2.5-pro'), 2097152);

  // Kimi 1M vs 128k
  assert.equal(getModelContextLimit('kimi-k3'), 1000000);
  assert.equal(getModelContextLimit('tbtk-kimi-k3'), 1000000);
  assert.equal(getModelContextLimit('kimi-k1.5'), 128000);

  // Grok 500k
  assert.equal(getModelContextLimit('grok-4.6'), 500000);
  assert.equal(getModelContextLimit('grok-4.5'), 500000);

  // Claude 200k
  assert.equal(getModelContextLimit('claude-sonnet-5'), 200000);
  assert.equal(getModelContextLimit('claude-opus-5'), 200000);
  assert.equal(getModelContextLimit('claude-3-7-sonnet'), 200000);

  // DeepSeek 128k
  assert.equal(getModelContextLimit('deepseek-v4-pro'), 131072);
  assert.equal(getModelContextLimit('deepseek-chat'), 131072);

  // GPT-5.6 / o3 200k vs GPT-4.5 128k
  assert.equal(getModelContextLimit('gpt-5.6-sol'), 200000);
  assert.equal(getModelContextLimit('o3-mini'), 200000);
  assert.equal(getModelContextLimit('gpt-4.5'), 128000);

  // OpenCode free models
  assert.equal(getModelContextLimit('opencode/free'), 131072);
  assert.equal(getModelContextLimit('openrouter/free'), 131072);
});

test('3. OpenCode free tier models are classified as T2/T3 and never T0_BLOCKED', () => {
  const contract = buildOpencodeContract();
  const tierFree = classifyModelTier(contract, 'opencode/free');
  assert.notEqual(tierFree, 'T0_BLOCKED');
  assert.ok(tierFree === 'T2_CONFIGURED' || tierFree === 'T3_CATALOG');

  const tierQwenFree = classifyModelTier(contract, 'qwen-2.5-coder-32b:free');
  assert.notEqual(tierQwenFree, 'T0_BLOCKED');
});

test('4. GET /api/chat/context-gauge returns dynamic max context, token breakdown, cache ratio and cost', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'mush-g067-test-'));
  const approvalRoot = path.join(tempDir, 'approvals');
  const runtimeRoot = path.join(tempDir, 'runtime');

  const server = await startBoardServer({
    approvalRoot,
    runId: 'test-g067',
    assignmentEpoch: 1,
    port: 0,
    runtimeRoot,
  });

  try {
    // 1. Query for Gemini (1M context)
    const geminiRes = await fetch(`http://127.0.0.1:${server.port}/api/chat/context-gauge?model=gemini-3.7-flash-high`);
    assert.equal(geminiRes.status, 200);
    const geminiData = (await geminiRes.json()) as any;
    assert.equal(geminiData.ok, true);
    assert.equal(geminiData.gauge.max_context_tokens, 1048576);
    assert.equal(typeof geminiData.gauge.input_tokens, 'number');
    assert.equal(typeof geminiData.gauge.output_tokens, 'number');
    assert.equal(typeof geminiData.gauge.cache_hit_ratio, 'number');
    assert.equal(typeof geminiData.gauge.cost_usd, 'number');
    assert.equal(geminiData.gauge.is_free, false);

    // 2. Query for Free Model (opencode/free -> 0 USD cost, is_free: true)
    const freeRes = await fetch(`http://127.0.0.1:${server.port}/api/chat/context-gauge?model=opencode/free`);
    assert.equal(freeRes.status, 200);
    const freeData = (await freeRes.json()) as any;
    assert.equal(freeData.ok, true);
    assert.equal(freeData.gauge.is_free, true);
    assert.equal(freeData.gauge.cost_usd, 0);

    // 3. Query for Claude (200k context)
    const claudeRes = await fetch(`http://127.0.0.1:${server.port}/api/chat/context-gauge?model=claude-sonnet-5`);
    assert.equal(claudeRes.status, 200);
    const claudeData = (await claudeRes.json()) as any;
    assert.equal(claudeData.ok, true);
    assert.equal(claudeData.gauge.max_context_tokens, 200000);

    // 4. Query for DeepSeek (128k context)
    const dsRes = await fetch(`http://127.0.0.1:${server.port}/api/chat/context-gauge?model=deepseek-v4-pro`);
    assert.equal(dsRes.status, 200);
    const dsData = (await dsRes.json()) as any;
    assert.equal(dsData.ok, true);
    assert.equal(dsData.gauge.max_context_tokens, 131072);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
