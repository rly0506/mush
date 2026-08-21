/**
 * mush loop 层（M4 dogfood）— 触发门机制（预算门）事件化。
 * 当预算 admission 需超 cap 时发出 APPROVAL_REQUEST 并落盘
 * goals/receipts/approval-requests/，状态 WAITING_OWNER_APPROVAL。
 * 这是 RM DoD“触发门在轻量模式下被真实触发并正确弹审批至少一次”的机制侧实现；
 * owner 应答记录另立文件，本模块不虚构应答。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ApprovalRequest {
  schema_version: 1;
  gate: 'BUDGET_GATE';
  actor_id: string;
  cap_usd: number;
  amount_usd: number;
  reason: string;
  requested_at_utc: string;
  status: 'WAITING_OWNER_APPROVAL';
  path: string;
}

let seqCounter = 0;

export function writeApprovalRequest(
  root: string,
  actorId: string,
  capUsd: number,
  amountUsd: number,
  reason: string,
): ApprovalRequest {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const seq = (++seqCounter).toString(36);
  const fileName = `budget-gate-${actorId}-${now}-${seq}.json`;
  const filePath = path.join(root, fileName);
  const request = {
    schema_version: 1,
    gate: 'BUDGET_GATE',
    actor_id: actorId,
    cap_usd: capUsd,
    amount_usd: amountUsd,
    reason,
    requested_at_utc: new Date().toISOString(),
    status: 'WAITING_OWNER_APPROVAL',
  } as const;
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, JSON.stringify(request) + '\n', 'utf8');
  return { ...request, path: filePath };
}
