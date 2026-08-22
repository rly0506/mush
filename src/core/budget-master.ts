/**
 * GOAL-068（D2）：全局资金总控门（Master Budget Gate）
 *
 * 多项目热切换架构下，每个工作区拥有独立的项目台账（<ws>/runtime/budget-ledger.jsonl，
 * 单一事实源为项目级审计链）；本模块在其之上提供**机器级跨项目总控**：
 * - 全局唯一台账文件（缺省 ~/.mush/master-ledger.jsonl，append-only，SHA-256 链式锚点）；
 * - 各项目 DispatchPipeline 在自身 admission 之前先过 Master Cap 检查；
 * - 未设上限（capUsd <= 0）时只记账不拦截，随时可在 ~/.mush/master-cap.json 配置。
 *
 * 纪律对齐 CONSTITUTION §1：DENIED 同样落账留证；撕裂行容错跳过并告警。
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './event-log.ts';

export interface MasterAdmissionResult {
  decision: 'ADMITTED' | 'DENIED';
  spent_before_usd: number;
  remaining_usd: number;
  master_cap_usd: number;
  reason?: string;
}

/** DispatchPipeline 依赖的最小门面（避免反向依赖具体类）。 */
export interface MasterBudgetGateLike {
  admit(actorId: string, workspace: string, amountUsd: number): MasterAdmissionResult;
}

function parseJsonLineSafe(line: string, source: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    process.stderr.write(`[mush:budget-master] torn line skipped in ${source}: ${line.slice(0, 120)}\n`);
    return null;
  }
}

export class MasterBudgetGate implements MasterBudgetGateLike {
  private readonly filePath: string;
  private readonly capUsd: number;
  private cachedLastSha: string | null | undefined = undefined;

  constructor(opts: { filePath: string; capUsd: number }) {
    this.filePath = opts.filePath;
    this.capUsd = opts.capUsd;
  }

  get file(): string {
    return this.filePath;
  }

  get cap(): number {
    return this.capUsd;
  }

  private lastSha(): string | null {
    if (this.cachedLastSha !== undefined) return this.cachedLastSha;
    this.cachedLastSha = null;
    if (existsSync(this.filePath)) {
      try {
        const lines = readFileSync(this.filePath, 'utf8').split('\n');
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (lines[i].trim() === '') continue;
          const row = parseJsonLineSafe(lines[i], path.basename(this.filePath));
          if (row && typeof row.sha256 === 'string') {
            this.cachedLastSha = row.sha256 as string;
          }
          break; // 只看最后一条可解析行（坏行不阻断链头定位）
        }
      } catch {}
    }
    return this.cachedLastSha;
  }

  /** 汇总全部 ADMITTED 条目金额（含各项目；DENIED 仅留证不计支出）。 */
  spentAll(): number {
    if (!existsSync(this.filePath)) return 0;
    let total = 0;
    try {
      for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        const row = parseJsonLineSafe(line, path.basename(this.filePath));
        if (row === null) continue;
        if (row.decision !== 'ADMITTED') continue;
        if (typeof row.amount_usd === 'number') total += row.amount_usd;
      }
    } catch {}
    return Math.round(total * 1_000_000) / 1_000_000;
  }

  admit(actorId: string, workspace: string, amountUsd: number): MasterAdmissionResult {
    const amount = Math.max(0, Math.round((Number.isFinite(amountUsd) ? amountUsd : 0) * 1_000_000) / 1_000_000);
    const spentBefore = this.spentAll();
    const allowed = this.capUsd <= 0 || Math.round((spentBefore + amount) * 1_000_000) / 1_000_000 <= this.capUsd;
    const decision: MasterAdmissionResult['decision'] = allowed ? 'ADMITTED' : 'DENIED';
    const body = {
      at_utc: new Date().toISOString(),
      actor_id: actorId,
      workspace,
      decision,
      amount_usd: amount,
      master_cap_usd: this.capUsd,
      spent_before_usd: spentBefore,
      remaining_usd: Math.round((this.capUsd > 0 ? this.capUsd - (allowed ? spentBefore + amount : spentBefore) : 0) * 1_000_000) / 1_000_000,
      previous_sha256: this.lastSha(),
    };
    const sha256 = sha256Hex(canonicalJson(body));
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      appendFileSync(this.filePath, JSON.stringify({ ...body, sha256 }) + '\n', 'utf8');
      this.cachedLastSha = sha256;
    } catch (err) {
      // 总控账写失败不得静默：stderr 告警（链头缓存回退重算）。
      process.stderr.write(`[mush:budget-master] failed to append master ledger: ${err instanceof Error ? err.message : String(err)}\n`);
      this.cachedLastSha = undefined;
    }
    return {
      decision,
      spent_before_usd: body.spent_before_usd,
      remaining_usd: body.remaining_usd,
      master_cap_usd: this.capUsd,
      ...(allowed ? {} : { reason: 'master budget cap exceeded (cross-project)' }),
    };
  }

  /** 重放校验全局哈希链（审计导出/自检用）。 */
  verifyChain(): void {
    let previous: string | null = null;
    if (!existsSync(this.filePath)) return;
    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const row = parseJsonLineSafe(line, path.basename(this.filePath));
      if (row === null) continue;
      if (row.previous_sha256 !== previous) throw new Error('master ledger chain anchor broken');
      const body = { ...row };
      delete body.sha256;
      if (sha256Hex(canonicalJson(body)) !== row.sha256) throw new Error('master ledger hash mismatch');
      previous = row.sha256 as string;
    }
  }
}

/** 读取机器级 Master Cap（~/.mush/master-cap.json {"master_cap_usd": n}）；缺省 0=不限。 */
export function loadMasterCap(homeDir: string = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd()): number {
  const file = path.join(homeDir, '.mush', 'master-cap.json');
  try {
    if (!existsSync(file)) return 0;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { master_cap_usd?: unknown };
    return typeof parsed.master_cap_usd === 'number' && parsed.master_cap_usd > 0 ? parsed.master_cap_usd : 0;
  } catch {
    return 0;
  }
}
