# 实现前基线复跑与在途改动批次地图（2026-10-01）

> 修订（2026-10-01 第二版，按 owner 复核）：§1 补基线日志证据入口与 +24 用例归属；§2 B6 及批次注记改写；§3 取消能力判断改写（默认路径未接线）；§4 #3/#7 表述修正。

性质：只读侦查 + 本文档。未提交、未推送、未发起真实模型派发、未改任何业务代码；测试经 `tests/setup.ts` 隔离运行。HEAD 仍为 `e1b61bf`（2026-08-29）。
边界声明：本盘点只描述当前工作树相对 HEAD 的变更状态，不推断 9 月工作的全部去向，也未联网核查远端。

## 1. 基线复跑结果（2026-10-01 实测，全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 0 类型错误 |
| `npm.cmd test`（共享进程 + setup.ts 隔离） | 734/734 pass，约 61s |
| `npm.cmd run test:isolated` | 734/734 pass，约 23s |
| `node --import ./tests/setup.ts scripts/g076-board-regression-baseline.cjs` | 7/7 |

对比 GOAL-083（09-05）记录的 710：现多 24 个，无失败项。GOAL-083 记录的"实际失败项"在今天不复现，基线可视为已恢复。GOAL-084 第一片及 owner 复核轮落地后：749/749 × 2（见证据入口）。

**证据入口**：`.test-fixtures/baseline-2026-10-01/`。首轮存档 `npm-test.stdout.log`（sha256 `989d6e4d…273b7b0`）与 `test-isolated.stdout.log`（sha256 `65dcf6e6…2ec8af`）**为输出末段与汇总（当时命令经 tail 截断，非完整原始输出）**；GOAL-084 复核轮后补完整输出：`npm-test-full-2026-10-01b.stdout.log`（749/749，sha256 `f592a721…6798b`）、`test-isolated-full-2026-10-01b.stdout.log`（749/749，sha256 `d23d43f6…027f`）。g076 基线与 typecheck 为短输出未留档；上表四条命令当轮均 exit 0。

**+24 用例归属**（698=HEAD e1b61bf 记录，710=G083 回执快照，719=验收文档记录的当日终态）：
- 710→719：+9 = `tests/core-browser-flow.test.ts`（7）+ `tests/g077-onboarding.test.ts`（2），与验收文档 719/719 对账吻合；
- 719→731：+12 = `tests/dispatch-cancel.test.ts`（3）+ `tests/liveness-realspawn.test.ts`（4）+ `tests/workspace-intent-select.test.ts`（5）；
- 731→734：+3 = 既有测试文件内的净增用例（**推断**，未逐文件清点；新文件计数均为本轮实测）。

## 2. 批次地图（按建议审阅/落库顺序；提交与推送另行处理）

| 批 | 主题 | 主要文件 |
| --- | --- | --- |
| B1 | 文档对账机检与簿记（不含 DECISIONS.md） | scripts/docs-reconcile.cjs；docs/goal-pool.md（24 处 done→AUTO_ACCEPTED 规范化）；goals/GOAL-014/018/019/020/021/022/023/024/025/026/027/043–055 状态行；AGENTS.md 精简重写；CLAUDE.md（指针）；docs/project-handoff-2026-09-05.md |
| B2 | GOAL-083 测试隔离与回归基线 | tests/setup.ts；package.json（test 入口）；tests/g068、pi-rpc-edge-cases、harness-doctor-multiprovider、harness-provider-hierarchy、g026、g070；tests/fixtures/{opencode,ccswitch,test-env-report.cjs}；goals/GOAL-083* + 回执；README.md 开发验证节 |
| B3 | 陈锁补丁（9 月前遗留，083 收编核验） | src/web/persistence.ts（进程名+端口三重校验）；scripts/board-up.ps1；tests/persistence.test.ts；tests/fixtures/lock-process.*、board-launcher-probe.ps1 |
| B4 | D83 聊天直通（v1.47） | src/web/chat.ts（originOwner 部分）；tests/fixtures/chat-approval.ts；g012b、g021a、g029、g075；api-contract.md v1.47 节 |
| B5 | 09-05 核心流程浏览器验收修复（v1.46） | src/web/page.ts 主体；chat.ts（状态落盘/失败重试部分）；server.ts（审批异步部分）；api-contract.md v1.46 节；web-server.test.ts；g018b；docs/operations/core-browser-acceptance-2026-09-05.md |
| B6 | D84 派发停止按钮（v1.48；默认通道接线缺口已由 GOAL-084 §3.2 补齐） | src/web/dispatch.ts（cancel/registerKill/INTERRUPTED）；src/adapters/t1-runner.ts；server.ts cancel 路由；page.ts 停止按钮；chat.ts 中断文案；tests/dispatch-cancel.test.ts；api-contract.md v1.48 节 |
| B7 | D85/D86 工作区数据面（v1.49/v1.50） | dispatch.ts（selectWorkspace/dataRoot/centralWorkspaceDataDir）；server.ts 热切换分支；tests/workspace-intent-select.test.ts；web-dispatch.test.ts；api-contract.md v1.49/v1.50 节 |
| B8 | 09-06 实弹审计修复（Windows 探针/档位注入） | src/core/liveness-ladder.ts（PATHEXT 解析 + .cmd shell 拉起）；src/adapters/agy.ts（--effort 先于 -p）；tests/liveness-realspawn.test.ts；tests/adapters-agy.test.ts |
| B9 | GOAL-077 最小切片（引导诚实化；Goal 仍 PROPOSED） | src/core/onboarding.ts；tests/g077-onboarding.test.ts；tests/g081-silk.test.ts；server.ts first_task；page.ts 横幅 |
| B10 | 决议与回执留痕 + GOAL-084 前置 | DECISIONS.md（D83–D87 追加 + 对账重构）；goals/receipts/approval-requests/（09-05/06 实弹 D30 审批对 ×6）；goals/GOAL-084*；docs/research/（09-05 编排调研、09-27 能力核查）；board-01~06-*.png（**待定**，见登记 #7） |

### 跨批文件（一个文件叠多批，file 级拆分不可行）

dispatch.ts（B6+B7）、chat.ts（B4+B5+B6）、server.ts（B5+B6+B7+B9）、page.ts（B5+B6+B9）、api-contract.md（B4–B7 五节）、package.json（B1+B2）、web-dispatch.test.ts（B5+B7）、g012b（B4+B5）、core-browser-flow.test.ts（B4+B5）、DECISIONS.md（B10 承载多流内容）。

建议：按批序审阅，混合文件归属其主导批——**仅为审阅便利，不保证每批独立可运行**（如 B5/B7 的测试引用 B2/B4 的 fixtures 与 setup 入口）；实际提交时按依赖排序（fixtures/setup 先于引用方），必要时允许合并批。换行符（LF/CRLF）造成 DECISIONS.md/AGENTS.md 呈整文件重写形态，diff 膨胀属预期，审阅时以语义为准。

## 3. GOAL-084 将用到的接口面现状（工作树实况）

- **派发入口**：`src/web/dispatch.ts:991` `dispatch(input, internal)`，internal 可携带 `originOwner`、`chat:{session_id,solo}`、预生成 dispatchId、`onStdout` 流式钩子；`:1662` `rerun` 同样透传 internal。受控会话派发可直接复用该通道。
- **D30 门与审批**：`dispatch.ts:1338-1356`——`real && originOwner!==true` 时消费一次性令牌，失败即建审批卡 + `BLOCKED_WAITING_OWNER`；审批响应 `server.ts:707`（handler :536-570），聊天内联卡 `page.ts:3051-3095`。当前授权粒度=每卡一单；D87 的"一次会话授权快照"**尚无任何实现**，GOAL-084 §2.3 明确新机制接通前 D30 旧门有效、不得借 originOwner 绕过。
- **聊天现状（D83 已生效）**：`chat.ts:283` `originOwner: true`——普通聊天受理即执行，豁免 D30 逐单审批；保留通道预检门、预算 cap/资金门、计划门；internal 不来自 HTTP body，外部请求不可伪造。看板/CLI 非聊天真实派发仍逐单审批。注意 api-contract v1.46 与 v1.47 语义相反（登记 #1），以 v1.47/D83 为准。
- **取消（缺口已于 2026-10-01 补齐）**：管线侧机制完备——`dispatch.ts:1725` `cancel(dispatchId)`（标记 cancelRequested→INTERRUPTED，不判 FAIL/不计熔断）、`server.ts:1045-1063` 端点、page.ts 停止按钮；`RunAdapterFn` 类型含 `registerKill`（:314），管线调用处也传了（:1468-1478）。原缺口（默认 runAdapter 未向 runT1/claude 透传句柄）已随 GOAL-084 §3.2 修复：runT1 分支透传 registerKill（t1-runner 本已支持）、claude.ts 新增 registerKill 支持并在 spawn 后注册树杀句柄；`tests/g084-default-runner-cancel.test.ts` 以真实 spawn fixture、零注入证明默认路径可取消（红灯证据：接线摘除时 pipeline cancel 报 "no killable child process"、claude 句柄不注册挂满 60s）。pi-rpc 会话型契约外（D84 如实 409）不变。
- **工作区**：`dispatch.ts:539` `centralWorkspaceDataDir`（宿主 runtime/workspaces/<slug>-<hash8> 确定性派生）、`:2480` selectWorkspace（D85 仅拒 .agent-bridge）；`server.ts:373-437` 热切换接线。GOAL-084 §2.1 的黑板 SQLite 可落该 dataRoot；会话绑定工作区需自行在会话记录钉 workspace_root（快照/SSE 已携带该字段）。

## 4. 范围外问题登记（只登记，不顺手修）

1. **api-contract v1.46 与 v1.47 语义相反且无取代标注**（已亲自核实）：v1.46 写"聊天与重试均须 D30 单次审批"，v1.47（次日）写聊天豁免。docs-reconcile 只机检版本号，不校验节间矛盾。建议后续在 v1.46 加一行"聊天部分被 v1.47 取代"。
2. **契约 v1.48 与实现小偏差**（agent 报告）：契约写 cancel 响应 `status:'ADMITTED'`，实现 `server.ts:1061` 返回 `record.status` 实际值。
3. **persistence.ts 保守锁策略是已知取舍**（表述修正）：`isProcessReallyActive`（persistence.ts:434-441）先做 `processAlive` 纯信号检查——**死 PID 无需外部工具即可判失效、陈锁正常接管**；tasklist/netstat/ss/lsof 的 fail-safe 只影响"PID 存活但进程类型/端口归属无法确认"的分支，此时按存活处理（保守保留锁，避免抢占活实例造成双开）。仅当检查工具长期不可用且恰有此类锁时才会滞留，不构成 GOAL-084 阻塞项。
4. **board-up.ps1 对旧格式锁的回归风险**（agent 报告）：case 1 要求锁含 port 字段；旧版无 port 锁落到 case 2，端口被占时 15s 后报 board 未起。
5. **liveness-ladder defaultSpawn 的 shell 引号拼接**（agent 报告）：needsShell 时 args 经 shell 解释；当前 args 全来自静态适配器合同，风险低，未来并入用户输入则成注入面（文件内已有注释）。
6. **AGENTS.md 重写幅度大**（agent 报告）：硬红线清单移出注入入口，红线密度下降，现依赖 CONSTITUTION/DECISIONS；是否符合预期由 owner 复核。
7. **board-01~06-*.png 来源待核验**（已补内容核验）：6 张为当前工作树看板六视图巡礼（对话/实验室/犬队/洞察/治理/基准，均为空会话、未选工作区、无在途派发），与 09-05 验收证据清单（`.test-fixtures/core-flow/`，7 项修复对应截图）不匹配；mtime 09-23 与 D87 黑板方案讨论同期，**推断**为该轮讨论的看板现状留档。内容核验不能证实拍摄者与用途，入库前请 owner 确认去留。
8. **D82 编号缺口已登记但引用仍在**：KNOWN_GAPS 含 D82，而 docs/rm-011 等继续引用未定义编号，属已登记簿记债，待 owner 补录依据。
9. **pi-rpc-completion-state-machine 间歇失败（2026-10-01 登记）**：`tests/pi-rpc-completion-state-machine.test.ts:281`（"complete outer json fence…"）在独立进程全量中间歇失败（截至当日晚：三次中出现两次；stderr=Managed Pi RPC fail-closed: agent-settle-timeout），单文件运行与共享模式恒绿。**根因尚未确认：并行负载是待验证假设，本轮改动的影响尚未排除**；未顺手修，建议独立处理。
