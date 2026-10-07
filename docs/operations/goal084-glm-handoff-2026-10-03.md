# GOAL-084 §3.5：Codex → GLM 交接（2026-10-03）

> **2026-10-03 完成注记（GLM）**：本单所列五项已全部完成——① 浏览器验收（阶段推进/停止/unverified 拒绝/恶意文本/390px 窄屏，证据 `.test-fixtures/g084-browser-9JKfCc/`）；② 契约 v1.52 补齐 + v1.51 seat 必填报正 + D87 运行状态补注 + Goal §2.4 接口统一；③ 全量失败复核（805/809 的 4 例复跑未再现，本轮两模式 809/809；persistence Windows launcher probe 升级登记为可复现间歇失败）；④ g076 基线 7/7；⑤ §5 执行记录已登记。Goal 保持 PROPOSED（真实通道证据未核验、真实双模型会话未获批）。本单其余内容保留为交接时历史快照。

当前状态：**已有实现，§3.5 尚未收口；GOAL 保持 PROPOSED**。owner 2026-10-03 要求暂停 Codex 施工，把剩余工作交回 GLM。本次只有本地修改、隔离 fixture 与测试；没有提交、推送或真实模型派发。

## 先读什么

1. 本文件、`goals/GOAL-084-controlled-blackboard-collaboration.md` §3.5 / §4 / §5。
2. `git status --short`，相关 diff，以及下面列出的**未跟踪源码/测试**。仓库存在大量更早的在途改动，不能把 HEAD diff 全算作本次。
3. `.test-fixtures/g084-handoff-2026-10-03/manifest.json`：本次交接时的源码、日志、截图哈希。复核当前代码是否已继续变化。

不需要重写 §3.1–§3.4 或重新争论一次会话授权方向。新的生产权限证据、具体真实会话审批和 owner 验收均未完成。

## Codex 接续了哪些缺口

接手时，GLM 已写 §3.5 HTTP/UI 与 4 条 board 测试，但尚无完整浏览器验收/执行记录。下列修补已落盘：

| 文件 | 当前实现 |
| --- | --- |
| `src/web/server.ts` | HTTP 创建强制隔离，禁止调用方自报权限证据；宿主可信注入证据库/条目；创建时冻结 model/provider/实际合同指纹；readonly readiness；审批先复核证据和当前合同，再写 wx append-only owner response；通用/专用审批共用同一逻辑；原会话跨工作区仍解析原审批目录；重启恢复持久化列表，在途遗留中断、不重放；派发显式绑定创建工作区；批准与执行状态分开。 |
| `src/web/dispatch.ts` | `collaborationContract`、会话审批路径/owner decision 查询；允许选择合同明确声明的默认模型；受控会话回执写集中数据面，不在外部业务工作区落 `.mush-receipts`。 |
| `src/orchestration/collaboration-blackboard.ts`（未跟踪） | readonly `assertCanAuthorizeSession`、持久化 `listSessions`；新增 `session_outcomes` 追加式终态结果表及 record/get 方法，错误原因重启后可见；`occupyCall` 在原子占额前检查停止标记。 |
| `src/orchestration/collaboration-coordinator.ts`（未跟踪） | 停止发生在异步预检期间时，异常收口为 interrupted；停止后已完成调用保留执行证据，不再形成新观点或下一轮。 |
| `src/web/page.ts` | 独立协作表单/列表/详情；真实 roster 模型下拉；A/B 材料 ACL；默认强制隔离；readiness 不满足时禁批准并显示原因；草稿不被轮询覆盖；忽略过期列表/详情响应；切换工作区清理新会话草稿；批准/否决与执行状态分开；显示失败原因和结构化观点；escaped 文本；窄屏样式已有但尚未最终浏览器验收。 |
| `tests/g084-board.test.ts`（未跟踪） | 原 4 例保留，扩到 14 例，覆盖默认隔离/拒绝 opt-out、否决回执、持久化恢复、内联 JS 语法、共享审批路径、启动恢复、配置漂移、跨工作区审批/执行、外部工作区零足迹、失败原因恢复、预检期间停止。 |
| `tests/fixtures/g084-browser-server.mjs`（未跟踪） | 隔离浏览器后端，真实 spawn Node fixture，无模型/provider；动态端口、caller token 开启；happy/hang/invalid/xss/unverified 场景。合成证据只供测试，不能转用生产。 |
| `.gitignore` | 忽略根目录 `collaboration/` 运行库。原已有 `collaboration/blackboard.sqlite` 保留，未删除或读改内容。 |

红灯证据：`.test-fixtures/g084-board-red-2026-10-02.log` 确认失败原因缺失、漂移合同仍批准、跨区通用审批 404；`g084-preflight-stop-red-2026-10-02.log` 确认停止后仍 calls=1、spawned=true。最终对应回归已绿（calls=0、spawned=false）。

## 当前验证：不要写“全绿”

| 检查 | 实际结果 |
| --- | --- |
| 单文件 board | `node --import ./tests/setup.ts --test --test-isolation=none ./tests/g084-board.test.ts` **14/14，exit 0**；完整输出 `.test-fixtures/g084-board-green-2026-10-02.log`。 |
| typecheck | `npm.cmd run typecheck` **exit 0**（工具实际输出）；最终代码包含 outcome 和预检停止修复。 |
| 默认全量 | 日志报告 **805/809，fail 4**，包括 persistence Windows launcher/非 Node PID fixture 与 browse-native abort。**未取得完整进程退出回执**；工具会话在跨轮续接后不可访问，不能补造 exit code。`full.stdout.log` / `full.stderr.log` 原样保留。 |
| 独立全量 | **805/809，exit 1**；Windows fixture 失败以及 pi-rpc completion `two-message` 预期 completion-extra-message、实际 agent-settle-timeout。日志与 result JSON 完整保存，stdout sha256 `4c52bc440fffd37646becbf6885bdd7376794472968fc267f1cd943a0521faa7`。 |
| 本次 tracked 源码格式 | `git diff --check -- .gitignore src/web/server.ts src/web/page.ts src/web/dispatch.ts` exit 0。 |
| 全仓格式 | `git diff --check` exit 1：大量既有文档 CR/尾空白；没有为此整库重写。 |
| g076 | **本轮尚未运行**，待 GLM。 |
| 交接文档对账 | 交接落盘后运行 `node scripts/docs-reconcile.cjs`：47 条映射、v1.52、D87，**PASS / exit 0**。GLM 修改契约后还需复跑。 |

全量日志目录：`.test-fixtures/g084-resume-2026-10-02/`。上述两个模式的失败不能因为聚焦测试通过而略去，也不能直接认定与本次修改无关。

已进一步定位 Windows 失败：`.test-fixtures/g084-policy-probe.cjs` 只运行自建 `Write-Output 'fixture-ok'` 脚本。默认子进程 status=1 且 ExecutionPolicies/UnauthorizedAccess；**仅对该子进程设置 PSExecutionPolicyPreference=Bypass 后 status=0**。未改系统/用户策略、未按此重跑全量。若使用这种本地测试进程配置，记录为单独的验证条件，保留默认失败，不称默认环境通过。pi-rpc 间歇失败根因仍未确认，本轮影响尚未排除。

## 浏览器证据与还欠的验收

使用 Playwright 接真实隔离 HTTP 服务，所有请求限定 localhost；真实模型零调用。已实际点击表单/批准/停止/否决：

- 最终代码（`.test-fixtures/g084-browser-lsJ2CW/`）：草稿经过轮询仍保留；模型下拉正确；批准前 pending + calls=0 + isolation=true；批准后 completed + calls=7 + retry=0 + 七行 pass；A 三轮 manifest 只有 m1，B 三轮只有 m2；pageerror=0，正常主路径未见 HTTP 错误。截图 01-create / 02-await-approval / 03-completed-desktop。
- 同目录 04-failed：持续格式错误 → failed、calls=3、retry=1；执行记录仍是 runner pass，但无效输出不形成观点；结束原因包含“root 缺少必填字段 body”，实际显示在页面。
- 较早 UI/runner 版本（`.test-fixtures/g084-browser-l0C5TS/`）：04-stopped 为真实 fixture 子进程中断，最终 calls=1 / interrupted / 零观点、无下一轮；05-unverified 为按钮禁用、强行 HTTP 批准 409、calls=0、无 owner decision；否决后明确显示已否决。**这两项要在最终代码再验，不把旧截图当最终状态。**
- 2026-10-03 新实例 `.test-fixtures/g084-browser-BFpKyc/` 只检查了 UI ready；接交接时已停止本次启动的 fixture 服务。不要沿用旧端口。旧工具进程句柄在跨轮后无法追踪，不要按模型名批量杀进程。

GLM 最先补完这些浏览器场景：

1. **阶段推进和最终停止/拒绝重验**：fixture 足够慢，让 UI 的 2 秒轮询实际观察 proposal/review/revision；在 hang 场景停止，确认 202 只是请求，最终 interrupted 且无下一轮；unverified 保持零调用、无批准回执。
2. **恶意文本与窄屏**：xss 场景的模型正文、议题和材料按文本显示，不能出现执行的 img/onerror；390px 左右不横向溢出、可操作审批/停止。保存截图、结构化断言、哈希；不要把 source esc() 或 HTTP 冒烟当浏览器验收。
3. **文档/契约对账**：v1.52 已由 GLM 起草，但未同步本轮强制隔离、可信宿主证据、owner response、readiness/outcome、重启恢复、集中回执与跨区审批语义；v1.51 internal.collab seat? 也落后于席位必填。D87 追加运行状态补注（保留原决议）；Goal §2.4 原路径式接口与现有 detail/cancel body 式需统一，不能留下两套并称已实现。状态仍 PROPOSED。
4. **最终验证与登记**：相关 g084、typecheck、两种全量、g076、docs-reconcile、diff-check；保留默认策略失败及 pi 间歇失败证据，查清或登记，不凑绿。不顺手改 unrelated persistence/系统配置或批量行尾。
5. §3.5 满足本地规格后再记“本地验收已收口”。**整个 Goal 仍缺已核验的真实通道权限证据，以及单独获批真实双模型会话**，不能 AUTO_ACCEPTED/DONE。

## 接续命令与 fixture 使用

在 `D:\mush`：

```powershell
node --import ./tests/setup.ts --test --test-isolation=none ./tests/g084-board.test.ts
npm.cmd run typecheck
node --import ./tests/setup.ts ./tests/fixtures/g084-browser-server.mjs
```

launcher 输出仅 url/root/scenarioFile，不输出 token。修改输出的 scenarioFile 文本选择 happy/hang/invalid/xss/unverified（只改 fixture 目录）；导航输出的动态 localhost URL，点击“🤝 协作”。fixture 的协调建议使用 m1/m2，所以创建两份材料，A 仅 m1、B 仅 m2。HTTP 写请求头为 **x-mush-caller-auth**，从页面 meta **mush-caller-auth** 获取；不是 Authorization: Bearer。不把 token 打到报告里。

临时验证脚本：`.test-fixtures/g084-verify-2026-10-02.cjs`，支持 full/isolated/typecheck/g076/docs/diff；当前写固定旧日志目录，若再次跑先改到新目录，避免覆盖原始失败证据。两种全量建议顺序执行并单独记条件和退出码。

禁止：借 fixture 的合成 live_verified 放行真实通道、降为 isolation_required=false、借 originOwner 绕过、重复启动同会话、自动真实调用、提交/推送/凭据或系统变更。
