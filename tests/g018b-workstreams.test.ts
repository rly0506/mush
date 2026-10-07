import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-018B（派发包 rm004-p18b，D29 修订 v2）工作流视图 + 会话恢复 —— 结构断言。
// 消费契约 v1.6（p18a 未落盘按描述 mock：/api/streams、stream_id/new_stream/new_window、
// HANDOFF 五节块、会话链 link 标记）。

const html = renderBoardPage();

test('任务1 流视图：工作流标签 + 流卡片（统计）+ 时间线', () => {
  assert.match(html, /data-view="team"/, '工作流已收纳进犬队视图（返工2 拆分）');
  assert.match(html, /id="view-streams"/, '流视图容器');
  assert.match(html, /id="streams-list"/, '流卡片列表');
  assert.match(html, /\/api\/streams/, 'GET /api/streams 消费');
  assert.match(html, /dispatch_count/, '派发数统计');
  assert.match(html, /context_pct/, '上下文估算占用%');
  assert.match(html, /handoff_count/, '交接计数');
  assert.match(html, /toggleStreamTimeline/, '点开时间线');
});

test('任务1 会话链标记：真续跑🟢 / 缝合🟡', () => {
  assert.match(html, /streamLinkMarker/, '会话链标记函数');
  assert.match(html, /真续跑/, '真续跑标记');
  assert.match(html, /缝合/, '缝合标记');
});

test('任务1 HANDOFF 交接块：五节卡片式 + 暴毙代写头犬署名标注', () => {
  assert.match(html, /renderHandoffBlock/, '交接块渲染函数');
  assert.match(html, /handoff-block/, '交接块样式类');
  assert.match(html, /做了什么/, '五节之一：做了什么');
  assert.match(html, /定了什么/, '五节之二：定了什么');
  assert.match(html, /文件在哪/, '五节之三：文件在哪');
  assert.match(html, /下一步/, '五节之四：下一步');
  assert.match(html, /未解问题/, '五节之五：未解问题');
  assert.match(html, /head_written/, '暴毙代写字段');
  assert.match(html, /头犬署名/, '头犬署名标注');
});

test('任务2 派发表单：工作流下拉 + 新开流 + 强制新窗随提交', () => {
  assert.match(html, /id="dispatch-stream"/, '工作流下拉');
  assert.match(html, /自动归流：同犬×Goal 归活动流/, '自动归流说明文案');
  assert.match(html, /id="dispatch-new-stream"/, '新开流勾选');
  assert.match(html, /id="dispatch-new-window"/, '强制新窗勾选');
  assert.match(html, /body\.stream_id = streamSel\.value/, 'stream_id 随派发提交');
  assert.match(html, /body\.new_stream = true/, 'new_stream 随派发提交');
  assert.match(html, /body\.new_window = true/, 'new_window 随派发提交');
});

test('任务3 会话恢复：localStorage 持久化 + 加载重渲 + 会话选择器', () => {
  assert.match(html, /mush\.chat\.session/, '当前 session localStorage 键');
  assert.match(html, /saveChatSession/, '会话持久化函数');
  assert.match(html, /id="chat-session-select"/, '会话选择器');
  assert.match(html, /switchChatSession/, '切换/恢复函数');
  assert.match(html, /chatStorageKey\('sessions'\)/, '会话注册表按工作区隔离');
  assert.match(html, /chatStorageKey\('session'\)/, '当前会话按工作区隔离');
  assert.match(html, /if \(chatSessionId\) switchChatSession\(chatSessionId\)/, '页面加载即恢复上次会话');
  assert.match(html, /恢复会话中…/, '恢复占位文案');
});
