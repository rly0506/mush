import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-021B（派发包 rm004-p20b）聊天流式前端 —— 结构断言（jsdom-free）。
// 消费契约 v1.9 真实后端：POST /api/chat 202 异步受理 + SSE kind=chat 帧
// （ADMITTED → EXECUTE(增量) → HEARTBEAT(耗时) → REPORT(回复全文)）。
// 红线：零框架/零构建/零外链；审批段（GP-32 面）未动；web-page-parse 每批必过。

const html = renderBoardPage();

test('U1: async send UX — 202 ack consumed; pending bubble staged; session semantics unchanged', () => {
  assert.match(html, /result\.status === 202 && data\.ok/, '202 异步受理判定（v1.9）');
  assert.match(html, /chatInflightId = data\.dispatch_id/, 'ack 登记在途 dispatch_id（帧匹配键）');
  assert.match(html, /showThinking\(\); \/\/ pending 气泡/, '发送即上屏 pending 气泡');
  assert.match(html, /resume: chatSessionId/, '会话续跑 resume 语义不变');
  assert.match(html, /registerSessionId\(chatSessionId\)/, '会话注册表/选择器语义不变');
});

test('U1: SSE chat frames drive stage machine (思考中→生成中→完成/失败)', () => {
  assert.match(html, /payload\.kind === 'chat'/, 'SSE onmessage 消费 kind=chat 帧');
  assert.match(html, /function chatHandleFrame\(/, 'chat 帧处理器');
  assert.match(html, /frame\.phase === 'ADMITTED'/, 'ADMITTED 阶段');
  assert.match(html, /frame\.phase === 'EXECUTE'/, 'EXECUTE 增量阶段');
  assert.match(html, /frame\.phase === 'HEARTBEAT'/, 'HEARTBEAT 耗时阶段');
  assert.match(html, /frame\.phase === 'REPORT'/, 'REPORT 终态阶段');
  assert.match(html, /<span class="chat-stage">思考中<\/span>/, 'pending 气泡阶段元素（思考中）');
  assert.match(html, /chatSetStage\(row, '生成中'\)/, '生成中阶段');
  assert.match(html, /chatSetStage\(row, '完成'/, '完成阶段');
  assert.match(html, /chatSetStage\(row, '失败'/, '失败阶段');
});

test('U1: heartbeat elapsed_ms renders live into stage row', () => {
  assert.match(html, /chatSetElapsed\(chatStreamRow \|\| thinkingRow, p\.elapsed_ms\)/, 'HEARTBEAT elapsed_ms 实时上屏');
  assert.match(html, /thinking-elapsed/, '耗时秒表元素');
});

test('U2: typewriter renderer — rAF throttle + reduced-motion fallback', () => {
  assert.match(html, /typewriter-text/, '打字机容器');
  assert.match(html, /requestAnimationFrame\(chatTypewriterTick\)/, 'AnimationFrame 节流');
  assert.match(html, /cancelAnimationFrame/, 'rAF 句柄清理');
  assert.match(html, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, 'reduced-motion 检测');
  assert.match(html, /chatStreamShown = chatStreamBuf\.length/, 'reduced-motion 降级直接全显');
  assert.match(html, /chatStreamBuf \+= p\.stream_text/, 'EXECUTE stream_text 增量拼接');
  assert.match(html, /chat-row\.head\.chat-streaming/, '生成中气泡样式');
});

test('U3: failure/timeout bubble state + retry button', () => {
  assert.match(html, /chat-failed/, '失败气泡态');
  assert.match(html, /chat-retry/, '重试按钮');
  assert.match(html, /function retryChat\(/, '重试逻辑');
  assert.match(html, /chatLastMessage/, '重试数据源');
  assert.match(html, /chatFinishFailure/, '失败/超时统一出口');
  assert.match(html, /320000/, '前端超时看门狗（320s > 服务端 300s）');
  assert.match(html, /p\.error !== undefined/, 'REPORT error 字段判定失败');
});

test('U3: in-flight chat dispatch skips history backfill (typewriter not clobbered)', () => {
  assert.match(html, /payload\.dispatch_id !== chatInflightId[\s\S]{0,120}chatRefreshHistory/, '在途 chat 派发跳过历史回补');
});

test('U4: snowfield design system preserved (15px body / 600 head weight / 28px badge)', () => {
  assert.match(html, /font-size: 15px; line-height: 1\.7/, '对话正文 15px/1.7');
  assert.match(html, /\.chat-row\.head \.bubble \{ font-weight: 600/, '头犬气泡 600 字重');
  assert.match(html, /width: 28px; height: 28px/, '28px 签名徽章');
  assert.match(html, /chat-row\.head\.chat-failed \.bubble \{ background: #fbeae8; border-color: var\(--danger\)/, '失败态走雪原 danger 令牌');
});
