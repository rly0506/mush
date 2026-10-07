---
goal_id: MUSH-GOAL-020
- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；雪原营地×任务池融合版在库（src/web/page.ts），专测 tests/g020-*.test.ts 通过；目标池 GP-34 已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
串行；owner↔kimi 直启线执行，头犬验收+安全审查）
mode: LIGHT
rm: RM-004 / 体验线 × M3 任务池前端（融合）
executor_model_profile: kimi-code（前端，thinking high）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D33（雪原立项）+ D34（融合）
---

# MUSH-GOAL-020：雪原营地 × 任务池前端融合批（D34）

## 关系

- 视觉/骨架权威 = `docs/gp-33-snowfield-theme-plan.md`（B1-B4 原样执行）；
- 任务池前端（原 p19b 范围）= 本章程新增 **B5**，建于 B2 新骨架内；
- 后端契约 v1.7（GOAL-019/p19a，另行推进）未落盘处 mock + 诚实标注。

## 批次（kimi 串行，每批 web-page-parse 必过）

1. **B1 令牌换血**（原计划书）；
2. **B2 骨架重组**（原计划书）；
3. **B3 审批收编**（原计划书 + **D33 附加条件：报备信息——犬只×强度/
   超时/工作区/预算已花与 cap/完整 prompt 预览——必须内联可展开保留；**目标行（goal_id，owner 2026-08-17 反馈：审批名与 Goal 编号结合）必须显著显示**，
   弹窗废除但信息不得缩水）；
4. **B4 排版阶梯**（原计划书）；
5. **B5 任务池三泳道（新增，新骨架内）**：
   - 泳道：待办（IDEA/READY）/进行中（QUEUED/IN_FLIGHT）/完成
     （DONE/CANCELLED，BLOCKED 折叠徽标）；
   - 卡片：标题/优先级/来源/派发链计数；迁移按钮按状态机白名单渲染；
   - 建卡表单（标题+详情+优先级+来源）；「派发」按钮预填派发表单携带
     task_id；dashi 双栏范式在此入位（计划书§四该条边界随之解除）；
   - v1.7 未落盘处 mock 消费诚实标注，联调批补真；
6. **冒烟**：全链路脚本（对话/审批批准否决/working 态/抽屉进出/任务池
   建卡-迁移-派发预填）+ 截图目检（亮色对比度人工复验点）。

## DoD

- 331+ tests 全绿（B1 时按 331 基线零修改通过，色值断言除外）；
- 新增结构断言 ≥5（色板/骨架/审批收编含报备/阶梯/任务池）；
- B3 报备信息完整内联（D33 附加条件验收项）；
- 每批 BATCH-NN 回执（-kimi 后缀）；终止：DoD 全满足 +
  GOAL-020-completion.json 落盘。

## 边界

F-45 worktree kimi-f / g020；零后端改动、零依赖、零外链；
127.0.0.1 不变；凭据永不渲染；模板正则双写；D15 语义。
