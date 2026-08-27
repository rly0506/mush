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

test('G076 结构：导航收敛为侧栏入口（对话/工作台/犬队/治理/洞察/实验室）', () => {
  const navMatch = html.match(/<nav[\s\S]*<\/nav>/);
  assert.ok(navMatch, 'must have a <nav>');
  // 返工2：owner 裁定侧栏可折叠 + 拆分内容新增标签页（3→6 入口）。
  for (const v of ['chat', 'workbench', 'team', 'governance', 'insights', 'lab']) {
    assert.ok(navMatch[0].includes(`data-view="${v}"`), `nav must include entry ${v}`);
  }
  assert.ok(navMatch[0].includes('id="nav-collapse"'), '侧栏折叠按钮存在');
});

test('G076 结构：L2 工作台视图存在且收纳任务池+派发', () => {
  assert.ok(html.includes('id="view-workbench"'), 'must have view-workbench section');
});

test('G076 结构：拆分后的四个内容视图齐备（犬队/治理/洞察/实验室）', () => {
  for (const id of ['view-team', 'view-governance', 'view-insights', 'view-lab']) {
    assert.ok(html.includes(`id="${id}"`), `must have ${id}`);
  }
  // 低频视图收纳进各自分组容器。
  for (const id of ['view-dogs', 'view-epochs', 'view-budget', 'view-carveouts', 'view-approvals', 'view-streams']) {
    assert.ok(html.includes(`id="${id}"`), `must still host ${id}`);
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

// ---- GOAL-076 返工批次（GLM 评审 + owner 反馈驱动）----

test('G076 返工·配色：双主题（亮面默认 + 暗面自调，§7.5 母题保留）', () => {
  // owner 2026-08-27 修订：亮色柔和为默认 + 用户可切暗面（月之亮/暗面）。
  assert.ok(html.includes('data-theme'), 'data-theme 主题挂点');
  assert.ok(html.includes('id="theme-toggle"'), '主题切换按钮');
  assert.ok(html.includes('--bg: #0a0f16'), '暗面极夜令牌');
  assert.ok(html.includes('color-scheme: light') && html.includes('color-scheme: dark'), '亮暗双 color-scheme');
});

test('G076 返工2·设置面板可展开 + 头犬 harness 可选（修复设置失灵/头犬不可选）', () => {
  assert.ok(html.includes('id="chat-settings-toggle"'), '设置开关存在');
  assert.ok(html.includes('id="chat-settings-panel"'), '设置面板存在');
  // .open 展开力需压过 style="display:none" 内联（!important）。
  assert.ok(/\.chat-settings-panel\.open\s*\{\s*display:\s*flex\s*!important/.test(html), 'open 态 !important 覆盖内联 display:none');
  // 头犬 harness 选择器挂在设置面板内且渲染函数绑定。
  assert.ok(html.includes('id="chat-head-select"'), '头犬 harness 选择器');
  assert.ok(html.includes('renderHeadCascade'), '头犬级联渲染函数');
});

test('G076 返工·导航：codex 式左侧栏（app-shell 双栏 + 纵排 nav）', () => {
  assert.ok(html.includes('class="app-shell"'), 'app-shell 布局容器');
  assert.ok(/nav\s*\{[^}]*flex-direction:\s*column/.test(html), 'nav 纵排（侧栏）');
});

test('G076 返工·派发抽屉：派发表单为抽屉形态 + 工作台有「＋派发」入口', () => {
  assert.ok(/id="view-dispatch"[^>]*dispatch-drawer/.test(html), '派发区为 dispatch-drawer 抽屉');
  assert.ok(html.includes('id="btn-open-dispatch"'), '工作台「＋派发任务」入口');
  assert.ok(html.includes('id="btn-close-dispatch"'), '抽屉关闭钮');
});

test('G076 返工·术语：版本号/决议号黑话不进可见标签', () => {
  const text = visibleText(html);
  for (const banned of ['（v1.6', '(GOAL-028', '（D20', 'ccusage', 'admission']) {
    assert.ok(!text.includes(banned), `visible text must not contain jargon "${banned}"`);
  }
});

test('G076 返工·金额守卫：fmtUsd 兜底 NaN，预算区不直出 $NaN', () => {
  assert.ok(html.includes('function fmtUsd'), 'fmtUsd 守卫存在');
  assert.ok(html.includes("if (!isFinite(n)) return '$0.0000'"), 'NaN 兜底');
});

test('G076 返工·脱敏：账号邮箱经 maskAccount 打码', () => {
  assert.ok(html.includes('function maskAccount'), 'maskAccount 脱敏函数存在');
});

test('G076 返工·待办徽标：点击有反馈（toast 提示）', () => {
  assert.ok(html.includes("id=\"rail-toggle-btn\""), '待办徽标存在');
  assert.ok(/待办栏已展开/.test(html), '待办徽标点击触发 toast 反馈文案');
});

test('G076 返工·三段式持久化：历史回看可重建（ChatTurn 带 thinking/tools/plan）', () => {
  assert.ok(html.includes('renderChatBubbleFromTurn'), '历史回看三段式渲染器');
  assert.ok(html.includes('turn.thinking') && html.includes('turn.tools'), '读取持久化帧');
});
