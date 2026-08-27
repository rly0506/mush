// GOAL-076 浏览器回归基线（裁定 §7-12）：把 2026-08-24「六批次体检」固化为可复跑脚本。
// 对活板做 HTTP+DOM 冒烟：起板（fake runner）→ 取页面 → 校验三入口/各视图可达/
// 关键控件存在/favicon/SSE 建连。零真实浏览器依赖，Node 内跑，先对旧页建基线、重写后复跑。
// 用法：node scripts/g076-board-regression-baseline.cjs（Windows 转义铁律：脚本文件）。
'use strict';
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const fromRoot = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

async function main() {
  const { DispatchPipeline } = await import(fromRoot('src/web/dispatch.ts'));
  const { startBoardServer } = await import(fromRoot('src/web/server.ts'));

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };

  const fixture = path.join(ROOT, '.test-fixtures', 'g076-baseline', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(path.join(fixture, 'goals', 'receipts', 'dispatch-approvals'), { recursive: true });
  writeFileSync(
    path.join(fixture, 'goals', 'receipts', 'dispatch-approvals', 'head-dog.approved.json'),
    JSON.stringify({ approved: true }) + '\n', 'utf8');

  const runAdapter = async () => ({ exitCode: 0, stdout: '基线回报', stderr: '', timedOut: false, childKilled: false });
  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter,
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g076-baseline',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;

    // 批次1：页面可达 + 关键骨架（导航三入口 + 对话流 + 输入框）。
    const pageRes = await fetch(base + '/');
    const page = await pageRes.text();
    check('批次1 页面 200 且含 <nav> 与对话输入框',
      pageRes.status === 200 && page.includes('<nav') && page.includes('id="chat-input"'));

    // 批次2：三入口导航（重写后收敛为 chat/workbench/console；旧基线容忍多 tab）。
    const navMatch = page.match(/<nav[\s\S]*<\/nav>/);
    const navViews = navMatch ? (navMatch[0].match(/data-view="/g) || []).length : 0;
    check('批次2 导航存在且 ≥3 入口', navMatch !== null && navViews >= 3, `navViews=${navViews}`);

    // 批次3：十项既有能力视图容器可达（页面内存在对应 section/锚点）。
    const viewIds = ['view-chat', 'view-tasks', 'view-dispatch', 'view-dogs', 'view-budget', 'view-approvals'];
    const missing = viewIds.filter((id) => !page.includes(`id="${id}"`));
    check('批次3 核心视图容器齐备（chat/tasks/dispatch/dogs/budget/approvals）', missing.length === 0, missing.join(','));

    // 批次4：favicon 声明存在（消灭 404 的回归锚点）。
    check('批次4 favicon <link rel="icon"> 已声明', /<link rel="icon"/.test(page));

    // 批次5：SSE 流端点可建连（快照推送通道）。
    const sseRes = await fetch(base + '/api/stream');
    check('批次5 SSE /api/stream 建连 200 且 content-type 为事件流',
      sseRes.status === 200 && /text\/event-stream/.test(sseRes.headers.get('content-type') || ''));

    // 批次6：快照端点返回 roster/dispatches 字段（数据源活）。
    const snapRes = await fetch(base + '/api/snapshot');
    const snap = await snapRes.json();
    check('批次6 /api/snapshot 200 且含 roster/dispatches',
      snapRes.status === 200 && Array.isArray(snap.roster) && Array.isArray(snap.dispatches));

    // 批次7：页面脚本可解析（DEF-07 守卫在基线侧再兜一道）。
    const scriptMatch = page.match(/<script>([\s\S]*)<\/script>/);
    let parseOk = false;
    if (scriptMatch) {
      try { new Function(scriptMatch[1]); parseOk = true; } catch (e) { parseOk = false; }
    }
    check('批次7 内联脚本可解析（无模板转义废码）', parseOk);
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log('---');
  console.log(`基线结果：${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('基线脚本异常：', e); process.exitCode = 1; });
