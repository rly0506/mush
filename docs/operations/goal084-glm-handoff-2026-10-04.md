# GOAL-084 给 GLM 的续作交接（2026-10-04）

**任务：在现有工作树上完成 Codex + Antigravity 的真实、有界黑板讨论。首场议题由 Owner 选定为「评审 GOAL-084 的实现与遗留问题」。** GLM 是接续开发的 controller，不因有额度就替换首场参会者。真实七调用会话尚未创建、批准或运行，Goal 仍为 PROPOSED。

## 1. 授权和工作区

- Owner 已要求推进到真实对话，并明确授权「修复 + 可以自主操作浏览器审批」。沿用本任务范围，无需再次询问是否开始；新真实派发仍先落 D30 看板卡，通过浏览器逐卡操作。准入满足后，对具体会话批准一次，运行正常 7 次、共享重试最多 1 次、180 秒/次、20 分钟/场。
- 审批 note 署名当前 controller（GLM）受 Owner 委托；这不是 Owner 正式 Goal 验收。费用仍 UNKNOWN，cap 不等于账单保证。额外模型/真实子模型、provider/凭据变更、全局配置变更等超出当前范围，不自动放开。
- `D:\mush` 大量修改和新文件未提交，包含早于本轮的工作。先看相关 diff，保留其他修改；不 reset、不自动提交/推送，不另开宽泛治理重构或 Goal。
- 2026-10-04 交接检查：4790 不可访问，`Get-Process -Id 23788` 未找到；`runtime/board.lock` 仍写 23788。未重启或删除锁。接手先核实实际实例和在途，不能从连接失败推断无任务。
- 真实派发前执行 `powershell -NoProfile -File D:\mush\scripts\scan-inflight.ps1`。此前执行策略阻挡时只用了进程级 `-ExecutionPolicy Bypass`，没改系统策略。测试必须预加载 `tests/setup.ts`。

## 2. 已有基础，不要重做

黑板存储、固定阶段协调器、会话授权、看板、取消、工作区数据面与证据库均已有代码和 fixture/browser 验证。入口：

- `goals/GOAL-084-controlled-blackboard-collaboration.md`：范围、执行记录、验收规格。
- `src/orchestration/collaboration-{blackboard,coordinator,skills,evidence-store}.ts`：ACL、额度、阶段、观点、受控证据。
- `src/web/{dispatch,server,page,sources}.ts`：派发、HTTP、审批显示。
- 历史报告：`docs/operations/goal084-{schema-probes-live,isolation-probes,codex-closed-profile,evidence-store}-2026-10-03.md`。

证据库已默认接入，路径 `<dataRoot>/collaboration/evidence`，无 HTTP 登记入口；source、配置指纹、产物哈希核验，失败反例阻断同配置同维度的旧 pass。C7 自报目前只登记 declared。没有为了放行而补造五维 live_verified。

## 3. 中断前新增代码：已落盘，尚未全量收尾

| 文件 | 当前用途 |
| --- | --- |
| `src/adapters/agy-discussion-profile.ts` | 绑定项目 UUID、运行目录、原生版本、model、项目/agent/hooks/guard 四类资产哈希；执行前复核；不授予会话准入 |
| `src/adapters/agy-discussion-gate.mjs` | 项目级 PreToolUse：只有 `finish` allow，其余名称及坏输入 deny；日志只记工具名、会话 ID、哈希等，不记参数正文 |
| `src/adapters/contract.ts` | 新增 `agy_discussion_profile` 字段及校验，参与合同指纹 |
| `src/web/dispatch.ts` | 新 profile 在预算前查资产/模型/版本；实际 cwd 从绑定派生，逻辑工作区不变；请求记 `execution_cwd`；新增 A9；注册绑定目录不切换选中工作区 |
| `src/web/server.ts` / `collaboration-probes.ts` | 固定 A9 准备入口、宿主 inspector/inputs；当前进程激活 profile，不写普通账号配置 |
| `collaboration-blackboard.ts` / `coordinator.ts` / `dispatch.ts` | 席位 effort 冻结、逐轮传递、入口拒绝升档或遗漏；旧快照无字段保持兼容 |
| `src/web/server.ts` / `page.ts` | 已绑定 profile 的会话由宿主给 Codex LOW / agy HIGH；审批参与者显示档位 |
| `src/adapters/agy.ts` | 严格解析相同 fenced JSON 副本；原生聚合 response 与全部已完成步骤正文逐字吻合时才提取最后完成的答案；不丢原始流 |

新增测试：`tests/g084-agy-discussion-profile.test.ts`（5）、`g084-agy-tool-gate.test.ts`（2）；修改 `adapters-agy`、`g084-probe-preparation`、`g084-session-authorization` 等。

**文档欠账：契约仍 v1.56，未补 A9、agy profile/实际 cwd、effort、原生多次响应解析的完整说明；Goal §5 和目标池此前也未记录本轮后半段。** 这份交接不表示上述改动已收官。

## 4. 原生配置与真实探针

### 本机 agy 状态

本轮实测版本 **1.2.16**，不能沿用早期 1.2.6 的版本证据。`agy models` 列表包含 gemini-3.7-flash-high，当前准备包仍选择它 + HIGH。

通过原生只读命令建立专用项目后，用原生 `/permissions` TUI **只编辑这个项目**，设置 deny：read_file(*)、write_file(*)、command(*)、mcp(*)、read_url(*)、execute_url(*)、unsandboxed(*)。没有修改全局/shared 权限、provider 或凭据。

- 项目 ID：`bb254da4-c36e-4f99-8801-599547824e0c`。
- 项目原生文件：`C:\Users\任锂帅\.gemini\config\projects\bb254da4-c36e-4f99-8801-599547824e0c.json`。
- 仅一份 folderUri：`D:\mush\runtime\collaboration-admission\agy\workspace`。
- 宿主描述：`runtime/collaboration-admission/agy/profile.json`；不是凭据文件。
- 运行目录 `.agents/agents/mush-discussion.md`、`.agents/hooks.json`、`.agents/deny-tools.mjs` 均与 profile 绑定。
- 原生项目备份：`.test-fixtures/g084-agy-admission-2026-10-03/project-before.json`；agent/gate 修改前版本也已保留。
- `/permissions`、`/config`、`/hooks` 的只读输出证实 num_turns=0、usage=0；`/hooks` 看到了本项目 enabled 的 guard。没有把帮助/配置载入当作行为通过。
- `.agents/mcp_config.json` 中试放本地 `mush-probe` 哑 server，但 `agy mcp list` **未列到它**。不能宣称已成功注册或把 unknown server/tool 当禁用证明。无需为了这一点修改用户全局 MCP。

### 两次 A9（均在 2026-10-03，经浏览器 D30 卡批准）

| 项 | 初版 A9 | 硬门版 A9b |
| --- | --- | --- |
| 审批请求 | f18d147a6ead404d9160ea8ef050d3ce | ce4eeef13f734696a0bb858be6983cdb |
| 实际派发 | d26a148372d54ceea5660e85706b4d88 | fa0b740a7d594f7ab7d633b70a5fa8cf |
| 原生会话 ID | a9ffe65b-466c-4947-b55e-3e57ecf0b304 | cb369469-64be-4810-95ee-25b64f923ea1 |
| runner 结果 | PASS | PASS |
| native num_turns | 4 | 4 |
| 配置指纹 | 44e89f1d73500af81435918e0f67607437eb3969ff2d41114f09105ff90f71af | 05c2a65b342ce52a7be4855eaebcd92b4512ff45d6f2a69fda4dec0c0d31d286 |

真实边界：

1. **tools:[] 没有使 init 工具目录变空**：两次 init 均列 60 个工具，包括 invoke_subagent/call_mcp_tool。这是广告目录，不能推断全部能执行，也不能宣称已禁用主 agent 全部工具。
2. A9b guard 留下 **一条真实 call_mcp_tool → deny**，会话 ID 对账一致。原生 steps 的第2步为工具类型132、状态7、有拒绝标记。这直接验证了该入口的硬拒绝集成。
3. 没有写出 probe-write.txt；随机读 canary 未出现在本次原生步骤。它们本身不证明所有文件/命令路径都被实际演练。
4. 其它资源名在同一 Node guard 的测试中返回 deny；**未在 native 层独立验证所有路径，尤其没有实际 invoke_subagent 的拒绝审计**。空 Subagents=[] 是探针唯一允许的原生请求；从未批准真实子任务/子模型。
5. 初版输出四份相同 fenced JSON；A9b 则聚合四份裸 JSON。最终解析补丁已可从完成步骤提取五项 BLOCKED，但这是回答解析，**不是五维权限独立证明**。A9b live record 当时未填 structured_output；后来用新解析器回放成功，不伪称新代码当时已 live 运输成功。
6. 两次 runner PASS ≠ 完整准入通过；尚未把它们登记成五维 pass。

证据目录 `.test-fixtures/g084-agy-admission-2026-10-03/`：A9/A9b stdout、receipt、result、A9b.tool-gate.jsonl、A9b.native-behavior.json、审批截图、元数据摘要。A9b 锚点：

- stdout SHA-256：`184daafb09ff4fd9b8717a9fe92bbac0ba4d18887498b23e580d85a0d9be2a83`。
- receipt：`ce577b1f93c4b912c6a5b6a88cc97e67033db5fcbbdc61d2400a6d31c04ade01`。
- guard audit：`11fe363556a60e5148f4e3598a4abddb0a5aff045eadc1a388f7c84bd64699c8`。

### Codex 身份表述待校准

原 C7（83ce4c0cd99e450fb6955414516de2fd）的原生 stderr 头部实际含 `model: gpt-5.5`、**`provider: custom`**；模板 `expected_provider` 仍为 openai。不要改实际 provider/凭据来凑匹配，也不要在表述中把现有自定义路由说成直接 OpenAI。应区分 API/模板标签、原生实际配置和下游服务所报模型身份。只改标签会改变合同指纹，旧证据/批准不能自动继承。

Codex closed profile 的 native fake-provider 实验是真实原生工具路由器行为，但是假服务、隔离 HOME、无账号模型调用；C7 真实报告与它覆盖对象不同。不要把两者简单排成一个“证据等级”或扩大未验证边界。

## 5. GLM 下一步按这个顺序

1. **接续核查，不重开全库审计**：读本单、相关 diff 和新测试，确认当前资产、版本、在途与运行实例；补齐新代码记录/契约说明。检查 guard 异常/timeout/缺失是否会被 native 忽略；现有源文件/版本前检不能自动证明 native hook 的所有故障均 fail-closed。
2. **把准入事实做成准确矩阵**：列清五维已证明/未证明的覆盖对象。native MCP 一条拒绝可以登记其精确范围，不能单凭通配符声明或裸 Node 测试给五维全部 live_verified。优先复用现有原生轨迹/回执，必要时做少量有判定力的 D30 探针；不要盲跑原14包，不调用真实子模型、不动全局配置。
3. **处理真实会话的两个具体前置**：Codex provider 表述/身份一致性；重启后的 profile 激活。现在 C7/A9 只在 prepare 时激活当前管线，重启恢复普通合同，旧批准因指纹漂移拒绝。可在无派发的宿主准备路径恢复已核验配置，但不能借恢复自动执行探针或旧会话。
4. **正式登记足用的证据并通过准入**：使用生产 FileCollaborationEvidenceStore，产物字节/来源/方法/版本/配置指纹对账，缺失或反例仍拒绝。不要注入测试证据、关闭 isolation_required 或借 originOwner 绕开。
5. **创建并运行 Owner 指定的会话**：两参会者仍 Codex gpt-5.5 LOW + agy gemini-3.7-flash-high HIGH。创建只冻结数据；核对具体会话卡、材料和边界后一次批准，协调器实际跑分配→双方提案→互评→修订。保留有效批评、采纳修改和分歧；没有隐藏总结调用。失败/停止即按状态机收口，不无限重试。
6. **收尾证据和状态**：跑适用机检/浏览器交互与真实会话回执，更新契约、Goal、目标池。符合机检和真实验收才考虑 AUTO_ACCEPTED，Owner 明确接受才 DONE。

首场材料已准备但 **未用于创建会话**：

- `.test-fixtures/g084-live-review-2026-10-03/review-packet-compact.json`：7份片段材料，正文共15536字符；旧大包也留存。使用前检查源码是否变更、重新冻结并保存新版本，不覆盖旧快照。
- agy 当前是 argument 运输；材料、schema、对方观点组合会受 Windows argv 限制。不要静默截断，也不要先跑一轮才发现上下文过长。必要时先用 fixture 验证典型评审/修订提示长度；若改 stdin 协议，应先验证真实语法并经过正常卡授权。

## 6. 最新验证与文档欠账

2026-10-04 交接本轮实际运行，**零模型调用**：

```powershell
node --import ./tests/setup.ts --test --test-isolation=none tests/adapters-agy.test.ts tests/g084-agy-discussion-profile.test.ts tests/g084-agy-tool-gate.test.ts tests/g084-probe-preparation.test.ts tests/g084-session-authorization.test.ts tests/g084-coordinator.test.ts tests/g084-board.test.ts
npm.cmd run typecheck
node scripts/docs-reconcile.cjs
```

结果：聚焦 **84/84，exit0**；typecheck exit0；文档对账 PASS（仍 v1.56 / D87）。对账 PASS 只表簿记一致，**没有证明新行为已写进契约**。

最近一次完整两模式 **847/847** 是 2026-10-03 证据库收尾状态，早于本单的 agy profile/guard、响应解析及 effort 改动；不能称当前全量已绿。该状态默认首轮曾842/846、复跑通过，Windows锁/launcher失败根因未确认。旧日志 `.test-fixtures/g084-evidence-store-2026-10-03/conflict-final/` 保留；后续默认与 isolated **分开执行**，新目录完整保存 stdout、退出码和哈希，不覆盖旧失败。

## 7. 工具脚本注意

- `.test-fixtures/` 多为一次性诊断脚本。有的 `wx` 拒绝重复，有的会覆盖同名报告，有的依赖已结束的真实派发号；先读，勿批量执行 `g084-*.cjs/mjs`。
- **不要运行 `g084-agy-empty-stream.cjs`**：此前自动审批审核拒绝了“指定模型 + 空stdin初始化”——空输入不能证明零调用，且没走 D30；它未执行。后续已经改走正常看板 A9，不能通过别的 wrapper 绕过此拒绝。
- `/permissions`、`/config`、`/hooks` 的无模型读取仅由本机1.2.16更新日志和实际 num_turns=0/usage=0确认，不泛化给任意 slash 命令。
- `g084-agy-a9b-behavior-trace.cjs` 只读这一轮自己的 DB，输出布尔/类型/字节数；不扫描其它用户对话，不复制原始 prompt 或凭据。
- 浏览器曾有只改特定审批请求 note 的 route；接手先取消遗留 `**/api/approvals/respond` route，刷新获取当前 Caller Token，禁止输出 token。note 用 GLM 受委托，不冒充 Codex/Owner。

官方参考（声明与本机行为需分别核验）：[权限](https://www.antigravity.google/docs/permissions?tab=cli)、[hooks](https://www.antigravity.google/docs/hooks/)、[custom agent](https://www.antigravity.google/docs/subagents/)、[headless](https://www.antigravity.google/docs/cli/headless/)。

**交接成功标准：GLM 能直接从本单定位中断位置，优先完成足用的真实准入证据与首场七轮对话；遇到现有 harness 限制如实保留，不把 Goal 标成已完成。**
