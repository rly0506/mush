# 派发包 004 — DeepSeek/dsh 执行 MUSH-GOAL-006 + MUSH-GOAL-008（并行）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的完整
任务包，覆盖两个并行 Goal。自主会话适用：无人应答，按包推进，疑问记 findings。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md` → `DECISIONS.md`（重点 D15–D22）
2. `docs/rm-002-mobilization.md` — 本阶段路线图（含 API 契约 v1 骨架附录）
3. `goals/GOAL-006-board-backend-dispatch.md` — Goal A（看板服务端+派发管线）
4. `goals/GOAL-008-adapters-expansion.md` — Goal B（codex/opencode/zcode headless）
5. `docs/auto-decisions-log.md` — 已裁决事项（AD-01..16，勿重做）
6. 现状底座：`src/web/`（GOAL-005 交付）、`src/adapters/`、`src/core/budget.ts`

## 执行顺序（关键）

1. **先交付 API 契约 v1**（`src/web/api-contract.md`）——GOAL-007（kimi 前端）
   在等它开工，这是全局关键路径，第一优先。
2. 契约落盘后两个 Goal 交替推进（每边一个小批次轮换，commit 信息标 G6-*/G8-*）；
   文件面不相交（A 限 src/web/+src/cli.ts；B 限 src/adapters/）。

## 工作纪律（两 Goal 通用，不可省略）

- 小步 TDD；既有 199 tests 保持全绿；
- path-limited commit（禁 git add -A）；commit 前 `git diff --cached --check`；
- 每批 `goals/receipts/BATCH-NN-completion.json` + 真实测试输出；
- D15：机检全绿回报落盘即 AUTO_ACCEPTED，不等待 owner；
- push origin master 常规同步，失败不阻塞（本地为准）。

## Goal B 特别条款

- codex/opencode nonce 探测**预授权已给**（D22，每犬一次有界）：
  正常跑；渠道异常（403/欠费/无凭据）记 finding 停该项，不烧第二次；
- 凭据红线：adapter 只调 executable，不读/不存/不注入任何密钥；
  CLI 凭据由 cc-switch profile 自理；
- zcode headless 三关（--json/EPERM/SQLite）：每关 ≤3 次失败即停记 finding，
  交互式在册不受影响，不阻塞其他项。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 绝对只读；
- 零依赖（确需→finding 停该项）；per-actor cap $5；
- 不删文件（可再生物按 D16 先清单后清）；五触发门照常。

## 终止条件

两 Goal 全部完成并各自 completion.json 落盘 / 预算逼近 / 仅剩 finding 阻塞项。
收尾：`goals/receipts/G006-G008-SUMMARY-<date>.md`（含两 Goal 完成清单、
findings、花费、给头犬的建议）。
