# 派发包 010 — DeepSeek/dsh 执行 MUSH-GOAL-011（头犬核心）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。

## 第一步：按序读取

1. `AGENTS.md`（含 Windows 转义铁律）→ `CONSTITUTION.md` → `DECISIONS.md` D15-D24
2. `docs/rm-003-conversation.md` — 本阶段 charter（M1 = 你的 Goal）
3. `goals/GOAL-011-head-dog-core.md` — Goal 定义
4. 现状底座：`src/web/dispatch.ts`（dispatch 管线/roster）、
   `src/web/persistence.ts`、`src/adapters/`

## F-45 工作方式（强制，新）

**在独立 worktree 工作**：`git worktree add runtime/worktrees/deepseek -b g011`
（分支名 g011）；全部提交落在该分支；完成回报后由头犬合并。
禁止直接动 master 工作树——与 kimi（GOAL-012）并行的隔离保障。

## 交付顺序

1. **聊天 API 契约先行**（M2 在等）：`src/web/api-contract.md` 增补
   chat 节（POST /api/chat、GET /api/chat/history、roster role 字段）；
2. 会话续跑（session_id 解析与 resume 注入，含测试）；
3. head-dog 适配器 + 章程注入；4. 聊天 API 实现；5. DEF-10。

## 纪律与边界（惯例 + 本 Goal 特有）

小步 TDD；255 tests 全绿；path-limited commit（G11-* 号）；每批 BATCH-NN
回报；D15 验收语义。head-dog 的真实 dispatch（聊天冒烟）：approval 以
`head-dog` adapter_id 落 `dispatch-approvals/`（头犬已预置，见同目录
owner-unlock 惯例；若缺则记 finding 停，不自行批准）。
五触发门照常；零依赖；只写 worktree 内。

## 终止条件

DoD 全满足（含一次 head-dog 真实聊天冒烟：POST /api/chat 两轮，
第二轮证明上下文延续）+ `goals/receipts/GOAL-011-completion.json` 落盘。
