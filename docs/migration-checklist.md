# 从 agent-bridge 迁移清单（mush ← 意向项目）

## 前置条件（全部满足才开始 M2 代码迁移）

- [ ] Sol 事后审计完成（审计哈希锚定意向项目当前路径，拆分/迁移前必须闭环；
      审计提示词已于 2026-08-15 交付 owner）
- [ ] 意向项目 INDEX.md / BOARD.md 与迁移基线收口完成（static-drift 门由 Sol 处理）
- [ ] parent 绑定按 Directive 12 §3 审计化 rebind 回 Sol
- [ ] tbtk 中转 tools 透传稳定性观察（Sol 审计能跑 = 基本恢复；连续数日稳定更佳）

## 迁移物

| 物 | 来源（意向项目内路径） | 去向 |
| --- | --- | --- |
| fixture 套件（作为验收规格翻译） | `.agent-bridge/tools/tests/*.tests.ps1` | mush M1 Node 测试套件（翻译，非照搬） |
| 事件/状态 schema | run root `state.json` / `events/` / 回执 JSON | mush M2 类型定义（TS） |
| 影子回放数据 | `.agent-bridge/runtime/orchestrator/RM065-GOAL-010-epoch21..50/` 事件流 | 只读回放输入，复制带哈希清单 |
| 能力探测合同 | capability record 字段定义（adapter_id…quota_checked_at） | mush 能力注册模块 |
| 适配器参考实现 | `BridgePiAdapter.psm1` / `BridgeClaudeAdapter.psm1` 等 | 阅读参照，重写为 Node |
| 治理经验 | OWNER-DIRECTIVES 1–14、epoch 事故回执 | CONSTITUTION.md 已吸收核心；原文留在原地 |

## 不迁移 / 原地冻结

- **runtime 证据**（全部 epoch run root、archive）：append-only 历史证据，
  留在意向项目原地冻结，mush 只引用路径+哈希；
- **PowerShell 实现**：冻结为黄金参照实现，只读，永不修改；
- **意向项目的 AGENTS.md/spec 治理文档**：属意向项目，mush 不复制其权威，
  仅在 CONSTITUTION.md 中声明关系。

## 关系约定（迁移后）

- 意向项目 = mush 的普通消费者（继续用 PS 黄金参照版跑日常协作，直至 mush M4 后择机切换）；
- 双方不共享代码路径；mush 通过 adapter 合同操作任意工作区（workspace-root 参数化）；
- 2026-08-15 起意向项目侧不再修改桥代码（避免迁移分歧）。
