import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTokenTelemetry } from '../src/adapters/t1-runner.ts';
import { calculateTokenCostAndSavings, DEFAULT_PRICING_MATRIX } from '../src/core/budget.ts';

describe('GOAL-056: 派发回执零开销真实用量对账与 Prompt Cache 细分计量', () => {
  it('1. parseTokenTelemetry 正确解析 Claude JSON 格式 usage 并计算 Prompt Cache 折扣', () => {
    const stdout = JSON.stringify({
      type: 'result',
      usage: {
        input_tokens: 1500,
        output_tokens: 600,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 20000,
      }
    });
    const telemetry = parseTokenTelemetry(stdout, '', 'claude-3-5-sonnet');
    assert.ok(telemetry !== undefined, 'telemetry should be parsed');
    assert.equal(telemetry.input_tokens, 1500);
    assert.equal(telemetry.output_tokens, 600);
    assert.equal(telemetry.cache_creation_tokens, 5000);
    assert.equal(telemetry.cache_read_tokens, 20000);

    // 验证费率折算与节省额计算
    // Claude 3.5 Sonnet: input $3/M, output $15/M, cache_read $0.30/M, cache_creation $3.75/M
    // 实际费用: (1500*3 + 5000*3.75 + 20000*0.30 + 600*15) / 1M = (4500 + 18750 + 6000 + 9000) / 1M = 38250 / 1M = 0.03825 USD
    assert.equal(telemetry.total_cost_usd, 0.03825);
    // 名义无缓存费用: ((1500 + 5000 + 20000)*3 + 600*15) / 1M = (79500 + 9000) / 1M = 0.0885 USD
    // 节省金额: 0.0885 - 0.03825 = 0.05025 USD
    assert.equal(telemetry.cache_savings_usd, 0.05025);
  });

  it('2. parseTokenTelemetry 支持 DeepSeek API 与通用文本用量回执', () => {
    const stdout = 'Task completed successfully.\nTokens: 2500 input, 800 output, 15000 cached';
    const telemetry = parseTokenTelemetry(stdout, '', 'deepseek-chat');
    assert.ok(telemetry !== undefined);
    assert.equal(telemetry.input_tokens, 2500);
    assert.equal(telemetry.output_tokens, 800);
    assert.equal(telemetry.cache_read_tokens, 15000);
    assert.ok(telemetry.total_cost_usd > 0);
    assert.ok(telemetry.cache_savings_usd > 0);
  });

  it('3. calculateTokenCostAndSavings 兜底与边界保护', () => {
    const res = calculateTokenCostAndSavings({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    });
    assert.equal(res.total_cost_usd, 0);
    assert.equal(res.cache_savings_usd, 0);
  });
});
