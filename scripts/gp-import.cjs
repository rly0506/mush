#!/usr/bin/env node
/**
 * GOAL-019 U4 — GP 导入工具（dry-run 默认，--write 才落盘）。
 *
 * 解析 docs/goal-pool.md 中的 `| GP-XX | ... |` 表格行，转换为任务池种子
 * runtime/tasks.jsonl 的 append-only 行。不执行迁移。
 *
 * 用法:
 *   node scripts/gp-import.cjs            # dry-run 打印 JSON
 *   node scripts/gp-import.cjs --write    # 追加写入 runtime/tasks.jsonl
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const POOL = path.join(ROOT, 'docs', 'goal-pool.md');
const TASKS = path.join(ROOT, 'runtime', 'tasks.jsonl');

const STATUS_MAP = {
  idea: 'IDEA',
  queued: 'QUEUED',
  active: 'IN_FLIGHT',
  done: 'DONE',
  dropped: 'CANCELLED',
  blocked: 'BLOCKED',
  ready: 'READY',
};

function normalizeStatus(raw) {
  const text = String(raw || '').toLowerCase();
  for (const [key, value] of Object.entries(STATUS_MAP)) {
    if (text.startsWith(key)) return value;
  }
  return 'IDEA';
}

function parseGoalPool() {
  const lines = fs.readFileSync(POOL, 'utf8').split(/\r?\n/);
  const tasks = [];
  for (const line of lines) {
    const match = /^\|\s*(GP-\d+)\s*\|/.exec(line);
    if (!match) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const id = cells[0];
    const title = cells[1] || '';
    const source = cells[2] || 'manual';
    const priorityRaw = cells[3] || '中';
    const priority = ['高', '中', '低'].includes(priorityRaw) ? priorityRaw : '中';
    const status = normalizeStatus(cells[4] || 'idea');
    const deps = cells[5] || '';
    const notes = cells[6] || '';
    const detail = [deps ? `依赖: ${deps}` : '', notes ? `备注: ${notes}` : ''].filter(Boolean).join('\n');
    const now = new Date().toISOString();
    tasks.push({
      task_id: id,
      title,
      detail,
      status,
      priority,
      source,
      dispatch_ids: [],
      created_at: now,
      updated_at: now,
    });
  }
  return tasks;
}

function main() {
  const write = process.argv.includes('--write');
  const tasks = parseGoalPool();
  if (tasks.length === 0) {
    console.error('gp-import: no GP rows found');
    process.exit(1);
  }
  if (!write) {
    console.log(JSON.stringify({ ok: true, dry_run: true, count: tasks.length, tasks }, null, 2));
    return;
  }
  fs.mkdirSync(path.dirname(TASKS), { recursive: true });
  for (const task of tasks) {
    fs.appendFileSync(TASKS, JSON.stringify(task) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ ok: true, dry_run: false, count: tasks.length, path: TASKS }, null, 2));
}

main();
