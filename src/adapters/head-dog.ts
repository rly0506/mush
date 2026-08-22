/**
 * mush 适配器层（GOAL-011）— head-dog 头犬合同与章程注入。
 * 通道：deepseek-dsh（dsh --profile headless）；工作区 D:\mush。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

// GOAL-067（P3）：原与 web/chat.ts 的聊天章程同名异文（HEAD_DOG_CHARTER），
// 极易改漏其一。本版是 T1 派发合同专用章程，更名为 *_T1_CHARTER 以正名；
// 聊天通道权威章程见 web/chat.ts HEAD_DOG_CHARTER。
export const HEAD_DOG_T1_CHARTER = [
  '你是 mush 项目的头犬（head-dog）。',
  '宪法五门摘要：花钱超阈值、外部影响、永久删除、范围扩张、身份/密钥变更，任一触发必须停下等 owner 决定。',
  '你可调用 `node bin/mush dispatch ...` 给执行犬派活；所有派发都经过预算 admission 门与审批门，照常生效。',
  '你负责：理解 owner 意图 → 拆分任务 → 派发 → 审核回报 → 汇报结论；证据 append-only、哈希锚点。',
  '回复保持简洁、可执行、可机检。',
].join('\n');

export function buildHeadDogContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'head-dog',
    executable: 'dsh',
    arguments: ['--profile', 'headless'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'deepseek',
    expected_model_id: 'deepseek-v4-flash',
    role: 'head',
    // F-48：dsh 0.1.0 headless 实测不支持 --resume（unknown option）——声明
    // 摘除，多轮上下文经 chat.ts 的 prompt 缝合实现；通道支持后恢复。
    // GP-22：同 dsh headless 无 effort 档位；chat.ts 历史硬编码 HIGH，故保留
    // 旧通用档位作为兼容接受（不注入），避免 M1 聊天回归。通道接入后收敛。
    effort_levels: ['DEFAULT', 'LOW', 'HIGH', 'XHIGH'],
    effort_injection: { kind: 'none' },
    // GOAL-018 U3：dsh 通道无自动压缩。
    context_management: 'none',
  });
}

/** 从犬输出中解析 session id（dsh --resume / claude --continue 回传形态）。 */
export function extractSessionId(stdout: string): string | null {
  // 优先结构化/常见形态：session_id、session id、kimi -r session_xxx、dsh-tui --resume xxx。
  const patterns = [
    /session[_ ]?id["'\s]*[:=]["'\s]*([A-Za-z0-9_-]+)/gi,
    /\b(?:kimi|claude|zcode|dsh-tui|dsh)\s+(?:-r|--resume)\s+([A-Za-z0-9_-]+)/gi,
    /\b(session[-_][A-Za-z0-9_-]+)\b/gi,
  ];
  for (const pattern of patterns) {
    const matches = [...stdout.matchAll(pattern)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1];
    }
  }
  return null;
}
