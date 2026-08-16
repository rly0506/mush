import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBoardServer } from '../src/web/server.ts';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-013L（派发包 rm003-p13）官方品牌图标接线 —— 资产路由 + 兜底链 + 三态动效。
// 后端授权唯一小改：GET /assets/brands/:name.svg（白名单目录/纯文件名/仅 svg/穿越拒绝）。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g013l', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

async function startWithBrands(root: string) {
  const approvalRoot = path.join(root, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  const brands = path.join(root, 'assets', 'brands');
  mkdirSync(brands, { recursive: true });
  writeFileSync(path.join(brands, 'deepseek.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M3 14c3-6 9-8 13-6z"/></svg>\n', 'utf8');
  return startBoardServer({
    approvalRoot,
    runId: 'g013l-assets',
    assignmentEpoch: 1,
    port: 0,
    workspaceRoot: root,
    runtimeRoot: path.join(root, 'runtime'),
  });
}

test('assets route: GET /assets/brands/deepseek.svg → 200 image/svg+xml + cache header', async () => {
  const root = fixtureRoot();
  const server = await startWithBrands(root);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/assets/brands/deepseek.svg`);
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /image\/svg\+xml/);
    assert.match(String(res.headers.get('cache-control')), /max-age/);
    const text = await res.text();
    assert.match(text, /^<svg/);
  } finally {
    await server.close();
  }
});

test('assets route: missing file → 404 JSON', async () => {
  const root = fixtureRoot();
  const server = await startWithBrands(root);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/assets/brands/nope.svg`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, false);
  } finally {
    await server.close();
  }
});

test('assets route: path traversal and non-svg rejected (fail-closed 404)', async () => {
  const root = fixtureRoot();
  // 目录外放一个诱饵文件，验证穿越读不到
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'secret.svg'), '<svg>outside</svg>\n', 'utf8');
  const server = await startWithBrands(root);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const traversal = await fetch(`${base}/assets/brands/..%2Fsecret.svg`);
    assert.equal(traversal.status, 404);
    const dotdot = await fetch(`${base}/assets/brands/..%2F..%2Fpackage.json`);
    assert.equal(dotdot.status, 404);
    const nonSvg = await fetch(`${base}/assets/brands/deepseek.png`);
    assert.equal(nonSvg.status, 404);
    const subdir = await fetch(`${base}/assets/brands/sub/deepseek.svg`);
    assert.equal(subdir.status, 404);
  } finally {
    await server.close();
  }
});

test('page: brand fallback chain — img with onerror→hand-drawn, mapping table present', () => {
  const html = renderBoardPage();
  assert.match(html, /\/assets\/brands\//, '页面引用品牌资产路径');
  assert.match(html, /onerror/, '加载失败静默回退（不留破图）');
  assert.match(html, /deepseek-dsh/, '映射含 deepseek-dsh');
  assert.match(html, /claude-code/, '映射含 claude-code');
  assert.match(html, /head-dog/, '映射含 head-dog（头犬徽章同源）');
  assert.match(html, /LOGO_SHAPES/, '手绘内联 SVG 兜底保留');
});

test('page: three-state motion — working hop / idle / terminal settle-flash + reduced-motion', () => {
  const html = renderBoardPage();
  assert.match(html, /@keyframes logo-hop/, 'working 跳动关键帧');
  assert.match(html, /dog-logo\.working/, 'working 态选择器');
  assert.match(html, /logo-settle-flash/, '终态落定闪一次动画');
  assert.match(html, /prefers-reduced-motion/, '减弱动效降级');
  assert.match(html, /terminal-flash/, '终态动画类');
});
