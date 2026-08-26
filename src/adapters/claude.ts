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
import { validateAdapterContract, type AdapterContract } from './contract.ts';
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
  totalCostUsd: number | null;
  ended: boolean;
  messageCount: number;
  sessionId: string | null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 解析 claude stream-json：init 模型身份、assistant/result 消息、成本与结束标志。 */
export function parseClaudeStreamJson(stdout: string): ClaudeStream {
  let provider = 'UNKNOWN';
  let modelId = 'UNKNOWN';
  let resultText = '';
  let totalCostUsd: number | null = null;
  let ended = false;
  let messageCount = 0;
  let sessionId: string | null = null;
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
      const result = record.result;
      if (typeof result === 'string') resultText = result;
      const cost = record.total_cost_usd;
      if (typeof cost === 'number') totalCostUsd = cost;
      ended = record.subtype === 'success' || record.subtype === 'error';
      const sid = record.session_id;
      if (typeof sid === 'string' && sid.trim() !== '') sessionId = sid.trim();
    }
  }
  return {
    identity: {
      provider: provider === 'UNKNOWN' ? 'anthropic' : provider,
      modelId,
      proven: modelId !== 'UNKNOWN',
    },
    resultText,
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
  totalCostUsd?: number;
}

export interface ClaudeStreamRunOptions {
  contract: AdapterContract;
  prompt: string;
  workspaceRoot: string;
  timeoutMs: number;
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  spawn?: SpawnFn;
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
  const args =
    options.contract.prompt_transport === 'argument'
      ? [...options.contract.arguments, options.prompt]
      : [...options.contract.arguments];
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let killed = false;
  let exitCode = 124;
  const child = spawn(options.contract.executable, args, { cwd: options.cwd ?? options.workspaceRoot });
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
    stdout: parsed.resultText !== '' || parsed.ended ? parsed.resultText : stdout,
    stderr,
    timedOut,
    childKilled: killed,
    resultText: parsed.resultText,
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
