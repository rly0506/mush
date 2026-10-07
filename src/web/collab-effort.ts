/**
 * GOAL-085（2026-10-05 owner 追加需求）：协作席位的**默认值口径**（强度 + 模型）。
 *
 * 强度：此前由服务端按通道档案类型硬编码（codex/Claude 讨论档案 = LOW，agy 讨论档案
 * = HIGH），界面没有选择器。现在改为"**默认值仍由宿主冻结，但 owner 可逐席位覆盖**"：
 *
 *   - 可选档位 = 该通道合同声明的 `effort_levels`（无声明则退回通用三档）；
 *   - 缺省值   = 讨论档案类型的冻结默认（保持既有行为不变）；
 *   - 覆盖值   = 创建会话时逐席位显式给出，服务端校验后**随授权快照冻结**；
 *     派发路径（`dispatch.ts` 的受控席位校验）继续要求请求强度与冻结值**逐字相等**，
 *     因此"批准后改强度"仍被拒。
 *
 * 模型：协作表单的模型初值此前只用名册默认模型（`discovered.defaultModel`）。实测本机
 * codex 的名册默认是 `gpt-5.6-sol`，而证据/批准按**讨论档案绑定的模型**（`gpt-5.5`）
 * 登记，于是"用默认值创建会话"会撞上隔离准入门（409，原因清楚但违反直觉）。
 * 现在名册额外投影 `collab_default_model_id` = 讨论档案声明的模型，协作表单用它作初值；
 * **只影响协作表单**，普通聊天/派发的默认模型不变；用户显式选过的模型继续保留；
 * 未经验证的组合照样按准入拒绝并原样说明原因（不下调门禁、不静默改写选择）。
 *
 * 本模块是这些默认值判定的**唯一来源**：服务端创建接口与名册投影（界面下拉）共用它，
 * 避免"界面默认值"和"服务端默认值"各写一份后漂移。
 *
 * 边界（如实记录，不在本模块放宽）：强度是**质量旋钮，不是权限面**——按 §3.3 的口径
 * 它不参与 `config_fingerprint`，因此既有证据/准入仍按指纹判定。若 owner 要把强度
 * 纳入批准面，属治理变更，需另立决议。
 */

import { DEFAULT_EFFORT_LEVELS, type AdapterContract } from '../adapters/contract.ts';

/** 该通道可用于协作席位的强度档位（大写规范，来自合同声明）。 */
export function collabEffortLevels(contract: AdapterContract): string[] {
  return (contract.effort_levels ?? DEFAULT_EFFORT_LEVELS).map((level) => level.toUpperCase());
}

/** 讨论档案的**冻结默认强度**：codex/Claude 讨论档案 LOW、agy 讨论档案 HIGH
 *  （GOAL-084 原有取值）；非讨论档案通道返回 undefined（不冻结强度，保持旧行为）。 */
export function defaultCollabEffort(contract: AdapterContract): string | undefined {
  if (contract.codex_discussion_profile !== undefined || contract.claude_discussion_profile !== undefined) return 'LOW';
  if (contract.agy_discussion_profile !== undefined) return 'HIGH';
  return undefined;
}

/** 讨论档案**绑定的模型**——协作表单的模型初值应与之对齐（证据/批准按该模型登记）。
 *  非讨论档案通道返回 undefined（界面回落到既有名册默认）。 */
export function defaultCollabModelId(contract: AdapterContract): string | undefined {
  return contract.codex_discussion_profile?.model_id
    ?? contract.claude_discussion_profile?.model_id
    ?? contract.agy_discussion_profile?.model_id;
}

/** 客户端请求的强度归一（非法形态一律拒绝，不静默取默认）。 */
export function parseCollabEffortRequest(contract: AdapterContract, seat: string, requested: unknown): string | undefined {
  if (requested === undefined || requested === null) return undefined;
  if (typeof requested !== 'string' || requested.trim() === '') {
    throw new Error(`席位 ${seat} 的强度必须是字符串`);
  }
  const effort = requested.trim().toUpperCase();
  const levels = collabEffortLevels(contract);
  if (!levels.includes(effort)) {
    throw new Error(`席位 ${seat}（${contract.adapter_id}）的强度 ${effort} 不在可用档位 ${levels.join('|')} 内`);
  }
  return effort;
}
