/**
 * mush 核心（M2）— 预算记账：本地资源预算 + per-actor USD admission 门（事件化）。
 *
 * PS 源（黄金参照，只读）：
 *   bridge-quota.tests.ps1 L67-L74（calls/elapsed/evidence 上限与机器可读 reason）
 *   CONSTITUTION.md §1.1（per-actor cap）+ GOAL-002 U3（admission 门事件化记账）
 */

import { canonicalJson, sha256Hex } from './event-log.ts';

export interface LocalBudgetLimits {
  maxCalls: number;
  maxWallClockSeconds: number;
  maxEvidenceBytes: number;
}

export interface LocalBudget extends LocalBudgetLimits {
  callsUsed: number;
  elapsedSecondsUsed: number;
  evidenceBytesUsed: number;
}

export interface BudgetUsage {
  calls?: number;
  elapsedSeconds?: number;
  evidenceBytes?: number;
}

export function createLocalBudget(limits: LocalBudgetLimits): LocalBudget {
  return {
    maxCalls: limits.maxCalls,
    maxWallClockSeconds: limits.maxWallClockSeconds,
    maxEvidenceBytes: limits.maxEvidenceBytes,
    callsUsed: 0,
    elapsedSecondsUsed: 0,
    evidenceBytesUsed: 0,
  };
}

export function addBudgetUsage(budget: LocalBudget, usage: BudgetUsage): LocalBudget {
  return {
    ...budget,
    callsUsed: budget.callsUsed + (usage.calls ?? 0),
    elapsedSecondsUsed: budget.elapsedSecondsUsed + (usage.elapsedSeconds ?? 0),
    evidenceBytesUsed: budget.evidenceBytesUsed + (usage.evidenceBytes ?? 0),
  };
}

export type BudgetTestResult = { allowed: boolean; reason: string | null };

/** 三维上限判定；reason 机器可读（移植 bridge-quota.tests.ps1 L70-L73）。 */
export function testBudget(budget: LocalBudget, usage: BudgetUsage): BudgetTestResult {
  const calls = usage.calls ?? 0;
  const elapsed = usage.elapsedSeconds ?? 0;
  const evidence = usage.evidenceBytes ?? 0;
  if (budget.callsUsed + calls > budget.maxCalls) {
    return { allowed: false, reason: 'MODEL_CALL_LIMIT' };
  }
  if (budget.elapsedSecondsUsed + elapsed > budget.maxWallClockSeconds) {
    return { allowed: false, reason: 'WALL_CLOCK_LIMIT' };
  }
  if (budget.evidenceBytesUsed + evidence > budget.maxEvidenceBytes) {
    return { allowed: false, reason: 'EVIDENCE_BYTES_LIMIT' };
  }
  return { allowed: true, reason: null };
}

export interface UsdAdmissionEntry {
  readonly atUtc: string;
  readonly actorId: string;
  readonly decision: 'ADMITTED' | 'DENIED';
  readonly amountUsd: number;
  readonly capUsd: number;
  readonly spentBeforeUsd: number;
  readonly remainingUsd: number;
  readonly meta: Record<string, unknown>;
  readonly sha256: string;
  readonly previous_sha256: string | null;
}

export interface TokenUsageTelemetry {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_tokens: number;
  readonly cache_read_tokens: number;
  readonly total_cost_usd: number;
  readonly cache_savings_usd: number;
}

export interface ModelPricingRate {
  readonly input_per_m: number;
  readonly output_per_m: number;
  readonly cache_read_per_m: number;
  readonly cache_creation_per_m: number;
}

export const DEFAULT_PRICING_MATRIX: Record<string, ModelPricingRate> = {
  'claude-3-5-sonnet': { input_per_m: 3.00, output_per_m: 15.00, cache_read_per_m: 0.30, cache_creation_per_m: 3.75 },
  'claude-3-7-sonnet': { input_per_m: 3.00, output_per_m: 15.00, cache_read_per_m: 0.30, cache_creation_per_m: 3.75 },
  'claude-3-5-haiku': { input_per_m: 0.80, output_per_m: 4.00, cache_read_per_m: 0.08, cache_creation_per_m: 1.00 },
  'deepseek-chat': { input_per_m: 0.14, output_per_m: 0.28, cache_read_per_m: 0.014, cache_creation_per_m: 0.14 },
  'deepseek-reasoner': { input_per_m: 0.55, output_per_m: 2.19, cache_read_per_m: 0.14, cache_creation_per_m: 0.55 },
  'gemini-2.5-pro': { input_per_m: 1.25, output_per_m: 5.00, cache_read_per_m: 0.30, cache_creation_per_m: 1.25 },
  'gemini-2.5-flash': { input_per_m: 0.075, output_per_m: 0.30, cache_read_per_m: 0.01875, cache_creation_per_m: 0.075 },
  'default': { input_per_m: 2.00, output_per_m: 10.00, cache_read_per_m: 0.20, cache_creation_per_m: 2.00 },
};

export function calculateTokenCostAndSavings(
  tokens: { input_tokens: number; output_tokens: number; cache_creation_tokens?: number; cache_read_tokens?: number },
  modelId?: string
): { total_cost_usd: number; cache_savings_usd: number } {
  const mid = (modelId || 'default').toLowerCase();
  let rate = DEFAULT_PRICING_MATRIX['default'];
  for (const [key, val] of Object.entries(DEFAULT_PRICING_MATRIX)) {
    if (mid.includes(key)) {
      rate = val;
      break;
    }
  }
  const input = tokens.input_tokens || 0;
  const output = tokens.output_tokens || 0;
  const cacheCreation = tokens.cache_creation_tokens || 0;
  const cacheRead = tokens.cache_read_tokens || 0;

  const actualInputCost = (input * rate.input_per_m + cacheCreation * rate.cache_creation_per_m + cacheRead * rate.cache_read_per_m) / 1_000_000;
  const outputCost = (output * rate.output_per_m) / 1_000_000;
  const total_cost_usd = Math.round((actualInputCost + outputCost) * 1_000_000) / 1_000_000;

  const nominalInputCost = ((input + cacheCreation + cacheRead) * rate.input_per_m + output * rate.output_per_m) / 1_000_000;
  const cache_savings_usd = Math.max(0, Math.round((nominalInputCost - total_cost_usd) * 1_000_000) / 1_000_000);

  return { total_cost_usd, cache_savings_usd };
}

export function roundMicroUsd(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

/**
 * per-actor USD cap + admission 门：每次 admit 无论通过与否都作为哈希链事件
 * 记账（非阻断、可审计）；超 cap 的消费被拒且不改变余额。
 */
export class UsdBudgetLedger {

  private readonly ledgers = new Map<string, UsdAdmissionEntry[]>();

  loadEntries(entries: UsdAdmissionEntry[]): void {
    this.ledgers.clear();
    for (const entry of entries) {
      const list = this.ledgers.get(entry.actorId) ?? [];
      this.ledgers.set(entry.actorId, [...list, entry]);
    }
  }

  recordActualUsage(opts: {
    actorId: string;
    capUsd: number;
    actualCostUsd: number;
    meta: Record<string, unknown>;
  }): UsdAdmissionEntry {
    const cost = roundMicroUsd(Math.max(0, opts.actualCostUsd));
    return this.admit({
      actorId: opts.actorId,
      capUsd: opts.capUsd,
      amountUsd: cost,
      meta: { ...opts.meta, kind: 'ACTUAL_COST' },
    });
  }

  admit(opts: {
    actorId: string;
    capUsd: number;
    amountUsd: number;
    meta: Record<string, unknown>;
  }): UsdAdmissionEntry {
    if (!(opts.amountUsd >= 0)) throw new Error('admission amountUsd must be >= 0');
    const amountUsd = roundMicroUsd(opts.amountUsd);
    const capUsd = roundMicroUsd(opts.capUsd);
    const entries = this.ledgers.get(opts.actorId) ?? [];
    // GOAL-068（A1）：门禁与 spentUsd() 同源同口径——同一 dispatch 的预估行被
    // ACTUAL_COST 覆盖（去重），不再把预留+实付双算进 spentBefore 导致提前拒单。
    const spentBefore = roundMicroUsd(
      entries
        .filter((entry) => entry.decision === 'ADMITTED' && !isActualCostCoveredReserve(entries, entry))
        .reduce((sum, entry) => sum + entry.amountUsd, 0)
    );
    const allowed = roundMicroUsd(spentBefore + amountUsd) <= capUsd;
    const decision = allowed ? 'ADMITTED' : 'DENIED';
    const previous = entries[entries.length - 1]?.sha256 ?? null;
    const atUtc = new Date().toISOString();
    const remainingUsd = roundMicroUsd(capUsd - spentBefore - (allowed ? amountUsd : 0));
    const body = {
      at_utc: atUtc,
      actor_id: opts.actorId,
      decision,
      amount_usd: amountUsd,
      cap_usd: capUsd,
      spent_before_usd: spentBefore,
      remaining_usd: remainingUsd,
      meta: opts.meta,
      previous_sha256: previous,
    };
    const entry: UsdAdmissionEntry = Object.freeze({
      atUtc,
      actorId: opts.actorId,
      decision,
      amountUsd,
      capUsd,
      spentBeforeUsd: spentBefore,
      remainingUsd,
      meta: { ...opts.meta },
      sha256: sha256Hex(canonicalJson(body)),
      previous_sha256: previous,
    });
    this.ledgers.set(opts.actorId, [...entries, entry]);
    return entry;
  }

  spentUsd(actorId: string): number {
    const list = this.ledgers.get(actorId) ?? [];
    return computeSpentUsd(list);
  }

  remainingUsd(actorId: string, capUsd: number): number {
    return roundMicroUsd(roundMicroUsd(capUsd) - this.spentUsd(actorId));
  }

  entries(actorId: string): readonly UsdAdmissionEntry[] {
    return Object.freeze([...(this.ledgers.get(actorId) ?? [])]);
  }

  /** 全部 actor 的 admission 事件（按落账顺序合并）。 */
  allEntries(): UsdAdmissionEntry[] {
    const all: UsdAdmissionEntry[] = [];
    for (const entries of this.ledgers.values()) all.push(...entries);
    all.sort((a, b) => a.atUtc.localeCompare(b.atUtc));
    return all;
  }

  /** 重算 admission 事件哈希链。 */
  verify(actorId: string): void {
    let previous: string | null = null;
    for (const entry of this.entries(actorId)) {
      if (entry.previous_sha256 !== previous) {
        throw new Error(`budget ledger anchor broken at ${entry.atUtc}`);
      }
      const body = {
        at_utc: entry.atUtc,
        actor_id: entry.actorId,
        decision: entry.decision,
        amount_usd: entry.amountUsd,
        cap_usd: entry.capUsd,
        spent_before_usd: entry.spentBeforeUsd,
        remaining_usd: entry.remainingUsd,
        meta: entry.meta,
        previous_sha256: previous,
      };
      if (sha256Hex(canonicalJson(body)) !== entry.sha256) {
        throw new Error(`budget ledger hash mismatch at ${entry.atUtc}`);
      }
      previous = entry.sha256;
    }
  }
}

function entryDispatchId(entry: UsdAdmissionEntry): string | null {
  return entry.meta && typeof entry.meta.dispatch_id === 'string' ? entry.meta.dispatch_id : null;
}

/** 预估行已被同 dispatch 的 ACTUAL_COST 覆盖（后者在账序上更晚）→ 不再计入花费。 */
function isActualCostCoveredReserve(entries: readonly UsdAdmissionEntry[], target: UsdAdmissionEntry): boolean {
  if (target.meta && target.meta.kind === 'ACTUAL_COST') return false;
  const did = entryDispatchId(target);
  if (did === null) return false;
  const idx = entries.indexOf(target);
  return entries.some(
    (e, i) =>
      i > idx &&
      e.decision === 'ADMITTED' &&
      entryDispatchId(e) === did &&
      e.meta !== undefined &&
      e.meta.kind === 'ACTUAL_COST',
  );
}

/** 花费口径（admit 门禁与 spentUsd 共用，GOAL-068 A1）：ADMITTED 且未被实付覆盖的预估 + 全部实付。 */
function computeSpentUsd(entries: readonly UsdAdmissionEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.decision !== 'ADMITTED') continue;
    if (isActualCostCoveredReserve(entries, entry)) continue;
    total += entry.amountUsd;
  }
  return roundMicroUsd(total);
}
