// GOAL-018B（rm004-p18b）脚本化冒烟：会话恢复真实链路 + 流视图/表单结构。
// 真实执行：起板（fake runner）→ POST /api/chat 发消息 → 模拟"刷新"
// （GET history）→ 对话完整恢复断言；切换会话 → 历史正确。
// 用法：node scripts/g018b-workstreams-smoke.cjs
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

  const fixture = path.join(ROOT, '.test-fixtures', 'g018b-smoke', String(process.pid));
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
      exitCode: 0,
      stdout: '头犬回复：收到指令 session_id=sess-018b',
      stderr: '',
      timedOut: false,
      childKilled: false,
    }),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g018b-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    const post = (body) => fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 会话 A 两轮
    const a1 = await (await post({ message: '第一轮：记下数字 42' })).json();
    const a2 = await (await post({ message: '第二轮：复述那个数字', resume: a1.session_id })).json();
    check('会话 A 两轮同 session', a1.session_id === a2.session_id, a1.session_id.slice(0, 8));

    // 模拟刷新：GET history → 完整恢复（4 轮 = 2×(user+head)）
    const histA = await (await fetch(`${base}/api/chat/history?session=${a1.session_id}&limit=50`)).json();
    check('刷新后会话 A 完整恢复（4 轮）', histA.ok && histA.turns.length === 4, `turns=${histA.turns.length}`);
    check('恢复内容含 user 与 head 双角色', histA.turns[0].role === 'user' && histA.turns[1].role === 'head');
    check('恢复内容含第二轮文本', histA.turns[2].text.includes('复述'));

    // 会话 B 独立 → 切换后历史互不串扰
    const b1 = await (await post({ message: '另一个会话的第一句' })).json();
    check('会话 B 独立 session', b1.session_id !== a1.session_id);
    const histB = await (await fetch(`${base}/api/chat/history?session=${b1.session_id}&limit=50`)).json();
    check('切换会话 B 历史正确（2 轮，不含 A 内容）',
      histB.turns.length === 2 && histB.turns[0].text.includes('另一个会话') && !histB.turns[0].text.includes('数字 42'));

    // 页面结构：流视图 / 会话选择器 / 强制新窗 / 恢复逻辑 / 交接块
    const html = renderBoardPage();
    check('页面含会话恢复逻辑（localStorage+加载重渲）',
      /mush\.chat\.session/.test(html) && /if \(chatSessionId\) switchChatSession\(chatSessionId\)/.test(html));
    check('页面含会话选择器', /id="chat-session-select"/.test(html));
    check('页面含工作流标签与流视图', /data-view="streams"/.test(html) && /id="view-streams"/.test(html));
    check('页面含强制新窗+新开流控件', /id="dispatch-new-window"/.test(html) && /id="dispatch-new-stream"/.test(html));
    check('页面含 HANDOFF 交接块渲染（五节+头犬署名）',
      /renderHandoffBlock/.test(html) && /未解问题/.test(html) && /头犬署名/.test(html));
    check('页面含会话链标记（真续跑/缝合）', /真续跑/.test(html) && /缝合/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g018b smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
