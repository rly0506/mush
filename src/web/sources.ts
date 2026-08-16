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
  status: 'WAITING' | 'APPROVED' | 'REJECTED';
  response: BoardApprovalResponse | null;
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

function collectApprovals(approvalRoot: string): BoardApproval[] {
  if (!existsSync(approvalRoot)) return [];
  const approvals: BoardApproval[] = [];
  const files = readdirSync(approvalRoot)
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
    if (response !== null) {
      status = response.owner_decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    }
    approvals.push({
      request_file: name,
      gate: textOrNull(request.gate) ?? 'UNKNOWN',
      actor_id: textOrNull(request.actor_id) ?? 'UNKNOWN',
      reason: textOrNull(request.reason),
      requested_at_utc: textOrNull(request.requested_at_utc) ?? '',
      status,
      response,
    });
  }
  return approvals;
}

/**
 * 从事件日志与审批目录投影看板快照。纯只读。
 * eventLogs 为可选；未提供时（静态页面模式）epochs/actors 为空，前端改经
 * POST /api/events 推送事件来驱动（数据源仍是同一 schema 事件流）。
 */
export function collectBoardSnapshot(opts: { eventLogs?: EventLog[]; approvalRoot: string }): BoardSnapshot {
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
    approvals: collectApprovals(opts.approvalRoot),
  };
}
