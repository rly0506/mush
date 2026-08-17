/** M2 派发：p20b → kimi 看板审批卡（D30）。 */
const BASE = 'http://127.0.0.1:4790';

async function main() {
  const res = await fetch(BASE + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      adapter_id: 'kimi-code',
      real: true,
      effort: 'HIGH',
      timeout_s: 3600,
      workspace: 'D:\\mush',
      goal_id: 'MUSH-GOAL-021',
      prompt: [
        '读取并完整执行派发包 docs/dispatch/rm004-p20b-kimi-chat-streaming.md（RM-004 M2，GOAL-021 前端：打字机与异步聊天）。',
        'F-45：worktree runtime/worktrees/kimi-g，分支 g021b，基于当前 master fb67b6a+。',
        '注意：主仓已修复任务池迁移按钮 bug（{to}→{status}），你基于最新 master 开工即可。',
        'v1.9 未落盘处 mock 消费诚实标注。批次回执 BATCH-NN 从 46 起，-kimi 后缀。',
      ].join('\n'),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json().catch(() => null);
  console.log('p20b-kimi', res.status, j?.dispatch?.status ?? j?.error ?? '');
}

main().catch((e) => { console.error(e); process.exit(1); });
