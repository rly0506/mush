/**
 * mush 适配器层（M3）— Claude Code 犬：claude -p --output-format stream-json（T2）。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md（claude 行：
 *   T1 -p 非交互；T2 --output-format stream-json 配 --print）。
 * 真实长任务在 M3 仅在 owner D6 确认后执行；本模块与测试使用录制/fake 流。
 */

import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateAdapterContract, type AdapterContract } from './contract.ts';
import type { ChildProcessLike, SpawnFn } from './t1-runner.ts';
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
      // 与 T1 相同的默认 spawn 语义；真实调用受沙箱/确认门约束。
      const child = nodeSpawn(executable, args, { cwd: opts.cwd, windowsHide: true });
      return {
        stdinWrite: (chunk: string) => {
          if (child.stdin !== null) child.stdin.write(chunk);
        },
        stdinEnd: () => {
          if (child.stdin !== null) child.stdin.end();
        },
        onStdout: (listener) => child.stdout.on('data', listener),
        onStderr: (listener) => child.stderr.on('data', listener),
        onExit: (listener) => child.on('exit', listener),
        kill: () => child.kill(),
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
