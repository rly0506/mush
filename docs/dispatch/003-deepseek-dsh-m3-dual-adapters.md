# 派发包 003 — DeepSeek/dsh 执行 MUSH-GOAL-003（M3 双犬适配器 + CLI 化）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的完整任务包。
自主会话适用：无人应答，按包自主推进；所有疑问记 findings，不要等待。

## 第一步：按序读取（都在 D:\mush 内）

1. `AGENTS.md` — 工作区指引与硬红线（D19 远端例外、D15/D16 常备规则）
2. `CONSTITUTION.md` — 治理（轻量档 + 五类触发门）
3. `DECISIONS.md` — 重点 D5（合同语言无关）、D6（半自动/花钱确认）、D13（身份
   fail-closed + UNKNOWN 诚实记录）、D19（私有远端）、D20（实测注册）、D21（CLI 三级路线）
4. `goals/GOAL-003-m3-dual-adapters.md` — 你的 Goal（任务/范围/DoD/边界）
5. `docs/capability-probes/harness-landscape-2026-08-16.md` — 通道选档预探测结论
   （T1 单发 headless 为通用底座；claude stream-json；pi `--mode rpc` 已由
   src/core/pi-rpc-* 覆盖）
6. `docs/auto-decisions-log.md` — 已裁决事项（勿重做）

现有代码底座：`src/core/`（事件日志/epoch/lease/身份/能力注册/预算/pi-rpc 全套）、
`src/schema/`、124 tests 全绿基线。

黄金参照（**只读**，`D:\意向项目\.agent-bridge\`）：
`invoke-managed-pi-agent.ps1`、`BridgePiAdapter.psm1`、`start-goal-orchestrator.ps1`
等为合同与实现参照（重写，不照搬）。

## 工作队列（严格按序，一个单元完成并提交后才进下一个）

- **U1 适配器框架**（`src/adapters/`）：D5 合同 = `{adapter_id, executable,
  arguments, protocol, prompt_transport}`；T1 单发 headless + 文件落盘回报为通用
  底座；协议档位 `t1 | pi-rpc | stream-json` 枚举与选档校验。TDD：fake 子进程
  fixture（不依赖本机 claude/pi），断言 stdout/stderr/exit code/回报文件/超时
  fail-closed/身份断言。
- **U2 DeepSeek 犬**（经 pi/dsh）：复用 `src/core/pi-rpc-*` 与 `src/core/pi-adapter*`；
  实现 `DeepSeekAdapter`（dsh `--profile headless` 或 pi `--mode rpc` 二选一配置）。
  执行 **nonce 身份探测**（探测属 Goal 明文"不花钱部分"）：本地生成 nonce →
  headless 一句求值 → 回值比对 + 磁盘证据落盘（写 D:\mush）；fail-closed 断言
  进测试。真实有界 dispatch 验收见 U-REAL（**花钱，待 owner 确认**）。
- **U3 Claude Code 犬**：`claude -p --output-format stream-json` T2 通道解析器
  （以录制/fake JSON 流为 fixture，不跑真实长任务）；`ClaudeAdapter` +
  nonce 身份探测同 U2。真实 dispatch 同 U-REAL。
- **U4 D20 实测能力注册**：cc-switch provider 目录**只读枚举**（只列 provider
  名，不打开凭据文件、不复制、不打印任何密钥）；逐 provider `/models` 探测仅在
  探测进程内临时使用密钥，结果只落 capability record（model/强度档位字段）；
  探测不了的全部诚实记 UNKNOWN。本单元配套 fake-provider 测试保证注册语义。
- **U5 D21 CLI 化**：`bin/mush`（零依赖 node 入口）+ `--workspace` 参数贯通；
  最小命令集 `status` / `dispatch` / `review`。实测：本仓 + 至少一个非 mush
  工作区目录（只读）上跑 `status`。
- **U6 预算记账接入**：真实/模拟 dispatch 都过 GOAL-002 `UsdBudgetLedger.admit`，
  per-actor cap 超限 DENIED 且事件留痕；fake runner 与测试证明"先 admit 后执行"。
- **U-REAL 真实 dispatch 验收**（每犬一次，有界）：
  - 若 `goals/receipts/` 存在 owner 对 D6 的确认记录 → 执行并留事件链；
  - 否则 **不执行**，在 GOAL-003 完成回报中单列 `BLOCKED_WAITING_OWNER`，
    其余单元不受阻。本包假定默认无确认。

## 每单元纪律（不可省略）

- 小步：一次一个批次；TDD 红→实现→全绿；
- 既有 124 tests 必须保持全绿（回归即缺陷）；
- 提交：path-limited（禁 `git add -A`），commit 信息含单元号；commit 前
  `git diff --cached --check` 必须过；
- 回报：每批 `goals/receipts/BATCH-NN-completion.json`（changed_paths、真实测试
  输出摘要、黄金源/探测源追溯、open_findings、花费估算）；
- 诚实：测试输出必须真实执行所得；断言语义不得弱化；探测结果 UNKNOWN 就写
  UNKNOWN，不补全；
- 完成语义（D15）：机检全绿 + 回报落盘即 `AUTO_ACCEPTED`，不等待 owner；
  不得自称 DONE。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 绝对只读；
- 零依赖：不引入任何 npm 依赖（确需→记 finding 停该项）；
- cc-switch 只读（D20）：凭据文件不打开、不复制、不入日志/prompt/测试输出；
- 真实花钱 dispatch：必须已有 owner 确认记录（D6）；per-actor cap $5，接近即停；
- 不删文件（`.test-fixtures/` 再生物除外，按 D16 先清单+哈希后清）；
- 远端：D19 授权 `git push origin master`（私有 rly0506/mush）每单元收尾尝试
  一次；失败不阻塞（记 finding，本地 commit 为准）；
- 同一错误连续失败 3 次：停该项记 finding，转下一个独立单元；
- 五触发门照常生效。

## 终止条件（任一满足即收尾）

队列全部完成（U-REAL 按上节规则处置）/ 预算逼近 / 只剩被 finding 阻塞的项。
收尾动作：写 `goals/receipts/GOAL-003-SUMMARY-2026-08-17.md`（完成清单带 commit
哈希、未完成与原因、全部 findings、总花费估算、给头犬的建议）。
