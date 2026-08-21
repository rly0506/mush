/**
 * mush 活动时间线（GOAL-023 / D38 信息披露架构）
 *
 * 核心设计：
 * 1. 纯投影与人话转译：将底层系统事件转译为人话叙事，不污染底层不可篡改事件源；
 * 2. Append-only 持久化：活动记录落盘 runtime/activity.jsonl，带 source_event 原始溯源；
 * 3. 稳健设计（Fail-open）：转译与落盘失败记录 warning，绝不阻断主流程。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ActivityItem {
  activity_id: string;
  task_id?: string;
  goal_id?: string;
  dispatch_id?: string;
  actor: string;
  kind:
    | 'dispatch_start'
    | 'dispatch_pass'
    | 'dispatch_fail'
    | 'dispatch_timeout'
    | 'dispatch_rejected'
    | 'task_create'
    | 'task_transition'
    | 'approval_request'
    | 'approval_response'
    | 'stream_handoff'
    | 'system';
  text_zh: string;
  at_utc: string;
  amount_usd?: number;
  source_event?: {
    event_id?: string;
    dispatch_id?: string;
    status?: string;
    phase?: string;
    seq?: number;
  };
}

export interface ActivityQueryFilter {
  task_id?: string;
  goal_id?: string;
  limit?: number;
}

export function activityFilePath(runtimeRoot: string): string {
  return path.join(path.resolve(runtimeRoot), 'activity.jsonl');
}

/**
 * 追加一条活动记录（append-only；fail-open 设计：写入失败记 warning 不阻断主流程）。
 */
export function recordActivity(runtimeRoot: string, item: ActivityItem): ActivityItem {
  try {
    const file = activityFilePath(runtimeRoot);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(item) + '\n', 'utf8');
  } catch (error) {
    console.warn(`[activity] failed to record activity ${item.activity_id}:`, error);
  }
  return item;
}

/**
 * 查询活动列表（按时间倒序，支持 task_id, goal_id 过滤与 limit 限制）。
 */
export function queryActivities(runtimeRoot: string, filter: ActivityQueryFilter = {}): ActivityItem[] {
  const file = activityFilePath(runtimeRoot);
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const items: ActivityItem[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ActivityItem;
        if (filter.task_id && parsed.task_id !== filter.task_id) continue;
        if (filter.goal_id && parsed.goal_id !== filter.goal_id) continue;
        items.push(parsed);
      } catch {
        // fail-open on malformed line
      }
    }
    // 倒序排列（最新活动在前）
    items.sort((a, b) => (String(a.at_utc || '') > String(b.at_utc || '') ? -1 : 1));
    if (filter.limit !== undefined && filter.limit > 0) {
      return items.slice(0, filter.limit);
    }
    return items;
  } catch (error) {
    console.warn('[activity] failed to query activities:', error);
    return [];
  }
}

/**
 * 将派发生命周期事件转译为人话条目。
 */
export function translateDispatchEvent(
  event: {
    dispatch_id: string;
    adapter_id: string;
    phase?: string;
    status: string;
    at_utc?: string;
    payload?: Record<string, unknown>;
  },
  meta: { task_id?: string; goal_id?: string; amount_usd?: number } = {},
): ActivityItem | null {
  const at_utc = event.at_utc ?? new Date().toISOString();
  const actor = event.adapter_id || 'dog';
  const dispatch_id = event.dispatch_id;
  const task_id = meta.task_id;
  const goal_id = meta.goal_id;

  if (event.phase === 'ADMITTED' || event.status === 'ADMITTED' || event.status === 'RUNNING') {
    return {
      activity_id: `act-disp-${dispatch_id}-${event.status.toLowerCase()}`,
      task_id,
      goal_id,
      dispatch_id,
      actor,
      kind: 'dispatch_start',
      text_zh: `${actor} 开始执行任务`,
      at_utc,
      source_event: {
        dispatch_id,
        status: event.status,
        phase: event.phase,
      },
    };
  }

  if (event.status === 'PASS' || event.status === 'DRY_RUN') {
    const elapsed =
      event.payload && typeof event.payload.elapsed_sec === 'number'
        ? Math.round(event.payload.elapsed_sec as number)
        : undefined;
    const elapsedStr = elapsed !== undefined ? `（耗时 ${elapsed} 秒）` : '';
    return {
      activity_id: `act-disp-${dispatch_id}-pass`,
      task_id,
      goal_id,
      dispatch_id,
      actor,
      kind: 'dispatch_pass',
      text_zh: `${actor} 执行完成${elapsedStr}`,
      at_utc,
      amount_usd: meta.amount_usd,
      source_event: {
        dispatch_id,
        status: event.status,
        phase: event.phase,
      },
    };
  }

  if (event.status === 'FAIL') {
    return {
      activity_id: `act-disp-${dispatch_id}-fail`,
      task_id,
      goal_id,
      dispatch_id,
      actor,
      kind: 'dispatch_fail',
      text_zh: `${actor} 执行失败`,
      at_utc,
      source_event: {
        dispatch_id,
        status: event.status,
        phase: event.phase,
      },
    };
  }

  if (event.status === 'REJECTED' || event.status === 'BLOCKED_WAITING_OWNER') {
    return {
      activity_id: `act-disp-${dispatch_id}-${event.status.toLowerCase()}`,
      task_id,
      goal_id,
      dispatch_id,
      actor,
      kind: 'dispatch_rejected',
      text_zh: `${actor} 派发等待审批 / 被否决`,
      at_utc,
      source_event: {
        dispatch_id,
        status: event.status,
        phase: event.phase,
      },
    };
  }

  return null;
}

const TASK_STATUS_CN: Record<string, string> = {
  IDEA: '构想',
  READY: '就绪',
  QUEUED: '已排队',
  IN_FLIGHT: '执行中',
  DONE: '完成',
  BLOCKED: '受阻',
  CANCELLED: '已取消',
};

/**
 * 将任务创建转译为人话条目。
 */
export function translateTaskCreate(task: { task_id: string; title: string; goal_id?: string; created_at_utc?: string }): ActivityItem {
  return {
    activity_id: `act-task-create-${task.task_id}`,
    task_id: task.task_id,
    goal_id: task.goal_id,
    actor: 'owner',
    kind: 'task_create',
    text_zh: `创建了任务卡「${task.title}」`,
    at_utc: task.created_at_utc ?? new Date().toISOString(),
  };
}

/**
 * 将任务状态迁移转译为人话条目。
 */
export function translateTaskTransition(
  task: { task_id: string; title: string; goal_id?: string },
  fromStatus: string,
  toStatus: string,
  atUtc?: string,
): ActivityItem {
  const toCn = TASK_STATUS_CN[toStatus] ?? toStatus;
  const now = atUtc ?? new Date().toISOString();
  return {
    activity_id: `act-task-trans-${task.task_id}-${toStatus.toLowerCase()}-${Date.now()}`,
    task_id: task.task_id,
    goal_id: task.goal_id,
    actor: 'owner',
    kind: 'task_transition',
    text_zh: `任务「${task.title}」转入${toCn}`,
    at_utc: now,
  };
}

/**
 * 将审批响应转译为人话条目。
 */
export function translateApprovalResponse(
  requestId: string,
  decision: string,
  actor = 'owner',
  goalId?: string,
  atUtc?: string,
): ActivityItem {
  const isApproved = decision === 'APPROVED';
  return {
    activity_id: `act-approval-${requestId}-${decision.toLowerCase()}`,
    goal_id: goalId,
    actor: 'owner',
    kind: 'approval_response',
    text_zh: isApproved ? `审批请求已批准` : `审批请求已否决`,
    at_utc: atUtc ?? new Date().toISOString(),
    source_event: {
      event_id: requestId,
      status: decision,
    },
  };
}

/**
 * 将工作流换窗交接转译为人话条目。
 */
export function translateStreamHandoff(streamId: string, dog: string, goalId?: string, atUtc?: string): ActivityItem {
  return {
    activity_id: `act-handoff-${streamId}-${Date.now()}`,
    goal_id: goalId,
    actor: dog,
    kind: 'stream_handoff',
    text_zh: `${dog} 工作流换窗续跑，交接已归档`,
    at_utc: atUtc ?? new Date().toISOString(),
  };
}
