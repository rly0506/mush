/**
 * mush 适配器层 — Antigravity CLI (agy) 适配器（T1 `agy -p`）。
 *
 * 通道依据：docs/capability-probes/agy-2026-08-18.md
 *   agy 1.1.14 实测：
 *     -p, --print <prompt>        Run a single prompt non-interactively and print the response
 *     --dangerously-skip-permissions  Auto-approve all tool permission requests without prompting
 *     --model <model>             Model for the current CLI session
 *     --effort <level>            Reasoning effort (low|medium|high)
 *     --conversation <id>         Resume a previous conversation by ID
 *   T1 单发起步；--output-format json / stream-json 提供结构化事件。
 * 凭据边界：mush 只调 executable；凭据由 agy 认证环境自理（~/.gemini），不注入、不读取、不存储。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

export const AGY_MODEL_VARIANTS: readonly string[] = [
  'gemini-3.7-flash-high',
  'gemini-3.7-flash-medium',
  'gemini-3.7-flash-low',
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.5-flash-high',
  'gemini-3.5-flash-medium',
  'gemini-3.5-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
];

export function buildAgyContract(expectedModelId: string = 'gemini-3.7-flash-high'): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'agy',
    executable: 'agy',
    arguments: ['--dangerously-skip-permissions', '--model', expectedModelId, '-p'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'google',
    expected_model_id: expectedModelId,
    variants: AGY_MODEL_VARIANTS,
    model_flag: '--model',
    role: 'executor',
    effort_levels: ['LOW', 'MEDIUM', 'HIGH'],
    effort_injection: { kind: 'flag', name: '--effort' },
    resume_flag: '--conversation',
    context_management: 'auto-compact',
  });
}

export interface AgyOutput {
  parsed: boolean;
  conversationId: string | null;
  modelId: string;
  status: string | null;
  text: string;
}

/** 解析 agy 输出（整段 JSON、逐行 JSON 或纯文本）。 */
export function parseAgyOutput(stdout: string): AgyOutput {
  let convId: string | null = null;
  let status: string | null = null;
  let modelId = 'UNKNOWN';
  let text = '';
  let parsedAny = false;

  try {
    const value: unknown = JSON.parse(stdout);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      parsedAny = true;
      const c = record.conversation_id ?? record.conversationId;
      if (typeof c === 'string' && c.trim() !== '') convId = c.trim();
      const s = record.status;
      if (typeof s === 'string') status = s;
      const m = record.model ?? record.model_id ?? record.modelId;
      if (typeof m === 'string' && m.trim() !== '') modelId = m.trim();
      const t = record.response ?? record.result ?? record.text ?? record.output;
      if (typeof t === 'string') text = t;
    }
  } catch {
    // 非单体 JSON，走按行解析
  }

  if (!parsedAny) {
    for (const line of stdout.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        const value: unknown = JSON.parse(line);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          parsedAny = true;
          const record = value as Record<string, unknown>;
          const payload = (record.result ?? record.step_update ?? record.init ?? record) as Record<string, unknown>;
          const c = payload.conversation_id ?? payload.conversationId ?? record.conversation_id;
          if (typeof c === 'string' && c.trim() !== '') convId = c.trim();
          const s = payload.status ?? record.status;
          if (typeof s === 'string') status = s;
          const m = payload.model ?? payload.model_id ?? payload.modelId ?? record.model;
          if (typeof m === 'string' && m.trim() !== '') modelId = m.trim();
          const t = payload.response ?? payload.result ?? payload.text ?? payload.text_delta ?? record.response ?? record.text;
          if (typeof t === 'string' && t.trim() !== '') text = t;
        }
      } catch {
        // 继续解析下一行
      }
    }
  }

  if (!parsedAny) {
    return {
      parsed: false,
      conversationId: null,
      modelId: 'UNKNOWN',
      status: null,
      text: stdout,
    };
  }

  return {
    parsed: true,
    conversationId: convId,
    modelId,
    status,
    text,
  };
}

export interface AgyIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export function evaluateAgyIdentity(stdout: string): AgyIdentity {
  const parsed = parseAgyOutput(stdout);
  return {
    provider: parsed.parsed ? 'google' : 'UNKNOWN',
    modelId: parsed.modelId,
    proven: parsed.parsed && parsed.modelId !== 'UNKNOWN',
  };
}
