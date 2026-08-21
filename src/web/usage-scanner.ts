/**
 * mush 本地会话用量与花费扫描引擎（GOAL-027 / GP-33）
 *
 * 类似 ccusage：解析本地 Claude / Pi / Receipts 日志，结合 pricing.ts 投影真实花费。
 * 绝不读取、记录任何密钥凭据。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { calculateUsageCost, type TokenUsageStats } from './pricing.ts';

export interface HarnessUsageSummary {
  scanned_at_utc: string;
  today_cost_usd: number;
  total_cost_usd: number;
  total_tokens: number;
  total_volume: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  cache_savings_usd: number;
  per_harness_usage: Record<
    string,
    {
      harness: string;
      cost_usd: number;
      tokens: number;
      volume: number;
      input_tokens: number;
      output_tokens: number;
      sessions_count: number;
    }
  >;
  per_model_usage: Record<
    string,
    {
      model_id: string;
      cost_usd: number;
      tokens: number;
    }
  >;
  daily_trends: Array<{
    date: string;
    cost_usd: number;
    tokens: number;
  }>;
}

/** 辅助：提取 ISO 字符串的前 10 位作为日期 YYYY-MM-DD */
function toDateStr(isoString?: string): string {
  if (!isoString) return new Date().toISOString().slice(0, 10);
  return isoString.slice(0, 10);
}

export function scanLocalHarnessUsage(
  options?: {
    customHomeDir?: string;
    workspaceRoot?: string;
    now?: () => Date;
  },
): HarnessUsageSummary {
  const home = options?.customHomeDir || homedir();
  const getNow = options?.now || (() => new Date());
  const todayStr = getNow().toISOString().slice(0, 10);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let todayCost = 0;

  const perHarness: HarnessUsageSummary['per_harness_usage'] = {};
  const perModel: HarnessUsageSummary['per_model_usage'] = {};
  const dailyMap: Record<string, { cost_usd: number; tokens: number }> = {};

  function addUsageRecord(
    harness: string,
    modelId: string,
    usage: TokenUsageStats,
    timestampIso?: string,
  ) {
    const cost = calculateUsageCost(modelId, usage);
    const tokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens || 0);

    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCacheRead += usage.cacheReadTokens || 0;
    totalCacheWrite += usage.cacheWriteTokens || 0;
    totalCost += cost;

    const recordDate = toDateStr(timestampIso);
    if (recordDate === todayStr) {
      todayCost += cost;
    }

    // Harness 聚合
    if (!perHarness[harness]) {
      perHarness[harness] = {
        harness,
        cost_usd: 0,
        tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        sessions_count: 0,
      };
    }
    perHarness[harness].cost_usd = Number((perHarness[harness].cost_usd + cost).toFixed(6));
    perHarness[harness].tokens += tokens;
    perHarness[harness].input_tokens += usage.inputTokens;
    perHarness[harness].output_tokens += usage.outputTokens;

    // Model 聚合
    const mKey = modelId || 'UNKNOWN';
    if (!perModel[mKey]) {
      perModel[mKey] = { model_id: mKey, cost_usd: 0, tokens: 0 };
    }
    perModel[mKey].cost_usd = Number((perModel[mKey].cost_usd + cost).toFixed(6));
    perModel[mKey].tokens += tokens;

    // Daily 趋势聚合
    if (!dailyMap[recordDate]) {
      dailyMap[recordDate] = { cost_usd: 0, tokens: 0 };
    }
    dailyMap[recordDate].cost_usd = Number((dailyMap[recordDate].cost_usd + cost).toFixed(6));
    dailyMap[recordDate].tokens += tokens;
  }

  // 1. 扫描 Claude Code 会话 (~/.claude/projects/*/*.jsonl)
  const claudeProjects = path.join(home, '.claude', 'projects');
  if (existsSync(claudeProjects)) {
    try {
      const pDirs = readdirSync(claudeProjects);
      for (const pd of pDirs) {
        const pPath = path.join(claudeProjects, pd);
        if (statSync(pPath).isDirectory()) {
          const files = readdirSync(pPath);
          for (const f of files) {
            if (f.endsWith('.jsonl')) {
              if (!perHarness['claude-code']) {
                perHarness['claude-code'] = {
                  harness: 'claude-code',
                  cost_usd: 0,
                  tokens: 0,
                  input_tokens: 0,
                  output_tokens: 0,
                  sessions_count: 0,
                };
              }
              perHarness['claude-code'].sessions_count += 1;
              const content = readFileSync(path.join(pPath, f), 'utf8');
              for (const line of content.split('\n')) {
                if (!line || !line.includes('usage')) continue;
                try {
                  const item = JSON.parse(line) as {
                    timestamp?: string;
                    message?: { model?: string; usage?: Record<string, number> };
                    usage?: Record<string, number>;
                  };
                  const u = item.message?.usage || item.usage;
                  if (u && typeof u.input_tokens === 'number') {
                    const model = item.message?.model || 'claude-sonnet-4-6';
                    addUsageRecord(
                      'claude-code',
                      model,
                      {
                        inputTokens: u.input_tokens || 0,
                        outputTokens: u.output_tokens || 0,
                        cacheReadTokens: u.cache_read_input_tokens || 0,
                        cacheWriteTokens: u.cache_creation_input_tokens || 0,
                      },
                      item.timestamp,
                    );
                  }
                } catch {}
              }
            }
          }
        }
      }
    } catch {}
  }

  // 2. 扫描 Pi Agent 会话 (~/.pi/agent/sessions/*/*.jsonl)
  const piSessions = path.join(home, '.pi', 'agent', 'sessions');
  if (existsSync(piSessions)) {
    try {
      const sDirs = readdirSync(piSessions);
      for (const sd of sDirs) {
        const sPath = path.join(piSessions, sd);
        if (statSync(sPath).isDirectory()) {
          const files = readdirSync(sPath);
          for (const f of files) {
            if (f.endsWith('.jsonl')) {
              if (!perHarness['pi']) {
                perHarness['pi'] = {
                  harness: 'pi',
                  cost_usd: 0,
                  tokens: 0,
                  input_tokens: 0,
                  output_tokens: 0,
                  sessions_count: 0,
                };
              }
              perHarness['pi'].sessions_count += 1;
              const content = readFileSync(path.join(sPath, f), 'utf8');
              for (const line of content.split('\n')) {
                if (!line || !line.includes('usage')) continue;
                try {
                  const item = JSON.parse(line) as {
                    timestamp?: string;
                    message?: { model?: string; usage?: Record<string, number> };
                    usage?: Record<string, number>;
                  };
                  const u = item.message?.usage || item.usage;
                  if (u && (typeof u.input === 'number' || typeof u.input_tokens === 'number')) {
                    const model = item.message?.model || 'deepseek-v4-flash';
                    addUsageRecord(
                      'pi',
                      model,
                      {
                        inputTokens: u.input || u.input_tokens || 0,
                        outputTokens: u.output || u.output_tokens || 0,
                        cacheReadTokens: u.cacheRead || u.cache_read_input_tokens || 0,
                        cacheWriteTokens: u.cacheWrite || u.cache_creation_input_tokens || 0,
                      },
                      item.timestamp,
                    );
                  }
                } catch {}
              }
            }
          }
        }
      }
    } catch {}
  }

  // 3. 扫描 mush 本地预算账本 (runtime/budget-ledger.jsonl)
  if (options?.workspaceRoot) {
    const ledger = path.join(options.workspaceRoot, 'runtime', 'budget-ledger.jsonl');
    if (existsSync(ledger)) {
      try {
        const content = readFileSync(ledger, 'utf8');
        for (const line of content.split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line) as {
              actor_id?: string;
              amount_usd?: number;
              timestamp_utc?: string;
            };
            if (entry.actor_id && typeof entry.amount_usd === 'number' && entry.amount_usd > 0) {
              const hKey = entry.actor_id;
              if (!perHarness[hKey]) {
                perHarness[hKey] = {
                  harness: hKey,
                  cost_usd: 0,
                  tokens: 0,
                  input_tokens: 0,
                  output_tokens: 0,
                  sessions_count: 0,
                };
              }
              perHarness[hKey].cost_usd = Number((perHarness[hKey].cost_usd + entry.amount_usd).toFixed(6));
              perHarness[hKey].sessions_count += 1;
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 整理趋势数据 (按日期升序)
  const dailyTrends = Object.entries(dailyMap)
    .map(([date, val]) => ({ date, cost_usd: val.cost_usd, tokens: val.tokens }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  // 计算缓存节省费用估算（缓存读免除的标准输入费用差额）
  const cacheSavings = Number(((totalCacheRead / 1_000_000) * 2.5).toFixed(4));

  return {
    scanned_at_utc: getNow().toISOString(),
    today_cost_usd: Number(todayCost.toFixed(4)),
    total_cost_usd: Number(totalCost.toFixed(4)),
    total_tokens: totalInput + totalOutput + totalCacheRead,
    total_volume: totalInput + totalOutput + totalCacheRead,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cache_read_tokens: totalCacheRead,
    total_cache_write_tokens: totalCacheWrite,
    cache_savings_usd: cacheSavings,
    per_harness_usage: perHarness,
    per_model_usage: perModel,
    daily_trends: dailyTrends,
  };
}
