/**
 * mush 核心（M2）— run lease：授予 / 重绑 / 恢复 / 过期。
 *
 * PS 源（黄金参照，只读）：
 *   bridge-orchestrator.lease.tests.ps1 L247-L277（同 run root 第二持有者被拒
 *     'already leased'；不同 run root 可并发）
 *   bridge-orchestrator.rebind.tests.ps1 L641（stale-actor rejection + capability
 *     rotation）、L655（rebind rejects a held run lease）
 *   bridge-orchestrator.recovery.tests.ps1 L241（恢复路径拒绝非授权时点）
 *
 * 语义模型说明：PS 版 lease 落在 run root 文件/进程树上；本模块以内存模型移植
 * 其可观察语义（重复授予拒绝、重绑轮换、过期、恢复、身份 fail-closed）。
 */

import { canonicalJson, sha256Hex } from './event-log.ts';
import { assertRuntimeIdentity, type RuntimeIdentity } from './identity.ts';

export type LeaseState = 'GRANTED' | 'REBOUND' | 'RECOVERED' | 'EXPIRED';
export type LeaseTransition = 'GRANTED' | 'REBOUND' | 'RECOVERED' | 'EXPIRED';

export interface LeaseHolder {
  role: string;
  instanceId: string;
  provider?: string;
  modelId?: string;
}

export interface LeaseHistoryEntry {
  readonly atUtc: string;
  readonly transition: LeaseTransition;
  readonly holder: LeaseHolder;
  readonly sha256: string;
  readonly previous_sha256: string | null;
}

export interface LeaseRecord {
  readonly leaseId: string;
  readonly runId: string;
  readonly assignmentEpoch: number;
  readonly holder: LeaseHolder;
  readonly state: LeaseState;
  readonly grantedAtUtc: string;
  readonly expiresAtUtc: string;
  readonly history: readonly LeaseHistoryEntry[];
  readonly ttlMs: number;
}

function historySha256(
  transition: LeaseTransition,
  holder: LeaseHolder,
  atUtc: string,
  previous: string | null,
): string {
  return sha256Hex(
    canonicalJson({
      at_utc: atUtc,
      transition,
      holder: {
        role: holder.role,
        instance_id: holder.instanceId,
        provider: holder.provider ?? null,
        model_id: holder.modelId ?? null,
      },
      previous_sha256: previous,
    }),
  );
}

export class LeaseManager {
  private readonly clock: () => Date;
  private readonly leases = new Map<string, LeaseRecord>();

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  get(runId: string): LeaseRecord | null {
    const lease = this.leases.get(runId);
    if (lease === undefined) return null;
    this.ensureExpiry(runId);
    return this.leases.get(runId) as LeaseRecord;
  }

  /** 授予 run lease；同一 run root 在租约有效期内重复授予即拒绝（already leased）。 */
  grant(opts: {
    runId: string;
    assignmentEpoch: number;
    holder: LeaseHolder;
    ttlMs: number;
  }): LeaseRecord {
    const existing = this.get(opts.runId);
    if (existing !== null) {
      throw new Error(`run lease already leased by ${existing.holder.instanceId} (${existing.leaseId})`);
    }
    if (!Number.isInteger(opts.ttlMs) || opts.ttlMs <= 0) {
      throw new Error('lease ttlMs must be a positive integer');
    }
    const now = this.clock();
    const leaseId = crypto.randomUUID().replace(/-/g, '');
    const record: LeaseRecord = {
      leaseId,
      runId: opts.runId,
      assignmentEpoch: opts.assignmentEpoch,
      holder: { ...opts.holder },
      state: 'GRANTED',
      grantedAtUtc: now.toISOString(),
      expiresAtUtc: new Date(now.getTime() + opts.ttlMs).toISOString(),
      history: [
        {
          atUtc: now.toISOString(),
          transition: 'GRANTED',
          holder: { ...opts.holder },
          sha256: historySha256('GRANTED', opts.holder, now.toISOString(), null),
          previous_sha256: null,
        },
      ],
      ttlMs: opts.ttlMs,
    };
    this.leases.set(opts.runId, record);
    return record;
  }

  /** 身份 fail-closed 断言：租约必须存在、未过期、且 holder 精确匹配。 */
  assertHolder(runId: string, holder: LeaseHolder): LeaseRecord {
    const lease = this.get(runId);
    if (lease === null) throw new Error(`lease missing for run ${runId}`);
    if (lease.state === 'EXPIRED') throw new Error(`lease ${lease.leaseId} expired; recover first`);
    try {
      assertRuntimeIdentity(
        {
          provider: holder.provider ?? '',
          modelId: holder.modelId ?? '',
          role: holder.role,
          instanceId: holder.instanceId,
        },
        {
          provider: lease.holder.provider ?? '',
          modelId: lease.holder.modelId ?? '',
          role: lease.holder.role,
          instanceId: lease.holder.instanceId,
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`lease holder mismatch for run ${runId}: ${detail}`);
    }
    return lease;
  }

  /** 重绑：GRANTED/REBOUND/RECOVERED 有效期内轮换 holder；过期必须走 recover。 */
  rebind(runId: string, newHolder: LeaseHolder): LeaseRecord {
    const lease = this.get(runId);
    if (lease === null) throw new Error(`lease missing for run ${runId}`);
    if (lease.state === 'EXPIRED') {
      throw new Error(`lease ${lease.leaseId} expired; use recover instead of rebind`);
    }
    return this.transition(runId, 'REBOUND', newHolder);
  }

  /** 恢复：仅 EXPIRED 租约可恢复并绑定替换 holder，同时授予与原租约等长的新租期。 */
  recover(runId: string, newHolder: LeaseHolder): LeaseRecord {
    const lease = this.get(runId);
    if (lease === null) throw new Error(`lease missing for run ${runId}`);
    if (lease.state !== 'EXPIRED') {
      throw new Error(`lease ${lease.leaseId} is not expired; recovery refused`);
    }
    const now = this.clock();
    return this.transition(runId, 'RECOVERED', newHolder, {
      expiresAtUtc: new Date(now.getTime() + lease.ttlMs).toISOString(),
    });
  }

  /** 到期判定：GRANTED/REBOUND/RECOVERED 在 expiresAtUtc 之后转为 EXPIRED。 */
  ensureExpiry(runId: string): LeaseRecord | null {
    const lease = this.leases.get(runId);
    if (lease === undefined) return null;
    if (lease.state !== 'EXPIRED' && this.clock().getTime() >= new Date(lease.expiresAtUtc).getTime()) {
      const next = this.transition(runId, 'EXPIRED', lease.holder);
      return next;
    }
    return lease;
  }

  /** 重算历史哈希链（append-only 审计）。 */
  verifyHistory(lease: LeaseRecord): void {
    let previous: string | null = null;
    for (const entry of lease.history) {
      if (entry.previous_sha256 !== previous) {
        throw new Error(`lease history anchor broken at ${entry.transition}`);
      }
      const recomputed = historySha256(entry.transition, entry.holder, entry.atUtc, previous);
      if (recomputed !== entry.sha256) {
        throw new Error(`lease history hash mismatch at ${entry.transition}`);
      }
      previous = entry.sha256;
    }
  }

  private transition(
    runId: string,
    transition: LeaseTransition,
    holder: LeaseHolder,
    opts: { expiresAtUtc?: string } = {},
  ): LeaseRecord {
    const current = this.leases.get(runId);
    if (current === undefined) throw new Error(`lease missing for run ${runId}`);
    const now = this.clock().toISOString();
    const previous = current.history[current.history.length - 1]?.sha256 ?? null;
    const entry: LeaseHistoryEntry = {
      atUtc: now,
      transition,
      holder: { ...holder },
      sha256: historySha256(transition, holder, now, previous),
      previous_sha256: previous,
    };
    const next: LeaseRecord = {
      leaseId: current.leaseId,
      runId,
      assignmentEpoch: current.assignmentEpoch,
      holder: { ...holder },
      state: transition,
      grantedAtUtc: current.grantedAtUtc,
      expiresAtUtc: opts.expiresAtUtc ?? current.expiresAtUtc,
      history: [...current.history, entry],
      ttlMs: current.ttlMs,
    };
    this.leases.set(runId, next);
    return next;
  }
}
