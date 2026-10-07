/**
 * mush M5 Web 看板（GOAL-005 U1）— 数据源投影层。
 *
 * 红线：只读消费事件流（内存 EventLog，与 loop 同源）与 approval-requests 目录；
 * 绝不写任何状态、绝不引入第二状态源。密钥红线：actor 投影只含身份/角色字段，
 * 永不携带凭据。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { EventLog, type EventLogEntry } from '../core/event-log.ts';

export interface BoardActor {
  actor_instance_id: string;
  role: string;
  provider: string;
  model_id: string;
  capability_id: string;
  event_count: number;
  last_event_type: string;
}

export interface BoardEpochEvent {
  sequence: number;
  event_id: string;
  event_type: string;
  actor_role: string;
  actor_instance_id: string;
  phase: number;
  summary: string | null;
  sha256: string;
  previous_sha256: string | null;
  created_at_utc: string;
}

export interface BoardEpoch {
  run_id: string;
  assignment_epoch: number;
  event_count: number;
  chain_head: string | null;
  chain_verified: boolean;
  events: BoardEpochEvent[];
}

export interface BoardApprovalResponse {
  owner_decision: string;
  responded_at_utc: string;
  owner_evidence: string | null;
  note: string | null;
}

export interface BoardApproval {
  request_file: string;
  gate: string;
  actor_id: string;
  reason: string | null;
  requested_at_utc: string;
  /** GOAL-085（owner 2026-10-05 复核）：新增 `SESSION_TERMINAL`——受控会话已进入终态
   *  （completed/failed/cancelled/interrupted）时，其授权卡不再属于"待批"；原卡与历史
   *  一律保留，**不写应答、不删卡**，只把待批投影排除。 */
  status: 'WAITING' | 'APPROVED' | 'REJECTED' | 'SESSION_TERMINAL';
  response: BoardApprovalResponse | null;
  /** 会话卡失效时的实际会话状态（审计用）。 */
  session_terminal_status?: string;
  /** 会话卡失效原因（人话，供审批界面明示）。 */
  stale_reason?: string;
  /** GP-32（D30）：派发类请求携带的审批者报备信息（非派发类请求缺省）。 */
  dispatch?: {
    dispatch_id: string;
    title: string;
    goal_id: string | null;
    adapter_id: string;
    effort: string;
    timeout_s: number | null;
    workspace: string | null;
    cap_usd: number | null;
    actor_spent_usd: number | null;
    prompt_preview: string;
    /** GOAL-084（owner 复核缺口，2026-10-03）：执行配置随投影到审批界面。 */
    model_id: string | null;
    restrict_tools: boolean;
    tool_restriction_args: string[] | null;
    output_schema: unknown;
    output_schema_sha256: string | null;
    contract_fingerprint: string | null;
    prepared_only?: boolean;
    probe_id?: string | null;
  };
  /** GOAL-084 §3.5 / D89：受控会话授权卡投影（所见即所批）。 */
  session?: {
    session_id: string;
    topic: string;
    workspace_root: string;
    isolation_required: boolean;
    call_limit: number | null;
    retry_limit: number | null;
    single_call_timeout_s: number | null;
    session_timeout_min: number | null;
    authorization_hash: string;
    participants: unknown[];
    materials: unknown[];
    capability_evidence: unknown[];
    policy_decision_ref: string | null;
    accepted_gaps: unknown[];
    failure_counterexamples: unknown[];
    /** GOAL-085：冻结的评审关系（双模型 A→B/B→A；三模型两两互评六条）。 */
    review_relations: unknown[];
  };
}

export interface BoardSnapshot {
  generated_at_utc: string;
  actors: BoardActor[];
  epochs: BoardEpoch[];
  approvals: BoardApproval[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function projectEvents(entries: readonly EventLogEntry[]): BoardEpochEvent[] {
  return entries.map((entry) => ({
    sequence: entry.sequence,
    event_id: entry.event_id,
    event_type: entry.event.event_type,
    actor_role: entry.event.actor_role,
    actor_instance_id: entry.event.actor_instance_id,
    phase: entry.event.phase,
    summary: entry.event.summary ?? null,
    sha256: entry.sha256,
    previous_sha256: entry.previous_sha256,
    created_at_utc: entry.event.created_at_utc,
  }));
}

/** 会话已终态 = 该授权卡不再是"待批"（GOAL-085 owner 2026-10-05 复核）。 */
const TERMINAL_COLLAB_SESSION_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled', 'interrupted'];

function collectApprovals(approvalRoot: string, collabSessionStatus?: (sessionId: string) => string | undefined): BoardApproval[] {
  if (!existsSync(approvalRoot)) return [];
  let names: string[];
  try {
    // GOAL-067：approvalRoot 在 existsSync 与 readdirSync 之间可能变为
    // 不可读（权限变化/被替换为文件）——fail-open 返回空，看板不崩。
    names = readdirSync(approvalRoot);
  } catch {
    return [];
  }
  const approvals: BoardApproval[] = [];
  const files = names
    .filter((name) => name.endsWith('.json') && !name.endsWith('.owner-response.json'))
    .sort();
  for (const name of files) {
    let request: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readFileSync(path.join(approvalRoot, name), 'utf8')) as unknown;
      if (!isRecord(parsed)) continue;
      request = parsed;
    } catch {
      continue; // 读取 fail-open：坏文件跳过，看板永不因单个文件崩溃
    }
    let response: BoardApprovalResponse | null = null;
    const responsePath = path.join(approvalRoot, name + '.owner-response.json');
    if (existsSync(responsePath)) {
      try {
        const parsed = JSON.parse(readFileSync(responsePath, 'utf8')) as unknown;
        if (isRecord(parsed)) {
          response = {
            owner_decision: textOrNull(parsed.owner_decision) ?? 'UNKNOWN',
            responded_at_utc: textOrNull(parsed.responded_at_utc) ?? '',
            owner_evidence: textOrNull(parsed.owner_evidence),
            note: textOrNull(parsed.note),
          };
        }
      } catch {
        response = null;
      }
    }
    let status: BoardApproval['status'] = 'WAITING';
    let sessionTerminalStatus: string | undefined;
    if (response !== null) {
      status = response.owner_decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    } else if (request.kind === 'collab-session' && collabSessionStatus !== undefined) {
      const sessionId = textOrNull(request.session_id);
      const observed = sessionId === null ? undefined : collabSessionStatus(sessionId);
      if (observed !== undefined && TERMINAL_COLLAB_SESSION_STATUSES.includes(observed)) {
        status = 'SESSION_TERMINAL';
        sessionTerminalStatus = observed;
      }
    }
    approvals.push({
      request_file: name,
      gate: textOrNull(request.gate) ?? 'UNKNOWN',
      actor_id: textOrNull(request.actor_id) ?? 'UNKNOWN',
      reason: textOrNull(request.reason),
      requested_at_utc: textOrNull(request.requested_at_utc) ?? '',
      status,
      response,
      ...(sessionTerminalStatus !== undefined
        ? {
            session_terminal_status: sessionTerminalStatus,
            stale_reason: `会话已终态（${sessionTerminalStatus}）：该授权卡不再待批；原卡与历史保留，未写应答`,
          }
        : {}),
      // GP-32（D30）：派发类请求投影报备信息（prompt 服务端截 1200 字）。
      ...(request.kind === 'dispatch'
        ? {
            dispatch: {
              dispatch_id: textOrNull(request.dispatch_id) ?? '',
              title: textOrNull(request.title) ?? '',
              goal_id: textOrNull(request.goal_id),
              adapter_id: textOrNull(request.adapter_id) ?? textOrNull(request.actor_id) ?? '',
              effort: textOrNull(request.effort) ?? '',
              timeout_s: typeof request.timeout_s === 'number' ? request.timeout_s : null,
              workspace: textOrNull(request.workspace),
              cap_usd: typeof request.cap_usd === 'number' ? request.cap_usd : null,
              actor_spent_usd: typeof request.actor_spent_usd === 'number' ? request.actor_spent_usd : null,
              prompt_preview: (textOrNull(request.prompt) ?? '').slice(0, 1200),
              // GOAL-084（owner 复核缺口，2026-10-03）：执行配置随投影到审批界面——
              // 生效模型/工具限制/输出 schema/合同指纹，审批所见含执行面。
              model_id: textOrNull(request.model_id),
              restrict_tools: request.restrict_tools === true,
              tool_restriction_args: Array.isArray(request.tool_restriction_args)
                ? (request.tool_restriction_args as unknown[]).filter((a): a is string => typeof a === 'string')
                : null,
              output_schema: request.output_schema !== undefined && request.output_schema !== null && typeof request.output_schema === 'object'
                ? request.output_schema
                : null,
              output_schema_sha256: textOrNull(request.output_schema_sha256),
              contract_fingerprint: textOrNull(request.contract_fingerprint),
              prepared_only: request.prepared_only === true,
              probe_id: textOrNull(request.probe_id),
            },
          }
        : {}),
      // GOAL-084 §3.5：受控会话授权卡投影冻结快照（所见即所批）。
      ...(request.kind === 'collab-session'
        ? {
            session: {
              session_id: textOrNull(request.session_id) ?? '',
              topic: textOrNull(request.topic) ?? '',
              workspace_root: textOrNull(request.workspace_root) ?? '',
              isolation_required: request.isolation_required === true,
              call_limit: typeof request.call_limit === 'number' ? request.call_limit : null,
              retry_limit: typeof request.retry_limit === 'number' ? request.retry_limit : null,
              single_call_timeout_s: typeof request.single_call_timeout_s === 'number' ? request.single_call_timeout_s : null,
              session_timeout_min: typeof request.session_timeout_min === 'number' ? request.session_timeout_min : null,
              authorization_hash: textOrNull(request.authorization_hash) ?? '',
              participants: Array.isArray(request.participants) ? request.participants : [],
              materials: Array.isArray(request.materials) ? request.materials : [],
              // D89（owner 2026-10-04 复核）：证据条目、政策依据与被接受的缺口必须进入
              // 审批投影——JSON 卡文件里有字段不等于审批者实际看见。
              capability_evidence: Array.isArray(request.capability_evidence) ? request.capability_evidence : [],
              policy_decision_ref: textOrNull(request.policy_decision_ref),
              accepted_gaps: Array.isArray(request.accepted_gaps) ? request.accepted_gaps : [],
              failure_counterexamples: Array.isArray(request.failure_counterexamples) ? request.failure_counterexamples : [],
              // GOAL-085：参会者数量、评审关系与计划调用数进入审批投影（侧栏常用卡据此展示）。
              review_relations: Array.isArray(request.review_relations) ? request.review_relations : [],
            },
          }
        : {}),
    });
  }
  return approvals;
}

/**
 * 从事件日志与审批目录投影看板快照。纯只读。
 * eventLogs 为可选；未提供时（静态页面模式）epochs/actors 为空，前端改经
 * POST /api/events 推送事件来驱动（数据源仍是同一 schema 事件流）。
 */
export function collectBoardSnapshot(opts: {
  eventLogs?: EventLog[];
  approvalRoot: string;
  /** 受控会话当前状态查询（只读；缺省时不做终态排除，保持旧投影）。 */
  collabSessionStatus?: (sessionId: string) => string | undefined;
}): BoardSnapshot {
  const eventLogs = opts.eventLogs ?? [];
  const actorMap = new Map<string, BoardActor>();
  const epochs: BoardEpoch[] = [];

  for (const log of eventLogs) {
    if (log.length === 0) continue; // 空 epoch 不上看板
    let verified = true;
    try {
      log.verifyChain();
    } catch {
      verified = false;
    }
    const events = projectEvents(log.events());
    epochs.push({
      run_id: log.runId,
      assignment_epoch: log.assignmentEpoch,
      event_count: events.length,
      chain_head: log.chainHead(),
      chain_verified: verified,
      events,
    });
    for (const entry of log.events()) {
      const event = entry.event;
      const existing = actorMap.get(event.actor_instance_id);
      if (existing === undefined) {
        actorMap.set(event.actor_instance_id, {
          actor_instance_id: event.actor_instance_id,
          role: event.actor_role,
          provider: event.provider ?? 'UNKNOWN',
          model_id: event.model_id ?? 'UNKNOWN',
          capability_id: event.capability_id,
          event_count: 1,
          last_event_type: event.event_type,
        });
      } else {
        actorMap.set(event.actor_instance_id, {
          ...existing,
          event_count: existing.event_count + 1,
          last_event_type: event.event_type,
        });
      }
    }
  }

  epochs.sort((a, b) => b.assignment_epoch - a.assignment_epoch);
  const actors = [...actorMap.values()].sort((a, b) => a.actor_instance_id.localeCompare(b.actor_instance_id));

  return {
    generated_at_utc: new Date().toISOString(),
    actors,
    epochs,
    approvals: collectApprovals(opts.approvalRoot, opts.collabSessionStatus),
  };
}
