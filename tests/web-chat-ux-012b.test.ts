import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-012B（派发包 rm003-p12）聊天体验四缺陷修复 —— 前端结构断言（jsdom-free）。
// D1 头犬/思维选择控件；D2 思考中占位+秒表+输入不锁；D3 reply 直渲气泡；D4 选字保护。

const html = renderBoardPage();

test('D1: chat toolbar has head-dog selector (roster role=head) + effort selector', () => {
  assert.match(html, /id="chat-head-select"/, '头犬选择下拉');
  assert.match(html, /id="chat-effort"/, '思维强度下拉');
  assert.match(html, /payload\.adapter_id = headSel\.value/, 'adapter_id 随消息提交');
  assert.match(html, /payload\.effort = effortSel\.value/, 'effort 随消息提交');
  assert.match(html, /r\.role === 'head'/, '头犬下拉数据源 = roster role=head');
});

test('D2: thinking placeholder bubble with breathing dots + elapsed stopwatch', () => {
  assert.match(html, /chat-thinking/, '思考中占位气泡');
  assert.match(html, /thinking-dots/, '三点呼吸动画');
  assert.match(html, /@keyframes think-dot/, '呼吸关键帧');
  assert.match(html, /thinking-elapsed/, '已耗时秒表');
  assert.match(html, /showThinking\(\)/, '发送后立即渲染占位');
  assert.match(html, /removeThinking\(\)/, '回复到达替换占位');
});

test('D2: input stays editable while pending (queue next message)', () => {
  // 不再禁用发送键为唯一反馈；pending 仅改按钮文案，输入框始终可编辑
  assert.doesNotMatch(html, /chat-send'\)\.disabled = pending/, '发送键不再硬禁用为唯一反馈');
  assert.match(html, /发送中…/, 'pending 按钮文案反馈');
});

test('D3: reply renders into head bubble on 200 sync response (v1.3.1)', () => {
  assert.match(html, /result\.status === 200 && data\.ok[\s\S]*data\.reply/, '200 响应体内消费 reply（聊天路径）');
  assert.match(html, /appendChatRow\('head', typeof data\.reply/, 'reply 直渲头犬气泡');
  assert.doesNotMatch(html, /postJson\('\/api\/chat'[\s\S]{0,800}?status === 202/, '聊天路径不再按 202 受理判定（dispatch 表单 202 语义保留）');
});

test('D4: text selection guard + detail selectable + collapse hot-zone narrowed', () => {
  assert.match(html, /window\.getSelection/, '选字保护：getSelection 检查');
  assert.match(html, /if \(selection !== ''\) return/, '选中文字时不折叠');
  assert.match(html, /user-select: text; cursor: auto/, 'detail 区域文字可选');
  assert.match(html, /\.dispatch-card \.head-row \{ cursor: pointer/, '折叠热区收缩到头部行');
  assert.match(html, /event\.stopPropagation\(\)/, 'detail 内点击不冒泡触发 toggle');
});
