# RM-001：移植与 dogfood 自举

状态：`DONE`（2026-08-17 owner 一句话转正。M1–M5 全绿 199 tests；dogfood loop
闭环；触发门真实弹审批并获 owner 应答；对调实验三模型家族；黄金参照零改动。
验收链：goals/receipts/* + docs/auto-decisions-log.md AD-09/12/15/16）
授权依据：DECISIONS.md D1–D9（2026-08-15 owner grilling 定稿）。

## 目标

把 agent-bridge（PowerShell 黄金参照，位于 `D:\意向项目\.agent-bridge\`）的
编排能力移植为 Node/TS 实现，并以 **dogfood 自举**收尾：mush 的第一个 live
loop 任务就是开发 mush 自己。

## 里程碑（按序，每个可独立验收）

### M1 fixture 先行移植

- 把 PS fixture 套件（RPC 25 场景、fail-closed 18 用例、状态机边角、
  身份/租约/恢复/重绑/审计用例）翻译为 Node 测试套件——**测试即验收规格**；
- 此阶段不写实现，先让"预期行为"在新语言里完整落纸。

### M2 核心移植

- 状态机（epoch / lease / 事件签名 / sequence）、能力注册、预算记账；
- 影子回放验收：用 agent-bridge 已录 epoch 事件流（epoch 21–50 的 run root）
  作为回放数据，新旧实现对外部可观察行为一致才算过；
- UTF-8 原生，PS5.1 的编码补丁（BOM/GBK）不需要也不允许出现在新实现里。

### M3 双犬适配器

- DeepSeek（经 pi 或 dsh，headless 已验证）+ Claude Code；
- 合同语言无关：executable + 参数 + 协议；运行时模型身份 fail-closed；
- 每只犬一次真实有界 dispatch 验收；
- M3 收尾接 **CLI 化（D21）**：`bin/mush` 入口 + workspace-root 参数贯通，
  同机任意工作区可调用。

### M4 dogfood 首个 live loop

- 初始分工：DeepSeek 头犬、Claude Code 执行犬（DECISIONS.md 随附默认项）；
- 首个任务：mush 自身的 M5 看板开发，或 M3 剩余适配器接入；
- 半自动调度首次全流程：扫描→推荐→owner 一句话确认→loop→验收；
- 之后头犬/执行犬对调一次，作为跨模型路由的首个验证。

### M5 Web 看板最小版

- 本地服务 + 浏览器看板：犬队状态、epoch 链、事件流推送、预算、审批弹窗；
- 数据源只读消费事件流，不引入第二状态源。

## Definition of Done（RM 级）

- M1–M5 全绿；
- dogfood loop 至少完成一次"派发→执行→回报→审核→验收"闭环并留完整事件链；
- 触发门（CONSTITUTION.md §1）在轻量模式下被真实触发并正确弹审批至少一次
  （预算门最容易自然触发）；
- agent-bridge 黄金参照全程未被修改（只读）。

## 边界

- 不 push 任何远端、不发布、不装全局包（触发门约束）；
- 迁移前置条件未满足前不开始 M2；
- 本 RM 不含记忆层/成员直连（旧提案 Phase C，后置另立）。
