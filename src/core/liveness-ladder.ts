/**
 * GOAL-080：犬链探针阶梯（Liveness Ladder）
 *
 * L0 进程层：可执行文件能拉起（--version，恒零成本）
 * L1 鉴权层：合同声明的无副作用探针 argv 通过（--dump-config / models 枚举，恒零成本）
 * L2/L3 实弹层：不主动发起——由 G026 live-probes 台账权威实测（T1_VERIFIED）回填，
 *   模型名以 -free 结尾计 L2（免费实弹），否则 L3（付费实弹）。诚实原则：没跑过就说没跑过。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
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
const execFileP = promisify(execFile);

const WIN_PATHEXT_FALLBACK = ['.COM', '.EXE', '.BAT', '.CMD'];

/** Windows 把裸命令名解析成 PATHEXT 可执行全路径：execFile 不做 PATHEXT 搜索，
 *  dsh/zcode/codex 这类只有 .cmd 垫片的 CLI 直接拉起必然 ENOENT（2026-09-06 实机审计，
 *  见 tests/liveness-realspawn.test.ts）。已带路径或扩展名的输入按存在性校验后原样返回；
 *  非 win32 原样透传；解析失败返回 undefined，由调用方产出诚实错误。 */
export function resolveWindowsExecutable(
  executable: string,
  pathEnv: string = process.env.PATH ?? '',
  pathExtEnv: string = process.env.PATHEXT ?? '',
): string | undefined {
  if (process.platform !== 'win32') return executable;
  const hasPathSep = executable.includes('\\') || executable.includes('/');
  const hasExecExt = /\.(exe|cmd|bat|com)$/i.test(executable);
  if (hasPathSep || hasExecExt) return existsSync(executable) ? executable : undefined;
  const declared = pathExtEnv.split(';').map((s) => s.trim()).filter((s) => s !== '');
  const exts = declared.length > 0 ? declared : WIN_PATHEXT_FALLBACK;
  for (const dir of pathEnv.split(';')) {
    if (dir.trim() === '') continue;
    for (const ext of exts) {
      const candidate = join(dir, executable + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** stdlib 探针：execFile 自带 timeout 杀进程；错误对象携带部分 stdout/stderr。
 *  win32 下先做 PATHEXT 解析；.cmd/.bat 垫片必须经 shell 拉起（Node ≥18.20 安全策略
 *  拒绝无 shell 直接 spawn 批处理，CVE-2024-27980）。args 来自适配器合同（静态 flag），非用户输入。 */
async function defaultSpawn(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const resolved = resolveWindowsExecutable(executable);
  if (resolved === undefined) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: `[liveness] 可执行文件未在 PATH/PATHEXT 解析到（${executable}；Windows .cmd 垫片需解析后拉起）`,
    };
  }
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
  try {
    const { stdout, stderr } = await execFileP(
      needsShell ? `"${resolved}"` : resolved,
      [...args],
      { windowsHide: true, timeout: timeoutMs, shell: needsShell },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err.message ?? err),
    };
  }
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
      detail: `L0 进程探针失败（${contract.executable} --version exit ${l0.exitCode}）：${(l0.stderr || l0.stdout || 'no output').slice(0, 160)}（修复指引：确认 ${contract.executable} 已安装并在 PATH（Windows 下 .cmd 垫片需可经 PATHEXT 解析），或运行 scripts/setup-harnesses.cmd）`,
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
  const entry = Object.entries(record.model_tiers).find(([, tier]) => tier === 'T1_VERIFIED');
  return entry !== undefined ? { model: entry[0], ageHours } : undefined;
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
