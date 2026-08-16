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

/**
 * per-actor USD cap + admission 门：每次 admit 无论通过与否都作为哈希链事件
 * 记账（非阻断、可审计）；超 cap 的消费被拒且不改变余额。
 */
export class UsdBudgetLedger {
  private readonly ledgers = new Map<string, UsdAdmissionEntry[]>();

  admit(opts: {
    actorId: string;
    capUsd: number;
    amountUsd: number;
    meta: Record<string, unknown>;
  }): UsdAdmissionEntry {
    if (!(opts.amountUsd >= 0)) throw new Error('admission amountUsd must be >= 0');
    const entries = this.ledgers.get(opts.actorId) ?? [];
    const spentBefore = entries
      .filter((entry) => entry.decision === 'ADMITTED')
      .reduce((sum, entry) => sum + entry.amountUsd, 0);
    const allowed = spentBefore + opts.amountUsd <= opts.capUsd;
    const decision = allowed ? 'ADMITTED' : 'DENIED';
    const previous = entries[entries.length - 1]?.sha256 ?? null;
    const atUtc = new Date().toISOString();
    const body = {
      at_utc: atUtc,
      actor_id: opts.actorId,
      decision,
      amount_usd: opts.amountUsd,
      cap_usd: opts.capUsd,
      spent_before_usd: spentBefore,
      remaining_usd: opts.capUsd - spentBefore - (allowed ? opts.amountUsd : 0),
      meta: opts.meta,
      previous_sha256: previous,
    };
    const entry: UsdAdmissionEntry = Object.freeze({
      atUtc,
      actorId: opts.actorId,
      decision,
      amountUsd: opts.amountUsd,
      capUsd: opts.capUsd,
      spentBeforeUsd: spentBefore,
      remainingUsd: body.remaining_usd,
      meta: { ...opts.meta },
      sha256: sha256Hex(canonicalJson(body)),
      previous_sha256: previous,
    });
    this.ledgers.set(opts.actorId, [...entries, entry]);
    return entry;
  }

  spentUsd(actorId: string): number {
    return (this.ledgers.get(actorId) ?? [])
      .filter((entry) => entry.decision === 'ADMITTED')
      .reduce((sum, entry) => sum + entry.amountUsd, 0);
  }

  remainingUsd(actorId: string, capUsd: number): number {
    return capUsd - this.spentUsd(actorId);
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
