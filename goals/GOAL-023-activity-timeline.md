---
goal_id: MUSH-GOAL-023
- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；活动时间线与三透镜（契约 v1.11）在库（src/web/activity.ts），专测 tests/g023-*.test.ts 通过；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
mode: LIGHT
rm: RM-004 / 体验线（活动时间线批）
executor_model_profile: deepseek-dsh（后端，owner 窗口）+ kimi-code（前端，owner 窗口或审批卡）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D38（任务卡骨架 + 活动时间线 + 三透镜）
---

# MUSH-GOAL-023：活动时间线批（D38 首批：让任务卡活起来）

## 后端（deepseek，包 rm004-p22a）

1. **事件转译层** `src/web/activity.ts`：把系统事件转译为人话活动条目
   （append-only `runtime/activity.jsonl`）：
   - dispatch 生命周期 → 「{犬} 开始执行 #{任务}」「执行完成/失败/
     超时/被否决」（耗时）；
   - task 变迁 → 「#{任务} 转入就绪/执行中/完成」；
   - approval → 「新审批请求：{犬} × {Goal}」「已批准/已否决」；
   - stream/handoff → 「#{任务} 换窗续跑，交接已归档」；
   - 每条：{activity_id, task_id?, goal_id?, actor, text_zh, at_utc,
     source_event 引用（原始事件可回溯）}；
2. **挂接**：dispatch/task/approval/stream 既有写路径各加一行转译
   （不改动原语义与审批段；转译失败不阻断主流程）；
3. **API**：GET /api/activity?task_id=&goal_id=&limit=（倒序）；契约 v1.9
   增活动节（与 M2 同号段协调，先落者定序）。

## 前端（kimi，包 rm004-p22b）

1. **任务卡聚合**：卡片点开 = 活动时间线（人话条目，时间本地化，**绑定各犬官方品牌图标与主题色**，如 deepseek 鲸蓝、claude 橙、kimi 紫、agy 星火蓝等）+
   关联区（Goal 徽章/派发链/最近审批态）+ 成本徽章（数据未上前占位
   「—」并诚实标注，GP-33 接入后填真）；
2. **渐进式披露（Progressive Disclosure）**：卡片表层为人话叙述，深层抽屉保留完整的
   Trace 步骤树、原始 stdout/stderr 尾段与哈希锚点，既直观又保留机器级证据链；
3. **纯投影架构（Pure Projection）**：事件转译层设计为无状态视图投影，转译条目带
   `source_event` 关联，不污染底层的不可篡改事件源；
4. 首页右侧栏顶部「最近活动」滚动条（跨任务人话事件流，点击跳对应卡）；
5. D36 人话原则全覆盖（转译文案本身即人话）。

## DoD

- 342+ tests 全绿（转译层单测：五类事件各至少一条正确人话 + 源事件
  回溯；API 过滤）；
- 真实冒烟：dry-run 派发 → 任务卡时间线出现「开始执行/完成（耗时）」；
  审批卡生成 → 时间线出现「新审批请求（犬×Goal）」；
- 前端结构断言（时间线容器/最近活动栏/关联区/成本占位）。

## 边界

F-45 worktree；零依赖；禁改 approval 段语义；转译失败 fail-open（不阻断
主流程但记 warning）；五触发门照常。
