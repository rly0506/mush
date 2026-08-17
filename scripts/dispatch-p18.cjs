#!/usr/bin/env node
/** 头犬队列派发（D17）：p18a → deepseek-dsh，p18b → kimi-code。真实派发停 owner 审批卡。 */
const BASE = 'http://127.0.0.1:4790';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const common = { real: true, timeout_s: 3600, workspace: 'D:\\mush' };

const p18a = {
  ...common,
  adapter_id: 'deepseek-dsh',
  effort: 'DEFAULT',
  prompt: [
    '读取并完整执行派发包 docs/dispatch/rm004-p18a-deepseek-workstreams.md（RM-004 M5，GOAL-018 后端）。',
    '注意：该单为 D29 修订后的 v2 版，设计权威 = goals/GOAL-018-workstreams.md 文末「修订 v2」节。',
    '按包内 F-45 指引建 worktree（runtime/worktrees/deepseek-d，分支 g018a，基于当前 master——p17a 已合并）。',
    '批次回执照旧（BATCH-NN 从 42 起，避免与已归档的 41 撞号）。',
  ].join('\n'),
};

const p18b = {
  ...common,
  adapter_id: 'kimi-code',
  effort: 'HIGH',
  prompt: [
    '读取并完整执行派发包 docs/dispatch/rm004-p18b-kimi-workstreams.md（RM-004 M5，GOAL-018 前端）。',
    '注意：该单为 D29 修订后的 v2 版，设计权威 = goals/GOAL-018-workstreams.md 文末「修订 v2」节。',
    '按包内 F-45 指引建 worktree（runtime/worktrees/kimi-e，分支 g018b，基于当前 master——p17b 已合并；契约 v1.5 后端已落盘，v1.6 未落盘处仍按包内 mock 约定）。',
    '批次回执照旧（BATCH-NN 从 42 起，避免与已归档的 41 撞号；文件名可带 -kimi 后缀防撞）。',
  ].join('\n'),
};

async function main() {
  for (const [name, body] of [['p18a-deepseek', p18a], ['p18b-kimi', p18b]]) {
    const r = await post('/api/dispatch', body);
    const j = r.json ?? {};
    console.log(name, r.status, JSON.stringify({ dispatch_id: j.dispatch_id, status: j.status ?? j.dispatch?.status, error: j.error }));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
