/** D34 后重开 p19a 后端卡（内容不变，停 owner 审批卡）。 */
const BASE = 'http://127.0.0.1:4790';

async function main() {
  const res = await fetch(BASE + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      adapter_id: 'deepseek-dsh',
      real: true,
      effort: 'DEFAULT',
      timeout_s: 3600,
      workspace: 'D:\\mush',
      prompt: [
        '读取并完整执行派发包 docs/dispatch/rm004-p19a-deepseek-taskpool.md（RM-004 M3，GOAL-019 后端，D34 修订：本 Goal 已收敛为纯后端，前端无关）。',
        'F-45：worktree runtime/worktrees/deepseek-e，分支 g019a，基于当前 master 5d1982e+。',
        '约束不变：禁改 dispatch approval 段与 page.ts。',
        '批次回执 BATCH-NN 从 44 起，文件名带 -ds 后缀。',
      ].join('\n'),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json().catch(() => null);
  console.log('p19a-backend', res.status, j?.dispatch?.status ?? j?.error ?? '');
}

main().catch((e) => { console.error(e); process.exit(1); });
