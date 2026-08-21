/**
 * mush 定价与计费引擎（GOAL-027 / GP-33）
 *
 * 依据：D32（用量与成本核算）、CONSTITUTION.md §1（花钱与证据纪律）。
 * 零外部依赖、零密钥侵入的大模型 Token 计费与费用核算。
 * 单位：美元 / 100 万 Token (USD per 1M tokens)
 */

export interface ModelPricingRate {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion?: number;
  readonly cacheWritePerMillion?: number;
}

export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricingRate> = {
  // Claude Family
  'claude-sonnet-5': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4-5': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-opus-4-6': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-opus-4-8': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-haiku-4-5': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },

  // DeepSeek Family
  'deepseek-v4-flash': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014, cacheWritePerMillion: 0.14 },
  'deepseek-v4-flash-0731': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014, cacheWritePerMillion: 0.14 },
  'deepseek-v4-pro': { inputPerMillion: 0.27, outputPerMillion: 1.10, cacheReadPerMillion: 0.07, cacheWritePerMillion: 0.27 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014, cacheWritePerMillion: 0.14 },

  // Gemini / AGY Family
  'gemini-3.7-flash-high': { inputPerMillion: 0.10, outputPerMillion: 0.40, cacheReadPerMillion: 0.025, cacheWritePerMillion: 0.10 },
  'gemini-3.7-flash-medium': { inputPerMillion: 0.10, outputPerMillion: 0.40, cacheReadPerMillion: 0.025, cacheWritePerMillion: 0.10 },
  'gemini-3.7-flash-low': { inputPerMillion: 0.10, outputPerMillion: 0.40, cacheReadPerMillion: 0.025, cacheWritePerMillion: 0.10 },
  'gemini-3.1-pro-high': { inputPerMillion: 1.25, outputPerMillion: 5.00, cacheReadPerMillion: 0.30, cacheWritePerMillion: 1.25 },
  'gemini-3.1-pro-low': { inputPerMillion: 1.25, outputPerMillion: 5.00, cacheReadPerMillion: 0.30, cacheWritePerMillion: 1.25 },

  // GPT / Codex Family
  'gpt-5.6-sol': { inputPerMillion: 2.50, outputPerMillion: 10.00, cacheReadPerMillion: 1.25, cacheWritePerMillion: 2.50 },
  'gpt-5.1-codex-max': { inputPerMillion: 2.50, outputPerMillion: 10.00, cacheReadPerMillion: 1.25, cacheWritePerMillion: 2.50 },
  'gpt-5': { inputPerMillion: 2.50, outputPerMillion: 10.00, cacheReadPerMillion: 1.25, cacheWritePerMillion: 2.50 },
  'gpt-4.1': { inputPerMillion: 2.00, outputPerMillion: 8.00, cacheReadPerMillion: 1.00, cacheWritePerMillion: 2.00 },
  'gpt-4.1-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60, cacheReadPerMillion: 0.075, cacheWritePerMillion: 0.15 },

  // Kimi Family
  'tbtk-kimi-k3': { inputPerMillion: 0.30, outputPerMillion: 0.60, cacheReadPerMillion: 0.05, cacheWritePerMillion: 0.30 },
  'kimi-k3': { inputPerMillion: 0.30, outputPerMillion: 0.60, cacheReadPerMillion: 0.05, cacheWritePerMillion: 0.30 },

  // ZCode / GLM Family
  'zai/glm-5.3': { inputPerMillion: 0.50, outputPerMillion: 1.00, cacheReadPerMillion: 0.10, cacheWritePerMillion: 0.50 },
  'zai/glm-5.2': { inputPerMillion: 0.30, outputPerMillion: 0.60, cacheReadPerMillion: 0.06, cacheWritePerMillion: 0.30 },
  'glm-5.3': { inputPerMillion: 0.50, outputPerMillion: 1.00, cacheReadPerMillion: 0.10, cacheWritePerMillion: 0.50 },

  // Grok Family
  'grok-4.5': { inputPerMillion: 2.00, outputPerMillion: 10.00, cacheReadPerMillion: 0.50, cacheWritePerMillion: 2.00 },
  'grok-4.5-latest': { inputPerMillion: 2.00, outputPerMillion: 10.00, cacheReadPerMillion: 0.50, cacheWritePerMillion: 2.00 },
};

export const FALLBACK_PRICING: ModelPricingRate = {
  inputPerMillion: 1.0,
  outputPerMillion: 3.0,
  cacheReadPerMillion: 0.2,
  cacheWritePerMillion: 1.0,
};

export function findPricingRate(modelId: string): ModelPricingRate {
  if (!modelId || modelId === 'UNKNOWN') return FALLBACK_PRICING;
  const key = modelId.toLowerCase().trim();
  if (DEFAULT_MODEL_PRICING[key]) return DEFAULT_MODEL_PRICING[key];

  // Fuzzy match
  for (const [k, v] of Object.entries(DEFAULT_MODEL_PRICING)) {
    if (key.includes(k) || k.includes(key)) {
      return v;
    }
  }
  if (key.includes('claude') || key.includes('sonnet')) return DEFAULT_MODEL_PRICING['claude-sonnet-4-6'];
  if (key.includes('deepseek') || key.includes('dsh')) return DEFAULT_MODEL_PRICING['deepseek-v4-flash'];
  if (key.includes('gemini') || key.includes('flash')) return DEFAULT_MODEL_PRICING['gemini-3.7-flash-high'];
  if (key.includes('gpt')) return DEFAULT_MODEL_PRICING['gpt-5.6-sol'];
  if (key.includes('kimi')) return DEFAULT_MODEL_PRICING['kimi-k3'];
  if (key.includes('glm')) return DEFAULT_MODEL_PRICING['zai/glm-5.3'];
  return FALLBACK_PRICING;
}

export function calculateUsageCost(modelId: string, usage: TokenUsageStats): number {
  const rate = findPricingRate(modelId);
  const inputCost = (usage.inputTokens / 1_000_000) * rate.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * rate.outputPerMillion;
  const cacheReadCost = ((usage.cacheReadTokens || 0) / 1_000_000) * (rate.cacheReadPerMillion || rate.inputPerMillion * 0.1);
  const cacheWriteCost = ((usage.cacheWriteTokens || 0) / 1_000_000) * (rate.cacheWritePerMillion || rate.inputPerMillion * 1.25);
  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6));
}
