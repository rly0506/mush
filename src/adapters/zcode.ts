/**
 * mush 适配器层（M3 收尾/GOAL-004 首任务）— zcode 适配器（T1 + --json）。
 *
 * 预探测依据：docs/capability-probes/zcode-2026-08-16.md
 *   zcode --prompt <text> 单发、--print 非交互、--cwd 原生 workspace-root、
 *   --max-turns 有界、--json 机器可读、app-server stdio 协议。
 * 真实 nonce 探测需单独 owner 授权（zcode 为 Z.AI OAuth 登录、预算计量 UNKNOWN）；
 * 注册前 expected_model_id 保持 UNKNOWN（D13 不预信自述）。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

export function buildZcodeContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'zcode',
    executable: 'zcode',
    arguments: ['--prompt', '--json', '--max-turns', '1'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'z.ai',
    expected_model_id: 'UNKNOWN',
    // GP-22：zcode --help（2026-08-17 本机抓取）未见 effort/thinking 档位；
    // 真实档位 UNKNOWN。为避免破坏既有派发，暂沿用旧通用三档占位，通道接入前
    // 不做注入承诺。
    effort_levels: ['LOW', 'HIGH', 'XHIGH'],
    effort_injection: { kind: 'none' },
  });
}

export interface ZcodeIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export interface ZcodeJsonOutput {
  parsed: boolean;
  modelId: string;
  text: string;
  totalCost: number | null;
}

/** 解析 zcode --json 输出（整段 JSON 或首条 JSON 行；容忍非 JSON）。 */
export function parseZcodeJsonOutput(stdout: string): ZcodeJsonOutput {
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
        // 继续找下一条 JSON 行。
      }
    }
  }
  if (record === null) {
    return { parsed: false, modelId: 'UNKNOWN', text: stdout, totalCost: null };
  }
  const model = record.model ?? record.model_id ?? record.modelId;
  const text = record.text ?? record.result ?? record.output ?? '';
  const usage = (record.usage ?? {}) as Record<string, unknown>;
  const cost = usage.total_cost ?? record.total_cost ?? record.total_cost_usd;
  return {
    parsed: true,
    modelId: typeof model === 'string' && model.trim() !== '' ? model.trim() : 'UNKNOWN',
    text: typeof text === 'string' ? text : '',
    totalCost: typeof cost === 'number' ? cost : null,
  };
}

/** D13：只有机器可读输出证明 model 才 proven；否则 UNKNOWN。 */
export function evaluateZcodeIdentity(stdout: string): ZcodeIdentity {
  const parsed = parseZcodeJsonOutput(stdout);
  return {
    provider: parsed.parsed ? 'z.ai' : 'UNKNOWN',
    modelId: parsed.modelId,
    proven: parsed.parsed && parsed.modelId !== 'UNKNOWN',
  };
}
