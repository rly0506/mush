/**
 * mush 适配器层（M3）— DeepSeek 犬（经 dsh T1 / pi pi-rpc 二通道）与 nonce 身份探测。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md
 *   dsh：--profile headless "task"（T1，答完即退，GOAL-001 实证）
 *   pi：--mode rpc（pi-rpc 由 src/core/pi-rpc-* 覆盖，黄金参照管理对象）
 * D13：nonce 身份探测 fail-closed；UNKNOWN 诚实记录。
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateAdapterContract, type AdapterContract } from './contract.ts';
import { runT1, type SpawnFn } from './t1-runner.ts';

export type DeepSeekChannel = 'dsh' | 'pi';

export function buildDeepSeekContract(channel: DeepSeekChannel): AdapterContract {
  if (channel === 'dsh') {
    return validateAdapterContract({
      adapter_id: 'deepseek-dsh',
      executable: 'dsh',
      arguments: ['--profile', 'headless'],
      protocol: 't1',
      prompt_transport: 'argument',
      expected_provider: 'deepseek',
      // 实测（--dump-config 2026-08-17）：headless profile 服务 deepseek-v4-flash。
      expected_model_id: 'deepseek-v4-flash',
      // 变体轴 flash/pro：切换通道待定（dsh headless 无 --model、env 无效、
      // --patch 需 loader-entry 覆盖格式——F-G9-02），先作为身份期望声明。
      variants: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    });
  }
  return validateAdapterContract({
    adapter_id: 'deepseek-pi',
    executable: 'pi',
    arguments: ['--mode', 'rpc'],
    protocol: 'pi-rpc',
    prompt_transport: 'stdin',
    expected_provider: 'deepseek',
    expected_model_id: 'deepseek-v4-pro',
  });
}

export interface DshIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

/** 解析 dsh --dump-config（JSON 或文本）；缺 model 时诚实 UNKNOWN、proven=false。 */
export function evaluateDshIdentity(dumpConfigText: string): DshIdentity {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(dumpConfigText);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }
  const firstString = (keys: string[]): string => {
    if (parsed === null) return '';
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return '';
  };
  let provider = firstString(['provider', 'profile.provider', 'modelProvider']);
  let modelId = firstString(['model_id', 'modelId', 'model', 'profile.model_id']);
  if (provider === '' && modelId === '') {
    const providerMatch = /provider["']?\s*[:=]\s*["']?([A-Za-z0-9._-]+)/i.exec(dumpConfigText);
    const modelMatch = /model[_"]?\s*[:=]\s*["']?([A-Za-z0-9._-]+)/i.exec(dumpConfigText);
    if (providerMatch !== null) provider = providerMatch[1];
    if (modelMatch !== null) modelId = modelMatch[1];
  }
  if (provider === '') provider = 'UNKNOWN';
  if (modelId === '') modelId = 'UNKNOWN';
  return { provider, modelId, proven: provider !== 'UNKNOWN' && modelId !== 'UNKNOWN' };
}

export interface NonceMaterial {
  nonce: string;
  expectedSha256: string;
}

/** 生成 32-hex nonce 与其 SHA-256（小写 hex）预期值。 */
export function makeNonce(): NonceMaterial {
  const nonce = randomBytes(16).toString('hex');
  return {
    nonce,
    expectedSha256: createHash('sha256').update(nonce, 'utf8').digest('hex'),
  };
}

export interface NonceResponse {
  observed: string | null;
  matched: boolean;
}

/** 从模型回答中提取最后一行 64-hex 并比对（含散文也不误判）。 */
export function parseNonceResponse(stdout: string, expectedSha256: string): NonceResponse {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-fA-F]{64}$/.test(line));
  const observed = lines.length > 0 ? lines[lines.length - 1].toLowerCase() : null;
  return { observed, matched: observed === expectedSha256 };
}

export interface NonceProbeResult {
  adapterId: string;
  nonce: string;
  expectedSha256: string;
  observed: string | null;
  matched: boolean;
  evidencePath: string;
  stdoutSha256: string;
  exitCode: number;
}

export interface T1NonceProbeOptions {
  contract: AdapterContract;
  workspaceRoot: string;
  evidencePath: string;
  timeoutMs: number;
  nonce?: NonceMaterial;
  spawn?: SpawnFn;
}

/**
 * T1 nonce 探测：一句 headless 求值 → 回值比对 → 磁盘证据（BOM-free JSON + 哈希锚点）。
 * 不抛 mismatch（证据诚实落盘），调用方用 verifyNonceProbe 做 fail-closed 断言。
 */
export async function runT1NonceProbe(options: T1NonceProbeOptions): Promise<NonceProbeResult> {
  const nonce = options.nonce ?? makeNonce();
  const prompt =
    'Nonce identity probe. Compute the SHA-256 (lowercase hex) of this exact string: ' +
    nonce.nonce +
    '. Reply with exactly one line containing the 64-hex digest.';
  const run = await runT1({
    contract: options.contract,
    prompt,
    workspaceRoot: options.workspaceRoot,
    receiptPath: options.evidencePath + '.t1-receipt.json',
    timeoutMs: options.timeoutMs,
    spawn: options.spawn,
  });
  const parsed = parseNonceResponse(run.stdout, nonce.expectedSha256);
  const evidence = {
    schema_version: 1,
    adapter_id: options.contract.adapter_id,
    channel: options.contract.protocol,
    started_at_utc: run.receipt.started_at_utc,
    finished_at_utc: run.receipt.finished_at_utc,
    nonce: nonce.nonce,
    expected_sha256: nonce.expectedSha256,
    observed: parsed.observed,
    matched: parsed.matched,
    exit_code: run.exitCode,
    timed_out: run.timedOut,
    stdout_sha256: run.receipt.stdout_sha256,
    stderr_sha256: run.receipt.stderr_sha256,
  };
  mkdirSync(path.dirname(path.resolve(options.evidencePath)), { recursive: true });
  writeFileSync(options.evidencePath, JSON.stringify(evidence) + '\n', 'utf8');
  return {
    adapterId: options.contract.adapter_id,
    nonce: nonce.nonce,
    expectedSha256: nonce.expectedSha256,
    observed: parsed.observed,
    matched: parsed.matched,
    evidencePath: options.evidencePath,
    stdoutSha256: run.receipt.stdout_sha256,
    exitCode: run.exitCode,
  };
}

/** fail-closed 断言：nonce 不匹配或超时即抛错，禁止继续 dispatch。 */
export function verifyNonceProbe(probe: NonceProbeResult): void {
  if (!probe.matched || probe.exitCode !== 0) {
    throw new Error(
      `nonce probe failed: adapter=${probe.adapterId} matched=${probe.matched} exit=${probe.exitCode}`,
    );
  }
}
