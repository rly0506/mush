---
read_priority: ON_DEMAND
read_when: 规划跨 harness 多 agent 协作（雪橇队）下一阶段 RM、看板可视化、一键启动或模型路由时
owner: shared
stale_after: 2026-11-15
---

# 雪橇队：跨 Harness 多 Agent 协作路线提案（2026-08-15）

文档类型：`DESIGN PROPOSAL CANDIDATE`；状态：`CANDIDATE`（不构成 RM/Goal，不授权任何操作）。
来源：owner 2026-08-15 口述愿景 + RM065-GOAL-010 关闭后的完成度对账 + 意见仓库既有调研
（`agent-harness-inspiration-overview-2026-08-11.md`、
`agent-bridge-vs-external-projects-and-dsh-plugin-2026-08-13.md`、
`dashi-taskboard-evaluation-2026-08-11.md`、
`2026-08-03-work-split-and-north-star-conversation.md`）。

## 0. 愿景（owner 原话提炼）

跨 agent harness 交流合作工具：父级（头犬）负责审核与计划，子级（雪橇犬）负责具体任务。
每个模型有其专属 harness（"专属武器"：opus→claude code、gpt→codex、glm→zcode、
deepseek→dsh/pi），同时存在普适 harness（opencode、pi）。联通它们戮力同心拉雪橇。

功能要求：随时更换父/子级模型与 harness；父级自动检测可调配模型（cc-switch、环境变量、
直接探测）并调度合适模型；派发→执行→回报→审核→修正的 loop 模式；harness 可联通可复现、
可扩展适配新 harness；前端可视化；一键启动。

## 1. 现状基线（RM065-GOAL-010 DONE 后，2026-08-15 实证）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 完整 loop（派发→执行→回报→审核→DONE） | **真实闭环 1 次** | epoch-50：Pi/DeepSeek 真实执行→签名 review_ready→approved，$0.03 |
| 修正循环（finding→correction→重过门） | 真实发生过 | epoch-29→49 链 |
| 换父级（rebind + epoch） | 机制在，演练 1 次（重型） | Directive 12：Sol→DeepSeek 临时 parent |
| 模型/harness 探测（capability/quota/cc-switch） | fixture 全绿，自动路由未达成 | capability registry + quota probe |
| 多 harness 真实联通 | **2 真 2 空**：pi ✅、claude ✅（执行者+review-helper 两角色）；codex 被 tbtk 中转故障挡（外因）；opencode 一直 UNKNOWN | epoch-49/50 回执 |
| 治理与审计 | 独有优势：绑定/epoch/签名/回执/HUMAN HOLD/预算 | 50 个 epoch run root |

压力测试实证：头犬 harness（Sol/tbtk）瘫痪时，队伍靠 rebind 换犬继续完成 Goal——
架构已支持愿景的核心韧性。

## 2. 缺口与提案项（按依赖排序）

### Phase A：犬队齐装（补真实联通 + 自动路由 + 换犬轻量化）

- **A1 全犬实跑验收**：codex、opencode 各完成一次真实有界 dispatch 或诚实 UNKNOWN；
  dsh 以"适配器进执行器池"形态纳入（中度形态已评估可行，headless 已验证，
  见 dsh-plugin 文档）。每个 adapter 一个 Goal 或一个 Goal 内分 stage。
- **A2 专属武器矩阵**：capability scan（cc-switch 只读、env、curl 探测）产出
  model×harness 适配度数据（专属/普适/可用/UNKNOWN 四档），父级按任务类型自动排序
  候选犬。对应 inspiration 文档"模型路由自动档"缺口。
- **A3 换犬一键化**：把 Directive 12 式手工 rebind 收敛为单命令（自动 epoch 递增 +
  审计回执保留，去掉 owner 批示环节；跨 Goal/花钱操作仍走 HUMAN HOLD）。
- **A4 双模式**：默认轻量 loop（预授权边界内父级自主派发审核，对应 STANDING-BOUNDED-B
  思路）；RED 级任务才启用全回执仪式。

### Phase B：驾驶舱（可视化 + 一键启动）

- **B1 只读看板**：todos/dashi 共同指向的最高性价比缺口。聚合 Goal/lane 文件与
  events JSONL，呈现犬队状态（谁在拉、拉到哪、等谁审）、epoch 链、预算消耗。
  可复用本项目现有 Vue3+TS 前端加一个 tab，数据源即 append-only 回执（零新状态）。
  借鉴 dashi 语义：任务认领（claim）、版本冲突、**用户显式接受才 done**（与现有
  "Sol 不自行写 DONE" 哲学一致）。
- **B2 一键启动**：自然语言 Goal 路径→launch contract 的入口封装。
  `start-goal-orchestrator.ps1` 已具备主体，缺的是 UI 入口 + 推荐矩阵展示
  （A2 产物）+ 一次自然语言确认（Goal-010 冻结契约第 2 条已有此语义）。
- **B3 VS Code 终端镜像已有**（Goal-010 已验收），看板与它互补而非替代。

### Phase C：记忆与直连（后置）

- **C1 符号化记忆**：借鉴 TencentDB-Agent-Memory"符号画布 + node_id 取回 + 证据
  下钻"三件套，压缩 268KB manifest 级 checkpoint 的上下文成本（回应 token 消耗大）。
- **C2 成员直连消息**：评估 dsh-agent-teams 的"无队长中转"模型是否适用于
  executor 间协作（现全走 parent 中转，可能过度）。
- **C3 loopx 深读**：状态内核与本项目 epoch/checkpoint 同题，待对比。

## 3. 参考项目映射

| 提案项 | 参考来源（意见仓库已评估） |
| --- | --- |
| B1 看板 | todos.dev 看板聚合、dashi claim/version/评审流 |
| A2 路由矩阵 | todos 泳道内模型档位路由 + 本项目 model_profile 设计 |
| C1 记忆 | TencentDB-Agent-Memory（不装，仅架构参考） |
| C2 直连 | dsh-agent-teams、agent-teams 协议 |
| A1 dsh 适配 | dsh 插件文档"中度形态"结论 |
| C3 状态内核 | loopx（待深读） |

## 4. 风险与边界

- **中转脆弱性**（本周实证）：专属 harness 依赖第三方中转会整体瘫痪；fallback 顺序
  （Goal-010 已内置 pi→codex→claude→opencode 有序替换）是正确设计，路由矩阵须保留。
- **Windows native 约束**：Qwen-MM 类 WSL2 方案暂缓；dsh Python SDK 评测路径不支持
  Windows（headless 可用）。
- **治理不放松**：轻量模式只减仪式不减审计；证据 append-only 与哈希锚点不破。
- **费用**：沿用 per-actor USD cap 与 admission 门；轻量模式需定义新的预算边界。
- 本提案不改变 RM-065 CURRENT 状态，不创建 Goal，一切以 owner 后续决策为准。

## 5. 建议的推进方式

1. owner 审阅本提案，圈定 Phase A/B 取舍；
2. Sol 通道恢复（tbtk 修复）后走 to-spec 流程升格为 RM 候选；期间可先用轻量方式
   验证 A2 的 capability scan 数据格式；
3. B1 看板可独立先行（只读、零治理风险、复用现有前端）。

## 6. 2026-08-15 增补：owner 决策意向——独立工作区拆分

owner 于 2026-08-15 明确：本目标（跨 harness 协作工具）与意向项目（认知工作台）
是两个主体，可各开独立工作区。理由与处置：

- 桥是服务任意项目的通用工具，不应住在某个被管理的工作区内部；雪橇队 Phase A/B/C
  的建设应在新仓库进行，dashboard 成为桥自己的产品界面。
- 本周实证痛点支持拆分：path-limited 提交需绕行 ~275 行无关脏工作区；GitNexus 对
  PowerShell 桥符号索引无效；两者验证门与节奏不同频。
- 迁移次序（关键约束）：① Sol 事后审计先完成（审计哈希锚定当前路径，拆分前必须
  闭环）+ INDEX/BOARD 收口；② 建新仓库，本提案升格为其首个 RM，治理采用
  A4 双模式；③ 代码以 manifest+哈希清单可逆搬移，意向项目侧 archive 冻结不动；
  ④ orchestrator workspace-root 参数化，与具体工作区解绑；⑤ 终极验收为 dogfood：
  用桥管理桥自身的开发。
- 意向项目拆分后成为桥的普通消费者，其 AGENTS.md 删减桥相关条款；本提案文档
  随首个 RM 迁入新仓库。
