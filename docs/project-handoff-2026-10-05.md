# mush 交接（2026-10-05 · GOAL-085 隔离补证 + 首次真实验收）

> 读者：接手本轮工作的下一个 agent。**先读 [AGENTS.md](../AGENTS.md) 与 [CONSTITUTION.md](../CONSTITUTION.md)**；
> 本文件只记录本轮做了什么、现在是什么状态、还差什么。**状态以代码与实测为准，本文件是当日证据。**
>
> 本轮 owner 的关键裁定已入库：[DECISIONS.md](../DECISIONS.md) 的 **D93 / D94 / D95**；行为契约见 [src/web/api-contract.md](../src/web/api-contract.md)（**v1.63**）。

## 0. 一句话状态

- **Claude 席位五维隔离证据已登记并读回通过**（`tool_scope` D93 + 其余四维 D94，各四条独立来源）。
- **第一场正式验收（Codex＋Claude 双模型）已跑通**：会话 `4a77b7b5-…` `completed`，7 次调用全 PASS，CLI 申报费用 **$0.169489**（授权 $4.00，未触发刹车）。
- **第二场（Codex＋agy＋Claude 三模型）未启动**：卡 `2d082857-…` 仍 `pending_approval`，**预算待 owner 另议**。
- **一个必修缺口**：D95 的版本漂移接受事实**没落进持久化派发记录**（详见 §4.1）。
- **讨论结论本身尚未由 owner 验收**；两场只验证真实协作链路 + 所提供材料，**不构成 GOAL-084 全量源码审计**。

## 1. 运行面（本轮实测）

| 项 | 值 |
| --- | --- |
| 工作区 | `D:\mush`（Node ≥24 / TypeScript，`npm.cmd`） |
| 看板 | `http://127.0.0.1:4790`，**PID 30388**（本轮热重载 26672 → 6496 → 33260 → 30388） |
| 讨论档案 | 已激活：claude `5b5096e9…`、codex `8194bb67…`、agy `05c2a65b…`（重载后必须重新激活） |
| 熔断 | `runtime/unattended-breaker.json` → `halted=false`、连续失败 0 |
| 预算上限 | `/api/budget/caps` → codex 5、claude-code 5、**agy 3（本轮按 owner 指令新设）**、其余同前 |
| 在途 | 无（`scripts/scan-inflight.ps1` 干净） |

## 2. 本轮完成的四件事

### 2.1 五维隔离证据登记 + 独立读回（D93 / D94）

- 零付费原生隔离实验产物（真实 CLI + 本地假后端 + 合成凭据 + 隔离数据根）：
  `evidence.json` `29ca8e83…`（工具面）、`evidence-write-coverage.json` `2ce13840…`（写入/工作区外/入口/持久化）、`evidence-mcp-and-userctx.json` `e25f6330…`（哑 MCP、用户级上下文）。
- 登记脚本：`.test-fixtures/g085-claude-native-isolation-2026-10-05/register-claude-tool-scope.mjs`（D93）与 `register-claude-remaining-dimensions.mjs`（D94，登记前逐项校验产物 + 指纹等价 + argv 一致，任一不符即拒）。
- 独立读回（`node --import ./tests/setup.ts .test-fixtures/g085-codex-seat-behavior-2026-10-04/check-seat-admission.mjs`）：
  **codex 五维、claude 五维全 `live_verified`，agy 仅 `mcp_scope`**，反例均 0。
- 边界（D93/D94 原文）：证据**只属各席位当时冻结的严格指纹**，不外推到其他模型/版本/变体/企业配置；模型是本地假后端，只证明 CLI/宿主侧行为。

### 2.2 待批投影修正（契约 v1.62）

- 会话进入终态后其授权卡不再计入"待批"：`/api/snapshot` 的 `approvals[]` 新增状态 **`SESSION_TERMINAL`** + `session_terminal_status` + `stale_reason`；**不删卡、不写应答、不伪造决定**。
- 落点：`src/web/sources.ts`（`collectApprovals` 增只读会话状态查询）、`src/web/server.ts`（注入查询）、`src/web/page.ts`（标签/只读单元格）。
- 实测：GOAL-084 三张旧卡（`302e6db7` / `8c091f5c` / `e8c549e9`）全部显示 `SESSION_TERMINAL(cancelled)`，**无需再次否决**。
- 回归：`tests/g085-collab-session-projection.test.ts`（2/2）。

### 2.3 卡片清理与两场正式验收卡

- 取消两张"准入核对"会话（`8fa0232e…`、`c8c1fb65…`）→ `cancelled`，卡与历史保留、未写应答。
- **C11 重复准备卡**（`dispatch-9fa52af8…`）：核对七项阻断通过后**否决清理**（note 以"重复包已执行"开头并**如实写明 schema 差异**：该卡是 C11 定稿前的读探针 schema）。记录链 append-only 追加 `REJECTED`，**未重跑、零费用**。脚本 `.test-fixtures/g085-c11-duplicate-card-disposition.mjs`。
- **C10 更正**：卡 `dispatch-e337dab5…` **存在**且带（委托）`APPROVED` 应答，但派发记录仍 `BLOCKED_WAITING_OWNER`/`prepared_only`、**无回执** → 保留未执行记录，**不补卡、不恢复**。（此前"没有卡文件"的说法是误推，已在回执更正。）
- 两场正式验收卡（议题「评审 GOAL-084 的实现与遗留问题（源码材料按 2026-10-05 冻结）」、五份冻结源码材料带文件 sha256 锚点）：
  - 双模型：本轮已用 → **`4a77b7b5-5771-4636-81f5-8ef8de014924`**
  - 三模型：**`2d082857-7367-4a6e-9d01-1796f49080c4`**（仍 pending）
  - 建卡/重冻结脚本：`.test-fixtures/g085-formal-acceptance-cards-2026-10-05.mjs`（`--skip-cancel` 可跳过取消步骤；状态文件 `.test-fixtures/g085-formal-acceptance-cards-state.json` 保证幂等）

### 2.4 D95：显式接受 Claude 原生版本漂移（契约 v1.63）

- 背景：隔离补证后本机 Claude CLI **自动升级 2.1.286 → 2.1.289**，派发前的原生版本门 fail-closed（首次双模型尝试因此被拒：codex 两次调用 PASS，claude 未派发、无费用）。owner 三选一中选 **C（政策接受，不重做证据）**。
- 机制（**放行仍是例外而非默认**）：
  - 登记文件 `runtime/collaboration-admission/claude/version-drift-acceptance.json`（`decision=D95`、`frozen_native_version=2.1.286`、`accepted_versions=["2.1.289"]`、`not_claimed` 逐条写明未证明事项）；
  - `src/adapters/claude-discussion-profile.ts`：`readClaudeVersionDriftAcceptanceDir()` + `verifyClaudeDiscussionBinding(..., driftAcceptance)`，**仅当登记冻结版本与合同绑定一致且观察版本被逐个列出**才放行，返回 `drift_accepted`；登记缺失/坏 JSON/形态非法/列别的版本 → 照旧拒绝；
  - `src/web/dispatch.ts`：登记目录**由合同 `workspace_root` 的父目录确定性推出**（= `profile.json` 所在目录），避免依赖 `dataRoot` 布局；放行时 `console.warn` 并写入内存记录字段 `version_drift_accepted`。
  - **不改变席位指纹**（实测 `5b5096e9…` 不变）、不改变证据归属、不放宽模型/参数形态/资产哈希三道复核。
- 回归：`tests/g085-claude-version-drift.test.ts`（7/7）+ 零成本生产资产核对 `.test-fixtures/g085-verify-version-drift-acceptance.mjs`（无登记即拒 / 登记覆盖版本放行 / 指纹不变）。

## 3. 第一场验收：双模型讨论实测

| 项 | 值 |
| --- | --- |
| 会话 | `4a77b7b5-5771-4636-81f5-8ef8de014924`（卡同名 `.json`） |
| 结果 | **completed**，phase `revision`，`call_count=7`，`retry_count=0`，7 条派发全 `PASS`（执行日志 seq 20–26 全 pass） |
| 席位 | A=codex×LOW、B=claude-code×LOW；A→B、B→A 互评 |
| 派发 | `4352c79b…`（codex 协调）、`7e78dffa…`（codex 提案）、`3d95ccc3…`（claude 提案）、`780ba05d…`（codex 评审）、`ff217f04…`（claude 评审）、`4e953e78…`（codex 修订）、`5de2e8d5…`（claude 修订） |
| 费用 | claude 0.045819 + 0.064874 + 0.0587956 = **$0.1694886**；codex 回执不带 `total_cost_usd` → **UNKNOWN**；申报合计 **$0.169489**（授权 $4.00） |
| 产出读取 | `POST /api/collaboration/sessions/detail` → `viewpoints.A`（11 559 字符）/`viewpoints.B`（9 941 字符）；claude 结构化输出为提案/评审/修订单三段（`observed_model_id=claude-sonnet-5`） |
| 运行日志 | `.test-fixtures/g085-dual-discussion3.log`（`c46b5ef1…`）；批准+监控+三道刹车脚本 `.test-fixtures/g085-run-dual-discussion-2026-10-05.mjs` |

## 4. 未决与遗留（按优先级）

### 4.1 【必修】D95 放行事实未持久化

- 现象：`runtime/dispatches/<id>.jsonl` 的 header 走**字段白名单**（`kind/schema_version/dispatch_id/adapter_id/status/receipt_path/admission/error/stdout_tail/stderr_tail/session_id/request`），因此 `version_drift_accepted` **没写进去**；同一白名单连既有的 `observed_model_id` 也吞掉（后者可在 `.mush-receipts/dispatch-<id>.json` 读到）。
- 影响：D95 / 契约 v1.63 声称"放行事实写入派发记录"**只部分成立**（现仅内存 + `console.warn`）。
- 建议修法：扩 header 序列化白名单（含 `version_drift_accepted`、`observed_model_id`），或改写入回执字段；补相应回归（断言落盘）。
- **注意**：这不影响"漂移接受实际生效"——claude 三次调用确实执行并按 2.1.289 产出。

### 4.2 准入就绪投影未覆盖版本漂移（owner 裁定**暂不修**）

`ready=true` 只看冻结快照与合同指纹，不看派发时的原生版本 → 出现"卡显示就绪、首次派发即被版本门拒绝"。已在回执与 D95 记录为观察项。

### 4.3 第二场（三模型）待 owner

卡 `2d082857-…` 仍 `pending_approval`（13+1 次调用、40 min、六条互评关系、`ready=true`）；**本轮授权只覆盖双模型**，三模型预算待 owner 另议；agy 准入上限已设 $3.00。启动前须重跑 §5 的核对清单。

### 4.4 验收口径

- 讨论**结论**尚未由 owner 验收；两场只验证真实协作链路与所提供五份源码片段，**不能**宣称完成 GOAL-084 全量源码审计。
- C10 保持不恢复；GOAL-084 三张旧卡无需再次否决。

## 5. 复现与核对清单（下一轮起手式）

```powershell
cd D:\mush
npm.cmd run typecheck                    # 0
node --import ./tests/setup.ts --test --test-isolation=none D:\mush\tests\g085-claude-version-drift.test.ts
node --import ./tests/setup.ts --test --test-isolation=none D:\mush\tests\g085-collab-session-projection.test.ts
npm.cmd test            # 948/948（.test-fixtures/r16-full-default.log  a999ed06…）
npm.cmd run test:isolated  # 948/948（.test-fixtures/r17-full-isolated.log 7361b8dc…）
node scripts/docs-reconcile.cjs          # PASS（D95）
git diff --check                          # 0
powershell -NoProfile -File D:\mush\scripts\scan-inflight.ps1
```

真实派发前（缺一不可）：

1. `scan-inflight.ps1` 干净；
2. 熔断未挂起（`runtime/unattended-breaker.json`）；
3. **讨论档案已激活**（重载看板后必须 `POST /api/collaboration/profiles/activate-claude` 与 `/activate`）；
4. **卡由当前看板进程创建**（若中途重载，卡会失效需重建）；
5. 预算：owner 明确授权额度；`/api/budget/caps` 覆盖所有参会席位；
6. 版本：CLI 版本必须在 D95 登记列表内，否则照旧 fail-closed。

## 6. 纪律与教训（本轮踩过的坑）

- **append-only**：否决/更正都追加，不改写历史；不伪造 owner 应答。
- **不擅自扩权**：预算门、全局依赖/配置变更、权限面变更都必须 owner 明确授权；D30 逐卡。
- **不要用 PowerShell 重写 UTF-8 源文件**：本轮用 `-replace` + `Set-Content -Encoding UTF8` 毁过一次 fixture 脚本（中文注释变乱码、行被吞）；一律用编辑器工具改写，PowerShell 只做只读或纯 ASCII 脚本。
- **多行/转义逻辑写成文件再跑**：`node <绝对路径>`；PowerShell 源码纯 ASCII。
- **登记/放行必须机器核对**：指纹等价、argv 逐字节、路径推导都要有断言；"同一指纹"不是理由。
- **临时脚本放 `.test-fixtures/`**，产物带 sha256 锚点。

## 7. 本轮产物哈希（SHA-256）

| 产物 | 哈希 |
| --- | --- |
| `goals/receipts/GOAL-085-receipt.json` | `6b9dafd992d8252bc8688a0db5e3211cd0095dd3b0a340e446ef4a3b33843663` |
| `src/adapters/claude-discussion-profile.ts` | `7a49175bdaee720b997cfe2f9eada052209b693c34985bf041036df960d56ab1` |
| `src/web/dispatch.ts` | `ea2adbca33f46abdbb3c917bd7965defa0371f783543c227fde3eddf2b5874bd` |
| `tests/g085-claude-version-drift.test.ts` | `a0e50175c2b6fcb4cb262dde9f52807812a37410a0262b325b663cbac09d4587` |
| `runtime/collaboration-admission/claude/version-drift-acceptance.json` | `f69d0cf8a47154fe2a40b08441444a05ae669a98b226c0c9bc54ac43d89457e8` |
| `.test-fixtures/g085-verify-version-drift-acceptance.mjs` | `7a69ef89886f04c4211fb51bf1a655adb60303db74359518b3fd53e55d627305` |
| `.test-fixtures/g085-dual-discussion3.log` | `c46b5ef19a856d3a72287149e094d417bb0ba658240fc3397b1453d99fa568a5` |
| `.test-fixtures/r16-full-default.log` / `r17-full-isolated.log` | `a999ed06…` / `7361b8dc…` |
| 隔离实验产物（工具面/写入覆盖/MCP+上下文） | `29ca8e83…` / `2ce13840…` / `e25f6330…` |

## 8. 看板会话现状（快照）

- `completed`：`4a77b7b5`（本轮双模型）、`7503ed94`（更早）
- `pending_approval`：**`2d082857`（三模型，待 owner）**
- `failed`：`78528225`、`1c1901dd`（D95 前的两次双模型尝试：版本门被拒）、`5dacedfb`、`110a6d41`、`1cba0b16`、`a90ce840`
- `cancelled`：`302e6db7`、`8c091f5c`、`e8c549e9`、`8fa0232e`、`c8c1fb65`、`9a25b862`、`3ac2582a`

## 9. 执行记录（2026-10-05 本地轮：D95 持久化收口 + AGENTS 精简；不提交不推送）

> 接手轮按 owner 指令只做本地修复、隔离测试与文档整理；未启动、未重跑任何真实模型；三模型卡 `2d082857` 仍未批未动。先补失败回归再实现（红→绿）。

### 9.1 D95 放行事实持久化（§4.1 必修缺口已闭合）

- 失败回归先行：新增 `tests/g085-drift-persistence.test.ts`（完整 DispatchPipeline + 假 CLI runner，冻结 2.1.286 / 观察 2.1.289 / D95 登记放行；零真实模型、隔离数据根）。实现前跑出红：header 与回执断言失败（字段确实没落盘）。
- 修复三处：
  - `src/web/persistence.ts` `saveDispatchHeader`：header 白名单加 `observed_model_id`、`version_drift_accepted`（缺省省键，不编造）；
  - 同文件 `loadDispatchRecords`：读回同两字段，漂移对象四字段全字符串才认（坏形态按缺失处理）；
  - `src/web/dispatch.ts` 回执对象：加同源 `version_drift_accepted`（`observed_model_id` 此前已在回执）。
- 未动：D95 接受名单（`version-drift-acceptance.json` 语义）、席位指纹、证据归属、其余权限门；未回填、未改写任何历史真实派发证据（`runtime/dispatches/` 存量文件原样）。
- 落盘与恢复证据（回归 3/3 绿）：漂移放行单的 header 首行、回执 JSON、以及用新 `BoardPersistence` 实例 `loadDispatchRecords()` 读回，三处均含 `version_drift_accepted`（D95-fixture / 2.1.286→2.1.289）与 `observed_model_id`；无漂移（版本一致）时三处均无接受字段；旧格式 header（无新字段）读回兼容不编造。

### 9.2 AGENTS.md 精简

- 4050 → **3967 字符**（≤4000）。只做合并与路由简化：技能两条合一、Goal 入池两条合一、上下文入口重复句合并、删被 10-05 取代的 09-05 旧交接链接。宪法/决议入口、五类触发门、D19/D30、会话授权、密钥与全局配置边界、在途扫描、同包单通道（AD-34/35）、测试隔离、UTF-8、append-only、D15 完成语义、10-05 交接入口、验证命令表全部保留；未新增 Goal/嵌套指引/治理规则；`CLAUDE.md` 仍仅引用 AGENTS.md。

### 9.3 本轮验证（实际运行）

| 命令 | 结果 |
| --- | --- |
| `node --import ./tests/setup.ts --test --test-isolation=none tests/g085-drift-persistence.test.ts` | 实现前 1/3（红，落盘断言失败）；实现后 **3/3** |
| 同上，`g085-claude-version-drift` + `g085-claude-native` + `persistence` + `web-dispatch` | **52/52** |
| `npm.cmd run typecheck` | **0 错误** |
| `npm.cmd test` | **952/952**（`.test-fixtures/r18-full-default-d95persist.log` `6186ab93…`） |
| `npm.cmd run test:isolated` | **952/952**（`.test-fixtures/r19-full-isolated-d95persist.log` `1d0856e3…`） |
| `node scripts/docs-reconcile.cjs` | **PASS**（47 Goal 映射、契约 v1.63、D95） |
| `git diff --check` | **0**（仅既有 LF/CRLF 提示） |

注：全量从交接的 948 升到 952，是本轮在途工作区相对交接快照新增测试所致（含本轮 +3），非历史数字沿用。

### 9.4 本轮产物哈希（SHA-256）

| 产物 | 哈希 |
| --- | --- |
| `src/web/persistence.ts` | `b6b9e3dff37b189e79313e35e99b9a30bd2abb4e50e63c804eb881588e40a678` |
| `src/web/dispatch.ts` | `472ca8c07636b6fbe48a1bdc884f29a04325cb11ec7a8e25ad47271512bbd621` |
| `tests/g085-drift-persistence.test.ts` | `6f7938d53413f320cb066791594ae990d3f5c0faf13154952a9186eae0678a86` |
| `AGENTS.md` | `dcfe8ca2e4c7b39c1116dee623c4c0003d6d0346e7600e1b1508a5fa5713aa1d` |
| `.test-fixtures/r18-full-default-d95persist.log` | `6186ab93699bdb5b1fd3ca2838dfd2630caf73428b16ad9e84e58f01af6a5ef7` |
| `.test-fixtures/r19-full-isolated-d95persist.log` | `1d0856e30e4b86fd1380fe0c9a7dec1c3a19ec4f1115a4a58de16b1f117e7230` |

### 9.5 遗留项

- §4.2（准入就绪投影未覆盖原生版本）owner 已裁定暂不修，维持；
- §4.3 三模型场仍待 owner 预算授权；启动前按 §5 清单重跑核对；
- 讨论结论的 owner 验收（§4.4）未变；
- 本轮改动未提交（按指令不 commit/push）；§4.1 状态由"必修缺口"更新为"已闭合（见 §9.1）"，以本记录为准。

### 9.6 追记（同日：两任务 owner 复核通过 + 看板恢复）

- owner 独立复核通过并关闭两项：D95 持久化（测试 10/10）与 AGENTS.md（3 967 字符，CLAUDE.md 引用保持）；952/952 两份日志哈希吻合。
- 运行面恢复：旧实例 PID 30388 已死（4790 无监听、锁陈旧）。空确认三通道（scan-inflight 犬窗/worktree 干净 + 进程树核查：现存 codex*/claude.exe 均属 ChatGPT.exe/Code.exe/cmd 交互会话，无一回溯到 30388）后，经 `scripts/board-up.ps1` 重启，新锁 **PID 27988**（board-up 同时开了一个看板浏览器窗口）。
- 档案重新激活（零派发、零预算）：三份指纹与 §1 冻结值**完全一致**——claude `5b5096e9…`、codex `8194bb67…`、agy `05c2a65b…`，证据归属不受影响。熔断 `halted=false`；预算 caps 不变（codex 5 / claude-code 5 / agy 3）。
- 注意：三模型卡 `2d082857` 由已死进程创建——按 §5 第 4 条，重载后旧卡失效需重建；该重建连同预算授权一并归 owner 决定，本轮未动。
- D95 持久化修复已随新进程在线生效（新派发 header/回执即带字段）；历史记录未回填。

### 9.7 更正（同日，owner 只读核验）：三模型卡**无需**因看板重启重建

- §9.6 上条"重载后旧卡失效需重建"的说法**被 owner 核验更正**：owner 只读查询会话 `2d082857…` 实测——仍 `pending_approval`、`ready=true`、未启动（调用数 0）、原审批卡哈希与冻结快照一致；**审批代码核对的是快照与准入条件，不绑定创建进程 PID**。
- 结论：该卡当前**保留即可**，不因看板重启（PID 30388 → 27988）而失效，后续不要重复建卡。§5 起手式第 4 条"卡由当前看板进程创建（若中途重载，卡会失效需重建）"以此核验为准修正理解：重启不必然作废旧卡，以快照/指纹核对结果为准。
- 看板 PID 27988 在线。剩余事项不变：三模型场预算授权、批准运行、结果验收，均待 owner；本轮零批准、零调用。

### 9.8 署名更正（同日，owner 指令）：§9.7 核验署名修正

- §9.7 中"被 owner 只读核验更正"**署名有误**，按 append-only 追加更正（§9.7 原文不改写）：该核验**经 Codex 独立只读核验，owner 转呈**——核验执行者是 Codex，不等于 owner 正式验收；owner 是正式接受权的唯一持有者。
- §9.7 的核验结论本身不变：会话 `2d082857…` 仍 `pending_approval`、`ready=true`、调用数 0、审批卡哈希与冻结快照一致，审批绑定快照与准入条件而非创建进程 PID；**三模型卡保留，不因重启重建**。
- 技术准备就绪。下一步顺序：owner 授权该场预算 → owner 看板点批（D30）→ 运行后检查讨论结果。此前提下 GLM 侧仅做零成本只读协助（如运行后读回观点、对账），不代行授权与批准。


### 9.9 Codex 受委托执行三模型实测（2026-10-05，真实失败）

Owner 明确回复「授权」后，Codex 经看板批准原卡 2d082857；没有重建卡或提高 cap。会话于北京时间 22:11–22:16 运行，最终 failed，正常3次+全场共享重试1次，总4次。Codex 完成协调和提案；agy 两次 runner PASS，但最终 response 均包含4个JSON行，无法满足单答案终局契约。Claude 未轮到，六条互评与三方修订未发生。四次花费均 UNKNOWN，不是0；不记三模型验收通过。原卡、应答、执行事件、回执保留，未启动第二场。

另修复详情接口漏第三席位 C 的真实缺陷，新增 HTTP 回归红→绿；相关9/9、typecheck通过。结束后确认空闲重载看板 PID27988→1816，API返回A/B/C、页面显示三列失败结果；重新激活原三份档案后指纹不变，零新增模型调用。首次恢复激活被自动审核拒绝，经补充同状态恢复的代码证据后获准；不绕过拒绝。

详情、原生证据哈希、机检与限制见 [本场报告](operations/goal085-real-triple-attempt-2026-10-05.md)。Goal保持PROPOSED，非Owner正式验收；未提交、未推送。下一步是修复agy纯文本会话的终止／终局封装兼容性，不能直接重跑旧终态卡、放宽D92或用草稿凑成功。


### 9.10 agy 结束协议补齐与复测版本门失败（Codex，2026-10-05）

- 局部修复：协调器只为agy逐轮补明已有finish返回协议；不改合同、agent/gate/项目Deny、权限、指纹或D92。真实子进程夹具红→绿，相关25/25，typecheck0，两模式宿主隔离全量各954/954。
- Owner明确授权新场81e32fe2后经看板代批并运行，实际2次Codex（协调、提案PASS）后，agy派发前因原生1.2.17≠冻结1.2.16被拒，整场failed。agy/Claude都未执行，finish原生行为仍未验证，不能记三模型通过。
- 当前累计真实6次＝旧场4+新场2，花费UNKNOWN。批准前漏检agy实时版本由Codex承担，已补独立零模型起手检查，不修改owner暂缓的产品readiness；当前Codex0.160.0、Claude2.1.289（D95）通过，agy1.2.17拒绝。升级执行者/自动更新因果未断言。
- 下一步需owner裁定是否接受agy仅1.2.17的漂移或先重验。待审提案只放.test-fixtures，不写运行政策；若再开一场，最多新增14、累计20，不能自动复用上次18次范围。当前无在途，未开始第三场。
- [修复及复测报告](operations/goal085-agy-finish-protocol-fix-2026-10-05.md)、[独立回执](../goals/receipts/GOAL-085-finish-retest-81e32fe2.json)。旧失败证据与原Owner应答均保留；Goal仍PROPOSED，未提交/推送。


### 9.11 D96实施与原生复测仍失败（Codex追加；2026-10-06收尾）

Owner明确接受仅agy1.2.17并授权再开本场14次、累计20次，已登记D96及runtime名单，不改变旧指纹/证据，未列版本照旧拒绝。名单/绑定/持久化相关18/18，两模式全量957/957，typecheck0，契约v1.64、对账D96。

第三场92390dcc实际4次＝3正常+1重试，Codex协调与提案通过，agy两次正常退出但没有调用finish且终局仍非单对象，整场failed；Claude未轮到。D96放行已在两单真实header、回执与新BoardPersistence读回三处一致证明。累计三场10个mush派发（Codex6、agy4、Claude0），费用UNKNOWN；没有再追加付费调用。

本轮推翻了“只补结束提示即可修复”的假设。init工具目录有finish、guard允许finish，不证明模型实际获得其接口；自身原生生成元数据的一组6个工具定义块没有finish，只有任务/后续消息提及finish。私有protobuf字段尚未完整映射，tools[]是否导致其缺失仍需单变量对照，不能把模型自报当唯一证据或断言根因。

[独立回执](../goals/receipts/GOAL-085-d96-attempt-92390dcc.json)保留原生元数据结构摘要与hash，未输出凭据或原始生成请求，不读其它会话。下一步先解决单模型结束接口，不能继续盲开完整三模型场，也不能从聚合response挑草稿。原生产agent/指纹未改变，任何工具配置变体需要新的配置审阅及D30探针卡。产品readiness仍只核对已有准入条件，不代表原生讨论兼容；owner此前暂缓的版本投影未擅改。


### 9.12 D97范围收窄及旧成功基线对照（Codex，2026-10-06）

Owner取消三模型验收，先只Codex/Claude/agy双模稳定复现；不扩八种，不重新铺接入，依据GOAL-085 §6。只读旧黑板与原始流：4a77b7b5双方互评和修订齐备、7个旧输出按当前终局提取可用；7503ed94旧程序completed/8次属历史事实，但3个agy原生终局当前都拒绝，旧落板JSON与回执structured_output均一致。应保留历史，不以选择片段放宽D92，失效点需做agy最小接口对照而不是重复整个大场。

本轮仅文档与只读分析产物，无新模型／审批／agent变更；三席位创建UI/API仍在代码，后续只收窄新建／启动，保留旧记录读取。原真实费用／新配置与指纹授权不因D97自动扩大，Goal未DONE。


### 9.13 GOAL-085 双模型实施（Codex，2026-10-06）

Owner要求实施D97收窄后的计划。新建/批准/启动/协调器/占额均双席位限定，历史三席位读取保留；A16仅开放原agent的finish结束工具，准备/批准各自临时生成并恢复资产，独立指纹不继承旧证据。尚未宣称原生单回合或新的双模型复现通过；检查结果与具体卡号见Goal §6.1及本轮独立回执，状态仍PROPOSED。


### 9.14 A16原生结果（Codex，2026-10-06）

A16准备 b5317d75eb1342098b9237955943eb09、批准后执行 c0643a3b394d4fff82c0205cbad6ab09：最小finish结束接口已验证，1次派发/1次内部生成、费用UNKNOWN；native init模型一致、只有finish步骤、guard allow、唯一正式JSON。原agent/合同已恢复，新指纹 43ae6c28ff26110c014bd162b3323a03b1b092b342e7ceed965c0b4144979c80 未登记准入、未永久采用，未自动重试或开整场。真实双模后续需候选证据适用性与授权；Claude实际2.1.290未在D95。952/952两模式及Chromium fixture证据见独立本地回执；原生见GOAL-085-a16-finish-receipt.json。不把最小schema结论外推为正式互评已通过。


### 9.15 D98候选采纳与复现卡（Codex，2026-10-06）

Owner接受候选五项已知缺证后，配置43ae6c28…已应用，有界政策只准Codex＋agy≤7+1/180s/20min；五维仍unmet，旧证据不迁移。新会话 24675150-8055-4794-93a1-bedd28aa93d0 pending_approval/ready=true/0调用，具体卡另批；未启动模型。当前代码955/955两模式、typecheck0、聚焦41/41、对账v1.66/D98通过。Claude2.1.290仍不接受；其未参会时不会阻断本场。插件/skill/MCP入口暂缓。见GOAL-085-d98-adoption-receipt.json。


### 9.16 新Code＋agy双模型实测完成（Codex，2026-10-06）

Owner对会话24675150-8055-4794-93a1-bedd28aa93d0明确授权后真实Chromium批准；7正常/0重试completed，双向评审与双方修订齐备。agy每轮原生finish、身份标签匹配；费用UNKNOWN。只覆盖批准组合与五份冻结片段。见GOAL-085-d98-dual-review-receipt.json及docs/operations/goal085-codex-agy-dual-result-2026-10-06.md。Claude2.1.290未放宽，skill/plugin暂缓，无自动下一场，无提交/推送，Owner正式验收仍待。


### 9.17 Claude2.1.290双模实测（Codex，2026-10-06）

真实CLI＋本地假后端兼容检查六类工具拒绝、上下文正反对照、JSON/身份通过，零付费。Owner随后明确接受2.1.290并授权卡1cafb42c…，D99版本名单精确更新（保留旧FP/证据，2.1.291拒绝）。真实Code＋Claude7正常/0重试completed，双向互评/双方修订、模型身份、版本接受持久化均一致；Claude申报$0.1576171与台账ACTUAL_COST舍入对平，Code费用未知，无在途。当前两组实测覆盖Code/agy/Claude已批准组合，未承诺其它组合/未来版本。结果、回执见Goal §6.6；26/26聚焦，TS源码未变，之前955/955两模式仍对应当前代码。Goal保持PROPOSED、Owner正式验收待；不追加场次/插件/提交/推送。


### 9.18 稳定联通第一阶段（Codex，2026-10-06）

Codex执行，2026-10-06：稳定联通第一阶段已实现（v1.67）。零模型check、30秒原生观测缓存、创建/批准/启动前最新版本门、完整组合正式回执索引及表单三类状态已接线。最终默认与独立均961/961、typecheck0、真实Chromium隔离验收、生产两个原批准组合只读ready=true且VERIFIED；看板PID23072加载当前代码。本轮零模型调用、零生产建卡/批准，指纹与接受范围不变。见 goals/receipts/GOAL-085-stability-stage1-receipt.json sha256 be89f4da63fa41e730441ffc897ce7c0f739bf5d8bc62d79b7c27c201e0c763f 与 docs/operations/collaboration-stability-stage1-2026-10-06.md。后两阶段（结果整理、CLI/MCP/skill）未实施，Goal保持PROPOSED，不自动DONE，未提交未推送。
