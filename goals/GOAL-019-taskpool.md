---
goal_id: MUSH-GOAL-019
status: QUEUED（RM-004 / M3；与头犬 GP-32 线并行——本 Goal 后端新增 tasks
模块+server 路由段、前端仅 page.ts，与 GP-32 的 dispatch 审批路径文件面
小交叠，联调时以头犬现场指示为准）
mode: LIGHT
rm: RM-004 / M3 任务池
executor_model_profile: deepseek-dsh（后端）+ kimi-code（前端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D26（dashi-taskboard 式任务板；markdown 目标池转归档）
---

# MUSH-GOAL-019：任务池（M3，D26）

## 任务

### 后端（deepseek，包 rm004-p19a）

1. **任务模型**：`runtime/tasks.jsonl`（append-only）：task_id、title、
   detail、status（IDEA|READY|QUEUED|IN_FLIGHT|DONE|BLOCKED|CANCELLED）、
   priority（高|中|低）、source（GP-XX/manual）、goal_id?、dispatch_ids[]、
   created_at/updated_at；旧记录不覆盖（状态迁移=追加新行，读侧折叠）。
2. **状态机 API**：GET /api/tasks（lane/status 过滤）、POST /api/tasks、
   POST /api/tasks/:id/transition（合法迁移白名单校验，非法=400 带原因）；
   契约 v1.7。
3. **派发回链**：dispatch 增可选 `task_id`；派发入流时把 dispatch_id 追加
   进任务记录（认领语义）。
4. **GP 迁移工具**：`scripts/gp-import.cjs` 解析 docs/goal-pool.md 表格
   → tasks.jsonl 种子（先 dry-run 打印，`--write` 才落盘）；本 Goal 只做
   工具不执行迁移（迁移时机头犬定）。

### 前端（kimi，包 rm004-p19b）

1. **三泳道任务板**：新「任务池」标签——待办（IDEA/READY）/进行中
   （QUEUED/IN_FLIGHT）/完成（DONE/CANCELLED/BLOCKED 折叠显示）；
   卡片含标题/优先级/来源/派发链计数；状态迁移按钮（按状态机白名单
   渲染可用动作）。
2. **建卡表单**：标题+详情+优先级+来源；新建走 POST。
3. **任务→派发联动**：卡片上「派发」按钮预填派发表单（task_id 携带）。
4. v1.7 未落盘处按包内 mock 约定并诚实标注（联调批补真）。

## DoD

- 状态机非法迁移被拒（400 带原因）断言；append-only（无覆盖）断言；
- 派发回链：带 task_id 派发后任务记录含 dispatch_id；
- 三泳道渲染 + 迁移按钮白名单 + 建卡 + 派发预填冒烟（脚本真实执行）；
- 324+ tests 全绿；web-page-parse 每批必过。

## 边界

F-45 worktree（deepseek-e / kimi-f）；零依赖；五触发门照常；目标池
markdown 本身不动（迁移另行安排）。
