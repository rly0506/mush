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

export const FREE_MODEL_PRICING: ModelPricingRate = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheReadPerMillion: 0,
  cacheWritePerMillion: 0,
};

export const FALLBACK_PRICING: ModelPricingRate = {
  inputPerMillion: 1.0,
  outputPerMillion: 3.0,
  cacheReadPerMillion: 0.2,
  cacheWritePerMillion: 1.0,
};

/**
 * 判定模型是否为 0-Token / 免费 / 本地开源模型。
 */
export function isFreeModel(modelId: string): boolean {
  if (!modelId || modelId === 'UNKNOWN') return false;
  const key = modelId.toLowerCase().trim();
  return (
    key.includes(':free') ||
    key.endsWith('/free') ||
    key.includes('openrouter/free') ||
    key.includes('opencode/free') ||
    key.startsWith('free/') ||
    key.startsWith('ollama/') ||
    key.startsWith('local/') ||
    key.includes('glm-4-flash:free') ||
    key.includes('gemini-2.0-flash-exp:free') ||
    key.includes('qwen-2.5-coder-32b:free') ||
    key.includes('deepseek-r1:free')
  );
}

export function findPricingRate(modelId: string): ModelPricingRate {
  if (!modelId || modelId === 'UNKNOWN') return FALLBACK_PRICING;
  if (isFreeModel(modelId)) return FREE_MODEL_PRICING;
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
  if (isFreeModel(modelId)) return 0;
  const rate = findPricingRate(modelId);
  const inputCost = (usage.inputTokens / 1_000_000) * rate.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * rate.outputPerMillion;
  const cacheReadCost = ((usage.cacheReadTokens || 0) / 1_000_000) * (rate.cacheReadPerMillion || rate.inputPerMillion * 0.1);
  const cacheWriteCost = ((usage.cacheWriteTokens || 0) / 1_000_000) * (rate.cacheWritePerMillion || rate.inputPerMillion * 1.25);
  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6));
}

export const DEFAULT_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Gemini / AGY Family: 1M or 2M tokens
  'gemini-3.7-flash-high': 1_048_576,
  'gemini-3.7-flash-medium': 1_048_576,
  'gemini-3.7-flash-low': 1_048_576,
  'gemini-3.7-flash': 1_048_576,
  'gemini-3.1-pro-high': 2_097_152,
  'gemini-3.1-pro-low': 2_097_152,
  'gemini-3.1-pro': 2_097_152,
  'gemini-2.5-pro': 2_097_152,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-pro': 2_097_152,

  // Claude Family: 200k tokens
  'claude-sonnet-5': 200_000,
  'claude-opus-5': 200_000,
  'claude-fable-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-8': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-3-7-sonnet': 200_000,
  'claude-3-5-sonnet': 200_000,

  // Kimi Family: K3 is 1M tokens, k1.5 is 128k
  'kimi-k3': 1_000_000,
  'tbtk-kimi-k3': 1_000_000,
  'kimi-k1.5': 128_000,
  'moonshot-v1-128k': 128_000,
  'moonshot-v1-32k': 32_000,

  // DeepSeek Family: 128k
  'deepseek-v4-pro': 131_072,
  'deepseek-v4-flash': 131_072,
  'deepseek-chat': 131_072,
  'deepseek-reasoner': 131_072,
  'deepseek-v3': 131_072,
  'deepseek-r1': 131_072,

  // GPT / Codex Family: 128k or 200k
  'gpt-5.6-sol': 200_000,
  'gpt-5.6': 200_000,
  'gpt-5.1-codex-max': 200_000,
  'gpt-5': 200_000,
  'gpt-4.5': 128_000,
  'gpt-4.1': 128_000,
  'gpt-4.1-mini': 128_000,
  'o3-mini': 200_000,
  'o1': 200_000,
  'gpt-4o': 128_000,

  // GLM / ZCode Family: 128k
  'zai/glm-5.3': 131_072,
  'zai/glm-5.2': 131_072,
  'glm-5.3': 131_072,
  'glm-4-plus': 131_072,

  // Grok Family: 500k
  'grok-4.5': 500_000,
  'grok-4.5-latest': 500_000,
  'grok-4.6': 500_000,

  // OpenCode / Free / Small models
  'opencode/free': 131_072,
  'openrouter/free': 131_072,
  'qwen-2.5-coder-32b:free': 131_072,
  'deepseek-r1:free': 131_072,
};

/**
 * 动态获取指定模型的最大上下文窗口容量（Tokens）。
 */
export function getModelContextLimit(modelId: string): number {
  if (!modelId || modelId === 'UNKNOWN') return 131_072;
  const key = modelId.toLowerCase().trim();
  if (DEFAULT_MODEL_CONTEXT_LIMITS[key]) return DEFAULT_MODEL_CONTEXT_LIMITS[key];

  // Exact or contains match in dictionary
  for (const [k, v] of Object.entries(DEFAULT_MODEL_CONTEXT_LIMITS)) {
    if (key.includes(k) || k.includes(key)) {
      return v;
    }
  }

  // Explicit suffix/tag detection (e.g., -1m, -2m, -256k, -long)
  if (key.includes('2m') || key.includes('2048k')) return 2_097_152;
  if (key.includes('1m') || key.includes('1000k') || key.includes('1024k') || key.includes('-long')) return 1_048_576;
  if (key.includes('500k') || key.includes('512k')) return 524_288;
  if (key.includes('256k')) return 262_144;
  if (key.includes('128k')) return 131_072;
  if (key.includes('64k')) return 65_536;
  if (key.includes('32k')) return 32_768;

  // Smart family heuristic
  if (key.includes('gemini') || key.includes('agy')) return 1_048_576; // 1M default for Gemini
  if (key.includes('kimi-k3') || key.includes('kimi-3')) return 1_000_000; // 1M default for K3
  if (key.includes('grok')) return 500_000; // 500k default for Grok
  if (key.includes('claude') || key.includes('sonnet') || key.includes('opus') || key.includes('gpt-5') || key.includes('o3') || key.includes('o1')) {
    return 200_000;
  }
  if (key.includes('deepseek') || key.includes('dsh') || key.includes('glm') || key.includes('kimi') || key.includes('gpt-4')) {
    return 131_072;
  }

  return 131_072; // Standard default 128k
}

