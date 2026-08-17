// GOAL-020 冒烟：全链路脚本（对话/审批批准否决/working 态/抽屉进出/任务池
// 建卡-迁移-派发预填）+ 亮色主题结构断言。
// 用法：node scripts/g020-snowfield-smoke.cjs
'use strict';
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const fromRoot = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

async function main() {
  const { DispatchPipeline } = await import(fromRoot('src/web/dispatch.ts'));
  const { startBoardServer } = await import(fromRoot('src/web/server.ts'));
  const { renderBoardPage } = await import(fromRoot('src/web/page.ts'));

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };

  const fixture = path.join(ROOT, '.test-fixtures', 'g020-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  const approvalDir = path.join(fixture, 'goals', 'receipts', 'dispatch-approvals');
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(path.join(approvalDir, 'head-dog.approved.json'), JSON.stringify({ approved: true }) + '\n', 'utf8');

  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter: async () => ({
      exitCode: 0, stdout: '头犬：收到 session_id=sess-g020', stderr: '', timedOut: false, childKilled: false,
    }),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g020-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    const post = (url, body) => fetch(base + url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    // 对话链路（真端点）
    const chat = await (await post('/api/chat', { message: '冒烟一句' })).json();
    check('对话发送 200+reply', !!chat.reply, String(chat.reply || '').slice(0, 16));

    // 审批链路：造一个 WAITING 请求 → 批准 → 201
    writeFileSync(path.join(approvalRoot, 'smoke-gate-001.json'), JSON.stringify({
      schema_version: 1, gate: 'budget', actor_id: 'head-dog',
      reason: '冒烟：超 cap 门', requested_at_utc: new Date().toISOString(),
    }) + '\n', 'utf8');
    const respond = await post('/api/approvals/respond', { request_file: 'smoke-gate-001.json', decision: 'APPROVED' });
    check('审批批准 201', respond.status === 201, `status=${respond.status}`);
    const rejectFile = 'smoke-gate-002.json';
    writeFileSync(path.join(approvalRoot, rejectFile), JSON.stringify({
      schema_version: 1, gate: 'external', actor_id: 'head-dog',
      reason: '冒烟：对外门', requested_at_utc: new Date().toISOString(),
    }) + '\n', 'utf8');
    const respond2 = await post('/api/approvals/respond', { request_file: rejectFile, decision: 'REJECTED' });
    check('审批否决 201', respond2.status === 201);

    // 页面结构：主题/骨架/审批收编/排版/任务池
    const html = renderBoardPage();
    check('B1 亮色主题令牌', /--bg: #eef1f5/.test(html) && /color-scheme: light/.test(html));
    check('B2 指挥台骨架（deck+rail+drawer）', /deck-main/.test(html) && /deck-rail/.test(html) && /drawer-tab/.test(html));
    check('B3 审批收编（rail 卡+琥珀 tint+goal 行）', /rail-appr-card/.test(html) && /ember-tint/.test(html) && /rail-appr-goal/.test(html));
    check('B3 模态废除（无 showModal 审批）', !/approval-dialog'\)\.showModal|getElementById\('approval-dialog'\)\.showModal/.test(html));
    check('B3 报备信息（强度/超时/工作区/预算/prompt 预览）',
      /犬只 × 强度/.test(html) && /超时 \/ 工作区/.test(html) && /cap \$/.test(html) && /Prompt 预览/.test(html));
    check('B4 排版阶梯（15px 对话+600 头犬+28px 徽章）',
      /font-size: 15px/.test(html) && /chat-row\.head \.bubble \{ font-weight: 600/.test(html) && /28px/.test(html));
    check('B5 任务池三泳道 DOM', /lane-todo/.test(html) && /lane-doing/.test(html) && /lane-done/.test(html));
    check('B5 状态机白名单 + 派发预填 task_id', /TASK_TRANSITIONS/.test(html) && /data-task-dispatch/.test(html) && /body\.task_id = taskIdAttr/.test(html));
    check('B5 v1.7 mock 诚实标注', /v1\.7 契约未落盘处 mock 消费/.test(html));
    check('working 态动效保留（辉光+跳动）', /logo-glow/.test(html) && /logo-hop/.test(html));
    check('任务池建卡表单', /id="task-create-form"/.test(html) && /task-priority/.test(html) && /task-source/.test(html));

    // 抽屉进出：六个详情视图 DOM 俱在
    check('详情抽屉入口保留（6 视图）',
      ['view-dispatch', 'view-streams', 'view-dogs', 'view-epochs', 'view-budget', 'view-approvals']
        .every((id) => html.includes(`id="${id}"`)));

    // 任务 API 状态探明（v1.7 未落盘 → 404 mock 标注）
    const tasksRes = await fetch(`${base}/api/tasks`);
    check('任务 API 状态探明（404=v1.7 未落盘，mock 级已标注）', tasksRes.status === 404 || tasksRes.status === 200,
      `status=${tasksRes.status}`);
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g020 smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
