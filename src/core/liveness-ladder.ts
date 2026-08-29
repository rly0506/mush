/**
 * GOAL-080：犬链探针阶梯（Liveness Ladder）
 *
 * L0 进程层：可执行文件能拉起（--version，恒零成本）
 * L1 鉴权层：合同声明的无副作用探针 argv 通过（--dump-config / models 枚举，恒零成本）
 * L2/L3 实弹层：不主动发起——由 G026 live-probes 台账权威实测（T1_VERIFIED）回填，
 *   模型名以 -free 结尾计 L2（免费实弹），否则 L3（付费实弹）。诚实原则：没跑过就说没跑过。
 */

import { spawn } from 'node:child_process';
import type { AdapterContract } from '../adapters/contract.ts';
import { loadLiveProbeCache, type LiveProbeRecord } from '../adapters/live-probe.ts';

export type LivenessLabel =
  | 'DEAD'
  | 'PROCESS_ONLY'
  | 'AUTH_VERIFIED'
  | 'FREE_ROUND_VERIFIED'
  | 'PAID_ROUND_VERIFIED';

export interface LivenessResult {
  adapter_id: string;
  level_reached: 0 | 1 | 2 | 3;
  ok: boolean;
  label: LivenessLabel;
  detail: string;
  checked_at_utc: string;
}

export interface LivenessDeclaration {
  /** L1 鉴权层探针 argv（如 ['--dump-config']），exit 0 即过；缺省 = 该通道只认 L0。 */
  l1_args?: readonly string[];
  /** L1 附加 stdout 断言（子串包含）。 */
  l1_expect_stdout?: string;
}

export type SpawnLivenessFn = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const L0_TIMEOUT_MS = 10_000;

function defaultSpawn(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(executable, args, { windowsHide: true });
    } catch (e) {
      resolve({ exitCode: -1, stdout: '', stderr: String(e) });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ exitCode: -1, stdout, stderr: stderr + '\n[liveness] probe timeout' });
      }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: -1, stdout: '', stderr: String(e) });
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, stdout, stderr });
      }
    });
  });
}

/** 评估单犬阶梯（不缓存）。spawnFn 可注入（测试零副作用）。 */
export async function evaluateLiveness(
  adapterId: string,
  contract: AdapterContract,
  opts: {
    now?: () => Date;
    spawnFn?: SpawnLivenessFn;
    probeRecord?: LiveProbeRecord;
  } = {},
): Promise<LivenessResult> {
  const now = opts.now ?? (() => new Date());
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const at = now().toISOString();
  // L0：进程层——--version 能拉起
  const l0 = await spawnFn(contract.executable, ['--version'], L0_TIMEOUT_MS);
  if (l0.exitCode !== 0) {
    return {
      adapter_id: adapterId,
      level_reached: 0,
      ok: false,
      label: 'DEAD',
      detail: `L0 进程探针失败（${contract.executable} --version exit ${l0.exitCode}）：${(l0.stderr || l0.stdout || 'no output').slice(0, 160)}`,
      checked_at_utc: at,
    };
  }
  // L1：鉴权层——合同声明的无副作用探针
  const decl = contract.liveness as LivenessDeclaration | undefined;
  if (decl?.l1_args === undefined) {
    return {
      adapter_id: adapterId,
      level_reached: 1,
      ok: true,
      label: 'PROCESS_ONLY',
      detail: 'L0 通过；通道未声明 L1 探针（可调度·未实弹）',
      checked_at_utc: at,
    };
  }
  const l1 = await spawnFn(contract.executable, [...decl.l1_args], L0_TIMEOUT_MS);
  const expectOk =
    l1.exitCode === 0 &&
    (decl.l1_expect_stdout === undefined || l1.stdout.includes(decl.l1_expect_stdout));
  if (!expectOk) {
    return {
      adapter_id: adapterId,
      level_reached: 1,
      ok: false,
      label: 'DEAD',
      detail: `L1 鉴权探针失败（${decl.l1_args.join(' ')} exit ${l1.exitCode}）：${(l1.stderr || l1.stdout || 'no output').slice(0, 160)}`,
      checked_at_utc: at,
    };
  }
  // L2/L3：由 live-probes 权威实测台账回填（不主动发起，恒零成本）
  const tier = bestVerifiedTier(opts.probeRecord);
  if (tier !== undefined) {
    const isFree = tier.model.endsWith('-free');
    return {
      adapter_id: adapterId,
      level_reached: isFree ? 2 : 3,
      ok: true,
      label: isFree ? 'FREE_ROUND_VERIFIED' : 'PAID_ROUND_VERIFIED',
      detail: `L1 通过 + 实弹回执在档（${tier.model}，${tier.ageHours.toFixed(1)}h 前）`,
      checked_at_utc: at,
    };
  }
  return {
    adapter_id: adapterId,
    level_reached: 1,
    ok: true,
    label: 'AUTH_VERIFIED',
    detail: 'L1 通过；尚无实弹回执（可调度·未实弹）',
    checked_at_utc: at,
  };
}

function bestVerifiedTier(
  record?: LiveProbeRecord,
): { model: string; ageHours: number } | undefined {
  if (record?.model_tiers === undefined || record.checked_at_utc === undefined) return undefined;
  const ageHours = (Date.now() - new Date(record.checked_at_utc).getTime()) / 3_600_000;
  if (ageHours > 24) return undefined; // 台账时效：>24h 的实测不再充当实弹凭证
  let best: { model: string; ageHours: number } | undefined;
  for (const [model, tier] of Object.entries(record.model_tiers)) {
    if (tier !== 'T1_VERIFIED') continue;
    if (best === undefined) best = { model, ageHours };
  }
  return best;
}

export interface LivenessGate {
  check(adapterId: string): Promise<LivenessResult>;
  refresh(adapterId: string): Promise<LivenessResult>;
  snapshot(): LivenessResult[];
}

/** 带 TTL 缓存的门（管线预检用）。spawnFn 可注入（测试零副作用、零网络）。
 *  contracts 支持传表或惰性 thunk（server 侧合同表随工作区热切换，取当前值）。 */
export function createLivenessGate(opts: {
  contracts: Record<string, AdapterContract> | (() => Record<string, AdapterContract>);
  liveProbesPath?: string;
  ttlMs?: number;
  now?: () => Date;
  spawnFn?: SpawnLivenessFn;
}): LivenessGate {
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const now = opts.now ?? (() => new Date());
  const contractsOf = (): Record<string, AdapterContract> =>
    typeof opts.contracts === 'function' ? opts.contracts() : opts.contracts;
  const cache = new Map<string, LivenessResult>();
  let probeRecords: Record<string, LiveProbeRecord> | undefined;
  if (opts.liveProbesPath !== undefined) {
    try {
      probeRecords = loadLiveProbeCache(opts.liveProbesPath);
    } catch {
      probeRecords = undefined;
    }
  }
  async function evaluate(adapterId: string): Promise<LivenessResult> {
    const contract = contractsOf()[adapterId];
    if (contract === undefined) {
      return {
        adapter_id: adapterId,
        level_reached: 0,
        ok: false,
        label: 'DEAD',
        detail: `unknown adapter: ${adapterId}`,
        checked_at_utc: now().toISOString(),
      };
    }
    return evaluateLiveness(adapterId, contract, {
      now,
      spawnFn: opts.spawnFn,
      probeRecord: probeRecords?.[adapterId],
    });
  }
  return {
    async check(adapterId) {
      const hit = cache.get(adapterId);
      if (hit !== undefined && now().getTime() - new Date(hit.checked_at_utc).getTime() < ttl) return hit;
      const fresh = await evaluate(adapterId);
      cache.set(adapterId, fresh);
      return fresh;
    },
    async refresh(adapterId) {
      const fresh = await evaluate(adapterId);
      cache.set(adapterId, fresh);
      return fresh;
    },
    snapshot() {
      return [...cache.values()];
    },
  };
}
