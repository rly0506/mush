# GOAL-029: 对话实时流式打字机与 Thinking 思考链展开 (Streaming Chat & Thinking Flow)

- 状态：`DONE`（2026-08-19 交付完成，全量 421 tests 100% PASS）
- 依据：`RM-004 M2`、`CONSTITUTION.md`（零外联、纯前端渲染纪律）与契约 `v1.9` / `v1.14`。

---

## 1. 目标与价值

当前看板（`127.0.0.1:4790`）的单屏指挥台中：
1. 头犬与工作犬的长输出多以整块事件或长轮询形式呈现，在面对长推理时用户需要较长时间的“黑盒等待”；
2. 模型的“思考过程（Thinking / Reasoning Content）”未能以可折叠/流式展开的方式优雅呈现。

本目标旨在交付：
- **真正的 SSE 逐字打字机流式渲染（Token-by-Token Streaming）**；
- **Thinking 思考链动态伸缩气泡**（运行中心跳呼吸，完成后自动折叠，支持一键展开查看心路历程）；
- **零外部 JS/CSS 依赖**，全原生 DOM 节流渲染（≥200ms 或 512B 帧合并防卡顿）。

---

## 2. 核心架构与交付物

### 1. 服务端流式管道 ([`src/web/chat.ts`](file:///D:/mush/src/web/chat.ts) & [`src/web/server.ts`](file:///D:/mush/src/web/server.ts))
- 完善 SSE `/api/events` 下发 `chat_stream_chunk` 与 `thinking_chunk` 增量帧；
- 维护会话流式终止与异常熔断保护。

### 2. 前端单屏指挥台流式组件 ([`src/web/page.ts`](file:///D:/mush/src/web/page.ts))
- **Thinking 气泡**：半透明灰调圆角气泡，带 `🧠 思考中 (0.0s)...` 动态秒表；
- **流式打字机光标**：闪烁的冷灰竖线光标 `|`，打字完成自动淡出；
- **自适应滚动锁**：用户向上滚动查阅历史时自动解除锁底，用户滚回底部时自动吸附。

---

## 3. 验收规格

- [ ] 新建自动化测试 [`tests/g029-streaming-chat-and-thinking.test.ts`](file:///D:/mush/tests/g029-streaming-chat-and-thinking.test.ts)；
- [ ] 覆盖 SSE 流式分帧合并、Thinking 标签解析与前端 DOM 渲染；
- [ ] 全量 `npm test` 保持 100% 绿灯。
