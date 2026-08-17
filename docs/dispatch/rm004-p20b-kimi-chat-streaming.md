# 派发包 rm004-p20b — Kimi 执行 GOAL-021 前端（打字机与异步聊天）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
消费 p20a 契约 v1.9（未落盘前 mock，联调批补真）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/DEF-07）→ `goals/GOAL-021-chat-streaming.md`
2. `src/web/page.ts`（雪原体系 + 聊天面板/会话恢复既有实现）+ p20a 包

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-g -b g021b`（基于当前 master）。
零后端改动；仅 page.ts + 测试 + 冒烟脚本。

## 任务

1. **异步发送 UX**：发送即上屏 pending 气泡；SSE 阶段事件驱动
   （思考中→生成中→完成/失败）；心跳耗时实时显示；
2. **打字机渲染**：回复增量渐显（节流AnimationFrame，reduced-motion
   降级为直接全显）；
3. 失败/超时气泡态 + 重试按钮；会话恢复/选择器语义不变；
4. 雪原设计体系沿用（15px 正文/600 头犬字重/28px 签名徽章不动）。

## 纪律与验收

342+ tests 全绿（web-page-parse 每批必过）+ 结构断言（pending 气泡/
阶段态/打字机容器/重试）；脚本化冒烟（真实执行入回执）。v1.9 未落盘处
mock 消费诚实标注。path-limited commit（G21B-*）；批次回执 BATCH-NN
（-kimi 后缀，从 46 起）。终止：DoD 全满足 + GOAL-021B-completion.json。
