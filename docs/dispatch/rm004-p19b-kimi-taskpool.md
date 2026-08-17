# 派发包 rm004-p19b — Kimi 执行 GOAL-019 前端（任务池三泳道）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
消费 p19a 契约 v1.7（未落盘前 mock，联调批补真）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/DEF-07）→ `goals/GOAL-019-taskpool.md`
2. `src/web/page.ts`（导航/派发表单/工作流标签的既有范式）+ p19a 包

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-f -b g019b`（基于当前 master）。
零后端改动；仅 page.ts + 测试 + 冒烟脚本。

## 任务

1. **三泳道任务板**：新「任务池」标签——待办（IDEA/READY）/进行中
   （QUEUED/IN_FLIGHT）/完成（DONE/CANCELLED，BLOCKED 折叠入完成列带
   徽标）；卡片：标题/优先级/来源/派发链计数；迁移按钮按状态机白名单
   渲染（不可用动作不出现）；
2. **建卡表单**：标题+详情+优先级+来源 → POST /api/tasks；
3. **任务→派发联动**：卡片「派发」按钮预填派发表单并携带 task_id；
4. v1.7 端点未落盘处 mock 消费并诚实标注（404 探明标注为惯例）。

## 纪律与验收

324+ tests 全绿（web-page-parse 每批必过）+ 结构断言（三泳道/迁移白名单/
建卡表单/派发预填）；脚本化冒烟（真实执行入回执）；极夜主题/品牌色沿用。
path-limited commit（G19B-*）；每批 BATCH-NN 回执（从 44 起，文件名带
-kimi 后缀防撞）。终止：DoD 全满足 + GOAL-019B-completion.json 落盘。
