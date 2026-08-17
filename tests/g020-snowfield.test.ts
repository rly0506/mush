import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-020（D33/D34）雪原营地 × 任务池前端融合批 —— B1-B5 结构断言（jsdom-free）。
// 权威：docs/gp-33-snowfield-theme-plan.md（B1-B4）+ GOAL-020 章程 B5。

const html = renderBoardPage();

test('B1 色板：雪原白昼令牌（冷白纸面）', () => {
  assert.match(html, /--bg: #eef1f5/, '蓝灰雪色底');
  assert.match(html, /--panel: #ffffff/, '白卡浮起');
  assert.match(html, /--ink: #1d2733/, '主文近黑');
  assert.match(html, /--ink-dim: #5a6675/, '二级灰');
  assert.match(html, /--ink-faint: #9aa5b1/, '三级灰');
  assert.match(html, /--accent: #0e9f8f/, '极光青压暗保对比');
  assert.match(html, /--ember: #c07a1f/, '审批琥珀');
  assert.match(html, /--ember-tint: #fdf3e3/, '审批浅琥珀 tint');
  assert.match(html, /color-scheme: light/, '亮色模式');
});

test('B2 骨架：对话主区 + 右侧犬队栏 + 详情抽屉入口', () => {
  assert.match(html, /class="view active deck"|view active deck/, '对话区 = 指挥台骨架');
  assert.match(html, /deck-main/, '对话主区容器');
  assert.match(html, /deck-rail/, '右侧栏容器');
  assert.match(html, /id="rail-dogs"/, '犬队栏');
  assert.match(html, /id="rail-budget"/, '预算迷你条');
  assert.match(html, /id="rail-approvals"/, '审批栏顶卡位');
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\) 300px/, '主区+300px 栏');
  assert.match(html, /drawer-tab/, '详情抽屉标签降级');
  assert.match(html, /renderRailDogs/, '犬队栏渲染函数');
});

test('B3 审批收编：栏顶常驻卡 + 报备信息内联 + goal 显著 + 无模态', () => {
  assert.match(html, /rail-approvals/, '审批卡常驻栏顶');
  assert.match(html, /renderRailApprovals/, '栏顶审批渲染函数');
  assert.match(html, /ember-tint/, '琥珀 tinted 卡');
  assert.match(html, /goal_id|goal 行/, '目标行显著显示');
  assert.match(html, /cap_usd|预算/, '报备：预算/cap');
  assert.match(html, /timeout|超时/, '报备：超时');
  assert.match(html, /workspace|工作区/, '报备：工作区');
  assert.match(html, /prompt|预览/, '报备：prompt 预览');
  assert.doesNotMatch(html, /approval-dialog.*showModal|showModal\(\).*approval/, '模态弹窗废除');
});

test('B4 排版阶梯：15/13/12 + 等宽数据 + 签名大徽章', () => {
  assert.match(html, /chat-row \.bubble[^}]*15px|font-size: 15px/, '对话正文 15px');
  assert.match(html, /chat-row\.head \.bubble[^}]*600|font-weight: 600/, '头犬 600 字重');
  assert.match(html, /13px/, '卡片标题 13px 层');
  assert.match(html, /12px/, '元信息 12px 层');
  assert.match(html, /28px/, '签名大徽章 28px');
});

test('B5 任务池三泳道（新骨架内，v1.7 mock 标注）', () => {
  assert.match(html, /data-view="tasks"|id="view-tasks"/, '任务池视图');
  assert.match(html, /lane-todo|lane-doing|lane-done|泳道/, '三泳道');
  assert.match(html, /IDEA|READY/, '待办泳道状态');
  assert.match(html, /IN_FLIGHT|QUEUED/, '进行中泳道状态');
  assert.match(html, /DONE|CANCELLED/, '完成泳道状态');
  assert.match(html, /BLOCKED/, 'BLOCKED 折叠徽标');
  assert.match(html, /task_id/, '派发预填携带 task_id');
  assert.match(html, /\/api\/tasks/, '任务 API 消费（mock）');
  assert.match(html, /v1\.7|mock/, 'v1.7 未落盘诚实标注');
});

// AD-42 回归：迁移请求体字段必须是 { status }（后端 v1.7 契约）——
// mock 漂移曾发 { to } 导致真实环境迁移按钮恒 400。
test('task transition request body uses { status } per v1.7 contract (mock-drift regression)', () => {
  const html = renderBoardPage();
  assert.match(html, /transition',\s*\{ status: btn\.getAttribute\('data-to'\) \}/, 'transition body must be { status }');
  assert.doesNotMatch(html, /\{ to: btn\.getAttribute/, 'must not send { to }');
});
