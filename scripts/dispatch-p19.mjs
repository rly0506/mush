/** 头犬队列派发（D17 + D30）：p19a/p19b 停 owner 审批卡，批卡即开工。 */
const BASE = 'http://127.0.0.1:4790';

async function main() {
  const common = { real: true, timeout_s: 3600, workspace: 'D:\\mush' };
  const packets = [
    {
      name: 'p19a-deepseek',
      body: {
        ...common,
        adapter_id: 'deepseek-dsh',
        effort: 'DEFAULT',
        prompt: [
          '读取并完整执行派发包 docs/dispatch/rm004-p19a-deepseek-taskpool.md（RM-004 M3，GOAL-019 后端）。',
          'F-45：worktree runtime/worktrees/deepseek-e，分支 g019a，基于当前 master。',
          '特别约束：头犬并行线在改 dispatch 审批路径——你禁改 approval 段（包内已注明）。',
          '批次回执 BATCH-NN 从 44 起，文件名带 -ds 后缀。',
        ].join('\n'),
      },
    },
    {
      name: 'p19b-kimi',
      body: {
        ...common,
        adapter_id: 'kimi-code',
        effort: 'HIGH',
        prompt: [
          '读取并完整执行派发包 docs/dispatch/rm004-p19b-kimi-taskpool.md（RM-004 M3，GOAL-019 前端）。',
          'F-45：worktree runtime/worktrees/kimi-f，分支 g019b，基于当前 master。',
          'v1.7 未落盘处按包内 mock 约定。批次回执 BATCH-NN 从 44 起，文件名带 -kimi 后缀。',
        ].join('\n'),
      },
    },
  ];
  for (const p of packets) {
    const res = await fetch(BASE + '/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.body),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => null);
    const d = j?.dispatch ?? j;
    console.log(p.name, res.status, d?.status ?? j?.error ?? '');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
