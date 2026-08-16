// GOAL-013L（rm003-p13）脚本化冒烟：品牌资产路由 + 页面兜底链共存断言。
// 用法：node scripts/g013l-brand-smoke.cjs（转义铁律：脚本文件，非内联）。
'use strict';
const { mkdirSync, writeFileSync } = require('node:fs');
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

  const fixture = path.join(ROOT, '.test-fixtures', 'g013l-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  // 冒烟用仓内真实资产目录（workspaceRoot=ROOT，资产已在仓）。
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g013l-smoke',
    assignmentEpoch: 1,
    port: 0,
    workspaceRoot: ROOT,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/assets/brands/deepseek.svg`);
    const text = await res.text();
    check('GET /assets/brands/deepseek.svg 200', res.status === 200, `status=${res.status}`);
    check('svg 头 + image/svg+xml', text.startsWith('<svg') && /image\/svg\+xml/.test(String(res.headers.get('content-type'))));
    check('短缓存头', /max-age/.test(String(res.headers.get('cache-control'))));

    const missing = await fetch(`${base}/assets/brands/nope.svg`);
    check('缺失资产 404', missing.status === 404);
    const traversal = await fetch(`${base}/assets/brands/..%2F..%2Fpackage.json`);
    check('路径穿越拒绝 404', traversal.status === 404);

    const html = renderBoardPage();
    check('页面含官方 img 引用路径', /\/assets\/brands\//.test(html));
    check('页面含 onerror 静默回退', /onerror/.test(html));
    check('页面含手绘兜底（LOGO_SHAPES 共存）', /LOGO_SHAPES/.test(html));
    check('页面含三态动效（logo-hop / terminal-flash / reduced-motion）',
      /@keyframes logo-hop/.test(html) && /terminal-flash/.test(html) && /prefers-reduced-motion/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g013l smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
