---
goal_id: MUSH-GOAL-006
status: AUTO_ACCEPTED（D15 非阻断验收，2026-08-17；DONE 待 owner 转正）
mode: LIGHT（触发门照常生效）
rm: RM-002 / GOAL-006
executor_model_profile: deepseek-dsh（后端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D22（2026-08-17 grilling 定稿）
---

# MUSH-GOAL-006：看板服务端与真派发管线

## 任务

把看板从"只读 + 审批"升级为"可派活"，服务端零依赖不变（node:http）。

1. **API 契约 v1 定稿**（首交付物，GOAL-007 依赖）：以
   `docs/rm-002-mobilization.md` 附录骨架为基础，细化 schema、错误码、
   事件类型，落 `src/web/api-contract.md`；向后兼容演进，破坏性变更需头犬批准。
2. **`POST /api/dispatch`**：真派发管线——选犬（能力注册表）→ 合同构建
   （含 D20 档位字段 effort）→ USD 预算 admission 门（事件化，超限 402）→
   T1/T2 runner 执行 → 回执落盘 → 派发生命周期事件进事件链 + SSE 推送；
   `real=false` 默认 dry-run（与现 CLI 同构）；`real=true` 须 approval 记录
   在案（无则 BLOCKED_WAITING_OWNER，与 CLI 行为一致）。
3. **workspace API**：`GET /api/workspaces`（路径/is_git/mush_managed），
   `POST /api/workspaces/select`（持久化当前选择，落 `.mush/workspace.json`）；
   路径穿越/不存在 fail-closed。
4. **USD 台账落盘**：append-only JSONL（`runtime/budget-ledger.jsonl`），照单
   全收 admission/spend 事件；`GET /api/budget` 投影。
5. **loop 事件流接线**：loop 生命周期（SCAN→DISPATCH→EXECUTE→REPORT→REVIEW→
   ACCEPT）与 dispatch 生命周期统一进 `/api/stream` SSE。

## 分批纪律（沿用惯例）

小步 TDD；path-limited commit（含 G6-Unit 号）；每批 BATCH-NN 回报；既有
199 tests 保持全绿；push origin master 常规同步（失败不阻塞）；D15 验收语义。

## 边界（硬红线）

- 只写 D:\mush；零依赖；真实 dispatch 须 approval 在案；per-actor cap $5；
- 看板仍只绑 127.0.0.1；凭据永不入任何 API 响应/日志；
- 与 GOAL-008 文件面不相交（本 Goal 限 src/web/、src/cli.ts、src/core/budget.ts
  只读消费为主，若需改动 core 先在回报说明）。

## DoD

- `npm test` 全绿（含新端点/管线/台账测试，fake adapter 路径全覆盖）；
- API 契约文档落盘且与实现一致（契约测试）；
- 一次 fake 真流程冒烟：dispatch(dry-run) → 台账落盘 → SSE 收到生命周期事件；
- 完成回报 `goals/receipts/GOAL-006-completion.json`（D15 语义）。
