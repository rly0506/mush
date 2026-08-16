/**
 * mush 适配器层（GOAL-008 U1）— codex 适配器（T1 `codex exec`）。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md
 *   codex exec 非交互 T1；app-server/mcp-server/exec-server/remote-control 为
 *   后续升级项。
 * 凭据边界：mush 只调 executable；凭据由 cc-switch 第三方 profile 自理，
 *   不注入、不读取、不存储。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

export function buildCodexContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'codex',
    executable: 'codex',
    arguments: ['exec'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'openai',
    expected_model_id: 'UNKNOWN',
  });
}

export interface CodexJsonlOutput {
  parsed: boolean;
  modelId: string;
  text: string;
}

/** 解析 codex exec JSONL 输出：任一 JSON 行含 model 字段即证明；text/result 取最后一条。 */
export function parseCodexJsonlOutput(stdout: string): CodexJsonlOutput {
  let modelId = 'UNKNOWN';
  let text = '';
  let parsedAny = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let record: Record<string, unknown> | null = null;
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        record = value as Record<string, unknown>;
      }
    } catch {
      continue;
    }
    if (record === null) continue;
    parsedAny = true;
    const payload = (record.payload ?? record) as Record<string, unknown>;
    const model = payload.model ?? payload.model_id ?? record.model;
    if (typeof model === 'string' && model.trim() !== '') modelId = model.trim();
    const candidate = payload.text ?? payload.result ?? payload.output ?? record.text;
    if (typeof candidate === 'string' && candidate.trim() !== '') text = candidate;
  }
  return { parsed: parsedAny, modelId, text };
}

export interface CodexIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export function evaluateCodexIdentity(stdout: string): CodexIdentity {
  const parsed = parseCodexJsonlOutput(stdout);
  return {
    provider: parsed.parsed ? 'openai' : 'UNKNOWN',
    modelId: parsed.modelId,
    proven: parsed.parsed && parsed.modelId !== 'UNKNOWN',
  };
}
