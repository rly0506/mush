---
goal_id: MUSH-GOAL-009
status: QUEUED（等 GOAL-006 + GOAL-007 收口后启动；由头犬编排）
mode: LIGHT（触发门照常生效）
rm: RM-002 / GOAL-009
executor_model_profile: 头犬 zcode 编排（执行犬按任务路由：deepseek/kimi/其他）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D22（2026-08-17 grilling 定稿；收官任务内容为开放槽，届时
  owner 指定）
---

# MUSH-GOAL-009：试验田验证 → 意向项目收官

## 阶段一：试验田（D:\mush-playground）

1. 头犬建场：轻量真实结构（README + 2-3 个源文件 + 一个小测试），git init；
2. owner 经看板完成首次真实操作：选犬→写任务→选 workspace→派活→看回报→
   验收（RM-002 DoD 的"owner 实操全流程"项）；
3. 任务示例量级："给 utils.ts 加一个 dateFmt 函数 + 测试，npm test 绿"；
   执行犬由头犬按 D20 档位路由指定；
4. 完整 loop 事件链留痕（SCAN→…→ACCEPT），看板可回放。

## 阶段二：意向项目收官（D22 开放槽）

1. owner 指定第一个真实小任务与文件范围（**圈定范围后才能写**，黄金参照
   `.agent-bridge/` 冻结区永远只读）；
2. 经看板派发执行，完整 loop + 事件链；
3. 完成 = RM-002 整单验收条件之一；PS 黄金参照的正式退役时点由 owner
   另行决定（本 Goal 不自动切换日常协作）。

## 边界

- 阶段二写入范围以 owner 圈定为准，未经圈定不动意向项目任何文件；
- 五门照常；真实 dispatch 走 approval/预授权记录；
- 事件链 append-only，全程可回放审计。

## DoD

- 试验田：owner 实操全流程完成 + loop 事件链可回放；
- 意向项目：收官任务完成（或诚实 BLOCKED 记录 + 原因）；
- 完成回报 `goals/receipts/GOAL-009-completion.json`（D15 语义）。
