/** GOAL-018 合并后干跑冒烟：自动归流/流API/handoff回路（全程 dry-run，零花销，D30 无涉）。 */
const BASE = 'http://127.0.0.1:4790';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// 1. 两次同 goal 干跑派发 → 应自动归同一条流
const goal = 'smoke-g018-' + Date.now();
const d1 = await call('POST', '/api/dispatch', { adapter_id: 'deepseek-dsh', prompt: '干跑冒烟第一条（GOAL-018 流归流验证）', effort: 'DEFAULT', real: false, goal_id: goal, workspace: 'D:\\mush' });
const d2 = await call('POST', '/api/dispatch', { adapter_id: 'deepseek-dsh', prompt: '干跑冒烟第二条（应归入同一条流）', effort: 'DEFAULT', real: false, goal_id: goal, workspace: 'D:\\mush' });
console.log('dispatch1:', d1.status, d1.json.dispatch?.status, 'stream:', d1.json.dispatch?.stream_id ?? d1.json.stream_id ?? '(看流表)');
console.log('dispatch2:', d2.status, d2.json.dispatch?.status);

// 2. 流表：同 goal 一条流、两事件
const streams = await call('GET', '/api/streams');
const mine = (streams.json.streams ?? []).filter((s) => s.goal_id === goal || (s.title ?? '').includes(goal));
console.log('streams matched:', mine.length, mine.map((s) => ({ id: s.stream_id, events: s.events?.length ?? s.event_count })) );

const streamId = mine[0]?.stream_id;
if (!streamId) { console.log('FAIL: no stream'); process.exit(1); }

// 3. 外部 handoff 补写 → 201
const ho = await call('POST', `/api/streams/${streamId}/handoff`, { done: '冒烟：归流验证通过', next: '无', open_issues: 'kimi 真实压缩实测仍悬置' });
console.log('handoff:', ho.status, ho.json.handoff?.sha256?.slice(0, 12));

// 4. 时间线含交接块
const tl = await call('GET', `/api/streams/${streamId}`);
const count = (tl.json.stream?.handoffs ?? []).length;
console.log('timeline handoffs:', count, count >= 1 ? 'PASS' : 'FAIL');
process.exitCode = count >= 1 ? 0 : 1;
