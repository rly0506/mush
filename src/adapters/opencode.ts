/**
 * mush 适配器层（GOAL-008 U1）— opencode 适配器（T1 `opencode run`）。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md
 *   opencode run headless T1；ACP/HTTP 为后续升级项（本 Goal 不实现）。
 * 凭据边界：只调 executable；cc-switch profile 自理，不注入/不读取/不存储密钥。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

export function buildOpencodeContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'opencode',
    executable: 'opencode',
    arguments: ['run'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'opencode',
    expected_model_id: 'UNKNOWN',
  });
}

export interface OpencodeOutput {
  parsed: boolean;
  modelId: string;
  text: string;
}

/** 解析 opencode run 输出（整段 JSON 或首条 JSON 行；容忍纯文本）。 */
export function parseOpencodeOutput(stdout: string): OpencodeOutput {
  let record: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(stdout);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      record = value as Record<string, unknown>;
    }
  } catch {
    for (const line of stdout.split(/\r?\n/)) {
      try {
        const value: unknown = JSON.parse(line);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          record = value as Record<string, unknown>;
          break;
        }
      } catch {
        // continue
      }
    }
  }
  if (record === null) return { parsed: false, modelId: 'UNKNOWN', text: stdout };
  const model = record.model ?? record.model_id ?? record.modelId;
  const text = record.text ?? record.result ?? record.output ?? '';
  return {
    parsed: true,
    modelId: typeof model === 'string' && model.trim() !== '' ? model.trim() : 'UNKNOWN',
    text: typeof text === 'string' ? text : '',
  };
}

export interface OpencodeIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export function evaluateOpencodeIdentity(stdout: string): OpencodeIdentity {
  const parsed = parseOpencodeOutput(stdout);
  return {
    provider: parsed.parsed ? 'opencode' : 'UNKNOWN',
    modelId: parsed.modelId,
    proven: parsed.parsed && parsed.modelId !== 'UNKNOWN',
  };
}
