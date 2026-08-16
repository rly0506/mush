# 派发包 004 — DeepSeek/dsh 执行 MUSH-GOAL-004（M4 dogfood 首个 live loop）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的完整任务包。
自主会话适用：无人应答，按包自主推进；所有疑问记 findings，不要等待。

## 第一步：按序读取（都在 D:\mush 内）

1. `AGENTS.md`（D19 远端例外、D15/D16 常备规则、M1–M3 状态）
2. `CONSTITUTION.md`（五类触发门，尤其门 1 预算/门 5 凭据）
3. `DECISIONS.md`（D4 dogfood 自举、D6 半自动确认、D17 队列自续）
4. `goals/GOAL-004-m4-dogfood-live-loop.md`（你的 Goal）
5. `goals/receipts/GOAL-003-*-ADDENDUM*`、`dispatch-events/*.json`（上轮结论：
   真实 dispatch BLOCKED_ENV；owner 已确认 M3，approval 在仓）
6. `docs/auto-decisions-log.md`（AD-10：GOAL-003 AUTO_ACCEPTED；model_id 需 nonce
   实测覆盖——本 Goal 任务 3）

现有底座：`src/core`（事件链/状态机/lease/预算）、`src/adapters`（dsh/claude/
T1/stream-json/能力探测）、`bin/mush` CLI、158 tests 全绿。

## 当前前置状态（owner 侧，mush 不代做）

- 凭据：`DEEPSEEK_API_KEY` 缺、claude 未 `/login` → 真实 dispatch 记 BLOCKED_ENV；
  任一就绪后先重跑 GOAL-003 dispatch 闭环（approval 已在
  `goals/receipts/dispatch-approvals/`，无需再确认）。
- 首任务一句话（D6）：(a) M5 看板开发启动 / (b) M3 剩余适配器接入（zcode 预探测
  已就绪）。未选定时不花钱准备先行，真实 loop 记 BLOCKED_WAITING_OWNER。

## 工作队列（严格按序，一个单元完成并提交后才进下一个）

- **U1 loop 骨架**（`src/loop/`）：半自动调度状态机
  `SCAN → RECOMMEND → CONFIRM(owner) → DISPATCH → EXECUTE → REPORT →
  REVIEW → ACCEPT`，非法迁移 fail-closed；每一步产生 append-only 事件
  （哈希链锚点，可回放）。TDD 先行，不与真实花钱耦合。
- **U2 扫描与推荐 + 确认门**：`scanNextTask` 读 Goal 候选并输出 RECOMMENDATION
  事件；无 owner 确认记录时停在 CONFIRM 并输出 WAITING_OWNER（不虚构确认）。
- **U3 头犬机检审核门**：`machineReview` 按机器规则审 receipt（exit 0、
  timed_out=false、identity_fail_closed=false、哈希锚点可验、nonce 实测在案），
  输出 PASS/FAIL 事件；FAIL 不得进 ACCEPT。
- **U4 对调实验骨架**：角色交换 `{head: claude-code, executor: deepseek-dsh}`
  与 ROLE_SWAP 事件；真跑需凭据，骨架与事件链先行。
- **U5 dispatch 闭环前置检查器**：读取 approval/凭据/PASS 证据状态，
  输出 `READY | BLOCKED_ENV | BLOCKED_WAITING_OWNER`（诚实，不碰凭据内容）。
- **U6 触发门机制真实验证**（RM DoD 要求）：预算门 `ApprovalGate`——
  admit 超 cap 时发出 `APPROVAL_REQUEST` 事件并写
  `goals/receipts/approval-requests/`，状态 WAITING_OWNER_APPROVAL；
  先 TDD 后真触发一次小额场景，留证据等 owner 应答。
- **U-REAL 真实 loop**：凭据就绪 + owner 首任务确认后执行派发→执行→回报→
  审核→验收闭环；两犬 nonce 实测覆盖 model_id；头犬/执行犬对调一次。当前
  前置未满足 → 单列 BLOCKED，不虚构。

## 每单元纪律（不可省略）

- 小步 TDD：红→实现→全绿；既有 158 tests 必须保持全绿；
- 提交 path-limited（禁 `git add -A`），信息含单元号；commit 前
  `git diff --cached --check` 必须过；
- 每批 `goals/receipts/BATCH-NN-completion.json` + 真实测试输出摘要；
- 诚实：测试输出必须真实执行所得；失败/阻塞照实记录；
- D15 验收语义：机检全绿 + 回报落盘 = AUTO_ACCEPTED，DONE 归 owner；
- D19：每单元收尾 `git push origin master` 尝试一次，失败不阻塞（本地为准）。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 绝对只读；零依赖不变；
- 不碰凭据（门 5）：不代登录、不代设密钥、不打印密钥；缺凭据记 BLOCKED_ENV；
- per-actor cap $5，真实花钱前核对 approval 记录在案；
- 五触发门照常生效；同一错误连续失败 3 次：停该项记 finding，转下一独立单元。

## 终止条件（任一满足即收尾）

队列全部完成（U-REAL 按前置状态处置）/ 预算逼近 / 只剩被 finding 阻塞的项。
收尾动作：写 `goals/receipts/GOAL-004-SUMMARY-2026-08-17.md`（完成清单带
commit 哈希、未完成与原因、全部 findings、总花费估算、给头犬/owner 的建议）。
