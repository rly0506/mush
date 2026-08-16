---
goal_id: MUSH-GOAL-011
status: AUTO_ACCEPTED（D15，2026-08-17；两轮真实聊天验收 PASS，AD-26）
mode: LIGHT
rm: RM-003 / M1 头犬核心
executor_model_profile: deepseek-dsh（后端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D24（A+B 组合）
---

# MUSH-GOAL-011：头犬核心——会话续跑、head-dog 适配器、聊天 API

## 任务（详见 docs/rm-003-conversation.md M1）

1. **会话续跑**：dispatch 记录犬只 session_id（dsh --resume / claude
   --continue 解析落盘），`resume_session` 字段允许多轮延续上下文；
2. **head-dog 适配器**：入册 `head-dog`（role=head，deepseek-dsh 通道，
   工作区 D:\mush）；系统章程注入（宪法五门摘要 + 派发/审核语义 +
   "你可调用 node bin/mush 派活，预算/审批门照常"）；
3. **聊天 API**：`POST /api/chat {message, resume?}` → 头犬 dispatch
   （会话续跑）；对话持久化 runtime/chat/<session>.jsonl；
   `GET /api/chat/history?limit=`；契约文档先行（M2 依赖）；
4. **角色注册**：capability record + roster 增 `role` 字段（head/executor）；
5. **DEF-10**：派发默认工作区启动时恢复 .mush/workspace.json 持久化选择。

## 边界

只写 D:\mush（F-45：在 runtime/worktrees/deepseek/ 工作，完成后回报，
头犬合并）；零依赖；真实 dispatch 走既有 approval；五触发门照常；
255 tests 保持全绿。DoD/纪律见派发包 010。
