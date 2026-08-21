import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelThinkingSpec } from '../src/adapters/live-probe.ts';

test('GOAL-059: Dynamic Thinking Capability Spec Engine', () => {
  // Claude 3.7 / Thinking models
  const claudeSpec = getModelThinkingSpec('claude-3-7-sonnet-thinking');
  assert.strictEqual(claudeSpec.type, 'categorical');
  assert.ok(claudeSpec.options && claudeSpec.options.length >= 5, 'Claude thinking supports 5 tiers');

  // GPT-5 / o1 / o3 models
  const gptSpec = getModelThinkingSpec('gpt-5.6-codex');
  assert.strictEqual(gptSpec.type, 'categorical');
  assert.ok(gptSpec.options && gptSpec.options.length >= 5, 'GPT-5 supports 5 tiers');

  // DeepSeek R1 models
  const r1Spec = getModelThinkingSpec('deepseek-r1');
  assert.strictEqual(r1Spec.type, 'toggle');

  // Standard models
  const baseSpec = getModelThinkingSpec('deepseek-v3');
  assert.strictEqual(baseSpec.type, 'none');
});
