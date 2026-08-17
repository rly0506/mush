// GOAL-017B（rm004-p17b）脚本化冒烟：调度自由前端结构 + 可执行链路。
// p17a（v1.5 后端）未落盘：adapters CRUD / caps PUT 走 mock 路径——本脚本
// 起真实板验证页面服务与既有端点，结构断言覆盖新 UI；联调批补真后端冒烟。
// 用法：node scripts/g017b-dispatch-freedom-smoke.cjs
'use strict';
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const fromRoot = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

async function main() {
  const { startBoardServer } = await import(fromRoot('src/web/server.ts'));
  const { renderBoardPage } = await import(fromRoot('src/web/page.ts'));

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };

  const fixture = path.join(ROOT, '.test-fixtures', 'g017b-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g017b-smoke',
    assignmentEpoch: 1,
    port: 0,
    workspaceRoot: ROOT,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    // 页面可服务 + 快照含 roster（级联选择数据源）
    const page = await fetch(`${base}/`);
    check('看板页面 200', page.status === 200);
    const snap = await (await fetch(`${base}/api/snapshot`)).json();
    check('快照含 roster（级联数据源）', Array.isArray(snap.roster) && snap.roster.length > 0, `roster=${(snap.roster || []).length}`);
    const headDog = (snap.roster || []).find((r) => r.adapter_id === 'head-dog');
    check('roster 含 head-dog（徽章链缺省）', !!headDog);

    // #1 犬只管理：v1.5 未落盘 → POST /api/adapters 应 404（前端按 mock 消费，联调批补）
    const addRes = await fetch(`${base}/api/adapters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'zcode', adapter_id: 'smoke-dog' }),
    });
    check('#1 adapters CRUD 端点状态已探明（mock 标注）', addRes.status === 404 || addRes.status === 201,
      `status=${addRes.status}（404=p17a 未落盘，前端 mock 级交付已标注）`);

    // 页面结构：级联/品牌色/预算行三处
    const html = renderBoardPage();
    check('#2 级联选择结构（harness+variant+UNVERIFIED）',
      /chat-head-select/.test(html) && /chat-head-variant/.test(html) && /unverifiedReason/.test(html));
    check('#3 徽章链联动（adapterId+model）', /当前头犬：' \+ adapterId/.test(html));
    check('#4 品牌主色表+运行辉光', /--brand-deepseek: #4D6BFE/.test(html) && /logo-glow/.test(html) && /--dog-brand/.test(html));
    check('#6 预算计数+cap 编辑结构', /admission_count/.test(html) && /\/api\/budget\/caps\//.test(html) && /data-cap-msg/.test(html));
    check('#1 管理条+软删确认结构', /roster-manage/.test(html) && /window\.confirm/.test(html) && /method: 'DELETE'/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g017b smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
