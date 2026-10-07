/**
 * mush 适配器层（M3）— T1 单发 headless + 文件落盘回报通用底座。
 *
 * 合同：docs/capability-probes/harness-landscape-2026-08-16.md T1 档。
 * 沙箱说明（AD-02）：harness 沙箱对 piped-stdio 子进程 spawn 返回 EPERM，
 * 因此 runner 接受可注入 SpawnFn；测试用 fake 子进程验证运行器语义，
 * 生产路径使用同一代码 + 默认 node:child_process spawn。
 */

import { spawn as nodeSpawn, execSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AdapterContract } from './contract.ts';
import { capabilityArgs } from './contract.ts';
import { sha256Hex } from '../core/event-log.ts';
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
  /** GOAL-075 切片2：ndjson-events 归一化回填的结构化会话锚点（ses_…）。 */
  sessionId?: string;
  /** GOAL-084（2026-10-03）：合同 output_parser 声明的通道解析产物（如 agy
   *  三形状结构化结果）；解析失败/无结构化结果 = 缺省，不伪造。 */
  structuredOutput?: unknown;
}

/** GOAL-075 切片2：结构化 stdout 归一化产物（由声明 output_format 的通道提供实现）。 */
export interface OutputNormalization {
  text: string;
  thinking?: string;
  sessionId?: string;
  telemetry?: TokenUsageTelemetry;
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
  /** D82 批次：增量 stderr 透传——opencode 等 CLI 的工具调用/构建进度走
   *  stderr（实证：`$ ls -1 | wc -l`、"> build · model"），只透传 stdout
   *  看不到干活过程。缺失 = 只累积。 */
  onStderr?: (chunk: string) => void;
  /** GOAL-075 切片2：stdout 结构化形态声明 + 归一化器（成对出现）。
   *  进程退出后把 NDJSON 事件流转成人类可读文本，回填 sessionId/tokens。
   *  在途流式 chunk 保持原始形态（节流在宿主侧）。 */
  outputFormat?: 'text' | 'ndjson-events';
  outputNormalizer?: (stdout: string) => OutputNormalization;
  /** D84（2026-09-06）：owner 停止按钮的中断句柄——spawn 成功即注册，
   *  kill 走 ChildProcessLike.kill（默认实现=taskkill 树杀）。缺失 = 该通道不可中断。 */
  registerKill?: (kill: () => void) => void;
  /** GOAL-084 §3.2：讨论通道工具限制（合同未声明 tool_restriction_args 即抛错，fail-closed）。 */
  restrictTools?: boolean;
  /** GOAL-084 §3.2：mush 预写的输出 schema 文件路径（file 运输，如 codex --output-schema）。 */
  outputSchemaPath?: string;
  /** GOAL-084 §3.2：输出 schema JSON 文本（inline 运输，如 claude --json-schema）。 */
  outputSchemaJson?: string;
  /** GOAL-084（2026-10-03，owner 复核缺口 1）：stdout 结构化结果解析器（合同
   *  output_parser 声明的通道由 dispatch 注入）。进程退出后对完整 stdout 调用
   *  一次，产出透传为 T1RunResult.structuredOutput（协调器结构化观点的第一
   *  优先来源）。缺失 = 不解析。 */
  structuredParser?: (stdout: string) => unknown | undefined;
}

/** G009（DEF-03）：Windows npm-global 的 .cmd 垫片不能被 node 直接 spawn
 *（ENOENT/EINVAL）。解析垫片内容找到其真实 JS 入口，改用
 * `node <entry>` 调用——与对调实验的绕行方案同构，但自动化且通用。
 * 返回 null 表示无法解析（保持原样直 spawn，让错误按 DEF-02 路径受控上报）。
 * DEF-12：入口匹配扩展 .mjs/.cjs（kimi 垫片入口为 dist/main.mjs，
 * 旧正则只认 .js 导致看板真实派发 kimi 恒 ENOENT）。
 * D82 批次：原生 .exe 垫片（opencode 等 Go/Rust 系 CLI）——垫片内容指向
 * .exe 而非 JS 入口，旧正则必然失配 → 裸名 spawn 恒 ENOENT。新增 exe 计划：
 * 直接 spawn 解析出的绝对 exe 路径；并在 PATH 找不到垫片时回扫 npm 全局
 * prefix 目录（服务进程 PATH 收窄的场景）。 */
const SHIM_ENTRY_RE = /node_modules[^\r\n"']*\.(?:mjs|cjs|js)/i;
const SHIM_EXE_RE = /node_modules[/\\][^\r\n"']*\.exe/i;

export type WindowsShimResolution =
  | { kind: 'node'; node: string; entry: string }
  | { kind: 'exe'; exe: string };

const shimEntryCache = new Map<string, WindowsShimResolution | null>();
/** GOAL-067（P0-3）：超时 kill 后等待子进程退出的宽限期，到点强制收敛。 */
const T1_KILL_GRACE_MS = 5_000;

let npmPrefixDirsCache: string[] | undefined;
function npmPrefixDirs(): string[] {
  if (npmPrefixDirsCache !== undefined) return npmPrefixDirsCache;
  let dirs: string[] = [];
  try {
    const out = execSync('npm config get prefix', { encoding: 'utf8', timeout: 8000 }).trim();
    if (out !== '' && path.isAbsolute(out)) dirs = [out];
  } catch {}
  npmPrefixDirsCache = dirs;
  return dirs;
}

function parseShimFile(shimPath: string, dir: string): WindowsShimResolution | null {
  const text = readFileSync(shimPath, 'utf8');
  const jsMatch = text.match(SHIM_ENTRY_RE);
  if (jsMatch !== null) {
    return { kind: 'node', node: process.execPath, entry: path.resolve(dir, jsMatch[0]) };
  }
  const exeMatch = text.match(SHIM_EXE_RE);
  if (exeMatch !== null) {
    // 垫片内多为 %dp0%\... 或 $basedir/... 相对形态——相对 dir 解析即绝对路径。
    return { kind: 'exe', exe: path.resolve(dir, exeMatch[0]) };
  }
  return null;
}

export function resolveWindowsShim(executable: string): WindowsShimResolution | null {
  if (process.platform !== 'win32' || path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\')) {
    return null;
  }
  if (shimEntryCache.has(executable)) return shimEntryCache.get(executable) ?? null;
  let resolved: WindowsShimResolution | null = null;
  try {
    const seen = new Set<string>();
    const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...npmPrefixDirs()];
    for (const rawDir of dirs) {
      const dir = rawDir.trim();
      if (dir === '' || seen.has(dir.toLowerCase())) continue;
      seen.add(dir.toLowerCase());
      for (const ext of ['.cmd', '.ps1']) {
        const shim = path.join(dir, `${executable}${ext}`);
        if (!existsSync(shim)) continue;
        resolved = parseShimFile(shim, dir);
        if (resolved !== null) break;
      }
      if (resolved !== null) break;
      // 前缀目录里直接躺着的同名 .exe（无垫片形态）
      const directExe = path.join(dir, `${executable}.exe`);
      if (existsSync(directExe)) {
        resolved = { kind: 'exe', exe: directExe };
        break;
      }
    }
  } catch {
    resolved = null; // 解析失败 fail-closed：回退直 spawn（受 DEF-02 保护）。
  }
  shimEntryCache.set(executable, resolved);
  return resolved;
}

function defaultSpawn(executable: string, args: string[], opts: { cwd: string }): ChildProcessLike {
  const plan = resolveWindowsShim(executable);
  const child =
    plan?.kind === 'node'
      ? nodeSpawn(plan.node, [plan.entry, ...args], { cwd: opts.cwd, windowsHide: true })
      : plan?.kind === 'exe'
        ? nodeSpawn(plan.exe, args, { cwd: opts.cwd, windowsHide: true })
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
    // GOAL-068（A6）：StringDecoder 流式解码——多字节字符（CJK/emoji）跨 chunk
    // 截断时 chunk.toString() 会产生乱码并污染 stdout 哈希锚点。
    onStdout: (listener) => {
      const decoder = new StringDecoder('utf8');
      child.stdout.on('data', (chunk: Buffer) => listener(decoder.write(chunk)));
      child.stdout.on('end', () => {
        const tail = decoder.end();
        if (tail) listener(tail);
      });
    },
    onStderr: (listener) => {
      const decoder = new StringDecoder('utf8');
      child.stderr.on('data', (chunk: Buffer) => listener(decoder.write(chunk)));
      child.stderr.on('end', () => {
        const tail = decoder.end();
        if (tail) listener(tail);
      });
    },
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
  // D82 修订（DEF-14）：声明 cwd_flag 的通道显式钉死工作目录（进程 cwd 对
  // 部分 CLI 不可靠，opencode 实证会自行解析项目根）。旗标置于 prompt 前参之前。
  const cwdDir = options.cwd ?? options.workspaceRoot;
  const cwdArgs = contract.cwd_flag !== undefined ? [contract.cwd_flag, cwdDir] : [];
  // GOAL-084 §3.2：能力注入参数插在合同静态参数之后、cwd/prompt 之前。
  const capability = capabilityArgs(contract, {
    restrictTools: options.restrictTools,
    outputSchemaPath: options.outputSchemaPath,
    outputSchemaJson: options.outputSchemaJson,
  });
  const args =
    contract.prompt_transport === 'argument'
      ? [
          ...contract.arguments,
          ...capability,
          ...cwdArgs,
          // GOAL-084：prompt_flag（如 agy `-p <prompt>`）由 runner 统一收尾拼接——
          // 能力注入参数必须落在该值参旗标之前，否则会被 CLI 当作 prompt。
          ...(contract.prompt_flag !== undefined ? [contract.prompt_flag, options.prompt] : [options.prompt]),
        ]
      : [...contract.arguments, ...capability, ...cwdArgs];
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

  // D84：spawn 成功即向宿主注册树杀句柄（owner 停止按钮）；对已退出进程 kill 为无害空操作。
  options.registerKill?.(() => {
    try {
      child.kill();
    } catch {}
  });

  child.onStdout((chunk) => {
    const text = chunk.toString();
    stdout += text;
    // GOAL-021 U3：增量透传（每次 chunk 原样流出，节流在上一层的 dispatch/chat）。
    options.onStdout?.(text);
  });
  child.onStderr((chunk) => {
    const text = chunk.toString();
    stderr += text;
    options.onStderr?.(text);
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killGraceTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (killGraceTimer !== undefined) clearTimeout(killGraceTimer);
      resolve();
    };
    timer = setTimeout(() => {
      timedOut = true;
      childKilled = true;
      try {
        child.kill();
      } catch {
        // kill 失败仍按超时 fail-closed 收尾。
      }
    }, options.timeoutMs);
    // GOAL-067（P0-3）：第二看门狗——taskkill 与进程信号双双失败（权限不足/
    // 僵尸子进程）时 exit 事件永不到来，Promise 会无限挂起、HTTP 请求与派发
    // 记录一起卡死。grace 到点强制按超时结果收敛，不等待不可靠的 kill 回执。
    killGraceTimer = setTimeout(settle, options.timeoutMs + T1_KILL_GRACE_MS);
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
    } else {
      // D82 修订：argument 运输必须立即关闭 stdin 写端——部分 CLI（opencode 实测）
      // 非 TTY 场景下等 stdin EOF 才开跑，管道恒开 → 子进程永久挂起、派发必然
      // 超时（stdout 恒空）。关闭写端 = 语义上"本 runner 不再投喂 stdin"。
      try {
        child.stdinEnd?.();
      } catch {}
    }
  });

  // GOAL-075 切片2：ndjson-events 归一化——结构化事件流转人类可读文本
  // （思维块前置），回填 sessionId 与真实 token 计量。失败 fail-open 保留原始
  // 输出走旧路径（DEF-02 精神）。在途流式 chunk 不经此处（保持原始形态）。
  let normalizedSessionId: string | undefined;
  let explicitTelemetry: TokenUsageTelemetry | undefined;
  if (options.outputFormat === 'ndjson-events' && options.outputNormalizer !== undefined) {
    try {
      const n = options.outputNormalizer(stdout);
      const head = n.thinking !== undefined && n.thinking !== '' ? 'Thinking: ' + n.thinking + '\n\n' : '';
      stdout = head + n.text;
      if (n.sessionId !== undefined && n.sessionId !== '') normalizedSessionId = n.sessionId;
      if (n.telemetry !== undefined) explicitTelemetry = n.telemetry;
    } catch {
      // 受控降级：归一化异常时按原始输出继续。
    }
  }

  if (options.identityVerifier !== undefined) {
    try {
      options.identityVerifier({ stdout, stderr, exitCode, contract });
    } catch (error) {
      identityError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const telemetry = explicitTelemetry ?? parseTokenTelemetry(stdout, stderr, contract.expected_model_id);


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
    // GOAL-069：回调内赋值不参与外层收窄，此处显式按声明类型读取。
    ...(spawnError !== null ? { spawn_error: (spawnError as Error).message } : {}),
    ...(telemetry ? { telemetry } : {}),
  };

  mkdirSync(path.dirname(path.resolve(options.receiptPath)), { recursive: true });
  writeFileSync(options.receiptPath, JSON.stringify(receipt) + '\n', 'utf8');

  if (spawnError !== null) throw new Error(`spawn failed (BLOCKED_ENV): ${(spawnError as Error).message}`);
  if (identityError !== null) throw identityError;
  // GOAL-084（owner 复核缺口 1）：合同声明解析器的通道在退出后对完整 stdout
  // 提取结构化结果；解析异常受控降级（不伪造、不阻断派发记录）。
  let structuredOutput: unknown | undefined;
  if (options.structuredParser !== undefined) {
    try {
      structuredOutput = options.structuredParser(stdout);
    } catch {
      structuredOutput = undefined;
    }
  }
  return {
    exitCode,
    stdout,
    stderr,
    timedOut,
    childKilled,
    receiptPath: options.receiptPath,
    receipt,
    ...(normalizedSessionId !== undefined ? { sessionId: normalizedSessionId } : {}),
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
  };
}
