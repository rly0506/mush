import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-007 U1-U4：看板前端调度入口——页面结构断言（服务端渲染 HTML + 内联 JS）。
// 契约源：src/web/api-contract.md v1（G006 已定稿）。
// 红线：单文件零框架零外链；永不渲染凭据材料；不动 server 端点逻辑。

const html = renderBoardPage();

test('dispatch form: dog selector, prompt textarea, effort/cap, dry-run|real toggle', () => {
  assert.match(html, /id="dispatch-adapter"/, '犬只下拉选择器');
  assert.match(html, /id="dispatch-prompt"/, '任务文本域');
  assert.match(html, /id="dispatch-effort"/, 'effort 档位选择');
  assert.match(html, />LOW<\/option>/);
  assert.match(html, />HIGH<\/option>/);
  assert.match(html, /id="dispatch-cap"/, 'cap_usd 输入');
  assert.match(html, /id="dispatch-real"/, 'dry-run|real 切换');
  assert.match(html, /需 approval 在案/, 'real 模式提示');
  assert.match(html, /id="btn-dispatch"/, '派发提交按钮');
});

test('dispatch form submits to POST /api/dispatch per contract v1', () => {
  assert.match(html, /postJson\('\/api\/dispatch'/);
  assert.match(html, /adapter_id/);
  assert.match(html, /cap_usd/);
  assert.match(html, /real/);
  // 犬只下拉选项来自快照 actors（在册身份证明徽章），不硬编码名单
  assert.match(html, /snapshot\.actors/);
});

test('workspace selector: list via GET /api/workspaces, select via POST, current highlighted', () => {
  assert.match(html, /id="workspace-select"/);
  assert.match(html, /getJson\('\/api\/workspaces'\)/);
  assert.match(html, /\/api\/workspaces\/select/);
  assert.match(html, /id="workspace-current"/, '当前 workspace 全局高亮区');
});

test('dispatch tracking cards: status badges + expandable receipt/chain anchors', () => {
  assert.match(html, /id="dispatch-list"/);
  assert.match(html, /badge\.ADMITTED/, 'ADMITTED 状态徽章样式');
  assert.match(html, /badge\.DRY_RUN/, 'DRY_RUN 状态徽章样式');
  assert.match(html, /badge\.BLOCKED_WAITING_OWNER/, 'BLOCKED 状态徽章样式');
  assert.match(html, /badge\.FAIL/, 'FAIL 状态徽章样式');
  assert.match(html, /dispatch-card/, 'dispatch 卡片');
  assert.match(html, /\/api\/dispatch\//, '点击展开拉取 GET /api/dispatch/:id');
  assert.match(html, /receipt_path/, '回执锚点');
});

test('budget view consumes GET /api/budget (per-actor spent/cap/entries)', () => {
  assert.match(html, /getJson\('\/api\/budget'\)/);
  assert.match(html, /spent_usd/);
  assert.match(html, /cap_usd/);
  assert.match(html, /entries/);
});

test('SSE dispatches update the board without full reload', () => {
  assert.match(html, /EventSource\('\/api\/stream'\)/);
  assert.match(html, /'dispatch'/, 'dispatch 生命周期事件类型');
});

test('style and security discipline: zero external resources, no credential fields', () => {
  assert.ok(!/src=["']https?:/i.test(html), 'no external script sources');
  assert.ok(!/href=["']https?:/i.test(html), 'no external stylesheet/font links');
  assert.ok(!/<script[^>]*src=/i.test(html), 'all scripts inline');
  assert.ok(!/credential|api[_-]?key|secret|token/i.test(html.replace(/credential_status|identity/g, '')), 'no credential material rendered');
});
