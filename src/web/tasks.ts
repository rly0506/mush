/**
 * GOAL-019（rm004-p19a）— 任务池后端模型（runtime/tasks.jsonl append-only）。
 *
 * 每条任务以完整快照追加一行；状态迁移/派发回链 = 追加新行，读侧折叠到最新。
 * 旧记录不覆盖，满足 append-only 审计要求。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type TaskStatus = 'IDEA' | 'READY' | 'QUEUED' | 'IN_FLIGHT' | 'DONE' | 'BLOCKED' | 'CANCELLED';
export type TaskPriority = '高' | '中' | '低';

export interface Task {
  task_id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: string;
  goal_id?: string;
  dispatch_ids: string[];
  created_at: string;
  updated_at: string;
}

export const TASK_STATUSES: readonly TaskStatus[] = [
  'IDEA',
  'READY',
  'QUEUED',
  'IN_FLIGHT',
  'DONE',
  'BLOCKED',
  'CANCELLED',
];

export const TASK_PRIORITIES: readonly TaskPriority[] = ['高', '中', '低'];

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  IDEA: ['READY', 'CANCELLED'],
  READY: ['QUEUED', 'BLOCKED', 'CANCELLED'],
  QUEUED: ['IN_FLIGHT', 'BLOCKED', 'CANCELLED'],
  IN_FLIGHT: ['DONE', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['READY', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function loadTasks(tasksPath: string): Task[] {
  const byId = new Map<string, Task>();
  try {
    if (!existsSync(tasksPath)) return [];
    const lines = readFileSync(tasksPath, 'utf8').split('\n').filter((line) => line.trim() !== '');
    for (const line of lines) {
      const task = JSON.parse(line) as Task;
      if (task === null || typeof task !== 'object' || typeof task.task_id !== 'string') continue;
      byId.set(task.task_id, task);
    }
  } catch {
    return [];
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function appendTask(tasksPath: string, task: Task): void {
  mkdirSync(path.dirname(path.resolve(tasksPath)), { recursive: true });
  appendFileSync(tasksPath, JSON.stringify(task) + '\n', 'utf8');
}

export function createTask(input: unknown, now: () => Date): Task {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('body must be a JSON object');
  }
  const body = input as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title === '') throw new Error('title must be non-blank');
  const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
  const status = body.status === undefined ? 'IDEA' : body.status;
  if (!isTaskStatus(status)) throw new Error(`status must be one of ${TASK_STATUSES.join('|')}`);
  const priority = body.priority === undefined ? '中' : body.priority;
  if (!isTaskPriority(priority)) throw new Error(`priority must be one of ${TASK_PRIORITIES.join('|')}`);
  const source = typeof body.source === 'string' && body.source.trim() !== '' ? body.source.trim() : 'manual';
  const goalId = typeof body.goal_id === 'string' && body.goal_id.trim() !== '' ? body.goal_id.trim() : undefined;
  const atUtc = now().toISOString();
  return {
    task_id: randomUUID().replace(/-/g, ''),
    title,
    detail,
    status,
    priority,
    source,
    ...(goalId !== undefined ? { goal_id: goalId } : {}),
    dispatch_ids: [],
    created_at: atUtc,
    updated_at: atUtc,
  };
}

export function transitionTask(task: Task, nextStatus: unknown, now: () => Date): Task {
  if (!isTaskStatus(nextStatus)) {
    throw new Error(`status must be one of ${TASK_STATUSES.join('|')}`);
  }
  const allowed = TASK_TRANSITIONS[task.status];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`illegal transition ${task.status} -> ${nextStatus} (allowed: ${allowed.join('|') || 'none'})`);
  }
  return { ...task, status: nextStatus, updated_at: now().toISOString() };
}

export function linkDispatchToTask(task: Task, dispatchId: string, now: () => Date): Task {
  if (task.dispatch_ids.includes(dispatchId)) return task;
  return { ...task, dispatch_ids: [...task.dispatch_ids, dispatchId], updated_at: now().toISOString() };
}
