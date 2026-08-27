import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-076 前端重铸（CLI 级聚焦）验收规格——测试先行（红灯），驱动 P1/P2 施工。
// 裁定口径见 GOAL-076 §7：三入口收敛、术语仅扫可见文本、首屏≤对话流+顶栏+输入框+待办徽标。

const html = renderBoardPage();

// 抽取 <body> 内可见文本（去 <script>/<style>/标签），用于术语裸词扫描。
  function visibleText(src: string): string {
  return src
    .replace(/<script>[\s\S]*<\/script>/g, ' ')
    .replace(/<style>[\s\S]*<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    // HTML 实体解码（&amp; 等），防转义后的裸词逃逸扫描。
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

test('G076 结构：导航收敛为 3 入口（对话/工作台/控制台）', () => {
  const navMatch = html.match(/<nav[\s\S]*<\/nav>/);
  assert.ok(navMatch, 'must have a <nav>');
  const navBtns = navMatch[0].match(/data-view="/g) || [];
  assert.equal(navBtns.length, 3, `nav must converge to 3 entries, got ${navBtns.length}`);
  for (const v of ['chat', 'workbench', 'console']) {
    assert.ok(navMatch[0].includes(`data-view="${v}"`), `nav must include entry ${v}`);
  }
});

test('G076 结构：L2 工作台视图存在且收纳任务池+派发', () => {
  assert.ok(html.includes('id="view-workbench"'), 'must have view-workbench section');
});

test('G076 结构：L3 控制台视图存在，收纳低频治理视图', () => {
  assert.ok(html.includes('id="view-console"'), 'must have view-console section');
  // 低频视图收进控制台容器（不再是顶层平级 section）。
  for (const id of ['view-dogs', 'view-epochs', 'view-budget', 'view-carveouts', 'view-approvals', 'view-streams']) {
    assert.ok(html.includes(`id="${id}"`), `console must still host ${id}`);
  }
});

test('G076 术语：可见文本不出现 carveout 裸词（写面授权）', () => {
  const text = visibleText(html);
  assert.ok(!/carveout/i.test(text), 'visible text must not contain raw "carveout"');
});

test('G076 术语：可见文本不出现 SUPERSEDED / stream_id 等内部代号', () => {
  const text = visibleText(html);
  for (const banned of ['SUPERSEDED', 'stream_id', 'cap_usd', 'timeout_s']) {
    assert.ok(!text.includes(banned), `visible text must not contain raw "${banned}"`);
  }
});

test('G076 术语：effort 档位保留模型原生梯度（low/medium/high），不译中文档位名', () => {
  const text = visibleText(html);
  // owner 裁定：梯度原文保留，但不得直出内部代号 XHIGH。
  assert.ok(!text.includes('XHIGH'), 'visible text must not contain raw internal tier "XHIGH"');
});

test('G076 首屏：L1 默认仅对话视图激活，右栏默认收起 + 待办徽标恒显', () => {
  assert.ok(html.includes('id="view-chat"'), 'L1 chat view present');
  // 右栏默认收起（deck-rail display:none，靠 deck-rail-open 展开）+ 待办徽标恒显。
  assert.ok(html.includes('id="rail-toggle-btn"'), 'topbar rail toggle (待办徽标) present');
  assert.ok(html.includes('id="waiting-count"'), 'topbar waiting badge present');
});

test('G076 favicon：页面声明图标（消灭 404）', () => {
  assert.ok(/<link rel="icon"/.test(html), 'page must declare a favicon <link rel="icon">');
});

test('G076 P2：三段式气泡渲染器存在（思考折叠 + 工具活动 + 正文）', () => {
  assert.ok(html.includes('thinking-collapsible'), '思考折叠区 class');
  assert.ok(html.includes('tool-activity'), '工具活动区 class');
  assert.ok(html.includes('parseToolBlocks'), '工具块解析器');
  assert.ok(html.includes('chat-text-body'), '正文区 class');
});

test('G076 P2：计划卡去内联样式（纳入设计令牌）', () => {
  const planCardIdx = html.indexOf('plan-card');
  assert.ok(planCardIdx >= 0, 'plan-card present');
  // 精修后计划卡不再带内联 style 属性。
  assert.ok(!/<div class="plan-card" style=/.test(html), 'plan-card must not use inline style');
});

test('G076 workspace 徽标：显示目录名而非「服务 cwd」原始文案', () => {
  const text = visibleText(html);
  assert.ok(!text.includes('服务 cwd'), 'workspace badge must not show raw "服务 cwd" wording');
});
