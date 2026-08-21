const path = require('node:path');
const { reconcileTasksWithReceipts, loadTasks } = require('../src/web/tasks.ts');

const workspaceRoot = path.resolve(__dirname, '..');
const tasksPath = path.join(workspaceRoot, 'runtime', 'tasks.jsonl');
const receiptsDir = path.join(workspaceRoot, 'goals', 'receipts');

console.log('Reconciling tasks from:', tasksPath, 'with receipts from:', receiptsDir);
const tasks = reconcileTasksWithReceipts(tasksPath, receiptsDir);
console.log('--- Current Tasks State ---');
for (const t of tasks) {
  console.log(`[${t.status}] #${t.task_id.slice(0, 8)} | ${t.title} (${t.goal_id || 'no-goal'})`);
}
