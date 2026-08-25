/**
 * GOAL-073：失控熔断器（Runaway Circuit-Breaker）
 *
 * 三类熔断：
 *  1. 连败熔断：连续 N 次真实派发失败（成功即清零）；
 *  2. 预算斜率熔断：滑动窗口内自动批支出斜率超阈（USD/min）；
 *  3. 单任务超时熔断：单笔时长超过硬顶立即停机。
 *
 * 停机后：真实派发全部拒绝（dry-run 不受影响，便于诊断），并支持导出
 * 审计回放包（事件全量 JSON）。状态持久化 runtime/unattended-breaker.json，
 * 重启后保持停机（fail-safe）——恢复必须 owner 显式 reset。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './event-log.ts';

export interface BreakerEvent {
  at_utc: string;
  kind: 'success' | 'failure' | 'timeout' | 'spend' | 'trip' | 'reset';
  detail: Record<string, unknown>;
}

export interface BreakerState {
  halted: boolean;
  halt_reason?: string;
  halted_at_utc?: string;
  consecutive_failures: number;
  /** 滑动窗口支出记录 [{at_ms, usd}]。 */
  spend_window: Array<{ at_ms: number; usd: number }>;
  events: BreakerEvent[];
}

export interface BreakerOptions {
  max_consecutive_failures?: number;
  /** 预算斜率阈值（USD/min），基于最近 10 分钟滑窗。 */
  budget_slope_usd_per_min?: number;
  /** 单任务超时硬顶（ms）——超过即熔断。 */
  hard_timeout_ms?: number;
  now?: () => Date;
}

const WINDOW_MS = 10 * 60_000;

export class CircuitBreaker {
  private readonly storePath: string;
  private state: BreakerState;
  private readonly opts: Required<Pick<BreakerOptions, 'max_consecutive_failures' | 'budget_slope_usd_per_min' | 'hard_timeout_ms'>>;
  private readonly now: () => Date;

  constructor(storePath: string, opts: BreakerOptions = {}) {
    this.storePath = storePath;
    this.opts = {
      max_consecutive_failures: opts.max_consecutive_failures ?? 3,
      budget_slope_usd_per_min: opts.budget_slope_usd_per_min ?? 5,
      hard_timeout_ms: opts.hard_timeout_ms ?? 15 * 60_000,
    };
    this.now = opts.now ?? (() => new Date());
    this.state = this.load();
  }

  private load(): BreakerState {
    try {
      if (existsSync(this.storePath)) {
        const raw = JSON.parse(readFileSync(this.storePath, 'utf8')) as BreakerState;
        if (typeof raw.halted === 'boolean' && Array.isArray(raw.events)) return raw;
      }
    } catch {}
    return { halted: false, consecutive_failures: 0, spend_window: [], events: [] };
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
    } catch {}
  }

  private push(kind: BreakerEvent['kind'], detail: Record<string, unknown> = {}): void {
    const at = this.now().toISOString();
    const events = this.state.events;
    const prevSha = events.length > 0 ? ((events[events.length - 1].detail as Record<string, unknown>).sha256 as string | undefined) ?? null : null;
    const entry: BreakerEvent = { at_utc: at, kind, detail: { ...detail } };
    // 事件链：行哈希覆盖 {at_utc, kind, detail(剥离锚点字段)}；链接指针=上一行 sha256。
    const core = { at_utc: entry.at_utc, kind: entry.kind, detail: { ...entry.detail } };
    const sha = sha256Hex(canonicalJson(core));
    entry.detail.previous_sha256 = prevSha;
    entry.detail.sha256 = sha;
    events.push(entry);
    if (events.length > 500) events.splice(0, events.length - 500);
  }

  get halted(): boolean {
    return this.state.halted;
  }

  snapshot(): BreakerState & { thresholds: { max_consecutive_failures: number; budget_slope_usd_per_min: number; hard_timeout_ms: number } } {
    return {
      ...this.state,
      thresholds: {
        max_consecutive_failures: this.opts.max_consecutive_failures,
        budget_slope_usd_per_min: this.opts.budget_slope_usd_per_min,
        hard_timeout_ms: this.opts.hard_timeout_ms,
      },
    };
  }

  trip(reason: string): void {
    if (this.state.halted) return;
    this.state.halted = true;
    this.state.halt_reason = reason;
    this.state.halted_at_utc = this.now().toISOString();
    this.push('trip', { reason });
    this.save();
  }

  reset(by: string): void {
    this.state.halted = false;
    this.state.consecutive_failures = 0;
    this.state.halt_reason = undefined;
    this.state.halted_at_utc = undefined;
    this.push('reset', { by });
    this.save();
  }

  recordSuccess(): void {
    this.state.consecutive_failures = 0;
    this.push('success');
    this.save();
  }

  recordFailure(detail: Record<string, unknown> = {}): void {
    this.state.consecutive_failures += 1;
    this.push('failure', { consecutive: this.state.consecutive_failures, ...detail });
    if (this.state.consecutive_failures >= this.opts.max_consecutive_failures) {
      this.trip(`连续失败 ${this.state.consecutive_failures} 次`);
      return;
    }
    this.save();
  }

  recordTimeout(durationMs: number, dispatchId: string): void {
    this.push('timeout', { duration_ms: durationMs, dispatch_id: dispatchId });
    if (durationMs > this.opts.hard_timeout_ms) {
      this.trip(`单任务超时 ${Math.round(durationMs / 1000)}s 超过硬顶 ${Math.round(this.opts.hard_timeout_ms / 1000)}s`);
      return;
    }
    this.state.consecutive_failures += 1;
    if (this.state.consecutive_failures >= this.opts.max_consecutive_failures) {
      this.trip(`连续失败 ${this.state.consecutive_failures} 次（含超时）`);
      return;
    }
    this.save();
  }

  /** 自动批支出入窗；斜率 = 窗口总额 ÷ 窗内首事件起经过分钟数（下限 1 分钟，
   *  防止单笔瞬时支出被 10 分钟窗摊薄而漏报）。超阈即熔断。 */
  recordAutoSpend(usd: number): void {
    const nowMs = this.now().getTime();
    this.state.spend_window = this.state.spend_window.filter((e) => nowMs - e.at_ms <= WINDOW_MS);
    this.state.spend_window.push({ at_ms: nowMs, usd });
    const windowSum = this.state.spend_window.reduce((s, e) => s + e.usd, 0);
    const firstAt = this.state.spend_window[0]?.at_ms ?? nowMs;
    const elapsedMin = Math.max(1, (nowMs - firstAt) / 60_000);
    const slope = windowSum / elapsedMin;
    this.push('spend', { usd, window_sum_usd: Math.round(windowSum * 1000) / 1000, slope_usd_per_min: Math.round(slope * 1000) / 1000 });
    if (slope > this.opts.budget_slope_usd_per_min) {
      this.trip(`预算斜率异常 $${Math.round(slope * 100) / 100}/min > $${this.opts.budget_slope_usd_per_min}/min`);
      return;
    }
    this.save();
  }

  /** 审计回放包导出（含逐事件哈希锚点）。 */
  exportBundle(): string {
    return JSON.stringify(
      {
        exported_at_utc: new Date().toISOString(),
        state: this.snapshot(),
        chain_intact: this.verifyEventChain(),
      },
      null,
      2,
    );
  }

  verifyEventChain(): boolean {
    let previous: string | null = null;
    for (const e of this.state.events) {
      const d = e.detail as Record<string, unknown>;
      if ((d.previous_sha256 as string | null) !== previous) return false;
      const stripped = { ...d };
      delete stripped.previous_sha256;
      delete stripped.sha256;
      const recomputed = sha256Hex(canonicalJson({ at_utc: e.at_utc, kind: e.kind, detail: stripped }));
      if (recomputed !== d.sha256) return false;
      previous = d.sha256 as string;
    }
    return true;
  }
}
