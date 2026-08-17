/** GOAL-019 合并后任务池真实冒烟（dry-run 派发，零花销）。 */
const BASE = 'http://127.0.0.1:4790';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// 1. 建卡
const created = await call('POST', '/api/tasks', { title: '冒烟：任务池验收卡', detail: 'GOAL-019 合并后真实冒烟', priority: '高', source: 'head-dog', goal_id: 'MUSH-GOAL-019' });
console.log('create:', created.status, created.json.task?.task_id?.slice(0, 8), created.json.task?.status);
const taskId = created.json.task?.task_id;

// 2. 合法迁移 IDEA→READY→QUEUED
const t1 = await call('POST', `/api/tasks/${taskId}/transition`, { status: 'READY' });
const t2 = await call('POST', `/api/tasks/${taskId}/transition`, { status: 'QUEUED' });
console.log('transitions:', t1.status, t1.json.task?.status, '→', t2.status, t2.json.task?.status);

// 3. 非法迁移 QUEUED→DONE 应 400
const bad = await call('POST', `/api/tasks/${taskId}/transition`, { status: 'DONE' });
console.log('illegal QUEUED→DONE:', bad.status, (bad.json.error || '').slice(0, 50));

// 4. dry-run 派发带 task_id → 回链
const disp = await call('POST', '/api/dispatch', { adapter_id: 'deepseek-dsh', prompt: '任务池冒烟（dry-run，不执行）', effort: 'DEFAULT', real: false, task_id: taskId, goal_id: 'MUSH-GOAL-019', workspace: 'D:\\mush' });
console.log('dispatch:', disp.status, disp.json.dispatch?.status);

// 5. 任务记录应含 dispatch_id
const list = await call('GET', '/api/tasks');
const mine = (list.json.tasks || []).find((t) => t.task_id === taskId);
console.log('task dispatch_ids:', JSON.stringify((mine?.dispatch_ids || []).map((id) => id.slice(0, 8))), 'status:', mine?.status);
process.exitCode = created.status === 201 && t2.json.task?.status === 'QUEUED' && bad.status === 400 && (mine?.dispatch_ids || []).length >= 1 ? 0 : 1;
