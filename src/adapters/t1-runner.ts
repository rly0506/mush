/**
 * mush 适配器层（M3）— T1 单发 headless + 文件落盘回报通用底座。
 *
 * 合同：docs/capability-probes/harness-landscape-2026-08-16.md T1 档。
 * 沙箱说明（AD-02）：harness 沙箱对 piped-stdio 子进程 spawn 返回 EPERM，
 * 因此 runner 接受可注入 SpawnFn；测试用 fake 子进程验证运行器语义，
 * 生产路径使用同一代码 + 默认 node:child_process spawn。
 */

import { createHash } from 'node:crypto';
import { spawn as nodeSpawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AdapterContract } from './contract.ts';
import { type TokenUsageTelemetry, calculateTokenCostAndSavings } from '../core/budget.ts';

export function killProcessTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
}

export interface ChildProcessLike {
  stdinWrite?(chunk: string): void;
  stdinEnd?(): void;
  onStdout(listener: (chunk: Buffer | string) => void): void;
  onStderr(listener: (chunk: Buffer | string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** DEF-02：spawn 失败（ENOENT/EPERM 等）经此送达；缺失即可执行文件不存在，
   *  必须 fail-closed 为受控结果而非未处理 error 崩溃宿主进程。 */
  onError?(listener: (err: Error) => void): void;
  kill(): void;
}

export type SpawnFn = (
  executable: string,
  args: string[],
  opts: { cwd: string },
) => ChildProcessLike;

export interface T1IdentityEvidence {
  stdout: string;
  stderr: string;
  exitCode: number;
  contract: AdapterContract;
}

export interface T1Receipt {
  schema_version: 1;
  adapter_id: string;
  started_at_utc: string;
  finished_at_utc: string;
  exit_code: number;
  timed_out: boolean;
  child_killed: boolean;
  identity_fail_closed: boolean;
  stdout_sha256: string;
  stderr_sha256: string;
  /** DEF-02：spawn 失败（可执行不存在等）时的受控错误标记。 */
  spawn_error?: string;
  /** GOAL-056：零开销本地提取的真实 Token 与费用回执（含 Prompt Cache 细分）。 */
  telemetry?: TokenUsageTelemetry;
}


export interface T1RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
  receiptPath: string;
  receipt: T1Receipt;
}

export interface T1RunOptions {
  contract: AdapterContract;
  prompt: string;
  workspaceRoot: string;
  receiptPath: string;
  timeoutMs: number;
  spawn?: SpawnFn;
  identityVerifier?: (evidence: T1IdentityEvidence) => void;
  /** GOAL-014（M0）：carve-out 指定的犬工作根（spawn cwd）；缺省回退 workspaceRoot。 */
  cwd?: string;
  /** GOAL-021 U3：增量 stdout 透传钩子（聊天流式/EXECUTE 增量事件源）。
   *  每个原始 chunk 到达即调用，宿主（dispatch/chat）负责节流合帧。缺失 = 只累积不流转。 */
  onStdout?: (chunk: string) => void;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

/** G009（DEF-03）：Windows npm-global 的 .cmd 垫片不能被 node 直接 spawn
 *（ENOENT/EINVAL）。解析垫片内容找到其真实 JS 入口，改用
 * `node <entry>` 调用——与对调实验的绕行方案同构，但自动化且通用。
 * 返回 null 表示无法解析（保持原样直 spawn，让错误按 DEF-02 路径受控上报）。
 * DEF-12：入口匹配扩展 .mjs/.cjs（kimi 垫片入口为 dist/main.mjs，
 * 旧正则只认 .js 导致看板真实派发 kimi 恒 ENOENT）。 */
const SHIM_ENTRY_RE = /node_modules[^\r\n"']*\.(?:mjs|cjs|js)/i;
const shimEntryCache = new Map<string, { node: string; entry: string } | null>();
export function resolveWindowsShim(executable: string): { node: string; entry: string } | null {
  if (process.platform !== 'win32' || path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\')) {
    return null;
  }
  if (shimEntryCache.has(executable)) return shimEntryCache.get(executable) ?? null;
  let resolved: { node: string; entry: string } | null = null;
  try {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (dir.trim() === '') continue;
      const shim = path.join(dir, `${executable}.cmd`);
      if (!existsSync(shim)) continue;
      const text = readFileSync(shim, 'utf8');
      const match = text.match(SHIM_ENTRY_RE);
      if (match === null) continue;
      const entry = path.resolve(dir, match[0]);
      resolved = { node: process.execPath, entry };
      break;
    }
  } catch {
    resolved = null; // 解析失败 fail-closed：回退直 spawn（受 DEF-02 保护）。
  }
  shimEntryCache.set(executable, resolved);
  return resolved;
}

function defaultSpawn(executable: string, args: string[], opts: { cwd: string }): ChildProcessLike {
  const shim = resolveWindowsShim(executable);
  const child =
    shim !== null
      ? nodeSpawn(shim.node, [shim.entry, ...args], { cwd: opts.cwd, windowsHide: true })
      : nodeSpawn(executable, args, { cwd: opts.cwd, windowsHide: true });
  // GOAL-065: 防御 EPIPE 崩溃——子进程提前退出时忽略写入管道错误
  if (child.stdin !== null) {
    child.stdin.on('error', () => {});
  }
  return {
    stdinWrite: (chunk) => {
      try {
        if (child.stdin !== null && child.stdin.writable) child.stdin.write(chunk);
      } catch {}
    },
    stdinEnd: () => {
      try {
        if (child.stdin !== null && child.stdin.writable) child.stdin.end();
      } catch {}
    },
    onStdout: (listener) => child.stdout.on('data', listener),
    onStderr: (listener) => child.stderr.on('data', listener),
    onExit: (listener) => child.on('exit', listener),
    onError: (listener) => child.on('error', listener),
    kill: () => killProcessTree(child.pid),
  };
}

export function parseTokenTelemetry(stdout: string, stderr: string, modelId?: string): TokenUsageTelemetry | undefined {
  const combined = stdout + '\n' + stderr;
  let input = 0;
  let output = 0;
  let cacheCreation = 0;
  let cacheRead = 0;
  let found = false;

  // 1. JSON-formatted usage (e.g. Claude stream-json, OpenAI/DeepSeek API output)
  const jsonMatch = /"usage"\s*:\s*\{([^}]+)\}/i.exec(combined);
  if (jsonMatch) {
    try {
      const block = JSON.parse(`{${jsonMatch[0]}}`);
      const u = block.usage || {};
      if (typeof u.input_tokens === 'number' || typeof u.prompt_tokens === 'number') {
        input = u.input_tokens ?? u.prompt_tokens ?? 0;
        output = u.output_tokens ?? u.completion_tokens ?? 0;
        cacheCreation = u.cache_creation_input_tokens ?? u.prompt_cache_miss_tokens ?? 0;
        cacheRead = u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? 0;
        found = true;
      }
    } catch {}
  }

  // 2. Line-by-line CLI text patterns (e.g. "Tokens: 1,234 input, 567 output, 8,900 cached")
  if (!found) {
    const tokensLineMatch = /(?:tokens?|usage)[:：]\s*([\d,]+)\s*(?:input|prompt)?\s*[,，/]\s*([\d,]+)\s*(?:output|completion)?/i.exec(combined);
    if (tokensLineMatch) {
      input = parseInt(tokensLineMatch[1].replace(/,/g, ''), 10) || 0;
      output = parseInt(tokensLineMatch[2].replace(/,/g, ''), 10) || 0;
      const cacheMatch = /(?:(?:cache|cached)[:：\s]+([\d,]+)|([\d,]+)\s*(?:cached|cache))/i.exec(combined);
      if (cacheMatch) cacheRead = parseInt((cacheMatch[1] || cacheMatch[2]).replace(/,/g, ''), 10) || 0;
      found = true;
    }

  }

  // 3. Comment pattern (e.g. <!-- token_usage: {"input":100,"output":50,"cache_read":500} -->)
  if (!found) {
    const commentMatch = /<!--\s*token_usage\s*:\s*(\{.+?\})\s*-->/i.exec(combined);
    if (commentMatch) {
      try {
        const u = JSON.parse(commentMatch[1]);
        input = u.input ?? u.input_tokens ?? 0;
        output = u.output ?? u.output_tokens ?? 0;
        cacheCreation = u.cache_creation ?? u.cache_creation_tokens ?? 0;
        cacheRead = u.cache_read ?? u.cache_read_tokens ?? 0;
        found = true;
      } catch {}
    }
  }

  if (!found) return undefined;

  const cost = calculateTokenCostAndSavings({
    input_tokens: input,
    output_tokens: output,
    cache_creation_tokens: cacheCreation,
    cache_read_tokens: cacheRead,
  }, modelId);

  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_tokens: cacheCreation,
    cache_read_tokens: cacheRead,
    total_cost_usd: cost.total_cost_usd,
    cache_savings_usd: cost.cache_savings_usd,
  };
}

/**
 * 跑一个 T1 单发：prompt 按合同（stdin 或最终参数）交给子进程，超时 fail-closed
 * kill，收 stdout/stderr/exit code，写带哈希锚点的文件回报；identityVerifier
 * 抛错即身份 fail-closed（回报仍落盘并标记）。
 */
export async function runT1(options: T1RunOptions): Promise<T1RunResult> {

  const contract = options.contract;
  if (contract.protocol !== 't1') {
    throw new Error(`T1 runner only accepts protocol 't1', got '${contract.protocol}'`);
  }
  const spawn = options.spawn ?? defaultSpawn;
  const args =
    contract.prompt_transport === 'argument'
      ? [...contract.arguments, options.prompt]
      : [...contract.arguments];
  const startedAt = new Date().toISOString();

  let child: ChildProcessLike;
  try {
    child = spawn(contract.executable, args, { cwd: options.cwd ?? options.workspaceRoot });
  } catch (error) {
    // DEF-02 环境自适应：沙箱可能让 nodeSpawn 同步抛 EPERM——同样受控收尾。
    const spawnError = error instanceof Error ? error : new Error(String(error));
    const receipt: T1Receipt = {
      schema_version: 1,
      adapter_id: contract.adapter_id,
      started_at_utc: startedAt,
      finished_at_utc: new Date().toISOString(),
      exit_code: 127,
      timed_out: false,
      child_killed: false,
      identity_fail_closed: false,
      stdout_sha256: sha256Hex(''),
      stderr_sha256: sha256Hex(''),
      spawn_error: spawnError.message,
    };
    mkdirSync(path.dirname(path.resolve(options.receiptPath)), { recursive: true });
    writeFileSync(options.receiptPath, JSON.stringify(receipt) + '\n', 'utf8');
    throw new Error(`spawn failed (BLOCKED_ENV): ${spawnError.message}`);
  }

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let childKilled = false;
  let exitCode = 124;
  let identityError: Error | null = null;
  let spawnError: Error | null = null;

  child.onStdout((chunk) => {
    const text = chunk.toString();
    stdout += text;
    // GOAL-021 U3：增量透传（每次 chunk 原样流出，节流在上一层的 dispatch/chat）。
    options.onStdout?.(text);
  });
  child.onStderr((chunk) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      childKilled = true;
      try {
        child.kill();
      } catch {
        // kill 失败仍按超时 fail-closed 收尾。
      }
    }, options.timeoutMs);
    child.onExit((code) => {
      exitCode = timedOut ? 124 : (code ?? 124);
      settle();
    });
    // DEF-02：spawn 失败（可执行不存在/权限）受控收尾，不崩溃宿主。
    child.onError?.((err) => {
      spawnError = err;
      exitCode = 127;
      settle();
    });
    if (contract.prompt_transport === 'stdin') {
      // DEF-02 环境自适应：沙箱对 piped-stdio spawn 同步抛 EPERM（可能发生在
      // 首次 stdin write 而非 async error 事件）——同样按 spawn 失败受控收尾。
      try {
        child.stdinWrite?.(options.prompt);
        child.stdinEnd?.();
      } catch (error) {
        spawnError = error instanceof Error ? error : new Error(String(error));
        exitCode = 127;
        settle();
      }
    }
  });

  if (options.identityVerifier !== undefined) {
    try {
      options.identityVerifier({ stdout, stderr, exitCode, contract });
    } catch (error) {
      identityError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const telemetry = parseTokenTelemetry(stdout, stderr, contract.expected_model_id);


  const receipt: T1Receipt = {
    schema_version: 1,
    adapter_id: contract.adapter_id,
    started_at_utc: startedAt,
    finished_at_utc: new Date().toISOString(),
    exit_code: exitCode,
    timed_out: timedOut,
    child_killed: childKilled,
    identity_fail_closed: identityError !== null,
    stdout_sha256: sha256Hex(stdout),
    stderr_sha256: sha256Hex(stderr),
    // DEF-02：spawn 失败受控标记（ENOENT/EPERM 等），exit_code=127。
    ...(spawnError !== null ? { spawn_error: spawnError.message } : {}),
    ...(telemetry ? { telemetry } : {}),
  };

  mkdirSync(path.dirname(path.resolve(options.receiptPath)), { recursive: true });
  writeFileSync(options.receiptPath, JSON.stringify(receipt) + '\n', 'utf8');

  if (spawnError !== null) throw new Error(`spawn failed (BLOCKED_ENV): ${spawnError.message}`);
  if (identityError !== null) throw identityError;
  return {
    exitCode,
    stdout,
    stderr,
    timedOut,
    childKilled,
    receiptPath: options.receiptPath,
    receipt,
  };
}
