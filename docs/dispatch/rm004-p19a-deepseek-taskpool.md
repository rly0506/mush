# 派发包 rm004-p19a — DeepSeek 执行 GOAL-019 后端（任务池）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/投喂单通道/每单审批卡 D30）→ `CONSTITUTION.md`
   → `goals/GOAL-019-taskpool.md`
2. `src/web/workstreams.ts`（append-only JSONL 的既有范式）、
   `src/web/dispatch.ts`（stream/task 回链挂点）、`src/web/server.ts`

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-e -b g019a`（基于当前 master
ed168c9+）；**注意**：头犬并行线 GP-32 会改 dispatch 审批路径与 server
部分路由——你禁改 `src/web/dispatch.ts` 的 approval 段与 server.ts 的
approval 路由段，task 相关新增放独立模块 `src/web/tasks.ts` + server
新路由段。禁改 page.ts。

## 单元（严格按序）

1. **U1 任务模型**：`src/web/tasks.ts`（runtime/tasks.jsonl append-only、
   状态折叠读、迁移白名单状态机——形态参照 workstreams.ts）；
2. **U2 任务 API**：GET /api/tasks、POST /api/tasks、
   POST /api/tasks/:id/transition（v1.7 契约落 api-contract.md）；
3. **U3 派发回链**：dispatch 可选 `task_id` 字段（仅追加挂点，不动
   approval 段）；派发 ADMITTED 后 dispatch_id 追加进任务记录；
4. **U4 GP 导入工具**：`scripts/gp-import.cjs`（解析 goal-pool.md 表格，
   dry-run 默认，--write 落盘；不执行迁移）。

## 纪律与验收

324+ tests 全绿（状态机拒绝/append-only/回链断言至少各一）；path-limited
commit（G19A-*）；每批 BATCH-NN 回执（从 44 起，文件名带 -ds 后缀防撞）；
D15 语义；转义铁律。终止：DoD 全满足 + GOAL-019A-completion.json 落盘。
