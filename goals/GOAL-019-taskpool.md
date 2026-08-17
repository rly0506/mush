---
goal_id: MUSH-GOAL-019
status: QUEUED（D34 修订：收敛为**纯后端**；前端三泳道并入 GOAL-020 融合批，
p19b 作废）
mode: LIGHT
rm: RM-004 / M3 任务池（后端）
executor_model_profile: deepseek-dsh（后端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D26（任务池）；D34（前端并入 GOAL-020）
---

# MUSH-GOAL-019：任务池·后端（M3，D26/D34）

## 任务（deepseek，包 rm004-p19a，内容不变）

1. **任务模型**：`runtime/tasks.jsonl`（append-only）：task_id、title、
   detail、status（IDEA|READY|QUEUED|IN_FLIGHT|DONE|BLOCKED|CANCELLED）、
   priority（高|中|低）、source（GP-XX/manual）、goal_id?、dispatch_ids[]、
   created_at/updated_at；旧记录不覆盖（状态迁移=追加新行，读侧折叠）。
2. **状态机 API**：GET /api/tasks、POST /api/tasks、
   POST /api/tasks/:id/transition（合法迁移白名单校验，非法=400 带原因）；
   契约 v1.7。
3. **派发回链**：dispatch 增可选 `task_id`；派发入流时把 dispatch_id 追加
   进任务记录（认领语义）。
4. **GP 迁移工具**：`scripts/gp-import.cjs` 解析 docs/goal-pool.md 表格
   → tasks.jsonl 种子（先 dry-run 打印，`--write` 才落盘）；只做工具
   不执行迁移。

## DoD

- 状态机非法迁移被拒（400 带原因）断言；append-only（无覆盖）断言；
- 派发回链：带 task_id 派发后任务记录含 dispatch_id；
- 331+ tests 全绿（后端面）。

## 边界

F-45 worktree（deepseek-e）；零依赖；五触发门照常；禁改 page.ts；
不动 dispatch approval 段（GP-32 刚落）。前端消费面见 GOAL-020。
