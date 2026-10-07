/**
 * GOAL-084：受控黑板多模型方案协作——黑板存储层（第一片：存储 + 上下文可见性 + 会话额度）。
 *
 * 与 GOAL-050 的 items.json 黑板（src/orchestration/blackboard.ts）互不共用：
 * 本层用 node:sqlite 落会话/参与者/材料/追加式观点/授权快照/执行记录，由调用方
 * 传入工作区数据面目录（D86 dataRoot / centralWorkspaceDataDir 派生），外部业务
 * 工作区零足迹；也绝不经旧黑板的无角色过滤读取接口公开新会话。
 *
 * 身份纪律：观点作者只能经 participants.run_instance（mush 启动的运行实例，派发
 * 时绑定）解析席位；写入 API 不存在模型自报作者字段。可见性按阶段收口：独立提案
 * 互不可见 → 评审互换指定版本 → 修订只见针对自己提案的质疑；公共议题/约束恒可见。
 *
 * GOAL-085（编排层扩展）：席位由 A/B 扩到 A/B/C，并由服务端在创建时冻结评审关系
 * （review_relations，见 deriveReviewRelations），两两互评——三席 6 条、双席 2 条。
 * viewpoints 唯一键从 (session_id, author_seat, kind) 迁到
 * (session_id, author_seat, kind, target)：target = 被评审提案的作者席位，提案/修订
 * 恒为空串（因此"每席位一条提案/修订"仍被拒绝重复）。迁移见 migrateViewpointsUniqueKey。
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { collabSkillRegistrySha256 } from './collaboration-skills.ts';
import { policyGapFor, type AcceptedGapRecord, type AdmissionPolicy } from './collaboration-admission-policy.ts';

/** 协作席位：双模型 = A/B，三模型 = A/B/C。 */
export type CollabSeat = 'A' | 'B' | 'C';
export const COLLAB_SEATS: readonly CollabSeat[] = ['A', 'B', 'C'];
/** 支持的席位数；其余人数一律拒绝。 */
export const COLLAB_SEAT_COUNTS: readonly number[] = [2];
export type CollabPhase = 'coordination' | 'proposal' | 'review' | 'revision';
export type CollabStatus = 'pending_approval' | 'authorized' | 'in_progress' | 'completed' | 'cancelled' | 'interrupted' | 'failed';
export type CallKind = 'normal' | 'retry';
/** GOAL-085 §2：评审关系——author 席位的评审指向 target 席位的那份提案。 */
export interface CollabReviewRelation {
  author: CollabSeat;
  target: CollabSeat;
}
/** 双席冻结关系：A→B、B→A。 */
export const DEFAULT_REVIEW_RELATIONS_TWO: readonly CollabReviewRelation[] = [
  { author: 'A', target: 'B' }, { author: 'B', target: 'A' },
];
/** 三席冻结关系（两两互评，固定顺序）：A→B、A→C、B→A、B→C、C→A、C→B。 */
export const DEFAULT_REVIEW_RELATIONS_THREE: readonly CollabReviewRelation[] = [
  { author: 'A', target: 'B' }, { author: 'A', target: 'C' },
  { author: 'B', target: 'A' }, { author: 'B', target: 'C' },
  { author: 'C', target: 'A' }, { author: 'C', target: 'B' },
];

/** 从参与者席位集合派生冻结评审关系（服务端唯一来源；调用方不得注入）。
 *  按固定席位顺序 A→B→C 排列，保证三席顺序与 owner 规格逐条一致。 */
export function deriveReviewRelations(seats: readonly CollabSeat[]): CollabReviewRelation[] {
  const ordered = COLLAB_SEATS.filter((seat) => seats.includes(seat));
  const relations: CollabReviewRelation[] = [];
  for (const author of ordered) {
    for (const target of ordered) {
      if (author !== target) relations.push({ author, target });
    }
  }
  return relations;
}

/** 关系集合相等（顺序无关）——用于快照与派生的逐条比对。 */
export function sameReviewRelationSet(a: readonly CollabReviewRelation[], b: readonly CollabReviewRelation[]): boolean {
  const key = (r: CollabReviewRelation): string => `${r.author}->${r.target}`;
  const left = [...new Set(a.map(key))].sort();
  const right = [...new Set(b.map(key))].sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

/** GOAL-084 §3.3：证据状态——非线性分级（帮助证明接口声明、fixture 证明参数传递、
 *  行为测试证明限制是否执行；三者验证对象不同，不排单一高低）。 */
export type CollabEvidenceStatus = 'declared' | 'fixture_verified' | 'live_verified' | 'unmet';
/** 隔离会话的准入维度（§2.2 讨论通道执行配置）。 */
export const ISOLATION_DIMENSIONS = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'] as const;
/** 行为级证据的正向方法白名单（§3.3 owner 复核：未知方法不构成可核验来源）。 */
export const EVIDENCE_BEHAVIOR_METHODS = ['live_probe', 'behavior_test', 'dispatch_receipt', 'behavior_replay'] as const;

/** GOAL-084 §3.3：通道能力证据条目——授权快照按条目记录验证对象、方法、覆盖范围、
 *  工具版本及配置指纹；配置变化后须重新判断证据是否适用。声明存在 ≠ 权限生效。 */
export interface CollabCapabilityEvidence {
  adapter_id: string;
  /** 验证对象所属维度（ISOLATION_DIMENSIONS 之一或自定义）。 */
  dimension: string;
  /** 验证对象：具体声明/旗标/配置。 */
  subject: string;
  /** 验证方法：正向白名单见 EVIDENCE_BEHAVIOR_METHODS（行为级准入只认这些）。 */
  method: string;
  /** 覆盖范围：该证据覆盖到哪一层（声明/注入面/行为）。 */
  coverage: string;
  tool_version?: string;
  config_fingerprint?: string;
  /** 可核查的证据来源（受控证据库登记键）；行为级条目必填且须可解析核验。 */
  source?: string;
  /** 显式验证分类（由受控证据库按登记记录给出）；缺失视为 declared。
   *  等级判定不看 coverage 文案（2026-10-04 owner 裁定）。 */
  verification?: 'behavior' | 'declared';
  status: CollabEvidenceStatus;
}

/** GOAL-084 §3.3：受控证据库中已登记的验证记录——正式路径只接受能解析到
 *  此类记录且逐字段匹配的证据条目；不存在/不匹配/fixture 声明一律保持未验证。 */
export interface EvidenceRecord {
  source: string;
  adapter_id: string;
  dimension: string;
  method: string;
  subject: string;
  coverage: string;
  tool_version: string;
  config_fingerprint: string;
  /** 验证产物哈希（64 位十六进制）。 */
  artifact_sha256: string;
  /** 显式验证分类（GOAL-084 收口，2026-10-04 owner 裁定）：等级**只由本字段决定**，
   *  描述文字（coverage/subject）不参与等级判定。'behavior'=该维度确有行为观察；
   *  'declared'=声明/自报/未演练。缺失视为 'declared'（保守，不因文案升级）。 */
  verification?: 'behavior' | 'declared';
  /** pass=行为通过；fail=同配置反例；withdrawn=登记更正撤回（append-only，
   *  原始记录保留，subject 以 'withdrawn:<source>' 精确指向被撤回来源）。 */
  result: 'pass' | 'fail' | 'withdrawn';
  recorded_at_utc: string;
}

/** 受控证据库解析器：由宿主注入（生产=探针/回执台账；测试=合成实现）。 */
export interface EvidenceStoreLike {
  resolve(source: string): EvidenceRecord | undefined;
  /** D89 必要条件（2026-10-04 owner 复核）：该通道 + 指纹 + 维度是否存在已登记的反例。
   *  仍缺失该方法的合成实现按"无方法 = 不可核验"处理（拒绝），不得静默当作"无反例"。 */
  failuresFor?(adapterId: string, configFingerprint: string, dimension: string): EvidenceRecord[];
}

/** 快照冻结的失败反例（存在即禁止批准，优先级高于政策缺口）。 */
export interface EvidenceFailure {
  adapter_id: string;
  dimension: string;
  config_fingerprint: string;
  source: string;
  subject: string;
  result: 'fail' | 'withdrawn';
}
/** 执行记录的结算终态；'started' 只是占用时的初态，不是合法结算值。 */
export type ExecutionSettlement = 'pass' | 'fail' | 'timeout' | 'interrupted';
export const SETTLEMENT_STATUSES: readonly ExecutionSettlement[] = ['pass', 'fail', 'timeout', 'interrupted'];

export class BlackboardAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlackboardAccessError';
  }
}

export class BlackboardQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlackboardQuotaError';
  }
}

/** 固定流程的阶段顺序；setPhase 只许沿链前进。 */
const PHASE_CHAIN: CollabPhase[] = ['coordination', 'proposal', 'review', 'revision'];

/** GOAL-084 双席缺省：7 正常 + 1 共享重试、单次 180s、整场 20 分钟。 */
export const DEFAULT_CALL_LIMIT = 7;
export const DEFAULT_RETRY_LIMIT = 1;
export const DEFAULT_SINGLE_CALL_TIMEOUT_S = 180;
export const DEFAULT_SESSION_TIMEOUT_MIN = 20;
/** GOAL-085 三席缺省：13 正常（协调 1 + 提案 3 + 评审 6 + 修订 3）+ 1 共享重试，整场 40 分钟。 */
export const TRIPLE_CALL_LIMIT = 13;
export const TRIPLE_SESSION_TIMEOUT_MIN = 40;

/** 按席位数取整场默认边界（单次上限 180s 两席一致，不随席位数变）。 */
export function collabDefaultsFor(seatCount: number): { call_limit: number; retry_limit: number; session_timeout_min: number } {
  if (seatCount === 3) {
    return { call_limit: TRIPLE_CALL_LIMIT, retry_limit: DEFAULT_RETRY_LIMIT, session_timeout_min: TRIPLE_SESSION_TIMEOUT_MIN };
  }
  if (seatCount === 2) {
    return { call_limit: DEFAULT_CALL_LIMIT, retry_limit: DEFAULT_RETRY_LIMIT, session_timeout_min: DEFAULT_SESSION_TIMEOUT_MIN };
  }
  throw new BlackboardAccessError(`只支持 2 或 3 位参与者（收到 ${seatCount}）`);
}


export interface CollabParticipantInput {
  seat: CollabSeat;
  adapter_id: string;
  provider_id?: string;
  model_id?: string;
  effort?: string;
  /** 每场会话恰一位协调者（默认 A 席；GOAL-085 起不再强制 A，但必须恰一位）。 */
  is_coordinator?: boolean;
  /** 该席位批准的配置指纹——证据条目指纹须与此一致，配置变化即证据不适用（§3.3）。 */
  config_fingerprint?: string;
}

export interface CollabMaterialInput {
  material_id: string;
  name: string;
  source: string;
  /** 首版只支持文本材料；来源与哈希入库，获准读取者按席位白名单。 */
  content: string;
  allowed_seats: CollabSeat[];
}

export interface CollabSessionInput {
  topic: string;
  /** 会话绑定创建时工作区，不随看板切换改变。 */
  workspace_root: string;
  /** 恒可见的公共约束（权限、禁写等），与议题一并冻结。 */
  constraints?: string;
  participants: CollabParticipantInput[];
  materials?: CollabMaterialInput[];
  call_limit?: number;
  retry_limit?: number;
  single_call_timeout_s?: number;
  session_timeout_min?: number;
  /** 会话是否要求隔离上下文（材料清单外不可读、无额外工具入口）——要求时
   *  authorize 按快照内证据条目 fail-closed 准入（§3.3）。 */
  isolation_required?: boolean;
  capability_evidence?: CollabCapabilityEvidence[];
  /** GOAL-084 §3.4：会话创建时冻结的 skill 模板注册表哈希（§2.2 记录模板版本与哈希）。 */
  skill_registry_sha256?: string;
}

export interface CollabAuthorizationSnapshot {
  topic: string;
  workspace_root: string;
  constraints?: string;
  participants: CollabParticipantInput[];
  materials: Array<{ material_id: string; name: string; source: string; sha256: string; allowed_seats: CollabSeat[] }>;
  call_limit: number;
  retry_limit: number;
  single_call_timeout_s: number;
  session_timeout_min: number;
  isolation_required?: boolean;
  capability_evidence?: CollabCapabilityEvidence[];
  /** D89 条件化准入：本会话批准时被接受为"已知缺口"的维度（冻结、随卡展示）。
   *  仅当 policy_decision_ref 非空时有意义；证据等级不因它改变。 */
  accepted_gaps?: AcceptedGapRecord[];
  /** 采纳的政策决策编号（如 'D88/D89 2026-10-04'）；缺失=未启用条件化准入。 */
  policy_decision_ref?: string;
  /** D89 必要条件：该会话适用的失败反例（存在即禁止批准；政策只接受"缺证"，不能覆盖已证实的失败）。 */
  failure_counterexamples?: EvidenceFailure[];
  skill_registry_sha256?: string;
  /** GOAL-085：创建时由服务端派生的冻结评审关系（两两互评）。调用方不可注入；
   *  旧快照（GOAL-084）无此字段，读取侧按参与者派生同口径关系（见 reviewRelationsFor）。 */
  review_relations?: CollabReviewRelation[];
}

export interface CollabViewpointInput {
  session_id: string;
  /** mush 启动的运行实例身份；席位由存储反查，不接受模型自报。 */
  author_instance: string;
  body: string;
  stance?: string;
  /** 证据引用：只收 material_id，哈希由存储按登记材料冻结。 */
  evidence_material_ids?: string[];
  /** 评审阶段必填：对方提案 id；修订阶段可指向可见观点。 */
  responds_to?: string;
  reserved_disagreements?: string;
  /** 本轮实际发送的材料清单（material_id），冻结为 id+sha256。 */
  manifest_material_ids?: string[];
}

export interface CollabViewpoint {
  id: string;
  session_id: string;
  author_seat: CollabSeat;
  author_instance: string;
  phase: CollabPhase;
  kind: string;
  responds_to: string | null;
  /** GOAL-085：评审观点 = 被评审提案的作者席位；提案/修订恒为空串。
   *  唯一键 (session_id, author_seat, kind, target) 靠它容纳"同作者多条评审，
   *  且每条评审指向一个不同目标"。 */
  target: string;
  version: number;
  body: string;
  stance: string | null;
  evidence: Array<{ material_id: string; sha256: string }>;
  reserved_disagreements: string | null;
  material_manifest: Array<{ material_id: string; sha256: string }>;
  created_at_utc: string;
}

interface SessionRow {
  id: string;
  topic: string;
  workspace_root: string;
  constraints: string | null;
  status: CollabStatus;
  phase: CollabPhase;
  call_count: number;
  retry_count: number;
  call_limit: number;
  retry_limit: number;
  authorization_hash: string;
  session_timeout_min: number;
  /** 整场截止时间（首次成功占额时确定）；未开跑前为 null（§3.3）。 */
  deadline_utc: string | null;
  created_at_utc: string;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function nowUtc(): string {
  return new Date().toISOString();
}

function rowToViewpoint(row: Record<string, unknown>): CollabViewpoint {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    author_seat: row.author_seat as CollabSeat,
    author_instance: row.author_instance as string,
    phase: row.phase as CollabPhase,
    kind: row.kind as string,
    responds_to: (row.responds_to as string | null) ?? null,
    target: (row.target as string | null) ?? '',
    version: row.version as number,
    body: row.body as string,
    stance: (row.stance as string | null) ?? null,
    evidence: JSON.parse((row.evidence_json as string) || '[]'),
    reserved_disagreements: (row.reserved_disagreements as string | null) ?? null,
    material_manifest: JSON.parse((row.material_manifest_json as string) || '[]'),
    created_at_utc: row.created_at_utc as string,
  };
}

/** 活跃运行登记表——按"数据库路径 + 会话 ID"跨句柄共享：同进程用多个对象打开
 *  同一库时，重复启动的判定必须对全部句柄生效（§3.4 owner 复核）；跨进程判定
 *  不在本机制范围（会话运行当前为单进程形态）。 */
const ACTIVE_RUNS = new Set<string>();
/** 整场停止请求与在途派发登记——按"库路径+会话 ID"跨句柄共享（§3.5 看板停止）。 */
const STOP_REQUESTS = new Set<string>();
const CURRENT_DISPATCHES = new Map<string, string>();

function activeRunKey(dbPath: string, sessionId: string): string {
  const normalized = process.platform === 'win32' ? dbPath.toLowerCase() : dbPath;
  return `${normalized}::${sessionId}`;
}

// ---- GOAL-085 §4：viewpoints 唯一键迁移（(session_id, author_seat, kind) →
// (session_id, author_seat, kind, target)）----

/** 库结构版本：0 = GOAL-084（无 target 列）；1 = GOAL-085（含 target 列与新唯一键）。 */
export const COLLAB_BLACKBOARD_SCHEMA_VERSION = 1;
/** GOAL-084 viewpoints 唯一键（迁移检测用）。 */
export const VIEWPOINTS_LEGACY_UNIQUE_KEY = 'UNIQUE (session_id, author_seat, kind)';
/** GOAL-085 viewpoints 唯一键。 */
export const VIEWPOINTS_UNIQUE_KEY = 'UNIQUE (session_id, author_seat, kind, target)';
/** 迁移备份文件名前缀（与 blackboard.sqlite 同目录）。 */
export const MIGRATION_BACKUP_PREFIX = 'blackboard.sqlite.backup-';

/** GOAL-085 目标表结构——与构造函数的 CREATE TABLE IF NOT EXISTS 逐字一致，
 *  迁移与新建库共用同一份 DDL，避免两处漂移。 */
export const VIEWPOINTS_TABLE_DDL = `
  CREATE TABLE viewpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    author_seat TEXT NOT NULL,
    author_instance TEXT NOT NULL,
    phase TEXT NOT NULL,
    kind TEXT NOT NULL,
    responds_to TEXT,
    target TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    stance TEXT,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    reserved_disagreements TEXT,
    material_manifest_json TEXT NOT NULL DEFAULT '[]',
    created_at_utc TEXT NOT NULL,
    UNIQUE (session_id, author_seat, kind, target)
  )`;

/** 迁移结果：ran=false 表示库已是目标结构（幂等：不备份、不重建、不报错）。 */
export interface ViewpointsMigrationResult {
  ran: boolean;
  /** 已迁移则给出备份文件的绝对路径（回滚用）；未迁移为 undefined。 */
  backup_path?: string;
  /** 迁移前后 viewpoints 行数（保留历史的核对锚点）。 */
  rows_before: number;
  rows_after: number;
  from_version: number;
  to_version: number;
}

export interface CollabMigrationOptions {
  /** false = 打开时不自动迁移（只读诊断/由调用方显式迁移）；缺省 true。 */
  migrate?: boolean;
  /** 备份文件落盘目录；缺省与 blackboard.sqlite 同目录（"同目录副本"）。 */
  backupDir?: string;
}

/** 该库是否已具备 GOAL-085 的 target 列。 */
function viewpointsHasColumn(db: DatabaseSync, column: string): boolean {
  const rows = db.prepare('PRAGMA table_info(viewpoints)').all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function schemaUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return Number(row?.user_version ?? 0);
}

/** 只读体检：报告是否需要迁移、是否处于迁移中途，并跑索引/外键检查。
 *  迁移后调用一次可确认结构、行数与历史数据一致（§4 "迁移后再跑索引/PRAGMA 检查"）。 */
export function inspectViewpointsSchema(db: DatabaseSync): {
  needs_migration: boolean;
  has_target_column: boolean;
  has_new_unique_key: boolean;
  has_legacy_unique_key: boolean;
  user_version: number;
  rows: number;
  foreign_key_violations: Array<Record<string, unknown>>;
} {
  const ddlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'viewpoints'").get() as { sql: string | null } | undefined;
  const ddl = (ddlRow?.sql ?? '').replace(/"/g, '');
  const hasTarget = viewpointsHasColumn(db, 'target');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM viewpoints').get() as { n: number };
  return {
    needs_migration: !hasTarget,
    has_target_column: hasTarget,
    has_new_unique_key: ddl.includes(VIEWPOINTS_UNIQUE_KEY),
    has_legacy_unique_key: ddl.includes(VIEWPOINTS_LEGACY_UNIQUE_KEY),
    user_version: schemaUserVersion(db),
    rows: Number(n),
    foreign_key_violations: db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>,
  };
}

/** 备份文件名（同目录、带时间戳、Windows 安全字符）。同一毫秒重复调用自动加序号，不覆盖既有备份。 */
export function migrationBackupPath(dbPath: string, backupDir?: string, stamp: string = new Date().toISOString()): string {
  const dir = backupDir ?? path.dirname(dbPath);
  const ts = stamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, (m) => m.replace(/[.:]/g, ''));
  const base = `${MIGRATION_BACKUP_PREFIX}${ts}`;
  let candidate = path.join(dir, base);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${counter}`);
    counter += 1;
  }
  return candidate;
}

/** 迁移前把 blackboard.sqlite 复制为同目录带时间戳的 .backup-<ts> 副本。
 *  先 TRUNCATE checkpoint 把 WAL 内容并入主库文件，保证副本自洽（非 WAL 模式下为空操作）。
 *  返回副本绝对路径——回滚路径见 restoreBlackboardFromBackup。 */
export function backupBlackboardDatabase(db: DatabaseSync, dbPath: string, backupDir?: string): string {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // 非 WAL 或引擎不支持：主库文件本身即完整，可直接复制。
  }
  const backupPath = migrationBackupPath(dbPath, backupDir);
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

/** 回滚：用备份文件覆盖当前库（调用方必须先关闭所有打开该库的句柄，否则 Windows 上文件被占用）。
 *  覆盖前保留现场副本 `.failed-<ts>`——回滚不销毁"迁移后"的证据。 */
export function restoreBlackboardFromBackup(dbPath: string, backupPath: string): { restored_from: string; preserved_path: string } {
  if (path.resolve(backupPath) === path.resolve(dbPath)) {
    throw new BlackboardAccessError('回滚备份不可指向库文件自身');
  }
  if (!existsSync(backupPath)) throw new BlackboardAccessError(`回滚备份不存在: ${backupPath}`);
  const preserved = `${dbPath}.failed-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, (m) => m.replace(/[.:]/g, ''))}`;
  copyFileSync(dbPath, preserved);
  copyFileSync(backupPath, dbPath);
  return { restored_from: path.resolve(backupPath), preserved_path: preserved };
}

/** GOAL-085 §4 迁移：备份 → 事务内 CREATE TABLE viewpoints_new → INSERT SELECT →
 *  DROP → RENAME → 结构/行数核验。幂等（已含 target 列即直接返回 ran=false）。
 *  id/body/authorizations 行/created_at_utc 原样搬移，不重写、不重编号。 */
export function migrateViewpointsUniqueKey(
  db: DatabaseSync,
  dbPath: string,
  options?: { backupDir?: string },
): ViewpointsMigrationResult {
  const fromVersion = schemaUserVersion(db);
  // 全新库（尚无 viewpoints 表）：由构造函数按目标 DDL 建表，无需迁移。
  const tableExists = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'viewpoints'",
  ).get() as { n: number };
  if (Number(tableExists.n) === 0 || viewpointsHasColumn(db, 'target')) {
    return { ran: false, rows_before: 0, rows_after: 0, from_version: fromVersion, to_version: COLLAB_BLACKBOARD_SCHEMA_VERSION };
  }
  const { n: rowsBefore } = db.prepare('SELECT COUNT(*) AS n FROM viewpoints').get() as { n: number };
  const backupPath = backupBlackboardDatabase(db, dbPath, options?.backupDir);
  db.exec('BEGIN IMMEDIATE');
  try {
    // 先删同名的半成品表：上一次迁移中途崩溃可能留下它（无事务保护的部分）。
    db.exec('DROP TABLE IF EXISTS viewpoints_new');
    db.exec(VIEWPOINTS_TABLE_DDL.replace('CREATE TABLE viewpoints', 'CREATE TABLE viewpoints_new'));
    db.exec(`INSERT INTO viewpoints_new (
      id, session_id, author_seat, author_instance, phase, kind, responds_to, target, version, body, stance,
      evidence_json, reserved_disagreements, material_manifest_json, created_at_utc)
      SELECT id, session_id, author_seat, author_instance, phase, kind, responds_to, '', version, body, stance,
      evidence_json, reserved_disagreements, material_manifest_json, created_at_utc FROM viewpoints`);
    db.exec('DROP TABLE viewpoints');
    db.exec('ALTER TABLE viewpoints_new RENAME TO viewpoints');
    const { n: rowsAfter } = db.prepare('SELECT COUNT(*) AS n FROM viewpoints').get() as { n: number };
    if (Number(rowsAfter) !== Number(rowsBefore)) {
      throw new BlackboardAccessError(`viewpoints 迁移行数不一致（迁移前 ${rowsBefore} / 迁移后 ${rowsAfter}），已回滚`);
    }
    db.exec(`PRAGMA user_version = ${COLLAB_BLACKBOARD_SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  // 迁移后核验：目标列、新唯一键、无外键违规（失败即抛，备份已落盘可回滚）。
  const check = inspectViewpointsSchema(db);
  if (!check.has_target_column || !check.has_new_unique_key || check.foreign_key_violations.length > 0) {
    throw new BlackboardAccessError(
      `viewpoints 迁移后核验失败（target 列 ${check.has_target_column} / 新唯一键 ${check.has_new_unique_key} / `
      + `外键违规 ${check.foreign_key_violations.length}），备份在 ${backupPath}，请按回滚步骤恢复`,
    );
  }
  return {
    ran: true, backup_path: backupPath, rows_before: Number(rowsBefore), rows_after: Number(check.rows),
    from_version: fromVersion, to_version: COLLAB_BLACKBOARD_SCHEMA_VERSION,
  };
}

export class CollaborationBlackboard {
  private db: DatabaseSync;
  private dbPath: string;
  private readonly evidenceStore?: EvidenceStoreLike;
  private readonly admissionPolicy?: AdmissionPolicy;
  private readonly runKeyBase: string;
  /** 本次打开的迁移结果（未迁移/未启用 = null）；备份路径可经 migrationRecord 取回。 */
  private migration: ViewpointsMigrationResult | null = null;

  private constructor(
    dataDir: string,
    options?: { evidenceStore?: EvidenceStoreLike; admissionPolicy?: AdmissionPolicy; migration?: CollabMigrationOptions },
  ) {
    this.evidenceStore = options?.evidenceStore;
    this.admissionPolicy = options?.admissionPolicy;
    const dir = path.resolve(dataDir);
    this.dbPath = path.join(dir, 'collaboration', 'blackboard.sqlite');
    this.runKeyBase = process.platform === 'win32' ? this.dbPath.toLowerCase() : this.dbPath;
    if (!existsSync(path.dirname(this.dbPath))) {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    // GOAL-085 §4：旧库先迁移（备份 + 事务内重建 views），再建其余表/索引。
    if (options?.migration?.migrate !== false) {
      const result = migrateViewpointsUniqueKey(this.db, this.dbPath, { backupDir: options?.migration?.backupDir });
      if (result.ran) this.migration = result;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        constraints TEXT,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        call_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        call_limit INTEGER NOT NULL,
        retry_limit INTEGER NOT NULL,
        authorization_hash TEXT NOT NULL,
        session_timeout_min REAL NOT NULL,
        deadline_utc TEXT,
        created_at_utc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS participants (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        seat TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        is_coordinator INTEGER NOT NULL DEFAULT 0,
        run_instance TEXT,
        PRIMARY KEY (session_id, seat)
      );
      CREATE TABLE IF NOT EXISTS materials (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        material_id TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        allowed_seats TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,
        PRIMARY KEY (session_id, material_id)
      );
      CREATE TABLE IF NOT EXISTS authorizations (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        snapshot_json TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at_utc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS viewpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        author_seat TEXT NOT NULL,
        author_instance TEXT NOT NULL,
        phase TEXT NOT NULL,
        kind TEXT NOT NULL,
        responds_to TEXT,
        target TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        stance TEXT,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        reserved_disagreements TEXT,
        material_manifest_json TEXT NOT NULL DEFAULT '[]',
        created_at_utc TEXT NOT NULL,
        UNIQUE (session_id, author_seat, kind, target)
      );
      CREATE TABLE IF NOT EXISTS session_outcomes (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id),
        outcome_json TEXT NOT NULL,
        recorded_at_utc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        call_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        seat TEXT,
        status TEXT NOT NULL DEFAULT 'started',
        started_at_utc TEXT NOT NULL,
        ended_at_utc TEXT,
        error TEXT
      );
    `);
  }

  /** 打开某工作区数据面下的黑板库；不同 dataDir 物理隔离，互不可见。
   *  evidenceStore 缺省时隔离会话无法准入（证据不可核验 → 保持未验证）。
   *  admissionPolicy 缺省时不存在任何"已知缺口"例外（与旧行为一致，fail-closed）。
   *  migration 缺省自动迁移旧库（先备份后事务内重建，见 migrateViewpointsUniqueKey）。 */
  static open(
    dataDir: string,
    options?: { evidenceStore?: EvidenceStoreLike; admissionPolicy?: AdmissionPolicy; migration?: CollabMigrationOptions },
  ): CollaborationBlackboard {
    return new CollaborationBlackboard(dataDir, options);
  }

  /** 本实例打开时执行的迁移记录（未迁移 = null）：backup_path 即回滚入口。 */
  get migrationRecord(): ViewpointsMigrationResult | null {
    return this.migration;
  }

  /** 回滚入口：关闭本实例后按备份恢复（备份先于本实例的迁移产生）。
   *  覆盖前会把"迁移后"的库另存为 `.failed-<ts>`，不销毁证据。 */
  static restoreFromBackup(dbPath: string, backupPath: string): { restored_from: string; preserved_path: string } {
    return restoreBlackboardFromBackup(dbPath, backupPath);
  }

  /** 本黑板使用的受控证据库（宿主注入；缺省=未注入，隔离会话保持未验证）。
   *  会话创建时据此取该席位指纹的证据条目——保证"管线黑板"与"看板黑板"同源。 */
  get evidenceStoreRef(): EvidenceStoreLike | undefined {
    return this.evidenceStore;
  }

  /** 关闭底层 SQLite 连接（服务关闭/测试收尾释放文件句柄）；关闭后本实例不可再用。 */
  close(): void {
    this.db.close();
  }

  get databasePath(): string {
    return this.dbPath;
  }

  private getSessionRow(sessionId: string): SessionRow {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!row) throw new BlackboardAccessError(`session not found: ${sessionId}`);
    return row;
  }

  /** 创建会话即冻结授权快照（议题/工作区/参与者/材料哈希/边界），创建本身不发起模型调用。
   *  D97：仅新建 2 位（A/B）；三席位历史结构保留用于读取。席位集合必须
   *  恰好等于该人数对应的前 N 个席位。评审关系由服务端派生并写入快照，调用方不可注入。 */
  createSession(input: CollabSessionInput): { session_id: string; authorization_hash: string } {
    const seatCount = input.participants.length;
    if (!COLLAB_SEAT_COUNTS.includes(seatCount)) {
      throw new BlackboardAccessError(`仅支持双模型 2 位（A/B）参与者，收到 ${seatCount} 位`);
    }
    const expectedSeats = COLLAB_SEATS.slice(0, seatCount);
    const seats = input.participants.map((p) => p.seat);
    const sortedSeats = [...seats].sort().join(',');
    if (new Set(seats).size !== seatCount || sortedSeats !== expectedSeats.join(',')) {
      throw new BlackboardAccessError(`参与者席位必须恰为 ${expectedSeats.join('/')}（不重复、不增减）`);
    }
    const coordinators = input.participants.filter((p) => p.is_coordinator).length;
    if (coordinators !== 1) throw new BlackboardAccessError('必须恰一位协调者');
    const defaults = collabDefaultsFor(seatCount);
    const callLimit = input.call_limit ?? defaults.call_limit;
    const retryLimit = input.retry_limit ?? defaults.retry_limit;
    // 评审关系冻结：由参与者席位派生（服务端唯一来源），不读任何调用方字段。
    // 调用方显式注入即拒绝（而不是静默丢弃）——避免"看起来能配评审关系"的错误预期。
    if ((input as { review_relations?: unknown }).review_relations !== undefined) {
      throw new BlackboardAccessError(
        '评审关系由服务端按参与者席位派生并冻结，不接受调用方注入 review_relations',
      );
    }
    const reviewRelations = deriveReviewRelations(seats);

    const sessionId = randomUUID();
    const materials = (input.materials ?? []).map((m) => {
      if (!m.allowed_seats.length) throw new BlackboardAccessError(`材料 ${m.material_id} 无获准读取者`);
      return { ...m, sha256: sha256(m.content), allowed_seats: [...m.allowed_seats].sort() };
    });
    const snapshot: CollabAuthorizationSnapshot = {
      topic: input.topic,
      workspace_root: path.resolve(input.workspace_root),
      constraints: input.constraints,
      participants: input.participants,
      materials: materials.map(({ material_id, name, source, sha256: hash, allowed_seats }) => ({
        material_id, name, source, sha256: hash, allowed_seats,
      })),
      call_limit: callLimit,
      retry_limit: retryLimit,
      single_call_timeout_s: input.single_call_timeout_s ?? DEFAULT_SINGLE_CALL_TIMEOUT_S,
      session_timeout_min: input.session_timeout_min ?? defaults.session_timeout_min,
      ...(input.isolation_required !== undefined ? { isolation_required: input.isolation_required } : {}),
      ...(input.capability_evidence !== undefined ? { capability_evidence: input.capability_evidence } : {}),
      skill_registry_sha256: input.skill_registry_sha256 ?? collabSkillRegistrySha256(seatCount),
      review_relations: reviewRelations,
    };
    // D89 条件化准入：创建即按当前证据 + 政策冻结"已知缺口"。缺口未被政策逐条接受时
    // 创建即失败（避免造出一个永远无法批准的会话）；证据等级不因此改变。
    // 同时冻结失败反例：已证实的失败不得由政策接受（owner 2026-10-04 复核）。
    const counterexamples = this.failureCounterexamplesFor(snapshot);
    if (counterexamples.length > 0) {
      this.assertNoFailureCounterexamples(snapshot);
    }
    if (this.admissionPolicy !== undefined) {
      const accepted = this.acceptedGapsFor(snapshot);
      snapshot.policy_decision_ref = this.admissionPolicy.decision_ref;
      snapshot.accepted_gaps = accepted;
      snapshot.failure_counterexamples = counterexamples;
    } else {
      // 未启用政策：严格路径本就要求五维行为级 pass；反例已在上面拒绝。
      snapshot.failure_counterexamples = counterexamples;
    }
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotHash = sha256(snapshotJson);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        'INSERT INTO sessions (id, topic, workspace_root, constraints, status, phase, call_count, retry_count, call_limit, retry_limit, authorization_hash, session_timeout_min, deadline_utc, created_at_utc) VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?)',
      ).run(sessionId, input.topic, snapshot.workspace_root, input.constraints ?? null,
        'pending_approval', 'coordination', callLimit, retryLimit, snapshotHash,
        snapshot.session_timeout_min, null, nowUtc());
      for (const p of input.participants) {
        this.db.prepare(
          'INSERT INTO participants (session_id, seat, adapter_id, provider_id, model_id, is_coordinator) VALUES (?,?,?,?,?,?)',
        ).run(sessionId, p.seat, p.adapter_id, p.provider_id ?? null, p.model_id ?? null, p.is_coordinator ? 1 : 0);
      }
      for (const m of materials) {
        this.db.prepare(
          'INSERT INTO materials (session_id, material_id, name, source, content, sha256, allowed_seats, created_at_utc) VALUES (?,?,?,?,?,?,?,?)',
        ).run(sessionId, m.material_id, m.name, m.source, m.content, m.sha256, JSON.stringify(m.allowed_seats), nowUtc());
      }
      this.db.prepare(
        'INSERT INTO authorizations (session_id, snapshot_json, sha256, created_at_utc) VALUES (?,?,?,?)',
      ).run(sessionId, snapshotJson, snapshotHash, nowUtc());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { session_id: sessionId, authorization_hash: snapshotHash };
  }

  getSession(sessionId: string): SessionRow {
    return this.getSessionRow(sessionId);
  }

  listSessions(): SessionRow[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY created_at_utc DESC').all() as unknown as SessionRow[];
  }

  getAuthorizationSnapshot(sessionId: string): CollabAuthorizationSnapshot {
    const row = this.db.prepare(
      'SELECT snapshot_json FROM authorizations WHERE session_id = ? ORDER BY seq DESC LIMIT 1',
    ).get(sessionId) as { snapshot_json: string } | undefined;
    if (!row) throw new BlackboardAccessError(`no authorization snapshot for session ${sessionId}`);
    return JSON.parse(row.snapshot_json);
  }

  /** 本会话冻结的评审关系（两两互评）。GOAL-085 起的快照直接带 review_relations；
   *  旧快照（GOAL-084 双席）无此字段，按参与者席位派生同口径关系——旧会话因此
   *  继续按 A→B/B→A 运行，不因新增字段而失效。 */
  reviewRelationsFor(sessionId: string): CollabReviewRelation[] {
    const snapshot = this.getAuthorizationSnapshot(sessionId);
    const frozen = snapshot.review_relations;
    if (Array.isArray(frozen) && frozen.length > 0) return frozen.map((r) => ({ author: r.author, target: r.target }));
    return deriveReviewRelations(snapshot.participants.map((p) => p.seat));
  }

  /** 该席位的全部冻结评审关系（协调器据此逐条派发评审轮）。 */
  reviewRelationsForSeat(sessionId: string, seat: CollabSeat): CollabReviewRelation[] {
    return this.reviewRelationsFor(sessionId).filter((r) => r.author === seat);
  }

  /** 冻结关系是否已逐条落板（review → revision 的放行条件）。返回缺失关系描述。 */
  missingReviewRelations(sessionId: string): string[] {
    const frozen = this.reviewRelationsFor(sessionId);
    const done = new Set((this.db.prepare(
      "SELECT author_seat, target FROM viewpoints WHERE session_id = ? AND kind = 'review'",
    ).all(sessionId) as Array<{ author_seat: string; target: string }>).map((r) => `${r.author_seat}->${r.target}`));
    return frozen.filter((r) => !done.has(`${r.author}->${r.target}`)).map((r) => `${r.author}->${r.target}`);
  }

  /** 隔离会话中，某席位在哪些维度上缺**行为级**证据（来源必须能在受控证据库逐字段解析）。
   *  等级只看显式 verification 字段与登记记录，不看描述文字（2026-10-04 owner 裁定）。
   *  返回的每条都带 `evidence_ok`，便于准入分支区分"缺证据"与"不是行为级/未登记"。 */
  private unmetIsolationDimensions(
    participant: CollabParticipantInput, evidence: CollabCapabilityEvidence[],
  ): string[] {
    const unmet: string[] = [];
    for (const dimension of ISOLATION_DIMENSIONS) {
      const ok = evidence.some((e) => {
        if (e.adapter_id !== participant.adapter_id || e.dimension !== dimension || e.status !== 'live_verified') return false;
        if (!(EVIDENCE_BEHAVIOR_METHODS as readonly string[]).includes(e.method)) return false;
        if (e.verification !== 'behavior') return false;
        if (typeof e.coverage !== 'string' || e.coverage.trim() === '') return false;
        if (typeof e.tool_version !== 'string' || e.tool_version.trim() === '') return false;
        if (e.config_fingerprint !== participant.config_fingerprint) return false;
        if (typeof e.source !== 'string' || e.source.trim() === '') return false;
        // 正式路径：来源必须在受控证据库中已登记且逐字段匹配——不存在、
        // 不匹配或仅 fixture 声明的来源保持未验证（§3.3 owner 复核）。
        const record = this.evidenceStore?.resolve(e.source);
        if (record === undefined) return false;
        if (record.adapter_id !== e.adapter_id || record.dimension !== dimension) return false;
        if (record.method !== e.method || record.subject !== e.subject) return false;
        if (record.coverage !== e.coverage) return false;
        if (record.tool_version !== e.tool_version) return false;
        if (record.config_fingerprint !== e.config_fingerprint) return false;
        if ((record.verification === 'behavior' ? 'behavior' : 'declared') !== 'behavior') return false;
        if (!/^[0-9a-f]{64}$/i.test(record.artifact_sha256)) return false;
        if (record.result !== 'pass') return false;
        return true;
      });
      if (!ok) unmet.push(dimension);
    }
    return unmet;
  }

  /** D89 必要条件：收集该会话在**受控证据库**中适用的失败反例（fail）。
   *  owner 2026-10-04 复核：政策只接受"未验证"的缺口；一旦同通道同指纹同维度存在已登记反例，
   *  该配置已被证伪，创建/批准都必须拒绝——政策不能覆盖失败。
   *  - 证据库**缺省**：不合成反例（改由既有的"来源不可核验"证据门拒绝，保持原有 409 语义）；
   *  - 证据库存在但**无法枚举反例**（合成实现缺 `failuresFor`）：按不可核验处理（拒绝）。 */
  private failureCounterexamplesFor(snapshot: {
    participants: CollabParticipantInput[]; capability_evidence?: CollabCapabilityEvidence[];
  }): EvidenceFailure[] {
    if (this.evidenceStore === undefined) return [];
    const found = new Map<string, EvidenceFailure>();
    for (const participant of snapshot.participants) {
      const fingerprint = participant.config_fingerprint ?? '';
      if (fingerprint === '') continue;
      for (const dimension of ISOLATION_DIMENSIONS) {
        if (this.evidenceStore.failuresFor === undefined) {
          throw new BlackboardAccessError(
            `isolation admission: 证据库无法核验失败反例（通道 ${participant.adapter_id} 维度 ${dimension}），按不可核验拒绝隔离会话`,
          );
        }
        for (const record of this.evidenceStore.failuresFor(participant.adapter_id, fingerprint, dimension)) {
          found.set(`${record.adapter_id}|${fingerprint}|${dimension}|${record.source}`, {
            adapter_id: record.adapter_id, dimension, config_fingerprint: fingerprint,
            source: record.source, subject: record.subject, result: record.result === 'withdrawn' ? 'withdrawn' : 'fail',
          });
        }
      }
    }
    return [...found.values()];
  }

  private assertNoFailureCounterexamples(
    snapshot: { participants: CollabParticipantInput[]; capability_evidence?: CollabCapabilityEvidence[] },
    frozen?: EvidenceFailure[],
  ): void {
    const current = this.failureCounterexamplesFor(snapshot);
    if (current.length === 0 && (frozen === undefined || frozen.length === 0)) return;
    const describe = (rows: EvidenceFailure[]): string => rows.map((f) =>
      `${f.adapter_id}/${f.config_fingerprint.slice(0, 12)}…/${f.dimension}（${f.result}，source ${f.source}）`).join('、');
    if (frozen !== undefined) {
      const key = (f: EvidenceFailure): string => `${f.adapter_id}|${f.config_fingerprint}|${f.dimension}|${f.result}`;
      const currentKeys = [...new Set(current.map(key))].sort().join(',');
      const frozenKeys = [...new Set(frozen.map(key))].sort().join(',');
      if (currentKeys !== frozenKeys) {
        throw new BlackboardAccessError(
          `isolation admission: 失败反例集合与冻结快照不一致（当前 [${currentKeys || '无'}] / 冻结 [${frozenKeys || '无'}]），拒绝授权隔离会话`,
        );
      }
      return;
    }
    throw new BlackboardAccessError(
      `isolation admission: 该配置已有失败反例（${describe(current)}），已证实的失败不得由准入政策接受`
      + `${this.admissionPolicy !== undefined ? `（政策 ${this.admissionPolicy.decision_ref} 只接受"缺证"）` : ''}，拒绝隔离会话`,
    );
  }

  /** D89 条件化准入：把该会话每个席位的**已知缺口**与政策条款逐条比对。
   *  未启用政策时返回空集（调用方据此走严格路径）；政策缺少某缺口的条款即抛错（fail-closed）。 */
  private acceptedGapsFor(snapshot: {
    participants: CollabParticipantInput[]; capability_evidence?: CollabCapabilityEvidence[];
    call_limit: number; retry_limit: number; single_call_timeout_s: number; session_timeout_min: number;
  }): AcceptedGapRecord[] {
    const accepted = new Map<string, AcceptedGapRecord>();
    for (const participant of snapshot.participants) {
      const fingerprint = participant.config_fingerprint ?? '';
      for (const dimension of this.unmetIsolationDimensions(participant, snapshot.capability_evidence ?? [])) {
        const gap = policyGapFor(this.admissionPolicy, participant.adapter_id, fingerprint, dimension);
        if (gap === undefined) {
          throw new BlackboardAccessError(
            `isolation admission: 席位 ${participant.seat} 通道 ${participant.adapter_id} 维度 ${dimension} 缺行为级（live_verified）证据，`
            + `且准入政策未接受该缺口，拒绝授权隔离会话`,
          );
        }
        const scope = gap.session_scope;
        if (scope !== undefined && (JSON.stringify(snapshot.participants.map(p => p.adapter_id).sort()) !== JSON.stringify([...scope.adapter_ids].sort())
          || snapshot.call_limit > scope.call_limit || snapshot.retry_limit > scope.retry_limit
          || snapshot.single_call_timeout_s > scope.single_call_timeout_s || snapshot.session_timeout_min > scope.session_timeout_min
          || !(snapshot.call_limit > 0) || !(snapshot.retry_limit >= 0) || !(snapshot.single_call_timeout_s > 0) || !(snapshot.session_timeout_min > 0))) {
          throw new BlackboardAccessError('isolation admission: policy session scope does not accept this pair or expanded call/time limits');
        }
        // 两席位可能同通道同指纹（首场 B 席即如此）——缺口按 通道|指纹|维度 去重，
        // 快照与审批卡只展示唯一集合。
        accepted.set(`${gap.adapter_id}|${gap.config_fingerprint}|${gap.dimension}`, gap);
      }
    }
    return [...accepted.values()];
  }

  /** owner 批准后放行（pending_approval → authorized）；快照不可变，扩大边界须另建会话。
   *  隔离会话（isolation_required）按快照内证据条目 fail-closed 准入：默认每个参与通道的
   *  每个隔离维度都必须有行为级（live_verified）证据，缺任一即拒——声明存在不等于权限生效（§3.3）。
   *  D89 条件化准入：快照冻结了 policy_decision_ref 时，**仅**允许"该政策逐条接受的已知缺口"
   *  通过，且缺口集合必须与当前证据状态逐条一致（证据变好不得沿用旧缺口，变差即拒）。
   *  证据等级不因该分支改变——缺口仍是 unmet，只是被显式接受。 */
  /** Shared execution gate. Reading legacy snapshots never invokes this gate. */
  assertDualModelSession(sessionId: string): void {
    const participants = this.getAuthorizationSnapshot(sessionId).participants;
    if (participants.length !== 2 || [...participants.map(p => p.seat)].sort().join(',') !== 'A,B') {
      throw new BlackboardAccessError('D97：历史三席位或其它非双席位会话只读，禁止批准、启动和占额');
    }
  }

  /** Read-only pre-creation admission, using exactly the same evidence/policy gates. */
  assertProspectiveAdmission(participants: CollabParticipantInput[], evidence: CollabCapabilityEvidence[]): void {
    if (participants.length !== 2 || participants.map(p => p.seat).sort().join(',') !== 'A,B') {
      throw new BlackboardAccessError('仅支持双模型 A/B');
    }
    const snapshot = { participants, capability_evidence: evidence, isolation_required: true,
      ...collabDefaultsFor(2), single_call_timeout_s: DEFAULT_SINGLE_CALL_TIMEOUT_S };
    this.assertNoFailureCounterexamples(snapshot);
    this.acceptedGapsFor(snapshot);
  }

  assertCanAuthorizeSession(sessionId: string): void {
    this.assertDualModelSession(sessionId);
    const row = this.getSessionRow(sessionId);
    if (row.status !== 'pending_approval') {
      throw new BlackboardAccessError(`cannot authorize session in status ${row.status}`);
    }
    const snapshot = this.getAuthorizationSnapshot(sessionId);
    if (snapshot.isolation_required === true) {
      const evidence = snapshot.capability_evidence ?? [];
      // 按席位逐一核验（owner 复核：同适配器不同席位可批准不同配置，
      // 按适配器去重会漏掉无证据席位）；隔离会话每个席位必须声明批准
      // 配置指纹，证据指纹须与其一致。
      for (const participant of snapshot.participants) {
        if (typeof participant.config_fingerprint !== 'string' || participant.config_fingerprint.trim() === '') {
          throw new BlackboardAccessError(
            `isolation admission: 席位 ${participant.seat}（${participant.adapter_id}）未声明批准配置指纹，拒绝授权隔离会话`,
          );
        }
      }
      const currentGaps = this.acceptedGapsFor(snapshot);
      const frozenGaps = snapshot.policy_decision_ref === undefined ? [] : (snapshot.accepted_gaps ?? []);
      // 必要条件先于缺口分支：已证实的失败反例一律拒（政策不覆盖失败）。
      this.assertNoFailureCounterexamples(snapshot, snapshot.failure_counterexamples);
      if (snapshot.policy_decision_ref === undefined) {
        // 严格路径：任何缺口都拒（含"缺缺口条款但当前刚好无缺口"也不放行额外缺口）。
        if (currentGaps.length > 0) {
          const first = currentGaps[0];
          throw new BlackboardAccessError(
            `isolation admission: 席位通道 ${first.adapter_id} 维度 ${first.dimension} 缺行为级（live_verified）证据，拒绝授权隔离会话`,
          );
        }
        return;
      }
      const key = (g: AcceptedGapRecord): string =>
        `${g.adapter_id}|${g.config_fingerprint}|${g.dimension}|${JSON.stringify(g.session_scope ?? null)}`;
      const currentKeys = currentGaps.map(key).sort();
      const frozenKeys = frozenGaps.map(key).sort();
      if (JSON.stringify(currentKeys) !== JSON.stringify(frozenKeys)) {
        throw new BlackboardAccessError(
          `isolation admission: 已知缺口集合与冻结快照不一致（当前 [${currentKeys.join(', ')}] / 冻结 [${frozenKeys.join(', ')}]），拒绝授权隔离会话`,
        );
      }
    }
  }

  authorizeSession(sessionId: string): void {
    this.assertCanAuthorizeSession(sessionId);
    this.db.prepare("UPDATE sessions SET status = 'authorized' WHERE id = ?").run(sessionId);
  }

  /** 附加会话授权快照（append-only）；已有快照的会话拒绝重复冻结。 */
  appendAuthorizationSnapshot(): never {
    throw new BlackboardAccessError('授权快照不可变：扩大任一边界须另建会话重新授权');
  }

  /** 终态转换（completed/cancelled/interrupted/failed）；待批准会话可被取消（§2.4）。 */
  closeSession(sessionId: string, next: 'completed' | 'cancelled' | 'interrupted' | 'failed'): void {
    const row = this.getSessionRow(sessionId);
    if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'interrupted' || row.status === 'failed') {
      throw new BlackboardAccessError(`session already terminal: ${row.status}`);
    }
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(next, sessionId);
  }

  /** 保存一次协调器终态结果；原始执行记录及观点不被摘要覆盖。 */
  recordSessionOutcome(sessionId: string, outcome: { status: 'completed' | 'failed' | 'interrupted'; reason?: string; dispatch_ids: string[] }): void {
    if (this.getSessionRow(sessionId).status !== outcome.status) {
      throw new BlackboardAccessError('session outcome must match the terminal session status');
    }
    this.db.prepare('INSERT INTO session_outcomes (session_id, outcome_json, recorded_at_utc) VALUES (?,?,?)')
      .run(sessionId, JSON.stringify(outcome), new Date().toISOString());
  }

  getSessionOutcome(sessionId: string): { status: 'completed' | 'failed' | 'interrupted'; reason?: string; dispatch_ids: string[] } | null {
    this.getSessionRow(sessionId);
    const row = this.db.prepare('SELECT outcome_json FROM session_outcomes WHERE session_id = ?')
      .get(sessionId) as { outcome_json: string } | undefined;
    return row === undefined ? null : JSON.parse(row.outcome_json);
  }

  /** 派发后绑定运行实例身份；此后该席位观点只能由该实例写入。终态会话拒绝绑定。 */
  bindRunInstance(sessionId: string, seat: CollabSeat, runInstance: string): void {
    const session = this.getSessionRow(sessionId);
    if (session.status === 'completed' || session.status === 'cancelled' || session.status === 'interrupted' || session.status === 'failed') {
      throw new BlackboardAccessError(`session already terminal: ${session.status}`);
    }
    const row = this.db.prepare(
      'SELECT run_instance FROM participants WHERE session_id = ? AND seat = ?',
    ).get(sessionId, seat) as { run_instance: string | null } | undefined;
    if (!row) throw new BlackboardAccessError(`unknown seat ${seat}`);
    const clash = this.db.prepare(
      'SELECT seat FROM participants WHERE session_id = ? AND run_instance = ?',
    ).get(sessionId, runInstance) as { seat: CollabSeat } | undefined;
    if (clash && clash.seat !== seat) {
      throw new BlackboardAccessError(`运行实例已绑定席位 ${clash.seat}：同一会话内实例与席位一一对应`);
    }
    if (row.run_instance && row.run_instance !== runInstance) {
      throw new BlackboardAccessError(`seat ${seat} already bound to another run instance`);
    }
    this.db.prepare(
      'UPDATE participants SET run_instance = ? WHERE session_id = ? AND seat = ?',
    ).run(runInstance, sessionId, seat);
  }

  /** 阶段只沿固定链前进；终态冻结一切状态变更；上阶段齐备才可放行。
   *  GOAL-085：齐备口径按参与者席位数与冻结评审关系计算——proposal→review 要求
   *  全部席位各一份提案；review→revision 要求**全部冻结评审关系**逐条落板
   *  （三席 6 条、双席 2 条），遗漏任一关系即拒绝推进。 */
  setPhase(sessionId: string, next: CollabPhase): void {
    const row = this.getSessionRow(sessionId);
    if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'interrupted' || row.status === 'failed') {
      throw new BlackboardAccessError(`session already terminal: ${row.status}`);
    }
    const currentIdx = PHASE_CHAIN.indexOf(row.phase);
    const nextIdx = PHASE_CHAIN.indexOf(next);
    if (nextIdx !== currentIdx + 1) {
      throw new BlackboardAccessError(`phase must advance along ${PHASE_CHAIN.join('→')}, got ${row.phase}→${next}`);
    }
    const seatCount = this.participantSeats(sessionId).length;
    if (next === 'proposal') {
      const assignment = this.db.prepare(
        "SELECT COUNT(*) AS n FROM viewpoints WHERE session_id = ? AND kind = 'assignment'",
      ).get(sessionId) as { n: number };
      if (assignment.n < 1) throw new BlackboardAccessError('协调者分配建议齐备后才能进入提案阶段');
    }
    if (next === 'review') {
      const done = this.db.prepare(
        "SELECT COUNT(DISTINCT author_seat) AS n FROM viewpoints WHERE session_id = ? AND kind = 'proposal'",
      ).get(sessionId) as { n: number };
      if (done.n < seatCount) throw new BlackboardAccessError(`all ${seatCount} seats must finish proposal before review`);
    }
    if (next === 'revision') {
      const missing = this.missingReviewRelations(sessionId);
      if (missing.length > 0) {
        throw new BlackboardAccessError(`评审关系未齐备，不得进入 revision（缺失：${missing.join('、')}）`);
      }
    }
    this.db.prepare('UPDATE sessions SET phase = ? WHERE id = ?').run(next, sessionId);
  }

  /** 本会话参与者席位（固定顺序 A→B→C）；快照是唯一来源。 */
  participantSeats(sessionId: string): CollabSeat[] {
    const snapshot = this.getAuthorizationSnapshot(sessionId);
    return COLLAB_SEATS.filter((seat) => snapshot.participants.some((p) => p.seat === seat));
  }

  /** 修订是否齐备（参与席位各一条）——整场完成条件，与阶段门同口径。 */
  missingRevisions(sessionId: string): CollabSeat[] {
    const done = new Set((this.db.prepare(
      "SELECT DISTINCT author_seat FROM viewpoints WHERE session_id = ? AND kind = 'revision'",
    ).all(sessionId) as Array<{ author_seat: string }>).map((r) => r.author_seat));
    return this.participantSeats(sessionId).filter((seat) => !done.has(seat));
  }

  /**
   * 追加观点。席位由 author_instance 反查（未知实例拒绝）；kind 由当前阶段唯一
   * 决定（coordination 仅协调者）；原文只追加不覆盖。唯一性 GOAL-085 起为
   * (session_id, author_seat, kind, target)：提案/修订每席位一条；评审每
   * (作者, 目标提案作者) 一条。评审必须回应**本会话**的对方提案、且关系必须落在
   * 冻结的 review_relations 内（自评、越界关系、跨会话回应一律拒绝）；
   * 证据与发送清单按登记材料冻结 id+哈希。
   */
  appendViewpoint(input: CollabViewpointInput): CollabViewpoint {
    const row = this.getSessionRow(input.session_id);
    if (row.status !== 'authorized' && row.status !== 'in_progress') {
      throw new BlackboardAccessError(`cannot append viewpoint in status ${row.status}`);
    }
    const seatRow = this.db.prepare(
      'SELECT seat, is_coordinator FROM participants WHERE session_id = ? AND run_instance = ?',
    ).get(input.session_id, input.author_instance) as { seat: CollabSeat; is_coordinator: number } | undefined;
    if (!seatRow) {
      throw new BlackboardAccessError('author_instance 不是本会话任何席位的绑定运行实例（不接受自报作者）');
    }
    const phase = row.phase;
    if (phase === 'coordination' && !seatRow.is_coordinator) {
      throw new BlackboardAccessError('coordination 阶段仅协调者可提交分配建议');
    }
    const kind = phase === 'coordination' ? 'assignment' : phase;
    const seatOf = (vp: Record<string, unknown>) => (vp.author_seat as string);
    let respondsTo: string | null = null;
    /** GOAL-085：提案/修订的 target 恒为空串（唯一键退化为"每席位一条"）；
     *  评审的 target = 被评审提案的作者席位（唯一键允许同作者多条评审，
     *  但每条只指向一个不同目标）。 */
    let reviewTarget = '';
    if (phase === 'review') {
      if (!input.responds_to) throw new BlackboardAccessError('评审必须回应对方的指定提案');
      // 跨会话回应在这里被拒：目标查询强制同一 session_id（别的会话的观点查不到）。
      const target = this.db.prepare(
        "SELECT author_seat FROM viewpoints WHERE id = ? AND session_id = ? AND kind = 'proposal'",
      ).get(input.responds_to, input.session_id) as Record<string, unknown> | undefined;
      if (!target) throw new BlackboardAccessError('回应对象不存在或不是提案（跨会话回应一律拒绝）');
      if (seatOf(target) === seatRow.seat) throw new BlackboardAccessError('评审不能回应自己的提案');
      // 冻结关系门：关系不在授权快照的 review_relations 内即拒（调用方不得自选评审对象）。
      const relation = this.reviewRelationsFor(input.session_id)
        .find((r) => r.author === seatRow.seat && r.target === seatOf(target));
      if (relation === undefined) {
        throw new BlackboardAccessError(
          `评审关系 ${seatRow.seat}→${seatOf(target)} 不在本会话冻结的 review_relations 内，拒绝写入`,
        );
      }
      respondsTo = input.responds_to;
      reviewTarget = seatOf(target);
    } else if (input.responds_to) {
      const target = this.db.prepare(
        'SELECT id FROM viewpoints WHERE id = ? AND session_id = ?',
      ).get(input.responds_to, input.session_id) as Record<string, unknown> | undefined;
      if (!target) throw new BlackboardAccessError('回应对象不存在');
      respondsTo = input.responds_to;
    }
    const evidence = this.freezeMaterialRefs(input.session_id, seatRow.seat, input.evidence_material_ids ?? []);
    const manifest = this.freezeMaterialRefs(input.session_id, seatRow.seat, input.manifest_material_ids ?? []);

    const id = `vp_${randomUUID()}`;
    try {
      this.db.prepare(
        'INSERT INTO viewpoints (id, session_id, author_seat, author_instance, phase, kind, responds_to, target, version, body, stance, evidence_json, reserved_disagreements, material_manifest_json, created_at_utc) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)',
      ).run(id, input.session_id, seatRow.seat, input.author_instance, phase, kind, respondsTo, reviewTarget,
        input.body, input.stance ?? null, JSON.stringify(evidence),
        input.reserved_disagreements ?? null, JSON.stringify(manifest), nowUtc());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE')) {
        if (phase === 'review') {
          throw new BlackboardAccessError(
            `席位 ${seatRow.seat} 对提案 ${reviewTarget} 已提交过评审：每条评审关系只追加一条，不覆盖`,
          );
        }
        throw new BlackboardAccessError(`席位 ${seatRow.seat} 在 ${phase} 阶段已提交，观点只追加不覆盖`);
      }
      throw error;
    }
    if (row.status === 'authorized') {
      this.db.prepare("UPDATE sessions SET status = 'in_progress' WHERE id = ?").run(input.session_id);
    }
    return this.getViewpoint(id);
  }

  /** 校验 material_id 存在且对席位获准，冻结为 id+sha256。 */
  private freezeMaterialRefs(sessionId: string, seat: CollabSeat, materialIds: string[]) {
    return materialIds.map((materialId) => {
      const m = this.db.prepare(
        'SELECT sha256, allowed_seats FROM materials WHERE session_id = ? AND material_id = ?',
      ).get(sessionId, materialId) as { sha256: string; allowed_seats: string } | undefined;
      if (!m) throw new BlackboardAccessError(`材料不存在: ${materialId}`);
      if (!(JSON.parse(m.allowed_seats) as string[]).includes(seat)) {
        throw new BlackboardAccessError(`席位 ${seat} 无权引用材料 ${materialId}`);
      }
      return { material_id: materialId, sha256: m.sha256 };
    });
  }

  getViewpoint(id: string): CollabViewpoint {
    const row = this.db.prepare('SELECT * FROM viewpoints WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BlackboardAccessError(`viewpoint not found: ${id}`);
    return rowToViewpoint(row);
  }

  /**
   * 组装席位在本阶段的可见上下文：公共议题/约束恒可见；独立提案互不可见；
   * review 各席位提案对本席位可见（三席两两互评时也只取本轮那一份，见协调器
   * reviewPrompt），仍不见对方评审；revision 见针对自己提案的评审。
   */
  getVisibleContext(sessionId: string, seat: CollabSeat): {
    topic: string;
    constraints: string | null;
    workspace_root: string;
    phase: CollabPhase;
    status: CollabStatus;
    own: CollabViewpoint[];
    visible: CollabViewpoint[];
    materials: Array<{ material_id: string; name: string; source: string; content: string; sha256: string }>;
  } {
    const row = this.getSessionRow(sessionId);
    const own = (this.db.prepare(
      'SELECT * FROM viewpoints WHERE session_id = ? AND author_seat = ? ORDER BY created_at_utc',
    ).all(sessionId, seat) as Record<string, unknown>[]).map(rowToViewpoint);
    const otherRows = (this.db.prepare(
      'SELECT * FROM viewpoints WHERE session_id = ? AND author_seat != ? ORDER BY created_at_utc',
    ).all(sessionId, seat) as Record<string, unknown>[]).map(rowToViewpoint);
    const visible = otherRows.filter((vp) => {
      if (vp.kind === 'assignment') return true; // 分配建议经 mush 校验后对双方公开
      if (row.phase === 'review') return vp.kind === 'proposal';
      if (row.phase === 'revision') {
        return vp.kind === 'proposal' ||
          (vp.kind === 'review' && vp.responds_to !== null &&
            own.some((mine) => mine.kind === 'proposal' && mine.id === vp.responds_to));
      }
      return false; // coordination/proposal 阶段：对方一切不可见
    });
    // 协调器靠这里重建完整上下文：获准席位拿到冻结正文与来源，未获准席位连条目都不出现。
    const materials = (this.db.prepare(
      'SELECT material_id, name, source, content, sha256, allowed_seats FROM materials WHERE session_id = ?',
    ).all(sessionId) as Record<string, unknown>[])
      .filter((m) => (JSON.parse(m.allowed_seats as string) as string[]).includes(seat))
      .map((m) => ({
        material_id: m.material_id as string,
        name: m.name as string,
        source: m.source as string,
        content: m.content as string,
        sha256: m.sha256 as string,
      }));
    return {
      topic: row.topic,
      constraints: row.constraints,
      workspace_root: row.workspace_root,
      phase: row.phase,
      status: row.status,
      own,
      visible,
      materials,
    };
  }

  /** D89 硬前置（owner 2026-10-04 二次复核）：**每次占额前**重新核对已冻结的失败反例集合——
   *  批准之后才登记的反例必须阻断本轮及后续每一轮/每次重试（占额、spawn 之前）。
   *  与批准时的比对同一口径；无冻结集合（旧会话）视为空集。 */
  assertSessionAdmissible(sessionId: string): void {
    const snapshot = this.getAuthorizationSnapshot(sessionId);
    const frozen: EvidenceFailure[] = snapshot.failure_counterexamples ?? [];
    const current = this.failureCounterexamplesFor(snapshot);
    const key = (f: EvidenceFailure): string => `${f.adapter_id}|${f.config_fingerprint}|${f.dimension}|${f.result}`;
    const currentKeys = [...new Set(current.map(key))].sort().join(',');
    const frozenKeys = [...new Set(frozen.map(key))].sort().join(',');
    if (currentKeys !== frozenKeys) {
      throw new BlackboardAccessError(
        `isolation admission: 失败反例集合已变更（当前 [${currentKeys || '无'}] / 批准冻结 [${frozenKeys || '无'}]），`
        + '拒绝继续占额；已证实的失败不得由准入政策接受，须重新核验并另建会话',
      );
    }
  }

  /**
   * 原子占用一次调用额度。三类上限分别核算（2026-10-01 owner 复核修正）：
   * normal 受正常次数（call_count-retry_count，默认 7）与总次数（默认 8）双重约束；
   * retry 受共享重试预算（默认 1）与总次数约束——中途重试不得挤占正常额度；
   * 终态冻结。整场截止时间在首次成功占额时确定，后续调用占额前检查过期。
   */
  occupyCall(sessionId: string, kind: CallKind, seat?: CollabSeat): {
    call_index: number;
    log_seq: number | bigint;
    deadline_utc: string;
    remaining_ms: number;
  } {
    // 占额是"派发/重试/下一轮"的必经关口：先查反例漂移，再动额度（本身不写库）。
    this.assertDualModelSession(sessionId);
    this.assertSessionAdmissible(sessionId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.getSessionRow(sessionId);
      if (row.status !== 'authorized' && row.status !== 'in_progress') {
        throw new BlackboardQuotaError(`session ${sessionId} 不在可执行状态（${row.status}），额度冻结`);
      }
      if (this.isStopRequested(sessionId)) {
        throw new BlackboardQuotaError('session stop requested: refusing call before quota occupation');
      }
      const now = new Date();
      let deadlineUtc: string;
      let remainingMs: number;
      if (row.deadline_utc === null) {
        deadlineUtc = new Date(now.getTime() + row.session_timeout_min * 60000).toISOString();
        remainingMs = Math.round(row.session_timeout_min * 60000);
      } else {
        deadlineUtc = row.deadline_utc;
        remainingMs = Date.parse(deadlineUtc) - now.getTime();
        if (remainingMs <= 0) {
          throw new BlackboardQuotaError(`session deadline exceeded（整场截止 ${deadlineUtc} 已过）；恢复执行须 owner 重新授权`);
        }
      }
      const totalLimit = row.call_limit + row.retry_limit;
      const normalUsed = row.call_count - row.retry_count;
      if (row.call_count >= totalLimit) {
        throw new BlackboardQuotaError(`总调用上限已达（${row.call_count}/${totalLimit}）`);
      }
      if (kind === 'normal' && normalUsed >= row.call_limit) {
        throw new BlackboardQuotaError(`正常调用额度已用尽（${normalUsed}/${row.call_limit}）`);
      }
      if (kind === 'retry' && row.retry_count >= row.retry_limit) {
        throw new BlackboardQuotaError('全场共享重试额度已用尽');
      }
      const newCount = row.call_count + 1;
      const newRetry = row.retry_count + (kind === 'retry' ? 1 : 0);
      this.db.prepare('UPDATE sessions SET call_count = ?, retry_count = ?, status = ?, deadline_utc = ? WHERE id = ?')
        .run(newCount, newRetry, 'in_progress', deadlineUtc, sessionId);
      const logSeq = this.db.prepare(
        'INSERT INTO execution_log (session_id, call_index, kind, seat, status, started_at_utc) VALUES (?,?,?,?,?,?)',
      ).run(sessionId, newCount, kind, seat ?? null, 'started', nowUtc()).lastInsertRowid;
      this.db.exec('COMMIT');
      return { call_index: newCount, log_seq: logSeq, deadline_utc: deadlineUtc, remaining_ms: remainingMs };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** 一次结算：仅接受明确终态（拒绝 started 与未知状态）；仅未结算行可落结果，
   * 以 status='started' 且 ended_at_utc IS NULL 双条件兜底——第一份证据不可改写。 */
  recordExecutionResult(logSeq: number | bigint, status: ExecutionSettlement, error?: string): void {
    if (!(SETTLEMENT_STATUSES as readonly string[]).includes(status)) {
      throw new BlackboardAccessError(`非法结算状态 "${status}"：只接受 ${SETTLEMENT_STATUSES.join('/')}`);
    }
    const res = this.db.prepare(
      "UPDATE execution_log SET status = ?, ended_at_utc = ?, error = ? WHERE seq = ? AND status = 'started' AND ended_at_utc IS NULL",
    ).run(status, nowUtc(), error ?? null, logSeq);
    if (Number(res.changes) === 0) {
      throw new BlackboardAccessError('执行记录已结算：结果只记录一次，不得改写');
    }
  }

  getExecutionLog(sessionId: string): Array<Record<string, unknown>> {
    return this.db.prepare(
      'SELECT * FROM execution_log WHERE session_id = ? ORDER BY call_index',
    ).all(sessionId) as Array<Record<string, unknown>>;
  }

  /** 标记活跃运行；返回 false = 该会话已有活跃运行（拒绝并发启动）。
   *  按"库路径+会话 ID"共享：同进程多句柄打开同一库时判定跨句柄生效。 */
  markRunActive(sessionId: string): boolean {
    const key = activeRunKey(this.runKeyBase, sessionId);
    if (ACTIVE_RUNS.has(key)) return false;
    ACTIVE_RUNS.add(key);
    return true;
  }

  isRunActive(sessionId: string): boolean {
    return ACTIVE_RUNS.has(activeRunKey(this.runKeyBase, sessionId));
  }

  clearRunActive(sessionId: string): void {
    ACTIVE_RUNS.delete(activeRunKey(this.runKeyBase, sessionId));
  }

  /** 整场停止：先阻止后续调用（协调器每轮派发前检查），再由调用方取消在途派发。 */
  requestStop(sessionId: string): void {
    STOP_REQUESTS.add(activeRunKey(this.runKeyBase, sessionId));
  }

  isStopRequested(sessionId: string): boolean {
    return STOP_REQUESTS.has(activeRunKey(this.runKeyBase, sessionId));
  }

  clearStop(sessionId: string): void {
    STOP_REQUESTS.delete(activeRunKey(this.runKeyBase, sessionId));
  }

  /** 登记在途派发（取消目标）；null = 当前无在途调用。 */
  setCurrentDispatch(sessionId: string, dispatchId: string | null): void {
    const key = activeRunKey(this.runKeyBase, sessionId);
    if (dispatchId === null) CURRENT_DISPATCHES.delete(key);
    else CURRENT_DISPATCHES.set(key, dispatchId);
  }

  getCurrentDispatch(sessionId: string): string | null {
    return CURRENT_DISPATCHES.get(activeRunKey(this.runKeyBase, sessionId)) ?? null;
  }
}
