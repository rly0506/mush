---
goal_id: MUSH-GOAL-021
- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；后端聊天流式（202 异步 + SSE chat 帧，契约 v1.9）在库，专测 tests/g021a-*/g021b-*.test.ts 通过；UI 侧由 GOAL-029 承接；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
mode: LIGHT
rm: RM-004 / M2
executor_model_profile: deepseek-dsh（后端，owner 手开窗口投喂——DEF-13）+ kimi-code（前端，看板审批卡）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D25（A+B 流式）；2026-08-17 批准 M2+M0 并行排期
---

# MUSH-GOAL-021：聊天流式体验（RM-004 M2，路线图名 GOAL-015）

## 后端（deepseek，包 rm004-p20a）

1. **chat 异步化**：`POST /api/chat` 改 202 即返（dispatch_id + session_id），
   不再同步等待回复；回复经事件流推送；
2. **SSE chat 帧**：`GET /api/stream` 增 chat 阶段事件（ADMITTED/EXECUTE/
   心跳耗时/REPORT+回复全文）；会话持久化照旧（回复落 chat JSONL）；
3. **t1-runner 流式回调**：onStdout 增量透传钩子（dsh/claude/kimi 输出
   末段实时可见）；超时/失败语义不变；
4. 契约 v1.9（v1.7 任务池 + v1.8 审批 + v1.9 聊天流式）。

## 前端（kimi，包 rm004-p20b）

1. 聊天发送改异步 UX：发送即上屏（pending 气泡），阶段事件驱动状态
   （思考中→生成中→完成）；
2. **打字机渲染**：SSE 回复增量渐显；心跳耗时实时显示；
3. 失败/超时的气泡态与重试入口；与雪原设计体系一致（15px/600 字重
   阶梯沿用）。

## DoD

- 342+ tests 全绿（chat 202 语义/阶段事件/流式回调断言；web-page-parse）；
- 真实冒烟：发送→阶段事件依序到达→打字机渐显→会话 JSONL 完整；
- 契约 v1.9 落盘。

## 边界

F-45 worktree；零依赖；禁改 approval 段（GP-32 面）；五触发门照常。
