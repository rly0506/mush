# 派发包 rm004-p22b — Kimi 执行 GOAL-023 前端（任务卡聚合与最近活动）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
消费 p22a 活动契约（未落盘前 mock，联调补真）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/DEF-07）→ `goals/GOAL-023-activity-timeline.md`
   → DECISIONS.md D36/D38
2. `src/web/page.ts`（雪原体系 + GOAL-022 任务卡形态——以 master 为准）

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-h -b g023b`（基于当前 master）。
零后端改动。

## 任务

任务卡聚合（点开=活动时间线+关联区+成本占位）→ 右栏「最近活动」流
（点击跳卡）→ D36 全覆盖。详见 Goal 文件。

## 纪律与验收

342+ tests 全绿 + 结构断言 + 脚本化冒烟。path-limited commit（G23B-*）；
批次回执 BATCH-NN（-kimi 后缀）。终止：DoD 全满足 +
GOAL-023B-completion.json 落盘。
