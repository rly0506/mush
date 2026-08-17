/** 并行补发 p18b → kimi-code：客户端短超时脱离，服务端继续执行，状态靠轮询。 */
const BASE = 'http://127.0.0.1:4790';

const body = {
  adapter_id: 'kimi-code',
  real: true,
  effort: 'HIGH',
  timeout_s: 3600,
  workspace: 'D:\\mush',
  prompt: [
    '读取并完整执行派发包 docs/dispatch/rm004-p18b-kimi-workstreams.md（RM-004 M5，GOAL-018 前端）。',
    '注意：该单为 D29 修订后的 v2 版，设计权威 = goals/GOAL-018-workstreams.md 文末「修订 v2」节。',
    '按包内 F-45 指引建 worktree（runtime/worktrees/kimi-e，分支 g018b，基于当前 master——p17b 已合并；契约 v1.5 后端已落盘，v1.6 未落盘处仍按包内 mock 约定）。',
    '批次回执照旧（BATCH-NN 从 42 起，避免与已归档的 41 撞号；文件名可带 -kimi 后缀防撞）。',
  ].join('\n'),
};

async function main() {
try {
  const res = await fetch(BASE + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json().catch(() => null);
  console.log('completed-fast:', res.status, JSON.stringify(j).slice(0, 200));
} catch (err) {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    console.log('posted-detached: 客户端超时脱离，服务端继续执行——用 /api/snapshot 轮询状态');
  } else {
    console.error('ERROR:', err);
    process.exit(1);
  }
}
}

main().catch((err) => { console.error(err); process.exit(1); });
