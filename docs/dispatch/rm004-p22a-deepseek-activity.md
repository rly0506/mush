# 派发包 rm004-p22a — DeepSeek 执行 GOAL-023 后端（事件转译层）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md` → `goals/GOAL-023-activity-timeline.md`
   → `DECISIONS.md` D36/D38（本批的设计宪法）
2. `src/web/dispatch.ts`（emit 写路径挂点）、`src/web/tasks.ts`、
   `src/web/workstreams.ts`、`src/web/server.ts`（approval respond）

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-g -b g023a`（基于当前 master）。
禁改 page.ts 与 approval 段语义（挂接允许：respond 处加转译行不动逻辑）。

## 单元（严格按序）

U1 转译模块 activity.ts（五类事件→人话+源引用）→ U2 四处挂接
（fail-open）→ U3 GET /api/activity → U4 契约节。

## 纪律与验收

342+ tests 全绿（转译单测≥5 + API 过滤断言）；path-limited commit
（G23A-*）；批次回执 BATCH-NN（-ds 后缀）；D15；转义铁律。
终止：DoD 全满足 + GOAL-023A-completion.json 落盘。
