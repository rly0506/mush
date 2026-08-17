import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-012（RM-003 / M2）对话面板与体验 —— 页面结构与脚本契约断言。
// 聊天契约源：src/web/api-contract.md v1.3（GOAL-011 M1，契约先行）。
// 消费 POST /api/chat + GET /api/chat/history；mock 开发，联调批补。
// 红线不变：零框架/零构建/零外链；凭据永不渲染；web-page-parse 每批必过。

const html = renderBoardPage();

test('chat panel: message stream view + composer bound to POST /api/chat (contract v1.3)', () => {
  assert.match(html, /id="view-chat"/, '聊天面板视图容器');
  assert.match(html, /id="chat-stream"/, '消息流（owner ↔ 头犬）');
  assert.match(html, /id="chat-input"/, '消息输入区');
  assert.match(html, /id="chat-send"/, '发送按钮');
  assert.match(html, /postJson\('\/api\/chat'/, '发送走 POST /api/chat');
  assert.match(html, /\/api\/chat\/history\?session=/, '会话历史走 GET /api/chat/history');
  assert.match(html, /data-view="chat"/, '聊天视图导航项');
});

test('chat panel: session continuity via resume field (GP-04 UI 侧)', () => {
  assert.match(html, /chatSessionId/, '前端持有 session_id 状态');
  assert.match(html, /resume: chatSessionId/, '后续消息带 resume 续跑字段');
});

test('head-dog identity: header badge + roster role column (GP-26 UI 侧)', () => {
  assert.match(html, /id="head-dog-badge"/, '页头常驻当前头犬标识');
  assert.match(html, /当前头犬/, '头犬标识文案');
  assert.match(html, /r\.role/, 'roster 渲染消费 v1.3 role 字段');
  assert.match(html, /head-dog/, 'head-dog 适配器名出现于前端逻辑');
});

test('head-dog action cards: structured dispatch/review records inside message flow', () => {
  assert.match(html, /chat-action-card/, '头犬动作卡（派发/审核）内嵌对话流');
  assert.match(html, /chatActionFor/, 'dispatch 终态回填会话动作卡的逻辑');
});

test('approval gate直通: pending gates auto-popup inside chat flow (触发门)', () => {
  assert.match(html, /chatPromptedApprovals/, '已弹审批的去重记录');
  assert.match(html, /chat pending approval/, '聊天流内嵌审批提示');
  assert.match(html, /openDialog\(/, '复用审批弹窗应答（append-only 语义不变）');
});

test('completion notification: toast + Notification API toggle (GP-18)', () => {
  assert.match(html, /id="notify-toggle"/, '浏览器通知开关');
  assert.match(html, /Notification/, 'Notification API 调用点');
  assert.match(html, /requestPermission/, '通知权限需用户授权');
  assert.match(html, /notifyPref/, '通知偏好本地持久化');
});

test('animated dog logos: inline SVG per model family, zero external refs (GP-23)', () => {
  assert.match(html, /function dogLogo\(/, '内联 SVG 犬只标识生成函数');
  assert.match(html, /<svg /, '内联 SVG（零外链）');
  assert.match(html, /@keyframes logo-(anim|glow)/, '运行中动画关键帧（G013L 后辉光为 logo-glow）');
  assert.match(html, /whale/, 'DeepSeek 鲸鱼意象');
  assert.ok(!/url\(\s*['"]?https?:/i.test(html), '动画零外部资源');
});

test('visual identity: sled-team theme tokens + reduced-motion respect', () => {
  assert.match(html, /--ink|--accent|CSS 变量/, '设计令牌（调色板变量化）');
  assert.match(html, /prefers-reduced-motion/, '减弱动效无障碍尊重');
});
