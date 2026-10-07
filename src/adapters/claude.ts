/**
 * mush 适配器层（M3）— Claude Code 犬：claude -p --output-format stream-json（T2）。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md（claude 行：
 *   T1 -p 非交互；T2 --output-format stream-json 配 --print）。
 * 真实长任务在 M3 仅在 owner D6 确认后执行；本模块与测试使用录制/fake 流。
 */

import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateAdapterContract, capabilityArgs, type AdapterContract } from './contract.ts';
import { type ChildProcessLike, type SpawnFn, killProcessTree, resolveWindowsShim } from './t1-runner.ts';
import { makeNonce, parseNonceResponse, type NonceMaterial } from './deepseek.ts';

export function buildClaudeContract(expectedModelId: string): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'claude-code',
    executable: 'claude',
    // --model 必须显式下发：否则渠道可能服务其默认模型（claude-real-008 教训：
    // 合同要 sonnet、渠道给了 fable）。
    arguments: ['-p', '--model', expectedModelId, '--output-format', 'stream-json', '--verbose'],
    protocol: 'stream-json',
    prompt_transport: 'argument',
    expected_provider: 'anthropic',
    expected_model_id: expectedModelId,
    // G009：变体切换实证可用（claude-real-011 经 --model 下发生效）。
    variants: ['claude-sonnet-5', 'claude-sonnet-4-5'],
    model_flag: '--model',
    // GP-22：claude --help 实测（2026-08-17）：
    //   --effort <level>  Effort level for the current session (low, medium, high, xhigh, max)
    effort_levels: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'],
    effort_injection: { kind: 'flag', name: '--effort' },
    // GOAL-018 U2/U3：claude 支持 -r/--resume 指定会话；自带自动压缩。
    resume_flag: '--resume',
    context_management: 'auto-compact',
    // GOAL-084 §3.2（2026-10-01）：协作通道能力声明——本机 `claude --help`
    //（claude 2.1.281）实录：`--tools ""` 禁用全部内建工具（"Use \"\" to
    // disable all"）、`--strict-mcp-config` 只用 --mcp-config 声明的 MCP、
    // `--json-schema <schema>` 结构化输出（schema 为 inline 值而非文件）。
    // **实弹行为未验证**（真实派发需 owner 获批后逐项核验）。
    tool_restriction_args: ['--tools', '', '--strict-mcp-config'],
    output_schema_flag: '--json-schema',
    output_schema_inline: true,
  });
}

export interface StreamIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export interface ClaudeStream {
  identity: StreamIdentity;
  resultText: string;
  /** GOAL-084 §3.2：result 事件的 structured_output（--json-schema 生效时的结构化
   *  回答）；未提供则缺省——mush 侧语义校验不依赖通道能力。 */
  structuredOutput?: unknown;
  totalCostUsd: number | null;
  ended: boolean;
  messageCount: number;
  sessionId: string | null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 解析 claude stream-json：init 模型身份、assistant/result 消息、成本与结束标志。
 *
 *  GOAL-085（终局优先级，2026-10-05 独立复核）：同一条 stdout 上可能有多条 `result`
 *  事件（C11 实测两条：先草稿、后更正）。`resultText`/`structuredOutput`/成本/结束时点
 *  一律**只由最后一个权威终局**决定：
 *    - 终局内优先 `structured_output`，无则用结果文本；
 *    - 终局失败（`subtype≠success` 或 `is_error`）时**不保留任何字段**——否则更早那条
 *      终局的 `structured_output` 会残留下来，绕过失败终局被当作结果（实测复现）。
 *  逐行"后行覆盖前行、且带字段才覆盖"的旧写法在下列两种情形都会让早期草稿胜出：
 *  (a) 最后成功终局只在文本里给答案；(b) 最后终局失败。 */
export function parseClaudeStreamJson(stdout: string): ClaudeStream {
  let provider = 'UNKNOWN';
  let modelId = 'UNKNOWN';
  let ended = false;
  let messageCount = 0;
  let sessionId: string | null = null;
  let terminal: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown = null;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    const type = textOf(record.type);
    if (type === 'system') {
      const model = record.model;
      if (typeof model === 'string' && model.trim() !== '') modelId = model.trim();
      const providerField = record.provider;
      if (typeof providerField === 'string' && providerField.trim() !== '') provider = providerField.trim();
      const sid = record.session_id;
      if (typeof sid === 'string' && sid.trim() !== '') sessionId = sid.trim();
    } else if (type === 'assistant') {
      messageCount += 1;
    } else if (type === 'result') {
      messageCount += 1;
      terminal = record; // 只有最后一条生效
    }
  }
  let resultText = '';
  let structuredOutput: unknown = undefined;
  let totalCostUsd: number | null = null;
  if (terminal !== null) {
    const subtype = terminal.subtype;
    const failed = terminal.is_error === true || (typeof subtype === 'string' && subtype !== 'success');
    // resultText 忠实描述**最后一条终局**的文本（诊断用，失败终局也如实保留）；
    // 但结构化字段是"答案"，失败终局自身不可信、更不许沿用更早终局的缓存值。
    resultText = textOf(terminal.result);
    if (!failed && terminal.structured_output !== undefined) structuredOutput = terminal.structured_output;
    const cost = terminal.total_cost_usd;
    if (typeof cost === 'number') totalCostUsd = cost;
    ended = subtype === 'success' || subtype === 'error';
    const sid = terminal.session_id;
    if (typeof sid === 'string' && sid.trim() !== '') sessionId = sid.trim();
  }
  return {
    identity: {
      provider: provider === 'UNKNOWN' ? 'anthropic' : provider,
      modelId,
      proven: modelId !== 'UNKNOWN',
    },
    resultText,
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    totalCostUsd,
    ended,
    messageCount,
    sessionId,
  };
}

export interface ClaudeStreamRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
  /** result 文本（stream-json result 事件）；空回退原始 stdout。 */
  resultText: string;
  sessionId?: string;
  /** GOAL-084 §3.2：result 事件的 structured_output（--json-schema 生效时的结构化回答）。 */
  structuredOutput?: unknown;
  totalCostUsd?: number;
}

export interface ClaudeStreamRunOptions {
  contract: AdapterContract;
  prompt: string;
  workspaceRoot: string;
  timeoutMs: number;
  cwd?: string;
  /** GOAL-072：附加环境变量（如 CLAUDE_CODE_MAX_OUTPUT_TOKENS 压低预扣费，
   *  通道矩阵实证 402 = 64000 上限超出余额时的可行解）。 */
  extraEnv?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  spawn?: SpawnFn;
  /** D84/GOAL-084：spawn 成功即向宿主注册树杀句柄（owner 停止按钮与会话级取消共用）；
   *  对已退出进程 kill 为无害空操作。此前仅 t1 通道支持，claude 分支不可中断。 */
  registerKill?: (kill: () => void) => void;
  /** GOAL-084 §3.2：讨论通道工具限制（合同未声明 tool_restriction_args 即抛错，fail-closed）。 */
  restrictTools?: boolean;
  /** GOAL-084 §3.2：mush 预写的输出 schema 文件路径（file 运输，如 codex --output-schema）。 */
  outputSchemaPath?: string;
  /** GOAL-084 §3.2：输出 schema JSON 文本（inline 运输，如 claude --json-schema）。 */
  outputSchemaJson?: string;
}

/** GOAL-072 通道修复：stream-json 协议泛用执行路径——此前泛用管线只支持
 *  t1/pi-rpc，claude-code 无法经看板派发（通道矩阵实证）。语义与 nonce 探针
 *  同构：argument 运输 + 超时 kill + parseClaudeStreamJson 提取结果/会话/成本。 */
export async function runClaudeStreamRun(options: ClaudeStreamRunOptions): Promise<ClaudeStreamRunResult> {
  const spawn: SpawnFn =
    options.spawn ??
    ((executable, args, opts) => {
      const plan = resolveWindowsShim(executable);
      const child =
        plan?.kind === 'node'
          ? nodeSpawn(plan.node, [plan.entry, ...args], { cwd: opts.cwd, windowsHide: true })
          : plan?.kind === 'exe'
            ? nodeSpawn(plan.exe, args, { cwd: opts.cwd, windowsHide: true })
            : nodeSpawn(executable, args, { cwd: opts.cwd, windowsHide: true });
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
        onStdout: (listener) => {
          const decoder = new StringDecoder('utf8');
          child.stdout.on('data', (buf: Buffer) => listener(decoder.write(buf)));
          child.stdout.on('end', () => {
            const tail = decoder.end();
            if (tail) listener(tail);
          });
        },
        onStderr: (listener) => {
          const decoder = new StringDecoder('utf8');
          child.stderr.on('data', (buf: Buffer) => listener(decoder.write(buf)));
          child.stderr.on('end', () => {
            const tail = decoder.end();
            if (tail) listener(tail);
          });
        },
        onExit: (listener) => child.on('exit', listener),
        onError: (listener) => child.on('error', listener),
        kill: () => killProcessTree(child.pid),
      } as ChildProcessLike;
    });
  // GOAL-084 §3.2：能力注入参数插在合同静态参数之后、运行时 prompt 之前。
  const capability = capabilityArgs(options.contract, {
    restrictTools: options.restrictTools,
    outputSchemaPath: options.outputSchemaPath,
    outputSchemaJson: options.outputSchemaJson,
  });
  const args =
    options.contract.prompt_transport === 'argument'
      ? [...options.contract.arguments, ...capability, options.prompt]
      : [...options.contract.arguments, ...capability];
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let killed = false;
  let exitCode = 124;
  const child = spawn(options.contract.executable, args, {
    cwd: options.cwd ?? options.workspaceRoot,
    ...(options.extraEnv !== undefined ||
    process.env.MUSH_CLAUDE_MAX_OUTPUT_TOKENS !== undefined ||
    options.contract.provider_base_url !== undefined
      ? {
          env: {
            ...(process.env as Record<string, string>),
            ...(process.env.MUSH_CLAUDE_MAX_OUTPUT_TOKENS !== undefined
              ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.MUSH_CLAUDE_MAX_OUTPUT_TOKENS }
              : {}),
            // provider 网关：合同声明 Anthropic 兼容端点 + 宿主环境密钥（不入库）。
            ...(options.contract.provider_base_url !== undefined
              ? {
                  ANTHROPIC_BASE_URL: options.contract.provider_base_url,
                  ...(() => {
                    const keyEnv =
                      'MUSH_' + options.contract.adapter_id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
                    const key = process.env[keyEnv];
                    return key !== undefined && key !== '' ? { ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: key } : {};
                  })(),
                }
              : {}),
            ...options.extraEnv,
          },
        }
      : {}),
  });
  // D84/GOAL-084：句柄注册（树杀经 SpawnFn.kill → killProcessTree）；已退出进程无害。
  options.registerKill?.(() => {
    try {
      child.kill();
    } catch {}
  });
  child.onStdout((chunk) => {
    stdout += chunk.toString();
    options.onStdout?.(chunk.toString());
  });
  child.onStderr((chunk) => {
    stderr += chunk.toString();
    options.onStderr?.(chunk.toString());
  });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
        killed = true;
      } catch {}
      resolve();
    }, options.timeoutMs);
    child.onExit((code) => {
      exitCode = code ?? 1;
      clearTimeout(timer);
      resolve();
    });
    child.onError?.(() => {
      exitCode = exitCode === 124 ? 127 : exitCode;
    });
  });
  const parsed = parseClaudeStreamJson(stdout);
  return {
    exitCode,
    // GOAL-085（2026-10-05 独立审核发现）：**不得丢弃原始流**。
    // 此前 `stdout: parsed.resultText !== '' ? parsed.resultText : stdout` 会把 stream-json 压成
    // 一行 final text，于是原生 `system/init`（模型身份）、`tool_use`/`tool_result`、
    // `permission_denied`、`task_*` 等**可核验事实全部丢失**，任何"模型到底做了什么"的判断
    // 都退化成只能相信模型自报。现在 stdout 一律返回累积的原始流；解析结果仍由
    // `resultText`/`structuredOutput` 单独提供（协调器已能直接读取 structuredOutput）。
    stdout,
    stderr,
    timedOut,
    childKilled: killed,
    resultText: parsed.resultText,
    ...(parsed.structuredOutput !== undefined ? { structuredOutput: parsed.structuredOutput } : {}),
    ...(parsed.sessionId !== null ? { sessionId: parsed.sessionId } : {}),
    ...(parsed.totalCostUsd !== null ? { totalCostUsd: parsed.totalCostUsd } : {}),
  };
}

export interface ClaudeNonceProbeResult {
  adapterId: string;
  identity: StreamIdentity;
  nonce: string;
  expectedSha256: string;
  observed: string | null;
  matched: boolean;
  totalCostUsd: number | null;
  evidencePath: string;
  stdoutSha256: string;
  exitCode: number;
  contractProvider: string;
  contractModelId: string;
  identityMismatch: boolean;
}

export interface ClaudeStreamNonceProbeOptions {
  contract: AdapterContract;
  workspaceRoot: string;
  evidencePath: string;
  timeoutMs: number;
  nonce?: NonceMaterial;
  spawn?: SpawnFn;
}

/** stream-json nonce 探测：fake/录制流可测；真实流只在 owner 确认后 dispatch 时用。 */
export async function runClaudeStreamNonceProbe(
  options: ClaudeStreamNonceProbeOptions,
): Promise<ClaudeNonceProbeResult> {
  const nonce = options.nonce ?? makeNonce();
  const prompt =
    'Nonce identity probe. Compute the SHA-256 (lowercase hex) of this exact string: ' +
    nonce.nonce +
    '. Reply with exactly one line containing the 64-hex digest.';
  const spawn: SpawnFn =
    options.spawn ??
    ((executable, args, opts) => {
      // GOAL-067（P0-4）：与 t1-runner defaultSpawn 完全同语义——此前副本丢失了
      // Windows shim 解析与 onError 桥接：claude 为 .cmd 垫片时 nodeSpawn 直 spawn
      // 会 ENOENT，且 error 事件无监听 → exit 永不到来、Promise 永久挂起。
      const plan = resolveWindowsShim(executable);
      const child =
        plan?.kind === 'node'
          ? nodeSpawn(plan.node, [plan.entry, ...args], { cwd: opts.cwd, windowsHide: true })
          : plan?.kind === 'exe'
            ? nodeSpawn(plan.exe, args, { cwd: opts.cwd, windowsHide: true })
            : nodeSpawn(executable, args, { cwd: opts.cwd, windowsHide: true });
      if (child.stdin !== null) {
        child.stdin.on('error', () => {});
      }
      return {
        stdinWrite: (chunk: string) => {
          try {
            if (child.stdin !== null && child.stdin.writable) child.stdin.write(chunk);
          } catch {}
        },
        stdinEnd: () => {
          try {
            if (child.stdin !== null && child.stdin.writable) child.stdin.end();
          } catch {}
        },
        // GOAL-068（A6）：StringDecoder 防多字节跨 chunk 乱码。
        onStdout: (listener) => {
          const decoder = new StringDecoder('utf8');
          child.stdout.on('data', (buf: Buffer) => listener(decoder.write(buf)));
          child.stdout.on('end', () => {
            const tail = decoder.end();
            if (tail) listener(tail);
          });
        },
        onStderr: (listener) => {
          const decoder = new StringDecoder('utf8');
          child.stderr.on('data', (buf: Buffer) => listener(decoder.write(buf)));
          child.stderr.on('end', () => {
            const tail = decoder.end();
            if (tail) listener(tail);
          });
        },
        onExit: (listener) => child.on('exit', listener),
        onError: (listener) => child.on('error', listener),
        kill: () => killProcessTree(child.pid),
      } as ChildProcessLike;
    });
  const args =
    options.contract.prompt_transport === 'argument'
      ? [...options.contract.arguments, prompt]
      : [...options.contract.arguments];
  const startedAt = new Date().toISOString();
  const child = spawn(options.contract.executable, args, { cwd: options.workspaceRoot });
  let stdout = '';
  child.onStdout((chunk) => {
    stdout += chunk.toString();
  });
  let exitCode = 124;
  let timedOut = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, options.timeoutMs);
    child.onExit((code) => {
      clearTimeout(timer);
      exitCode = timedOut ? 124 : (code ?? 124);
      resolve();
    });
    if (options.contract.prompt_transport === 'stdin') {
      child.stdinWrite?.(prompt);
      child.stdinEnd?.();
    }
  });

  const stream = parseClaudeStreamJson(stdout);
  const parsed = parseNonceResponse(stream.resultText, nonce.expectedSha256);
  // DEF-01（宪法 §3 fail-closed）：运行时 model_id 必须匹配合同 provider 期望。
  // nonce 只证明“后端一致”，不证明“它是 claude 合同犬”。
  const identityMismatch =
    options.contract.expected_provider === 'anthropic' &&
    !/^claude-/i.test(stream.identity.modelId);
  const evidence = {
    schema_version: 1,
    adapter_id: options.contract.adapter_id,
    channel: 'stream-json',
    started_at_utc: startedAt,
    finished_at_utc: new Date().toISOString(),
    provider: stream.identity.provider,
    model_id: stream.identity.modelId,
    identity_proven: stream.identity.proven && !identityMismatch,
    identity_mismatch: identityMismatch,
    nonce: nonce.nonce,
    expected_sha256: nonce.expectedSha256,
    observed: parsed.observed,
    matched: parsed.matched,
    total_cost_usd: stream.totalCostUsd,
    timed_out: timedOut,
    exit_code: exitCode,
    stdout_sha256: createHash('sha256').update(stdout, 'utf8').digest('hex').toUpperCase(),
  };
  mkdirSync(path.dirname(path.resolve(options.evidencePath)), { recursive: true });
  writeFileSync(options.evidencePath, JSON.stringify(evidence) + '\n', 'utf8');
  return {
    adapterId: options.contract.adapter_id,
    identity: stream.identity,
    nonce: nonce.nonce,
    expectedSha256: nonce.expectedSha256,
    observed: parsed.observed,
    matched: parsed.matched,
    totalCostUsd: stream.totalCostUsd,
    evidencePath: options.evidencePath,
    stdoutSha256: evidence.stdout_sha256,
    exitCode,
    contractProvider: options.contract.expected_provider,
    contractModelId: options.contract.expected_model_id,
    identityMismatch,
  };
}

/** D13 + DEF-01 fail-closed：nonce 匹配 + 运行时模型家族必须符合合同，否则禁止 dispatch。 */
export function verifyNonceProbeResult(probe: ClaudeNonceProbeResult): void {
  if (!probe.matched || !probe.identity.proven || probe.identityMismatch || probe.exitCode !== 0) {
    throw new Error(
      `claude nonce probe failed: matched=${probe.matched} identity=${probe.identity.modelId} ` +
        `identityMismatch=${probe.identityMismatch} exit=${probe.exitCode}`,
    );
  }
}
