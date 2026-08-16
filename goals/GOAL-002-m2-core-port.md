---
goal_id: MUSH-GOAL-002
status: AUTO_ACCEPTED（D15 非阻断验收，2026-08-17；DONE 待 owner 转正）
mode: LIGHT（宪法 §1 轻量档；触发门照常生效）
rm: RM-001 / M2 核心移植
executor_model_profile: 头犬派发（dsh/deepseek headless 或等价可用 harness）
per_actor_budget_usd: 5
created: 2026-08-16
owner_decision: RM-001 M2 里程碑授权（D2 移植式重写 + D4 自举）+ D17 队列自续；
  迁移前置条件已全部满足（docs/migration-checklist.md 四项全勾），无需逐 Goal 再确认
---

# MUSH-GOAL-002：M2 核心移植 — 状态机 / 能力注册 / 预算记账 / 影子回放

## 任务

在 U4 已落的 `src/schema/`（事件/状态/epoch 类型）之上，完成 RM-001 M2 的核心
模块移植，并以已录 epoch 事件流做影子回放验收。

1. **状态机**（`src/core/`）：epoch 推进、lease（授予/重绑/恢复/过期）、
   事件 append-only + 签名锚点、sequence 单调性；语义以 M1 fixture 断言为验收规格。
2. **能力注册**：capability record 字段（adapter_id…quota_checked_at，字段表见
   `docs/migration-checklist.md` 迁移物表）；运行时身份 fail-closed。模型清单按
   D20 以**实测**填充：provider 目录（cc-switch 等，只读，密钥不入库/日志/prompt）
   枚举 provider，逐个探测当前密钥可调用模型，UNKNOWN 诚实记录；capability record
   含 model/思考强度档位字段，供派发包按任务复杂度路由。
3. **预算记账**：per-actor cap + admission 门（作为事件留痕，非阻断记账）。
4. **影子回放**：将 `.agent-bridge/runtime/orchestrator/` 下 epoch21–50 run root
   的事件流复制为只读回放输入（**带 SHA-256 清单**，入 `tests/fixtures/replay/`），
   断言新实现对事件流的重放决策与黄金参照记录的外部可观察行为一致。
5. **参考件收口**（夜间 F-03）：`tests/support/` 的语义参考件 import 切到
   `src/` 生产实现，fixture 断言不弱化、行为不变。

## 范围与要求

1. 零依赖不变：node:test + Node 24 原生 TS；确需依赖则记 finding 停该项（不静默引入）。
2. 每个移植模块注明黄金参照 PS 源文件与行号（可追溯）。
3. 小步分批：每批一个 path-limited commit + `goals/receipts/BATCH-NN-completion.json`。
4. UTF-8 原生：PS5.1 的 BOM/GBK 补丁类用例移植"意图"而非"补丁"，注释注明。
5. 完成回报写入 `goals/receipts/GOAL-002-completion.json`；机检规格全绿后按 D15
   可升 `AUTO_ACCEPTED`（DONE 仍归 owner）。

## 边界（硬红线）

- 只在 `D:\mush` 内写文件；**只读** `D:\意向项目`（黄金参照，禁止修改；复制回放
  数据属读取，落盘只落 D:\mush）。
- 不 push、不发布、不装全局包、不动密钥；花费接近 $5 上限即停并回报。
- 五类触发门照常生效；内核级实现（Job Object/reparse/named-pipe，夜间 F-05/07/08）
  默认不做语义模型之外的扩张，除非里程碑验收需要且走门 4。

## DoD

- `npm test` 退出码 0，含影子回放断言（epoch21–50 事件流）；
- 状态机/能力注册/预算记账各有对应 `src/` 模块与测试，PS 源可追溯；
- `tests/support/` 到 `src/` 的收口完成且断言语义不弱化；
- 完成回报 JSON 落盘（changed_paths、测试输出、证据哈希、open_findings、花费估算）；
- `D:\意向项目` 指名黄金源文件 git diff 为 0。
