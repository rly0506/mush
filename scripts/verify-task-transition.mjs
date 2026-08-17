/** 迁移 bug 修复验证：真后端迁移「目检卡」IDEA→READY，并跑 GP 池迁移。 */
const BASE = 'http://127.0.0.1:4790';

async function main() {
  // 1. 找到目检卡
  const list = await (await fetch(BASE + '/api/tasks')).json();
  const card = (list.tasks || []).find((t) => t.title.includes('owner 目检'));
  if (!card) { console.log('FAIL: 目检卡不存在'); process.exit(1); }
  console.log('card:', card.task_id.slice(0, 8), card.status);

  // 2. 迁移 IDEA→READY（后端真链路）
  const res = await fetch(`${BASE}/api/tasks/${card.task_id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'READY' }),
  });
  const j = await res.json();
  console.log('transition IDEA→READY:', res.status, j.task?.status ?? j.error);
  process.exitCode = res.status === 200 ? 0 : 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
