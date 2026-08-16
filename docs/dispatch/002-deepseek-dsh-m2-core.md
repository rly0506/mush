# 派发包 002 — DeepSeek/dsh 执行 MUSH-GOAL-002（M2 核心移植）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的完整任务包。
自主会话适用：无人应答，按包自主推进；所有疑问记 findings，不要等待。

## 第一步：按序读取（都在 D:\mush 内）

1. `AGENTS.md` — 工作区指引与硬红线（注意 D19 远端例外与 D15–D18 常备规则）
2. `CONSTITUTION.md` — 治理（轻量档 + 五类触发门）
3. `DECISIONS.md` — 重点 D15–D21（D20 能力注册实测原则、D21 封装路线不在本 Goal 范围）
4. `goals/GOAL-002-m2-core-port.md` — 你的 Goal（任务/范围/DoD/边界）
5. `goals/receipts/OVERNIGHT-2026-08-16-report.md` — 上轮交接（基线 91 tests 全绿）
6. `docs/auto-decisions-log.md` — 已裁决事项（F-01..F-09 勿重做、勿再上报）

黄金参照（**只读**，`D:\意向项目\.agent-bridge\`）：

- `runtime/orchestrator/RM065-GOAL-010-epoch21..50/` 各 epoch run root
  （`state.json` + `events/`）— 影子回放数据源（U4 用）
- `tools/tests/*.tests.ps1` — M1 已移植，语义参照
- `BridgePiAdapter.psm1`、`invoke-managed-pi-agent.ps1`、`start-goal-orchestrator.ps1`
  等 — 合同与实现参照（重写，不照搬）

现有代码底座：`src/schema/`（U4 已落的事件/状态/epoch 类型）、`tests/`（91 tests）、
`tests/support/`（M1 语义参考件）。

## 工作队列（严格按序，一个单元完成并提交后才进下一个）

- **U1 事件日志与 epoch 状态机**（`src/core/`）：事件 append-only + 哈希链锚点、
  sequence 单调、epoch 推进。TDD：先写测试（红）再实现；对照 `src/schema` 既有
  类型与 epoch50 fixture（`tests/fixtures/replay/`）。
- **U2 lease 与身份**：授予 / 重绑 / 恢复 / 过期；运行时身份 fail-closed（不符即停）。
- **U3 能力注册与预算记账**：capability record（含 D20 的 model/思考强度档位字段
  ——本单元只做**结构与 fake-provider 测试**，不做真实 cc-switch 探测）；
  per-actor cap + admission 门事件化记账。
- **U4 影子回放**：epoch21–50 事件流复制入 `tests/fixtures/replay/`（带 SHA-256
  清单；源只读）；回放断言新实现对外可观察行为与黄金记录一致。
- **U5 收口**：`tests/support/` import 切到 `src/`（行为不变、断言不弱化）；
  `npm test` 全绿；写 `goals/receipts/GOAL-002-completion.json`。

## 每单元纪律（不可省略）

- 小步：一次一个批次；TDD 红→实现→全绿；
- 已有 91 tests 必须保持绿（回归即缺陷）；
- 提交：path-limited（禁 `git add -A`），commit 信息含单元号；commit 前
  `git diff --cached --check` 必须过；
- 回报：每批次 `goals/receipts/BATCH-NN-completion.json`（changed_paths、真实测试
  输出摘要、PS 源行号追溯、open_findings、花费估算）；
- 诚实：测试输出必须真实执行所得；断言语义不得弱化；PS5.1 补丁类用例移植
  "意图"并注释注明；
- 完成语义（D15）：机检全绿 + 回报落盘即 `AUTO_ACCEPTED`，**不等待 owner**；
  不得自称 DONE。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 绝对只读；
- 零依赖：不引入任何 npm 依赖（确需→记 finding 停该项）；
- 预算：per-actor cap $5，接近即停并回报；
- 不删文件（`.test-fixtures/` 可再生物除外，按 D16 先清单+哈希后清）；
- 远端：D19 已授权 push `origin master`（github.com/rly0506/mush，私有）为常规
  同步动作，每单元收尾 push 一次；失败不阻塞（记 finding，本地 commit 为准）；
- 同一错误连续失败 3 次：停该项记 finding，转下一个独立单元；
- 五触发门照常生效（花钱超标 / D19 例外之外的外部影响 / 不可恢复删除 /
  范围扩张 / 身份密钥）。

## 终止条件（任一满足即收尾）

队列全部完成 / 预算逼近 / 只剩被 finding 阻塞的项。
收尾动作：写 `goals/receipts/GOAL-002-SUMMARY-2026-08-17.md`（完成清单带 commit
哈希、未完成与原因、全部 findings、总花费估算、给头犬的建议）。
