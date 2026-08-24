/**
 * GOAL-019（rm004-p19a）— 任务池后端模型（runtime/tasks.jsonl append-only）。
 *
 * 每条任务以完整快照追加一行；状态迁移/派发回链 = 追加新行，读侧折叠到最新。
 * 旧记录不覆盖，满足 append-only 审计要求。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
  // D82 修订：取消不再是死局——owner 误取消/失败后放弃的任务可重新打开
  // （转就绪）或经"重新执行"直接复活为 IN_FLIGHT。DONE 仍为真终态。
  CANCELLED: ['READY'],
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

/**
 * GOAL-024: 自动平滑跃迁任务状态（支持多步过渡，如 IDEA -> READY -> QUEUED -> IN_FLIGHT -> DONE）。
 * 针对已处于终态 (DONE/CANCELLED) 或已处于目标状态的任务安全幂等返回。
 */
export function advanceTaskToStatus(task: Task, targetStatus: TaskStatus, now: () => Date): Task {
  if (task.status === targetStatus || task.status === 'DONE') {
    return task;
  }
  // D82 修订：CANCELLED 只允许沿两条复活路径前进（手动重开→READY、
  // 重新执行→IN_FLIGHT）；其余目标（如自动归档 BLOCKED/DONE）仍视作冻结，
  // 不因后台对账把 owner 主动取消的任务悄悄改态。
  if (task.status === 'CANCELLED' && targetStatus !== 'READY' && targetStatus !== 'IN_FLIGHT') {
    return task;
  }
  let current = task;
  if (targetStatus === 'IN_FLIGHT') {
    // D82 修订：CANCELLED 可经重新执行复活（先回到 READY 再走正常跃迁链）。
    if (current.status === 'CANCELLED') current = transitionTask(current, 'READY', now);
    if (current.status === 'IDEA') current = transitionTask(current, 'READY', now);
    if (current.status === 'BLOCKED') current = transitionTask(current, 'READY', now);
    if (current.status === 'READY') current = transitionTask(current, 'QUEUED', now);
    if (current.status === 'QUEUED') current = transitionTask(current, 'IN_FLIGHT', now);
    return current;
  }
  if (targetStatus === 'DONE') {
    if (current.status !== 'IN_FLIGHT') {
      current = advanceTaskToStatus(current, 'IN_FLIGHT', now);
    }
    return transitionTask(current, 'DONE', now);
  }
  if (targetStatus === 'BLOCKED') {
    if (current.status === 'IDEA') current = transitionTask(current, 'READY', now);
    return transitionTask(current, 'BLOCKED', now);
  }
  if (targetStatus === 'READY') {
    if (current.status === 'IDEA' || current.status === 'BLOCKED' || current.status === 'CANCELLED') {
      return transitionTask(current, 'READY', now);
    }
  }
  return current;
}

/**
 * GOAL-024 扩展：从 receipts 目录加载所有已验收的 Goal ID 规范化集合。
 */
export function loadCompletedGoalIds(receiptsDir: string): Set<string> {
  const completed = new Set<string>();
  if (!existsSync(receiptsDir)) return completed;
  try {
    const files = readdirSync(receiptsDir);
    for (const file of files) {
      if (file.endsWith('-completion.json') || file.endsWith('-pass.json')) {
        const match = /^(GOAL-\d+[A-Z]?|BATCH-\d+)/i.exec(file);
        if (match) {
          const raw = match[1].toUpperCase();
          completed.add(raw);
          const numMatch = /\d+/.exec(raw);
          if (numMatch) {
            completed.add(numMatch[0]);
            completed.add(`GOAL-${numMatch[0]}`);
            completed.add(`MUSH-GOAL-${numMatch[0]}`);
          }
        }
      }
    }
  } catch (error) {
    console.warn('[tasks] failed to load completed goal ids:', error);
  }
  return completed;
}

/**
 * 判断任务是否属于已交付的 Goal。
 */
export function isTaskGoalCompleted(task: Task, completedGoals: Set<string>): boolean {
  if (!task.goal_id) return false;
  return isGoalIdCompleted(task.goal_id, completedGoals);
}

export function isGoalIdCompleted(goalId: string, completedGoals: Set<string>): boolean {
  const normalized = goalId.toUpperCase();
  if (completedGoals.has(normalized)) return true;
  // GOAL-067（P2-16，owner 裁决 B7）：严格 GOAL- 前缀匹配——旧 /\d+/ 会把
  // EPIC-7、BATCH-30 等任意编号 id 的首段数字 ≤55 误判为已交付 Goal。
  const goalMatch = /^GOAL-(\d+)$/.exec(normalized);
  if (goalMatch) {
    const num = parseInt(goalMatch[1], 10);
    // RM-001 ~ RM-007 (GOAL-001 ~ GOAL-055) 经 D65 确认已全部验收交付
    if (num >= 1 && num <= 55) return true;


    if (
      completedGoals.has(goalMatch[1]) ||
      completedGoals.has(`GOAL-${goalMatch[1]}`) ||
      completedGoals.has(`MUSH-GOAL-${goalMatch[1]}`)
    ) {
      return true;
    }
  }
  return false;
}


export interface ParsedGoalDoc {
  goal_id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: string;
  deps: string[];
}

/**
 * 解析 Goal Markdown 文档，提取结构化立项信息与目标价值摘要。
 */
export function parseGoalMarkdownDocument(content: string, filename: string): ParsedGoalDoc | null {
  const lines = content.split(/\r?\n/);
  let goalId = '';
  let title = '';
  let status: TaskStatus = 'READY';
  let priority: TaskPriority = '中';
  let source = `goals/${filename}`;
  const deps: string[] = [];

  // 1. 尝试从前 10 行匹配 `# (GOAL-\d+[A-Za-z]?):\s*(.+)`
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    const titleMatch = /^#\s*(GOAL-\d+[A-Za-z]?)\s*[:：]\s*(.+)/i.exec(line);
    if (titleMatch) {
      goalId = titleMatch[1].toUpperCase();
      title = titleMatch[2].trim();
      break;
    }
  }

  // 兜底从文件名解析 Goal ID
  if (!goalId) {
    const fnMatch = /^(GOAL-\d+[A-Za-z]?)/i.exec(filename);
    if (fnMatch) {
      goalId = fnMatch[1].toUpperCase();
      title = filename.replace(/\.md$/i, '');
    } else {
      return null;
    }
  }

  // 模板占位符与虚假 ID 过滤
  if (goalId === 'GOAL-XXX' || /^GOAL-X+$/i.test(goalId) || filename.toUpperCase() === 'TEMPLATE.MD') {
    return null;
  }


  // 2. 解析元数据区（前 15 行）
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i].trim();
    const statusMatch = /^[-\*]\s*状态\s*[:：]\s*[`'"]?([A-Za-z_]+)/i.exec(line);
    if (statusMatch) {
      const rawS = statusMatch[1].toUpperCase();
      if (rawS === 'DONE' || rawS === 'COMPLETED') status = 'DONE';
      else if (rawS === 'IN_PROGRESS' || rawS === 'ACTIVE' || rawS === 'RUNNING') status = 'IN_FLIGHT';
      else if (rawS === 'READY' || rawS === 'QUEUED') status = 'READY';
      else if (rawS === 'BLOCKED') status = 'BLOCKED';
      else if (rawS === 'CANCELLED' || rawS === 'DROPPED') status = 'CANCELLED';
      else status = 'READY';
    }

    const priorityMatch = /^[-\*]\s*优先级\s*[:：]\s*([高中低])/i.exec(line);
    if (priorityMatch) {
      priority = priorityMatch[1] as TaskPriority;
    }

    const sourceMatch = /^[-\*]\s*来源\s*[:：]\s*(.+)/i.exec(line);
    if (sourceMatch) {
      source = sourceMatch[1].trim();
    }

    const depMatch = /^[-\*]\s*依赖\s*[:：]\s*(.+)/i.exec(line);
    if (depMatch) {
      const depItems = depMatch[1].split(/[,，、\s]+/).filter(Boolean);
      deps.push(...depItems);
    }
  }

  // 3. 提取目标与价值摘要（## 1. 目标与价值 或 ## 目标与价值）
  let inValueSection = false;
  const valueParagraphs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+(\d+\.\s*)?目标与价值/i.test(line.trim())) {
      inValueSection = true;
      continue;
    }
    if (inValueSection) {
      if (/^##\s+/.test(line.trim())) {
        break; // 进入下一章节，停止提取
      }
      if (line.trim() !== '' && !line.trim().startsWith('---')) {
        valueParagraphs.push(line.trim());
      }
    }
  }

  let detail = '';
  if (valueParagraphs.length > 0) {
    detail = valueParagraphs.slice(0, 4).join('\n\n');
  } else {
    // 提取正文第一段非空非标题行作为摘要
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t && !t.startsWith('#') && !t.startsWith('-') && !t.startsWith('---')) {
        detail = t;
        break;
      }
    }
  }

  if (deps.length > 0) {
    detail = `${detail ? detail + '\n\n' : ''}依赖: ${deps.join(', ')}`;
  }

  return {
    goal_id: goalId,
    title,
    detail,
    status,
    priority,
    source,
    deps,
  };
}

/**
 * 自动扫描 goals/ 目录并增量同步到任务池（runtime/tasks.jsonl）。
 */
export function syncGoalsDirectoryToTasks(
  tasksPath: string,
  goalsDir: string,
  receiptsDir: string,
  now: () => Date = () => new Date(),
): Task[] {
  const tasks = loadTasks(tasksPath);
  const completedGoals = loadCompletedGoalIds(receiptsDir);
  const existingGoalMap = new Map<string, Task>();

  for (const t of tasks) {
    if (t.goal_id) existingGoalMap.set(t.goal_id.toUpperCase(), t);
    const m = /^(GOAL-\d+[A-Z]?)/i.exec(t.title || '');
    if (m) existingGoalMap.set(m[1].toUpperCase(), t);
    const mSource = /^(GOAL-\d+[A-Z]?)/i.exec(t.source || '');
    if (mSource) existingGoalMap.set(mSource[1].toUpperCase(), t);
  }

  let hasChanges = false;
  if (existsSync(goalsDir)) {
    try {
      const files = readdirSync(goalsDir);
      for (const file of files) {
        if (!file.endsWith('.md') || file === 'README.md' || file === 'TEMPLATE.md') continue;

        const fullPath = path.join(goalsDir, file);
        try {
          const content = readFileSync(fullPath, 'utf8');
          const parsed = parseGoalMarkdownDocument(content, file);
          if (!parsed) continue;

          const existing = existingGoalMap.get(parsed.goal_id);
          const isCompleted = isGoalIdCompleted(parsed.goal_id, completedGoals) || parsed.status === 'DONE';

          if (!existing) {
            // 新增 Goal 文档自动入池建卡
            const atUtc = now().toISOString();
            const initialStatus: TaskStatus = isCompleted ? 'DONE' : parsed.status;
            const newTask: Task = {
              task_id: parsed.goal_id.toLowerCase().replace(/[^a-z0-9]/g, ''),
              title: `${parsed.goal_id}: ${parsed.title}`,
              detail: parsed.detail,
              status: initialStatus,
              priority: parsed.priority,
              source: `goals/${file}`,
              goal_id: parsed.goal_id,
              dispatch_ids: [],
              created_at: atUtc,
              updated_at: atUtc,
            };
            appendTask(tasksPath, newTask);
            existingGoalMap.set(parsed.goal_id, newTask);
            hasChanges = true;
          } else {
            // 如果已有任务卡，但回执已通过或文档状态已更新为 DONE
            if (isCompleted && existing.status !== 'DONE' && existing.status !== 'CANCELLED') {
              const advanced = advanceTaskToStatus(existing, 'DONE', now);
              appendTask(tasksPath, advanced);
              existingGoalMap.set(parsed.goal_id, advanced);
              hasChanges = true;
            }
          }

        } catch (err) {
          console.warn('[tasks] failed to parse goal doc:', file, err);
        }
      }
    } catch (err) {
      console.warn('[tasks] failed to readdir goalsDir:', err);
    }
  }

  return hasChanges ? loadTasks(tasksPath) : reconcileTasksWithReceipts(tasksPath, receiptsDir, now);
}

/**
 * 全局对账：根据已交付的 Goal 验收回执，自动将未完成但已交付的目标任务推进到完成池 (DONE)。
 */
export function reconcileTasksWithReceipts(
  tasksPath: string,
  receiptsDir: string,
  now: () => Date = () => new Date(),
): Task[] {
  const completedGoals = loadCompletedGoalIds(receiptsDir);
  if (completedGoals.size === 0) return loadTasks(tasksPath);

  const tasks = loadTasks(tasksPath);
  let hasChanges = false;
  for (const task of tasks) {
    if (task.status === 'DONE' || task.status === 'CANCELLED') continue;
    if (isTaskGoalCompleted(task, completedGoals)) {
      const advanced = advanceTaskToStatus(task, 'DONE', now);
      appendTask(tasksPath, advanced);
      hasChanges = true;
    }
  }
  return hasChanges ? loadTasks(tasksPath) : tasks;
}




