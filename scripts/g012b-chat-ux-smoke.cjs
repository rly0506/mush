// GOAL-012B 脚本化冒烟（派发包 rm003-p12 DoD 要求真实执行记入回执）。
// 全链路：起板（fake runner）→ 选 head-dog + effort=XHIGH 发消息 → 200+reply
// 直渲语义校验 → 页面脚本含 D2 占位/D4 选字保护结构 → 输出 PASS/FAIL 摘要。
// 用法：node scripts/g012b-chat-ux-smoke.cjs（Windows 转义铁律：脚本文件，非内联）。
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
    checks.push({ name, ok, detail: detail || '' });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };

  const fixture = path.join(ROOT, '.test-fixtures', 'g012b-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  // D6：real 聊天需 head-dog 批准记录在案。
  const approvalDir = path.join(fixture, 'goals', 'receipts', 'dispatch-approvals');
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(path.join(approvalDir, 'head-dog.approved.json'), JSON.stringify({ approved: true }) + '\n', 'utf8');

  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter: async () => ({
      exitCode: 0,
      stdout: '冒烟头犬回复：已收到并派活 session_id=smoke-012b',
      stderr: '',
      timedOut: false,
      childKilled: false,
    }),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g012b-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    // D1：选 head-dog + effort=XHIGH → 200 受理
    const res = await fetch(`http://127.0.0.1:${server.port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '冒烟：回报一下队列状态', adapter_id: 'head-dog', effort: 'XHIGH' }),
    });
    const body = await res.json();
    check('D1 头犬+effort 选择受理', res.status === 200 && body.ok === true, `status=${res.status}`);

    // D3：响应体 reply 即头犬回复（直渲气泡语义）
    check('D3 响应体含 reply 头犬文本', typeof body.reply === 'string' && body.reply.includes('冒烟头犬回复'), String(body.reply).slice(0, 24));
    check('D3 同步语义（200 非 202）', res.status === 200, 'v1.3.1');

    // D1 负例：executor 伪装头犬 → 400 fail-closed
    const bad = await fetch(`http://127.0.0.1:${server.port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x', adapter_id: 'deepseek-dsh' }),
    });
    check('D1 executor 伪装头犬被拒（400）', bad.status === 400, `status=${bad.status}`);

    // D2/D4：页面脚本结构（占位气泡/秒表/选字保护/热区收缩）
    const html = renderBoardPage();
    check('D2 思考中占位+秒表结构在页面', /chat-thinking/.test(html) && /thinking-elapsed/.test(html));
    check('D2 输入不锁（无 disabled = pending）', !/chat-send'\)\.disabled = pending/.test(html));
    check('D4 getSelection 选字保护在页面', /window\.getSelection/.test(html) && /selection !== ''\) return/.test(html));
    check('D4 detail 可选中 + 热区收缩', /user-select: text; cursor: auto/.test(html) && /\.dispatch-card \.head-row/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g012b smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  // 不用 process.exit（Node/libuv Windows 上 SSE handle 关闭竞态会触发
  // async.c assertion 崩溃，退出码 127）；置 exitCode 让事件循环自然排空。
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
