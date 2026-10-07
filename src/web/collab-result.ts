/**
 * GOAL-085 第二阶段（结果整理与本地导出，2026-10-06）：只读会话结果文档。
 *
 * 事实源只有两个既有来源：协作黑板（会话/授权快照/观点/材料/执行日志/结束原因）
 * 与派发管线（派发记录 + USD 台账）。本模块不写库、不建卡、不调用模型，也不做
 * 任何"总结"步骤——观点逐席位原文呈现，不合成"共同结论"；互评中的缺陷/建议
 * 只是模型观点，未经 mush 核实。
 *
 * 排除项（owner 指令）：caller token、凭据类字段、派发记录的原生流（stdout/stderr
 * tail）与完整审计事件一律不进入导出；观点 body 是模型原始 JSON，按约定允许导出。
 * 费用只认台账 ACTUAL_COST 申报（超 cap 被记为 DENIED 的实付回写同样计入，与
 * computeSpentUsd 同口径）；无申报记录一律标 UNKNOWN，不写成 0——台账申报金额
 * 不等于账单硬上限。
 */

import type {
  CollaborationBlackboard,
  CollabPhase,
  CollabSeat,
  CollabStatus,
  CollabReviewRelation,
  CollabParticipantInput,
  CollabViewpoint,
} from '../orchestration/collaboration-blackboard.ts';
import type { DispatchPipeline } from './dispatch.ts';

export const COLLAB_RESULT_SCHEMA = 'mush.collaboration-session-result' as const;

const PHASE_CHAIN: CollabPhase[] = ['coordination', 'proposal', 'review', 'revision'];
const PHASE_LABEL: Record<CollabPhase, string> = {
  coordination: '分配建议', proposal: '独立提案', review: '交叉评审', revision: '修订方案',
};

export interface CollabResultOpinion {
  viewpoint_id: string;
  seat: CollabSeat;
  author_instance: string;
  kind: string;
  phase: CollabPhase;
  responds_to: string | null;
  target: string;
  version: number;
  stance: string | null;
  /** 模型原始观点 JSON 原文（落板原文，不做改写）。 */
  body: string;
  evidence: Array<{ material_id: string; sha256: string }>;
  material_manifest: Array<{ material_id: string; sha256: string }>;
  reserved_disagreements: string | null;
  created_at_utc: string;
}

export interface CollabResultFeeEntry {
  dispatch_id: string;
  adapter_id: string | null;
  dispatch_status: string | null;
  declared_cost_usd: number | null;
  visibility: 'DECLARED' | 'UNKNOWN';
}

export interface CollabResultFees {
  currency: 'USD';
  basis: 'ledger_declared';
  note: string;
  total_declared_usd: number | null;
  /** DECLARED=全部派发有申报；PARTIAL=部分申报、部分 UNKNOWN（整场费用不完整）；UNKNOWN=无任何申报。 */
  visibility: 'DECLARED' | 'PARTIAL' | 'UNKNOWN';
  declared_dispatch_count: number;
  unknown_dispatch_count: number;
  per_dispatch: CollabResultFeeEntry[];
}

export interface CollabSessionResultDoc {
  schema: typeof COLLAB_RESULT_SCHEMA;
  schema_version: 1;
  generated_at_utc: string;
  reading_notes: string[];
  session: {
    session_id: string;
    topic: string;
    status: CollabStatus;
    phase: CollabPhase;
    workspace_root: string;
    constraints: string | null;
    authorization_hash: string;
    skill_registry_sha256?: string;
    owner_decision: string | null;
    execution: 'running' | 'settled' | 'not_started';
    stop_requested: boolean;
    created_at_utc: string;
    deadline_utc: string | null;
    call_count: number;
    retry_count: number;
    call_limit: number;
    retry_limit: number;
    single_call_timeout_s: number;
    session_timeout_min: number;
    review_relations: CollabReviewRelation[];
  };
  participants: CollabParticipantInput[];
  materials: Array<{ material_id: string; name: string; source: string; sha256: string; allowed_seats: CollabSeat[] }>;
  completion: {
    /** 严格口径：当前双模型流程完成 = 修订齐备 且 会话以 completed 终态结束 且 恰为 2 席。
     *  修订齐备但终态非 completed（失败/中断）或历史三席位，不冒充完成。 */
    complete: boolean;
    /** 仅"全体席位均有最终修订"这一子命题；与 complete 分开呈现（Codex 复核缺口 1）。 */
    revisions_complete: boolean;
    missing_revision_seats: CollabSeat[];
    last_phase_with_content: CollabPhase | null;
    note: string;
  };
  opinions: CollabResultOpinion[];
  end: { status: 'completed' | 'failed' | 'interrupted'; reason?: string; dispatch_ids: string[] } | null;
  fees: CollabResultFees;
  execution_log: Array<{ call_index: unknown; kind: unknown; seat: unknown; status: unknown; started_at_utc: unknown; ended_at_utc: unknown; error: unknown }>;
  evidence_references: {
    capability_evidence: unknown;
    accepted_gaps?: unknown;
    failure_counterexamples?: unknown;
    policy_decision_ref?: string;
  };
}

export class CollabResultError extends Error {}

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

function toOpinion(vp: CollabViewpoint): CollabResultOpinion {
  return {
    viewpoint_id: vp.id,
    seat: vp.author_seat,
    author_instance: vp.author_instance,
    kind: vp.kind,
    phase: vp.phase,
    responds_to: vp.responds_to,
    target: vp.target,
    version: vp.version,
    stance: vp.stance,
    body: vp.body,
    evidence: vp.evidence.map((e) => ({ material_id: e.material_id, sha256: e.sha256 })),
    material_manifest: vp.material_manifest.map((m) => ({ material_id: m.material_id, sha256: m.sha256 })),
    reserved_disagreements: vp.reserved_disagreements,
    created_at_utc: vp.created_at_utc,
  };
}

/** 从黑板 + 管线只读构建结果文档；不产生任何模型调用或写路径。 */
export function buildCollabSessionResult(
  board: CollaborationBlackboard,
  pipeline: DispatchPipeline,
  sessionId: string,
): CollabSessionResultDoc {
  const row = board.getSession(sessionId);
  const snapshot = board.getAuthorizationSnapshot(sessionId);
  const seats = snapshot.participants.map((p) => p.seat);
  const opinions = seats.flatMap((seat) => board.getVisibleContext(sessionId, seat).own.map(toOpinion));
  const end = board.getSessionOutcome(sessionId);
  const ownerDecision = pipeline.sessionOwnerDecision(sessionId) ?? null;

  const missingRevisions = seats.filter((seat) => !opinions.some((o) => o.seat === seat && o.kind === 'revision'));
  const lastPhase = [...PHASE_CHAIN].reverse().find((phase) => opinions.some((o) => o.phase === phase)) ?? null;
  // Codex 复核缺口 1：修订齐备 ≠ 流程完成。complete 收紧为"修订齐备 + completed 终态 +
  // 恰 2 席（当前双模型流程口径）"；修订齐备这一子命题单列 revisions_complete。
  const revisionsComplete = seats.length > 0 && missingRevisions.length === 0;
  const flowComplete = revisionsComplete && row.status === 'completed' && seats.length === 2;
  const completionNote = flowComplete
    ? '全体席位均已提交最终修订，会话以 completed 终态结束（当前双模型流程完成）。'
    : revisionsComplete
      ? `修订已齐备，但会话终态为 ${row.status}${seats.length !== 2 ? `（${seats.length} 席位，不属当前双模型流程口径）` : ''}；不构成当前双模型流程完成，以下内容按原样呈现。`
      : opinions.length === 0
        ? `会话尚无任何落板观点（当前状态 ${row.status}）；讨论未开始或未走到落板步骤，不构成完成。`
        : `会话未产出全体席位的最终修订（当前状态 ${row.status}，最后有效阶段「${PHASE_LABEL[lastPhase!]}」）；`
          + '结果区按席位显示各自最后有效阶段的内容，不代表已完成共识。';
  const completion: CollabSessionResultDoc['completion'] = {
    complete: flowComplete,
    revisions_complete: revisionsComplete,
    missing_revision_seats: missingRevisions,
    last_phase_with_content: lastPhase,
    note: completionNote,
  };

  const dispatchIds = end?.dispatch_ids ?? [];
  const dispatchIndex = new Map<string, { adapter_id: string; status: string }>();
  for (const record of pipeline.recent(100_000)) {
    if (dispatchIds.includes(record.dispatch_id)) {
      dispatchIndex.set(record.dispatch_id, { adapter_id: record.adapter_id, status: record.status });
    }
  }
  const declared = new Map<string, number>();
  for (const actor of pipeline.budgetProjection().actors) {
    for (const entry of actor.entries) {
      const meta = entry.meta as Record<string, unknown>;
      const did = typeof meta.dispatch_id === 'string' ? meta.dispatch_id : null;
      if (did === null || !dispatchIds.includes(did) || meta.kind !== 'ACTUAL_COST') continue;
      declared.set(did, round6((declared.get(did) ?? 0) + entry.amountUsd));
    }
  }
  const perDispatch = dispatchIds.map<CollabResultFeeEntry>((dispatchId) => {
    const amount = declared.has(dispatchId) ? round6(declared.get(dispatchId)!) : null;
    const info = dispatchIndex.get(dispatchId);
    return {
      dispatch_id: dispatchId,
      adapter_id: info?.adapter_id ?? null,
      dispatch_status: info?.status ?? null,
      declared_cost_usd: amount,
      visibility: amount === null ? 'UNKNOWN' : 'DECLARED',
    };
  });
  const declaredTotal = perDispatch.reduce<number | null>(
    (sum, e) => (e.declared_cost_usd === null ? sum : round6((sum ?? 0) + e.declared_cost_usd)),
    null,
  );
  // Codex 复核缺口 2：部分派发申报、部分 UNKNOWN 时整场费用**不完整**——
  // visibility=PARTIAL，已知申报小计保留在 total_declared_usd，但不冒充整场已知。
  const declaredCount = perDispatch.filter((e) => e.visibility === 'DECLARED').length;
  const unknownCount = perDispatch.filter((e) => e.visibility === 'UNKNOWN').length;
  const fees: CollabResultFees = {
    currency: 'USD',
    basis: 'ledger_declared',
    note: '费用为台账 ACTUAL_COST 申报口径（超 cap 的实付回写计入）；UNKNOWN 表示无申报记录，不是 0；'
      + 'PARTIAL 表示部分派发无申报、整场费用不完整，total_declared_usd 只是已知申报小计；台账申报金额不等于账单硬上限。',
    total_declared_usd: declaredTotal,
    visibility: declaredTotal === null ? 'UNKNOWN' : unknownCount > 0 ? 'PARTIAL' : 'DECLARED',
    declared_dispatch_count: declaredCount,
    unknown_dispatch_count: unknownCount,
    per_dispatch: perDispatch,
  };

  return {
    schema: COLLAB_RESULT_SCHEMA,
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    reading_notes: [
      '本文件由 mush 看板只读导出，数据来自协作黑板与派发台账；不含 caller token、凭据或完整原生审计流。',
      '观点 body 为各席位模型原始 JSON 原文；本文件不合成"共同结论"，互评中的缺陷/建议为模型观点，未经 mush 核实。',
      '费用为台账 ACTUAL_COST 申报口径；UNKNOWN 表示无申报记录，不是 0，也不等于账单硬上限。',
    ],
    session: {
      session_id: sessionId,
      topic: row.topic,
      status: row.status,
      phase: row.phase,
      workspace_root: row.workspace_root,
      constraints: row.constraints,
      authorization_hash: row.authorization_hash,
      ...(snapshot.skill_registry_sha256 !== undefined ? { skill_registry_sha256: snapshot.skill_registry_sha256 } : {}),
      owner_decision: ownerDecision,
      // 执行状态从会话状态如实映射：in_progress=运行中，终态=已结算，其余=未启动
      //（服务重启后的在途残留由恢复路径改判 interrupted，不会停留在这里）。
      execution: row.status === 'in_progress' ? 'running'
        : row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled' || row.status === 'interrupted'
          ? 'settled' : 'not_started',
      stop_requested: board.isStopRequested(sessionId),
      created_at_utc: row.created_at_utc,
      deadline_utc: row.deadline_utc,
      call_count: row.call_count,
      retry_count: row.retry_count,
      call_limit: row.call_limit,
      retry_limit: row.retry_limit,
      single_call_timeout_s: snapshot.single_call_timeout_s,
      session_timeout_min: row.session_timeout_min,
      review_relations: snapshot.review_relations ?? [],
    },
    participants: snapshot.participants,
    materials: snapshot.materials.map((m) => ({ ...m })),
    completion,
    opinions,
    end: end ? { ...end, dispatch_ids: [...end.dispatch_ids] } : null,
    fees,
    execution_log: board.getExecutionLog(sessionId).map((e) => ({
      call_index: e.call_index, kind: e.kind, seat: e.seat, status: e.status,
      started_at_utc: e.started_at_utc, ended_at_utc: e.ended_at_utc, error: e.error,
    })),
    evidence_references: {
      capability_evidence: snapshot.capability_evidence ?? [],
      ...(snapshot.accepted_gaps !== undefined ? { accepted_gaps: snapshot.accepted_gaps } : {}),
      ...(snapshot.failure_counterexamples !== undefined ? { failure_counterexamples: snapshot.failure_counterexamples } : {}),
      ...(snapshot.policy_decision_ref !== undefined ? { policy_decision_ref: snapshot.policy_decision_ref } : {}),
    },
  };
}

/** 与 JSON 同一事实源的 Markdown 渲染；只读，供本地下载。 */
export function collabResultMarkdown(doc: CollabSessionResultDoc): string {
  const s = doc.session;
  const lines: string[] = [];
  lines.push(`# 协作会话结果：${s.topic}`);
  lines.push('');
  lines.push(`- 会话 ID：\`${s.session_id}\``);
  lines.push(`- 状态：${s.status}（阶段 ${s.phase}）· 授权：${s.owner_decision ?? '尚未批准'} · 执行：${s.execution}`);
  lines.push(`- 调用：正常 ${s.call_count - s.retry_count}/${s.call_limit}，重试 ${s.retry_count}/${s.retry_limit}（总 ${s.call_count}/${s.call_limit + s.retry_limit}）· 单次 ${s.single_call_timeout_s}s · 整场 ${s.session_timeout_min}min`);
  lines.push(`- 授权哈希：\`${s.authorization_hash}\``);
  if (s.skill_registry_sha256) lines.push(`- 模板注册表哈希：\`${s.skill_registry_sha256}\``);
  lines.push(`- 工作区：\`${s.workspace_root}\``);
  if (s.constraints) lines.push(`- 公共约束：${s.constraints}`);
  const relations = s.review_relations.map((r) => `${r.author}→${r.target}`).join('、');
  if (relations) lines.push(`- 评审关系：${relations}`);
  lines.push('');
  lines.push('## 参与配置');
  lines.push('');
  for (const p of doc.participants) {
    lines.push(`- ${p.seat} 席：${p.adapter_id} · 模型 ${p.model_id ?? 'UNKNOWN'} · 强度 ${p.effort ?? 'UNKNOWN'}`
      + `${p.is_coordinator ? '（协调者）' : ''} · 指纹 \`${p.config_fingerprint ?? 'UNKNOWN'}\``);
  }
  lines.push('');
  lines.push('## 冻结材料（标识与哈希）');
  lines.push('');
  if (doc.materials.length === 0) lines.push('（无登记材料）');
  for (const m of doc.materials) {
    lines.push(`- ${m.material_id}「${m.name}」（来源 ${m.source}）· sha256 \`${m.sha256}\` · 可见席位 ${m.allowed_seats.join('/')}`);
  }
  lines.push('');
  lines.push('## 完成情况');
  lines.push('');
  lines.push(`- 当前双模型流程完成：${doc.completion.complete ? '是' : '否'}（修订齐备：${doc.completion.revisions_complete ? '是' : '否'}）`);
  lines.push(`- ${doc.completion.note}`);
  if (doc.completion.missing_revision_seats.length > 0) {
    lines.push(`- 缺少最终修订的席位：${doc.completion.missing_revision_seats.join('、')}`);
  }
  lines.push('');
  lines.push('## 结束原因');
  lines.push('');
  lines.push(doc.end ? `- 终态 ${doc.end.status}${doc.end.reason ? `：${doc.end.reason}` : ''}（派发 ${doc.end.dispatch_ids.length} 条）` : '- 无结束记录（会话未走到终态结算）。');
  lines.push('');
  lines.push('## 费用可见性');
  lines.push('');
  lines.push(`- ${doc.fees.note}`);
  for (const f of doc.fees.per_dispatch) {
    lines.push(`- \`${f.dispatch_id.slice(0, 8)}…\`（${f.adapter_id ?? 'UNKNOWN'} · ${f.dispatch_status ?? 'UNKNOWN'}）：`
      + (f.visibility === 'DECLARED' ? `申报 $${f.declared_cost_usd}` : 'UNKNOWN（无申报记录，不是 0）'));
  }
  lines.push(`- 合计申报：${doc.fees.total_declared_usd === null ? 'UNKNOWN（无任何申报记录，不是 0）' : `$${doc.fees.total_declared_usd}`}`
    + (doc.fees.visibility === 'PARTIAL' ? `（PARTIAL：${doc.fees.declared_dispatch_count} 条申报、${doc.fees.unknown_dispatch_count} 条 UNKNOWN——整场费用不完整）` : ''));
  lines.push('');
  lines.push('## 阶段观点（各席位原文，未合成共同结论）');
  lines.push('');
  if (doc.opinions.length === 0) lines.push('（无落板观点）');
  let currentSeat: string | null = null;
  for (const o of doc.opinions) {
    if (o.seat !== currentSeat) {
      currentSeat = o.seat;
      lines.push(`### 席位 ${o.seat}`);
      lines.push('');
    }
    lines.push(`#### ${PHASE_LABEL[o.phase] ?? o.phase}（${o.kind}）· v${o.version} · ${o.created_at_utc}`);
    lines.push('');
    if (o.responds_to) lines.push(`- 回应对象：\`${o.responds_to}\``);
    if (o.stance) lines.push(`- 立场：${o.stance}`);
    if (o.evidence.length > 0) {
      lines.push(`- 材料引用：${o.evidence.map((e) => `${e.material_id}(sha256 \`${e.sha256}\`)`).join('、')}`);
    }
    if (o.material_manifest.length > 0) {
      lines.push(`- 发送清单：${o.material_manifest.map((m) => `${m.material_id}(sha256 \`${m.sha256}\`)`).join('、')}`);
    }
    if (o.reserved_disagreements) lines.push(`- 保留分歧：${o.reserved_disagreements}`);
    lines.push('');
    lines.push('原始观点 JSON：');
    lines.push('');
    lines.push('```json');
    lines.push(o.body);
    lines.push('```');
    lines.push('');
  }
  lines.push('## 证据引用');
  lines.push('');
  const ev = doc.evidence_references;
  const capability = Array.isArray(ev.capability_evidence) ? ev.capability_evidence as Array<Record<string, unknown>> : [];
  lines.push(capability.length === 0 ? '- 无隔离维度证据条目。'
    : capability.map((e) => `- ${String(e.adapter_id)}/${String(e.dimension)}：${String(e.status)}（${String(e.verification)}）· 指纹 \`${String(e.config_fingerprint)}\``).join('\n'));
  if (ev.policy_decision_ref !== undefined) lines.push(`- 准入政策：${String(ev.policy_decision_ref)}`);
  const gaps = Array.isArray(ev.accepted_gaps) ? ev.accepted_gaps as Array<Record<string, unknown>> : [];
  for (const g of gaps) lines.push(`- 已接受的已知缺口：${String(g.adapter_id)}/${String(g.dimension)} — ${String(g.reason ?? '')}`);
  const failures = Array.isArray(ev.failure_counterexamples) ? ev.failure_counterexamples as Array<Record<string, unknown>> : [];
  for (const f of failures) lines.push(`- 失败反例（已证实）：${String(f.adapter_id)}/${String(f.dimension)} = ${String(f.result)}`);
  lines.push('');
  lines.push('## 执行记录摘要');
  lines.push('');
  lines.push(doc.execution_log.length === 0 ? '（无调用）'
    : doc.execution_log.map((e) => `- 调用 ${String(e.call_index)}（${String(e.kind)}，席位 ${String(e.seat ?? '?')}）：${String(e.status)}`
      + `${e.error ? ` · ${String(e.error)}` : ''}`).join('\n'));
  lines.push('');
  lines.push('---');
  for (const note of doc.reading_notes) lines.push(`> ${note}`);
  lines.push('');
  return lines.join('\n');
}

export function collabResultFileName(doc: CollabSessionResultDoc, ext: 'json' | 'md'): string {
  return `collab-result-${doc.session.session_id.slice(0, 8)}.${ext}`;
}
