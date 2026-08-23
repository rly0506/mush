/**
 * mush 适配器层（GOAL-008 U1）— opencode 适配器（T1 `opencode run`）。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md
 *   opencode run headless T1；ACP/HTTP 为后续升级项（本 Goal 不实现）。
 * 凭据边界：只调 executable；cc-switch profile 自理，不注入/不读取/不存储密钥。
 * GOAL-070：模型选型接入——`-m provider/model` 注入（缺省 free 档，零成本执行）；
 *   真实可选清单来自 `opencode models` 实测枚举（parseOpencodeModelsList），
 *   经 probeLiveModels 同步进合同 variants。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

/** GOAL-070：opencode 缺省模型——free 档（本机实测在册），链路验证/演练零成本。 */
export const OPENCODE_DEFAULT_MODEL = 'x-preview-f-free';

export function buildOpencodeContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'opencode',
    executable: 'opencode',
    arguments: ['run', '-m', OPENCODE_DEFAULT_MODEL],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'opencode',
    expected_model_id: OPENCODE_DEFAULT_MODEL,
    variants: [OPENCODE_DEFAULT_MODEL],
    model_flag: '-m',
    effort_levels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'MAX'],
    effort_injection: { kind: 'flag', name: '--variant' },
    // GOAL-018 U3：未列入本批自动压缩/续跑主路径，暂按 none。
    context_management: 'none',
  });
}

export interface ParsedModelList {
  /** provider -> 全量 model id 列表（如 "opencode" -> ["opencode/hy3-free", …]）。 */
  grouped: Record<string, string[]>;
  models: string[];
}

/** GOAL-070：解析 `opencode models [provider]` 输出——每行一个 "provider/model"。 */
export function parseOpencodeModelsList(stdout: string): ParsedModelList {
  const grouped: Record<string, string[]> = {};
  const models: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const slash = line.indexOf('/');
    if (slash <= 0 || slash === line.length - 1) continue;
    const provider = line.slice(0, slash);
    if (!/^[A-Za-z0-9._-]+$/.test(provider)) continue;
    (grouped[provider] ??= []).push(line);
    models.push(line);
  }
  return { grouped, models };
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
