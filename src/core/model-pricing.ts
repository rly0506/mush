/**
 * mush 单一权威模型价目表（GOAL-068 B1，owner 裁决：全网核对官方定价后只留一张表）
 *
 * 数据来源（2026-08-22 逐一取证自各家官方定价页）：
 * - Anthropic: docs.anthropic.com/en/docs/about-claude/pricing
 * - DeepSeek:  api-docs.deepseek.com/quick_start/pricing（峰值价；闲时=峰值一半）
 * - Google:    ai.google.dev/gemini-api/docs/pricing（标准档 ≤200k；>200k 翻倍）
 * - OpenAI:    platform.openai.com/docs/pricing（标准短上下文；sol 促销计费至≥2026-11-21）
 * - Moonshot:  platform.kimi.ai/docs/pricing/chat-k3（无独立缓存写入计费，write 记 miss 价）
 * - Z.ai:      docs.z.ai/guides/overview/pricing（GLM-5.3 与 5.2 官方同价）
 * - xAI:       docs.x.ai/docs/models（grok-4.5 非官方型号，已从表中移除）
 *
 * 匹配策略（取代旧双向 includes 的错配）：精确命中 → 最长前缀命中（key 是
 * modelId 的前缀）→ 兜底 DEFAULT_MODEL_RATE。绝不反向用 modelId 命中更长的 key，
 * 杜绝 'gpt-4' 误中 'gpt-4.1' 一类系统性错价。
 */

export interface OfficialModelRate {
  readonly input_per_m: number;
  readonly output_per_m: number;
  readonly cache_read_per_m: number;
  readonly cache_write_per_m: number;
}

export const OFFICIAL_MODEL_PRICING: Record<string, OfficialModelRate> = {
  // ---- Anthropic ----
  'claude-fable-5': { input_per_m: 10, output_per_m: 50, cache_read_per_m: 1.0, cache_write_per_m: 12.5 },
  'claude-opus-5': { input_per_m: 5, output_per_m: 25, cache_read_per_m: 0.5, cache_write_per_m: 6.25 },
  'claude-opus-4-8': { input_per_m: 5, output_per_m: 25, cache_read_per_m: 0.5, cache_write_per_m: 6.25 },
  'claude-opus-4-7': { input_per_m: 5, output_per_m: 25, cache_read_per_m: 0.5, cache_write_per_m: 6.25 },
  'claude-opus-4-6': { input_per_m: 5, output_per_m: 25, cache_read_per_m: 0.5, cache_write_per_m: 6.25 },
  'claude-sonnet-5': { input_per_m: 2, output_per_m: 10, cache_read_per_m: 0.2, cache_write_per_m: 2.5 },
  'claude-sonnet-4-6': { input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, cache_write_per_m: 3.75 },
  'claude-sonnet-4-5': { input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, cache_write_per_m: 3.75 },
  'claude-haiku-4-5': { input_per_m: 1, output_per_m: 5, cache_read_per_m: 0.1, cache_write_per_m: 1.25 },
  // legacy：已退役/仅云渠道在售，按最后官方发布价保留别名解析
  'claude-3-7-sonnet': { input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, cache_write_per_m: 3.75 },
  'claude-3-5-sonnet': { input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, cache_write_per_m: 3.75 },
  'claude-3-5-haiku': { input_per_m: 0.8, output_per_m: 4, cache_read_per_m: 0.08, cache_write_per_m: 1 },

  // ---- DeepSeek（峰值价；01:00-04:00 与 06:00-10:00 UTC 以外为闲时半价）----
  'deepseek-v4-flash': { input_per_m: 0.44, output_per_m: 1.32, cache_read_per_m: 0.014, cache_write_per_m: 0.44 },
  'deepseek-v4-flash-0731': { input_per_m: 0.44, output_per_m: 1.32, cache_read_per_m: 0.014, cache_write_per_m: 0.44 },
  'deepseek-v4-pro': { input_per_m: 1.32, output_per_m: 3.96, cache_read_per_m: 0.044, cache_write_per_m: 1.32 },
  // chat/reasoner 已合并为 v4-flash 双模式，按同一官方价计
  'deepseek-chat': { input_per_m: 0.44, output_per_m: 1.32, cache_read_per_m: 0.014, cache_write_per_m: 0.44 },
  'deepseek-reasoner': { input_per_m: 0.44, output_per_m: 1.32, cache_read_per_m: 0.014, cache_write_per_m: 0.44 },

  // ---- Google Gemini（标准档；effort 变体同价；pro >200k 输入/输出/缓存翻倍）----
  'gemini-3.7-flash': { input_per_m: 0.75, output_per_m: 3.75, cache_read_per_m: 0.075, cache_write_per_m: 0.75 },
  'gemini-3.7-flash-high': { input_per_m: 0.75, output_per_m: 3.75, cache_read_per_m: 0.075, cache_write_per_m: 0.75 },
  'gemini-3.7-flash-medium': { input_per_m: 0.75, output_per_m: 3.75, cache_read_per_m: 0.075, cache_write_per_m: 0.75 },
  'gemini-3.7-flash-low': { input_per_m: 0.75, output_per_m: 3.75, cache_read_per_m: 0.075, cache_write_per_m: 0.75 },
  'gemini-3.6-flash': { input_per_m: 0.75, output_per_m: 3.75, cache_read_per_m: 0.075, cache_write_per_m: 0.75 },
  'gemini-3.1-pro-preview': { input_per_m: 2, output_per_m: 12, cache_read_per_m: 0.2, cache_write_per_m: 2 },
  'gemini-3.1-pro-high': { input_per_m: 2, output_per_m: 12, cache_read_per_m: 0.2, cache_write_per_m: 2 },
  'gemini-3.1-pro-low': { input_per_m: 2, output_per_m: 12, cache_read_per_m: 0.2, cache_write_per_m: 2 },
  'gemini-2.5-pro': { input_per_m: 1.25, output_per_m: 10, cache_read_per_m: 0.125, cache_write_per_m: 1.25 },
  'gemini-2.5-flash': { input_per_m: 0.3, output_per_m: 2.5, cache_read_per_m: 0.03, cache_write_per_m: 0.3 },

  // ---- OpenAI（标准短上下文档；长上下文翻倍另见官方页）----
  // gpt-5.6-sol 当前按促销价计费（至少至 2026-11-21），促销后恢复 $4/$20。
  'gpt-5.6-sol': { input_per_m: 2, output_per_m: 10, cache_read_per_m: 0.2, cache_write_per_m: 2.5 },
  'gpt-5.6-terra': { input_per_m: 1, output_per_m: 6, cache_read_per_m: 0.1, cache_write_per_m: 1.25 },
  'gpt-5.6-luna': { input_per_m: 0.1, output_per_m: 0.6, cache_read_per_m: 0.01, cache_write_per_m: 0.125 },
  'gpt-5.6-cyber': { input_per_m: 12.5, output_per_m: 75, cache_read_per_m: 1.25, cache_write_per_m: 15.625 },
  // legacy：已移出现行价目页，按发布时官方价保留别名解析
  'gpt-5': { input_per_m: 1.25, output_per_m: 10, cache_read_per_m: 0.125, cache_write_per_m: 1.25 },
  'gpt-5.1-codex-max': { input_per_m: 1.25, output_per_m: 10, cache_read_per_m: 0.125, cache_write_per_m: 1.25 },
  'gpt-4.1': { input_per_m: 2, output_per_m: 8, cache_read_per_m: 0.5, cache_write_per_m: 2 },
  'gpt-4.1-mini': { input_per_m: 0.4, output_per_m: 1.6, cache_read_per_m: 0.1, cache_write_per_m: 0.4 },

  // ---- Moonshot Kimi（cache write 无独立计费，记 miss 价）----
  'kimi-k3': { input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, cache_write_per_m: 3 },
  'tbtk-kimi-k3': { input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, cache_write_per_m: 3 },

  // ---- Z.ai GLM（国际站美元价；GLM-5.3 官方与 5.2 同价）----
  'zai/glm-5.3': { input_per_m: 1.4, output_per_m: 4.4, cache_read_per_m: 0.26, cache_write_per_m: 1.4 },
  'glm-5.3': { input_per_m: 1.4, output_per_m: 4.4, cache_read_per_m: 0.26, cache_write_per_m: 1.4 },
  'zai/glm-5.2': { input_per_m: 1.4, output_per_m: 4.4, cache_read_per_m: 0.26, cache_write_per_m: 1.4 },
  'glm-5.2': { input_per_m: 1.4, output_per_m: 4.4, cache_read_per_m: 0.26, cache_write_per_m: 1.4 },

  // ---- xAI Grok ----
  'grok-4.3': { input_per_m: 1.25, output_per_m: 2.5, cache_read_per_m: 0.2, cache_write_per_m: 1.25 },
  'grok-code-fast-1': { input_per_m: 1, output_per_m: 2, cache_read_per_m: 0.2, cache_write_per_m: 1 },
};

/** 未收录模型的保守兜底价。 */
export const DEFAULT_MODEL_RATE: OfficialModelRate = {
  input_per_m: 2,
  output_per_m: 10,
  cache_read_per_m: 0.2,
  cache_write_per_m: 2,
};

/**
 * 官方价查找：精确 key → 最长 key 前缀 → 默认兜底。
 * 只允许"表 key 是 modelId 的前缀"，禁止反向包含匹配（旧引擎错价根因）。
 */
export function findOfficialModelPricing(modelId?: string): OfficialModelRate {
  const hit = findOfficialModelPrefixHit(modelId);
  return hit !== null ? OFFICIAL_MODEL_PRICING[hit] : DEFAULT_MODEL_RATE;
}

/** 同上但不做兜底：未收录返回 null（供调用方实现自己的家族/回退策略）。 */
export function findOfficialModelPrefixHit(modelId?: string): string | null {
  const key = (modelId ?? '').toLowerCase().trim();
  if (key === '' || key === 'unknown') return null;
  if (OFFICIAL_MODEL_PRICING[key] !== undefined) return key;
  let best: string | null = null;
  for (const k of Object.keys(OFFICIAL_MODEL_PRICING)) {
    if (!key.startsWith(k)) continue;
    if (best === null || k.length > best.length) best = k;
  }
  return best;
}
