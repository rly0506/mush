# 派发包 rm004-p17b — Kimi 执行 GOAL-017B（调度自由·前端）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
消费 rm004-p17a 的契约 v1.5（未落盘前按其包内描述 mock，联调批补）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/DEF-07）→ `docs/rm-004-realwork-streaming.md` M4
2. `src/web/page.ts`（聊天工具栏/roster/预算视图）+ `docs/dispatch/
   rm004-p17a-deepseek-dispatch-freedom.md`（后端契约形态）

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-d -b g017b`；提交落该分支。
禁改 chat.ts/dispatch.ts 等后端（本次授权零后端改动）。

## 任务（owner 复验六项的前端侧）

1. **#1 犬只管理 UI**：roster 视图加"添加犬只"（选基础模板+命名）与
   每行"移除"（确认对话，说明软删语义）；操作后 roster 即时刷新；
2. **#2 头犬级联选择**：聊天工具栏改为 **harness 下拉 → 模型变体下拉**
   两级（数据：roster verified 项 × variants；UNVERIFIED 项灰显+原因
   徽标，如 codex「F-50 通道未实证」）；选择随消息提交；
3. **#3 徽章链**：页头当前头犬徽章 = 所选 harness 官方图标 + 模型名
   （随选择联动，不再固定 deepseek）；
4. **#4 品牌色 + 运行边缘辉光**：各家族主色 CSS 变量表
   （deepseek #4D6BFE、claude #D97757、kimi #7C5CFF、glm #4E7AC7、
   opencode #RndF67、codex 手绘灰）常态着色图标；**运行态 = 边缘
   drop-shadow 辉光（品牌色）+ 现有跳动**（owner 2026-08-17 指定形态）；
   idle 保持品牌色不发光；
5. **#6 预算面板活化**：每犬行显示 spent/admission_count/cap（SSE 到达
   即刷新）；cap 行内编辑（PUT，成功后 toast+刷新，失败显示原因）。

## 纪律与验收（DoD）

- 294+ tests 全绿（web-page-parse 每批必过）+ 新增结构断言
  （级联选择/品牌色类/预算行三处）；
- 脚本化冒烟（真实执行入回执）：添加测试犬→roster 出现→移除→消失；
  头犬切换 zcode→徽章变 zcode 图标+GLM；预算行计数与 cap 编辑流转；
- path-limited commit（G17B-*）；每批 BATCH-NN 回执；D15 语义；
  模板正则双写；零外链。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-017B-completion.json` 落盘
（若 p17a 未合并致联调受阻，交付 mock 级并诚实标注，联调批补）。
