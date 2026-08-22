/**
 * mush loop 层（M4 dogfood）— 头犬/执行犬对调实验骨架（D5 随附默认项：
 * 首轮 DeepSeek 头犬、Claude Code 执行犬；之后对调一次作跨模型路由首验）。
 * 真跑需凭据（BLOCKED_ENV 前置）；本模块记录对调配置与哈希锚点证据。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface RoleAssignment {
  head: string;
  executor: string;
  swapped: boolean;
}

export function buildRoleSwap(head: string, executor: string): RoleAssignment {
  return { head, executor, swapped: true };
}

export interface RoleSwapRecord extends RoleAssignment {
  schema_version: 1;
  swapped_at_utc: string;
  sha256: string;
}

export function recordRoleSwap(evidencePath: string, assignment: RoleAssignment): RoleSwapRecord {
  const body = {
    schema_version: 1 as const,
    swapped_at_utc: new Date().toISOString(),
    head: assignment.head,
    executor: assignment.executor,
    swapped: assignment.swapped,
  };
  const sha256 = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex').toUpperCase();
  const record: RoleSwapRecord = { ...body, sha256 };
  mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(record) + '\n', 'utf8');
  return record;
}
