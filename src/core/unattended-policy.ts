/**
 * GOAL-073：无人值守分级授权引擎（RM-011 M3）
 *
 * 三档模型：
 *  - L0 全弹卡（现状默认，任何情况下缺省）：真实派发一律 D30 审批；
 *  - L1 低额自动批·超额弹卡：单笔 ≤ auto_approve_cap_usd 自动批（一次性令牌 +
 *    台账 auto_approved 留痕），超额走审批卡；
 *  - L2 任务型白名单自动批：goal_id 命中白名单前缀的任务按 L1 规则自动批。
 *
 * 红线：
 *  - 默认档位恒为 L0——文件缺失/损坏/非法值一律回退 L0（fail-closed）；
 *  - 档位提升只能经 owner 显式 API 操作留痕（server 层强制）；
 *  - 自动批总额受 Master Cap 硬约束（clamp 在此层完成）。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type UnattendedLevel = 'L0' | 'L1' | 'L2';

export interface UnattendedPolicy {
  level: UnattendedLevel;
  /** 单笔自动批上限（USD）。 */
  auto_approve_cap_usd: number;
  /** 当日自动批总额硬顶（USD）；0 = 不设（仍受 master cap 约束）。 */
  daily_auto_budget_usd: number;
  /** L2 任务白名单：goal_id 前缀命中即视为可自动批任务型。 */
  task_whitelist_prefixes: string[];
}

export const DEFAULT_POLICY: UnattendedPolicy = {
  level: 'L0',
  auto_approve_cap_usd: 0,
  daily_auto_budget_usd: 0,
  task_whitelist_prefixes: [],
};

export interface PolicyArbitrationInput {
  level: UnattendedLevel;
  /** 本单请求额度。 */
  cap_usd: number;
  /** 档位配置：单笔自动批上限。 */
  auto_approve_cap_usd: number;
  /** 档位配置：当日自动批总额硬顶。 */
  daily_auto_budget_usd?: number;
  /** 档位配置：L2 任务白名单前缀。 */
  task_whitelist_prefixes?: string[];
  goal_id?: string;
  /** 当日已自动批累计（USD）。 */
  daily_auto_spent_usd: number;
}

export interface PolicyArbitration {
  decision: 'auto-approve' | 'defer-to-owner';
  reason: string;
}

/** 纯函数仲裁：给定档位与请求参数决定是否免审放行。 */
export function arbitrateUnattended(input: PolicyArbitrationInput): PolicyArbitration {
  if (input.level === 'L0') return { decision: 'defer-to-owner', reason: 'L0 全弹卡（默认）' };
  if (input.cap_usd <= 0) return { decision: 'defer-to-owner', reason: '未配置自动批额度' };
  if (input.cap_usd > input.auto_approve_cap_usd) {
    return { decision: 'defer-to-owner', reason: `超额：$${input.cap_usd} > 单笔上限 $${input.auto_approve_cap_usd}` };
  }
  if (input.level === 'L2') {
    const hit = input.goal_id !== undefined &&
      (input.task_whitelist_prefixes ?? []).some((prefix) => prefix !== '' && input.goal_id!.startsWith(prefix));
    if (!hit) return { decision: 'defer-to-owner', reason: 'L2：goal 未命中任务白名单' };
  }
  const dailyBudget = input.daily_auto_budget_usd ?? 0;
  if (dailyBudget > 0 && input.daily_auto_spent_usd + input.cap_usd > dailyBudget) {
    return { decision: 'defer-to-owner', reason: '当日自动批总额已达硬顶' };
  }
  return { decision: 'auto-approve', reason: `${input.level} 低额自动批` };
}

/** 读取持久化策略；缺失/损坏/越界一律回退默认 L0（fail-closed）。 */
export function loadUnattendedPolicy(runtimeRoot: string): UnattendedPolicy {
  const file = path.join(runtimeRoot, 'unattended-policy.json');
  try {
    if (!existsSync(file)) return { ...DEFAULT_POLICY };
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<UnattendedPolicy>;
    const level: UnattendedLevel = raw.level === 'L1' || raw.level === 'L2' ? raw.level : 'L0';
    const cap = typeof raw.auto_approve_cap_usd === 'number' && raw.auto_approve_cap_usd > 0 ? raw.auto_approve_cap_usd : DEFAULT_POLICY.auto_approve_cap_usd;
    const daily = typeof raw.daily_auto_budget_usd === 'number' && raw.daily_auto_budget_usd >= 0 ? raw.daily_auto_budget_usd : DEFAULT_POLICY.daily_auto_budget_usd;
    const prefixes = Array.isArray(raw.task_whitelist_prefixes)
      ? raw.task_whitelist_prefixes.filter((p): p is string => typeof p === 'string')
      : [];
    return { level, auto_approve_cap_usd: cap, daily_auto_budget_usd: daily, task_whitelist_prefixes: prefixes };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function saveUnattendedPolicy(runtimeRoot: string, policy: UnattendedPolicy): void {
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    path.join(runtimeRoot, 'unattended-policy.json'),
    JSON.stringify(policy, null, 2) + '\n',
    'utf8',
  );
}

/** 档位额度受 master cap 硬约束：clamp 而非拒绝（owner 配置再大也越不过总闸）。 */
export function clampPolicyToMasterCap(policy: UnattendedPolicy, masterCapUsd: number): UnattendedPolicy {
  if (masterCapUsd <= 0) return policy; // 0 = 总闸不限
  const clamp = (v: number) => Math.min(v, masterCapUsd);
  return {
    ...policy,
    auto_approve_cap_usd: clamp(policy.auto_approve_cap_usd),
    daily_auto_budget_usd: clamp(policy.daily_auto_budget_usd),
  };
}
