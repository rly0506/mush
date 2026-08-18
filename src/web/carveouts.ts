/**
 * GOAL-014（rm004-p14a）— carve-out 机制（M0 安全底座，M1 旗舰前置）。
 *
 * 语义：
 * - `runtime/carveouts.jsonl` append-only，每行一条完整快照；读侧折叠到
 *   各 carveout_id 的最新一行（status 即最新态）。旧行不覆盖（审计留痕）。
 * - 同一时刻最多一份 ACTIVE（单切片授权：一次人类授权一个切片）。
 * - `.agent-bridge/` 整树任意仓永久 deny——grant 拒绝含该段的路径，
 *   白名单校验也复查 cwd（纵深防御，黄金参照底线，carve-out 不可覆盖）。
 * - 路径匹配：绝对路径 `path.resolve` 归一；Windows 大小写不敏感由
 *   node:path win32 实现保证（path.relative 比较前小写归一）。
 * - 路径根匹配（cwd 须在白名单根下）用 path.relative：target===root 返回 ''，
 *   前缀逃逸（如 `C:/foo` vs `C:/foobar`）天然拒绝。
 *
 * 模块保持纯函数 + 薄 IO：校验逻辑集中在可测试的导出函数，写盘由
 * DispatchPipeline 层调用（与 tasks.ts 同模式）。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type CarveoutStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface Carveout {
  carveout_id: string;
  owner_grant_utc: string;
  task_ref: string;
  /** 绝对路径白名单（每个条目视为一个根；文件或目录皆可）。 */
  paths: string[];
  /** ISO-8601 UTC 过期时间。 */
  expires_at: string;
  status: CarveoutStatus;
}

/** dispatch 记录/快照里留痕的白名单快照（事件链审计用，与记录共存亡）。 */
export interface CarveoutWhitelistSnapshot {
  paths: string[];
  expires_at: string;
  task_ref: string;
}

/** `.mush/carveout-token` 文件内容（权限 0600，每次 grant 旋转）。 */
export interface CarveoutTokenFile {
  schema_version: 1;
  token: string;
  created_at_utc: string;
}

/** 黄金参照底线：任意仓 `.agent-bridge/` 整树永久 deny。 */
export const AGENT_BRIDGE_SEGMENT = '.agent-bridge';

export const CARVEOUT_STATUSES: readonly CarveoutStatus[] = ['ACTIVE', 'EXPIRED', 'REVOKED'];

export function isCarveoutStatus(value: unknown): value is CarveoutStatus {
  return typeof value === 'string' && (CARVEOUT_STATUSES as readonly string[]).includes(value);
}

/** 路径段级判定：任意层出现 `.agent-bridge` 段即拒绝（整树语义）。 */
export function hasAgentBridgeSegment(target: string): boolean {
  return target.replace(/\\/g, '/').split('/').includes(AGENT_BRIDGE_SEGMENT);
}

/** 目标路径是否位于白名单某根之下（等于根或为其子路径）。 */
export function isPathWithinRoots(target: string, roots: string[]): boolean {
  for (const root of roots) {
    const relative = path.relative(root, target);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return true;
  }
  return false;
}

export interface CarveoutAuditResult {
  allowed: string[];
  violations: string[];
}

/** 事后 diff 审核（声明式，供头犬审核犬产物）：超白名单根或命中
 *  `.agent-bridge` 任意仓永久 deny 的产物路径标记红线违反。 */
export function auditCarveoutPaths(producedPaths: string[], carveout: Carveout): CarveoutAuditResult {
  const allowed: string[] = [];
  const violations: string[] = [];
  for (const produced of producedPaths) {
    if (hasAgentBridgeSegment(produced) || !isPathWithinRoots(produced, carveout.paths)) {
      violations.push(produced);
    } else {
      allowed.push(produced);
    }
  }
  return { allowed, violations };
}

export interface GrantCarveoutInput {
  task_ref: string;
  paths: string[];
  expires_at: string;
}

/** grant 输入 fail-closed 解析：字段类型/空白/绝对路径归一/.agent-bridge deny。 */
export function parseGrantCarveoutInput(input: unknown): GrantCarveoutInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('body must be a JSON object');
  }
  const body = input as Record<string, unknown>;
  const taskRef = typeof body.task_ref === 'string' ? body.task_ref.trim() : '';
  if (taskRef === '') throw new Error('task_ref must be non-blank');
  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    throw new Error('paths must be a non-empty array');
  }
  const rawPaths = body.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  if (rawPaths.length === 0) throw new Error('paths must be a non-empty array of absolute path strings');
  const paths = rawPaths.map((entry) => path.resolve(entry));
  for (const entry of paths) {
    if (hasAgentBridgeSegment(entry)) {
      throw new Error(`path under .agent-bridge is permanently denied (golden reference): ${entry}`);
    }
  }
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at.trim() : '';
  const expiresMs = Date.parse(expiresAt);
  if (expiresAt === '' || !Number.isFinite(expiresMs)) {
    throw new Error('expires_at must be a valid ISO-8601 UTC timestamp');
  }
  return { task_ref: taskRef, paths, expires_at: new Date(expiresMs).toISOString() };
}

export interface ActiveResolution {
  /** 当前生效的 ACTIVE（未过期）。 */
  active: Carveout | null;
  /** 检测到状态仍为 ACTIVE 但已过期的记录（写面调用方应标注 EXPIRED 落盘）。 */
  expired: Carveout | null;
}

/** 折叠记录到各 id 最新快照，解析当前 ACTIVE（同一时刻最多一份，防御取最新）。 */
export function resolveActiveCarveout(records: Carveout[], now: Date): ActiveResolution {
  const byId = new Map<string, Carveout>();
  for (const record of records) byId.set(record.carveout_id, record);
  const actives = [...byId.values()]
    .filter((record) => record.status === 'ACTIVE')
    .sort((a, b) => a.owner_grant_utc.localeCompare(b.owner_grant_utc));
  const latest = actives[actives.length - 1] ?? null;
  if (latest === null) return { active: null, expired: null };
  if (Date.parse(latest.expires_at) <= now.getTime()) {
    return { active: null, expired: latest };
  }
  return { active: latest, expired: null };
}

export function loadCarveouts(carveoutsPath: string): Carveout[] {
  try {
    if (!existsSync(carveoutsPath)) return [];
    return readFileSync(carveoutsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Carveout)
      .filter(
        (record) =>
          record !== null &&
          typeof record === 'object' &&
          typeof record.carveout_id === 'string' &&
          typeof record.owner_grant_utc === 'string' &&
          typeof record.task_ref === 'string' &&
          Array.isArray(record.paths) &&
          typeof record.expires_at === 'string' &&
          isCarveoutStatus(record.status),
      );
  } catch {
    return []; // 损坏 fail-closed：无活跃 carve-out。
  }
}

export function appendCarveout(carveoutsPath: string, record: Carveout): void {
  mkdirSync(path.dirname(path.resolve(carveoutsPath)), { recursive: true });
  appendFileSync(carveoutsPath, JSON.stringify(record) + '\n', 'utf8');
}

/** 创建 ACTIVE 快照（ID/授权时间由调用方注入 now，切片 ID 随机）。 */
export function buildCarveout(input: GrantCarveoutInput, now: Date): Carveout {
  return {
    carveout_id: randomUUID().replace(/-/g, ''),
    owner_grant_utc: now.toISOString(),
    task_ref: input.task_ref,
    paths: [...input.paths],
    expires_at: input.expires_at,
    status: 'ACTIVE',
  };
}

/** 撤销 = 追加同 id 新快照（status=REVOKED，append-only 不改历史行）。 */
export function revokeCarveout(record: Carveout, now: Date): Carveout {
  return { ...record, owner_grant_utc: now.toISOString(), status: 'REVOKED' };
}

/** 过期标注 = 追加同 id 新快照（status=EXPIRED）。 */
export function expireCarveout(record: Carveout, now: Date): Carveout {
  return { ...record, owner_grant_utc: now.toISOString(), status: 'EXPIRED' };
}

/** 读一次性 token 文件；缺失/损坏 fail-closed 返回 null。 */
export function readCarveoutToken(tokenPath: string): string | null {
  try {
    if (!existsSync(tokenPath)) return null;
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as Record<string, unknown>;
    return typeof parsed.token === 'string' && parsed.token !== '' ? parsed.token : null;
  } catch {
    return null;
  }
}

/** 生成新 token 并写盘（mode 0600；Windows 无 POSIX 权限位，POSIX 平台生效）。 */
export function rotateCarveoutToken(tokenPath: string, now: () => Date): string {
  mkdirSync(path.dirname(path.resolve(tokenPath)), { recursive: true });
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const file: CarveoutTokenFile = { schema_version: 1, token, created_at_utc: now().toISOString() };
  writeFileSync(tokenPath, JSON.stringify(file) + '\n', { encoding: 'utf8', mode: 0o600 });
  return token;
}
