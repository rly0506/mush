/**
 * GOAL-084 隔离准入政策（条件化准入分支，2026-10-04 owner 裁定 D89）。
 *
 * 背景：agy 正式讨论席位在席位指纹下有四维（tool_scope/write_protection/read_scope/recursion）
 * 只能是"未演练"——席位 agent 自身不发起该类请求（实测 A9/A10/A15 三轮零 tool 步骤），
 * 而 owner 2026-10-04 裁定"未尝试"不构成限制被验证的证据，且不许把 declared 凑成 live_verified。
 *
 * 本模块提供**唯一**的受控例外通道：宿主出具、owner 认可的政策文件逐条声明
 * "某指纹的某维度缺口被接受"，并随会话快照冻结、在审批卡上展示。
 * 准入语义不变——证据等级保持原样（缺口仍是 unmet）；变化只在"是否**允许带已知缺口**批准"。
 * 政策缺失、指纹不符、维度未声明、依据含糊 → 一律 fail-closed 拒绝。
 */
import { existsSync, readFileSync } from 'node:fs';

export interface AcceptedGap {
  /** 受影响通道（与参与者 adapter_id 比对）。 */
  adapter_id: string;
  /** 受影响的隔离维度（必须是 ISOLATION_DIMENSIONS 之一）。 */
  dimension: string;
  /** 被接受缺口所属的席位配置指纹（64 位十六进制）。 */
  config_fingerprint: string;
  /** 该缺口为何被接受（引用结构等价依据等）；不得为空。 */
  reason: string;
  /** 结构等价依据：逐字节相同的强制层文件哈希与唯一差异说明。 */
  equivalence: {
    gate_sha256: string;
    hooks_sha256: string;
    project_sha256: string;
    /** 唯一差异说明（如 --agent 取值）；不得为空。 */
    differing: string;
    /** 支撑该依据的归档（文档/复核产物路径）。 */
    reference: string;
  };
  /** 决策来源（如 'D88/D89 2026-10-04'）；不得为空。 */
  decided_by: string;
  /** Optional owner-approved room bounds; absent preserves historical D89 behavior. */
  session_scope?: GapSessionScope;
}

export interface GapSessionScope {
  adapter_ids: string[];
  call_limit: number;
  retry_limit: number;
  single_call_timeout_s: number;
  session_timeout_min: number;
}

export interface AdmissionPolicy {
  schema_version: 1;
  decision_ref: string;
  accepted_gaps: AcceptedGap[];
}

/** 缺口被政策接受的证据（随授权快照冻结、供审批卡展示）。 */
export interface AcceptedGapRecord {
  adapter_id: string;
  dimension: string;
  config_fingerprint: string;
  reason: string;
  equivalence: AcceptedGap['equivalence'];
  decided_by: string;
  session_scope?: GapSessionScope;
}

const HEX64 = /^[0-9a-f]{64}$/i;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function validScope(value: unknown): value is GapSessionScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  return Object.keys(s).length === 5 && Array.isArray(s.adapter_ids) && s.adapter_ids.length === 2 && s.adapter_ids.every(nonEmpty)
    && typeof s.call_limit === 'number' && Number.isInteger(s.call_limit) && s.call_limit > 0
    && typeof s.retry_limit === 'number' && Number.isInteger(s.retry_limit) && s.retry_limit >= 0
    && typeof s.single_call_timeout_s === 'number' && Number.isFinite(s.single_call_timeout_s) && s.single_call_timeout_s > 0
    && typeof s.session_timeout_min === 'number' && Number.isFinite(s.session_timeout_min) && s.session_timeout_min > 0;
}

function validGap(value: unknown): value is AcceptedGap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const g = value as Record<string, unknown>;
  const eq = g.equivalence as Record<string, unknown> | undefined;
  return nonEmpty(g.adapter_id) && nonEmpty(g.dimension) && HEX64.test(String(g.config_fingerprint)) &&
    nonEmpty(g.reason) && nonEmpty(g.decided_by) && eq !== undefined && typeof eq === 'object' &&
    HEX64.test(String(eq.gate_sha256)) && HEX64.test(String(eq.hooks_sha256)) && HEX64.test(String(eq.project_sha256)) &&
    nonEmpty(eq.differing) && nonEmpty(eq.reference) && (g.session_scope === undefined || validScope(g.session_scope));
}

export class AdmissionPolicyError extends Error {}

/** 读取并校验政策文件；缺失或结构不合法 → 空政策（准入保持 fail-closed）。 */
export function loadAdmissionPolicy(file: string): AdmissionPolicy {
  if (!existsSync(file)) return { schema_version: 1, decision_ref: '', accepted_gaps: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new AdmissionPolicyError(`admission policy is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AdmissionPolicyError('admission policy must be an object');
  const p = parsed as Record<string, unknown>;
  if (p.schema_version !== 1) throw new AdmissionPolicyError('admission policy schema_version must be 1');
  if (!nonEmpty(p.decision_ref)) throw new AdmissionPolicyError('admission policy decision_ref must be non-empty');
  if (!Array.isArray(p.accepted_gaps)) throw new AdmissionPolicyError('admission policy accepted_gaps must be an array');
  for (const gap of p.accepted_gaps) {
    if (!validGap(gap)) throw new AdmissionPolicyError('admission policy contains an invalid accepted gap entry');
  }
  return { schema_version: 1, decision_ref: p.decision_ref, accepted_gaps: p.accepted_gaps };
}

/** 该通道 + 指纹下，某维度是否被政策接受为已知缺口。 */
export function policyGapFor(
  policy: AdmissionPolicy | undefined, adapterId: string, fingerprint: string, dimension: string,
): AcceptedGapRecord | undefined {
  const gap = policy?.accepted_gaps.find((g) =>
    g.adapter_id === adapterId && g.config_fingerprint === fingerprint && g.dimension === dimension);
  if (gap === undefined) return undefined;
  return {
    adapter_id: gap.adapter_id, dimension: gap.dimension, config_fingerprint: gap.config_fingerprint,
    reason: gap.reason, equivalence: gap.equivalence, decided_by: gap.decided_by,
    ...(gap.session_scope === undefined ? {} : { session_scope: {
      adapter_ids: [...gap.session_scope.adapter_ids].sort(), call_limit: gap.session_scope.call_limit,
      retry_limit: gap.session_scope.retry_limit, single_call_timeout_s: gap.session_scope.single_call_timeout_s,
      session_timeout_min: gap.session_scope.session_timeout_min,
    } }),
  };
}
