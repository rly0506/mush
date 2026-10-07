# GOAL-084: 受控黑板多模型方案协作 (Controlled Blackboard Collaboration)

- 状态：PROPOSED（本地验收收口 §3.1–§3.5；2026-10-04 首场真实双模型会话已完成（8 次调用＝正常 7＋共享重试 1）；同日 owner 复核后落地 **D88/D89 条件化准入**——守卫层证据按"同一强制层"结构等价采纳、席位四维缺证由准入政策逐条接受并随快照冻结，**创建/批准/占额前三道反例硬前置**均 fail-closed，常用审批卡（含侧栏）经**真实 Chromium** 验收可见。**如实保留的限制：agy 正式讨论席位五维证据未全部通过**——`mcp_scope` 为行为级，`tool_scope`/`write_protection`/`read_scope`/`recursion` 仍是"未演练"缺口（席位 agent 自身不发起该类请求；按 owner 裁定"未尝试"不构成限制被验证的证据），作为**明确接受的限制**保留，不用守卫层结果顶替。Owner 正式验收未做，AUTO_ACCEPTED/DONE 仅 owner 决定）
- 来源：owner 2026-09-27 确定的首个协作场景与一次会话授权方向（D87），以及 2026-10-01 对黑板方案的讨论
- 优先级：高
- 依赖：复用 GOAL-043 协作入口、GOAL-048 skill 管理、GOAL-050 黑板及现有派发/审批管线；历史验收状态不代表本 Goal 已接通
- 依据：docs/research/collaboration-harness-capabilities-2026-09-27.md、DECISIONS.md D30/D87/D88/D89
- 验收回执：goals/receipts/GOAL-084-receipt.json（sha256 `7ee5581b3946c19963faec38233debaf4c3c3ec9c828f8ee761c94c12ac19114`；机检、真实会话、条件准入与如实缺口）

---

## 1. 目标与价值

让两个模型围绕同一议题，通过共享黑板完成“独立提案 → 交叉评审 → 各自修订”。owner 不必在模型之间搬运消息；每位模型都能看到本阶段获准的材料及需要回应的具体观点。最终保留原始发言、证据、方案版本和未解决分歧，供 owner 判断。

owner 一次批准范围明确的整场会话。一个参会模型可以提出角色、skill 和材料分配，mush 在授权范围内校验后执行；阶段推进、额度占用和停止由程序控制。此 Goal 的完成要求隔离验证与一场具体获批的真实双模型讨论，不能用界面演示或模拟输出替代。

首版限两个参与者、一个工作区和三个讨论阶段。MCP 接口、第三位参与者、自由发言顺序、自动施工及无人值守调度不在本 Goal 内；以后可复用同一黑板与授权服务扩展。

---

## 2. 核心架构与契约

### 2.1 黑板、身份与上下文

- 在当前工作区对应的集中 runtime 下使用 Node 24 内置 node:sqlite 保存会话、参与者、材料快照、追加式观点、授权和执行记录；不向外部业务工作区写 mush 元数据。旧黑板 items.json 保留，不自动迁移或通过其无角色过滤的读取接口公开新会话。
- 材料由 owner 明确选择，首版只支持文本；记录来源、内容哈希和获准读取者。每条观点保存会话、作者运行实例、阶段、回应对象、版本、证据引用及原文；修订追加新版本，摘要不覆盖原文。
- 参与者身份取自 mush 启动的运行实例，不接受模型自报的 author_dog 作为权限依据。模型不直接连接数据库或执行任意 SQL；协调器按角色查询并组装每轮上下文。
- 双方独立提案时互不可见；提案齐备后才交换指定版本用于评审；评审齐备后再分别提供相关质疑用于修订。公共议题及约束始终提供给双方。保存每轮实际发送的材料清单和哈希；超出通道容量时停止并提示缩小材料，不静默截断。

### 2.2 角色与 skill

- owner 选择两个已登记的 harness/provider/model、其中一位为协调者，以及允许使用的材料、skill 和资源上限。协调者先提交一次分配建议：双方关注点、已批准 skill 和材料范围；mush 校验后执行，不能扩大授权。
- 提供协调、提案、评审、修订四种版本固定的纯文本 skill 模板。会话授权记录模板版本与哈希；首版不执行 skill 附带脚本。skill 指导回答方式，实际数据和工具权限由运行环境与服务端落实。
- 讨论通道禁用不必要的文件写入、命令、额外 MCP/插件和递归派发。某通道无法落实批准的执行配置时，不作为该会话参与者。此权限边界针对 mush 管理的模型运行，不宣称防御同一用户下的恶意宿主进程。

### 2.3 有界讨论、适配器与授权

- 固定流程：协调者分配建议 1 次 → 双方独立提案各 1 次 → 双方互评各 1 次 → 双方修订各 1 次。正常路径为 7 次 mush 发起的模型调用；允许全场共享 1 次格式或可重试失败的重试，最多 8 次。关闭自动换模型及隐式故障转移；应用层调用次数不等于 provider 内部请求次数。
- 每条回答至少有正文、立场、回应对象、证据、缺陷、修改建议和保留分歧。允许“证据不足”，不强制正反角色。原生输出 schema 可用时使用，但每次仍由 mush 校验引用、阶段和语义；坏格式保存失败证据，重试占额度。最终展示已有记录，不增设隐形总结模型；共识须指向双方真实观点，不能填固定文案。
- 首版补齐 Codex 与 Claude Code 的模型参数传递、结果解析、限制工具、超时及取消接线。每轮用黑板重建上下文，不依赖跨 harness 原生续聊，也不使用全局 --last。具体身份、可用额度及历史通道限制以当前检查和获批真实验证为准；不自动换身份、provider 或凭据路径。
- 沿用现有审批卡与 append-only owner response，新增不可变会话授权快照，绑定议题、工作区、参与者及模型、材料和 skill 版本、权限、时间与调用上限。默认单次超时 180 秒、整场 20 分钟，owner 可在批准前调整；批准后扩大任一边界须重新授权。各轮原子占用该会话额度并继续受单次 cap 和主预算门约束；费用无法可靠计量时明确显示 UNKNOWN，不宣称美元硬上限已落实。
- 停止先阻止后续调用，再中断在途进程；重启后未确认结束的运行标记中断并保留证据，不自动重放。会话绑定创建时工作区，不能随看板切换改变。新授权机制接通并测试前，D30 旧门仍有效；不得借 originOwner 或常设免检文件绕过。

### 2.4 对外入口

- POST /api/collaboration/sessions：冻结议题、参与者、材料及边界，创建待批准会话；创建本身不发起模型调用。
- GET /api/collaboration/sessions：会话列表（议题、状态、阶段、调用数）。
- POST /api/collaboration/sessions/detail|approve|reject|start|cancel：body `{ session_id }`——detail 返回冻结快照、双席位观点与执行记录；approve/reject 走会话绑定管线的 append-only owner response；cancel 先阻止后续调用再取消在途派发。
- （2026-10-03 修正：本节原按草案写路径式 `GET /:id` 与 `POST /:id/cancel`，落地统一为上列 body 式端点，以实现与契约 v1.52 为准，不保留两套并称已实现的接口。）审批沿用现有响应入口，进度沿用看板 SSE。重复审批响应、重复事件与并发请求不能重复派发或占用额度。后续 MCP 只作为这些服务的受控入口，不建立第二套权限逻辑。

---

## 3. 执行顺序

1. 为黑板存储、上下文可见性和会话额度写隔离测试；实现 SQLite 存储与工作区隔离。
2. 为 Codex/Claude 默认真实 runner 路径补输出解析、模型绑定、权限配置和进程取消的聚焦测试与实现；不能仅用注入的假 runner 证明取消有效。
3. 扩展既有审批流为单场授权，测试额度并发占用、撤销、边界变化、预算拒绝和旧 D30 派发不受影响。
4. 实现固定阶段协调器与四种 skill 模板，测试观点交换、引用校验、共享重试、故障转移关闭及重启后不重放。
5. 接入看板创建、审批、进度、结果和停止；更新 API 契约与 D87 的运行状态说明，再做浏览器交互验收。
6. 运行隔离机检，修复本 Goal 引入的问题；真实派发前核查在途任务，在具体获批的会话内完成双模型验证并记录回执。

---

## 4. 验收规格与停止条件

- [ ] 两个模拟参与者完整运行时恰好 7 次调用；一次共享重试后不超过 8 次。失败、超时、重复事件和并发请求不突破上限。
- [ ] 独立提案时双方互不可见；评审只见对方指定版本和获准材料；越权读取、伪造作者、扩权 skill、覆盖原文均被拒绝。
- [ ] 实际默认 runner 可停止在途 fixture 子进程，停止后没有下一轮；重启和工作区切换不会串话或自动重派。
- [ ] 看板浏览器实测创建、审批、阶段推进、结果、失败和停止；HTTP/DOM 冒烟不代替视觉与交互验收。
- [ ] 使用 tests/setup.ts 隔离用户配置、主账本和模型 CLI；执行相关单测、npm.cmd run typecheck、npm.cmd test、npm.cmd run test:isolated 及 git diff --check，记录本轮退出码与结果。
- [ ] 在单独批准的真实会话中确认两种模型的运行身份、材料传递、相互评审与修订。回执记录有效批评、采纳修改、保留分歧、耗时、可得的费用信息及哈希锚点；模拟通过不写成真实通道通过。
- [ ] 若权限无法落实、身份/通道限制未解决、资源边界无法执行或取消失败，停止该通道验证并记明原因；不通过降低权限或替换模型凑绿。

本 Goal 可在适用机检和真实验证满足后进入 AUTO_ACCEPTED；DONE 仅由 owner 明确接受。普通实施不自动提交、推送、安装全局包或改变凭据。

---

## 5. 执行记录

- **第一片初版（2026-10-01）**：`src/orchestration/collaboration-blackboard.ts`（node:sqlite 存储层：会话/参与者/材料/授权快照/追加式观点/执行记录；与 GOAL-050 items.json 黑板互不共用）+ `tests/g084-blackboard.test.ts` 10/10、全量 744/744、typecheck 0。（初版自评"完成"被 Codex 独立复核推翻——owner 转呈，见下条；原记录保留不改写。）
- **Codex 独立复核轮一（2026-10-01，owner 转呈）——第一片主体验收**：Codex 以 `.test-fixtures/g084-review-boundaries.mjs` 独立复现五个边界缺口：①中途重试挤占正常额度（6 正常+1 重试）；②cancelled 会话仍可 setPhase；③两席位可绑定同一运行实例（作者归属含糊）；④getVisibleContext 不返回材料正文（协调器无法重建上下文）；⑤recordExecutionResult 可二次改写、抹掉原始错误。
  修复：额度三类上限分别核算（正常按 call_count−retry_count 单独 ≤7、总 ≤8，中途重试不挤占）；setPhase/bindRunInstance 终态冻结；同一会话内运行实例与席位一一对应（跨席位重绑拒绝）；上下文按席位返回冻结正文+来源（未获准席位连条目不出现）；执行记录一次结算（仅 started 行可落结果，二次结算拒绝，原始证据保留）。
  回归：`tests/g084-blackboard.test.ts` 15/15（新增中途重试/终态推进/重复身份/材料正文/重复结算五用例，原十条保留）；Codex 复现脚本验证副本（`.test-fixtures/g084-review-boundaries-verify.mjs`，仅将二次结算包入 try/catch）输出五项全部符合预期；`npm.cmd test` 749/749 exit 0、`npm.cmd run test:isolated` 749/749 exit 0、`npm.cmd run typecheck` exit 0（完整输出存档 `.test-fixtures/baseline-2026-10-01/*-full-2026-10-01b.stdout.log`）。未提交、未推送、未发起真实模型派发。
- **Codex 独立复核轮二（2026-10-01，owner 转呈）——一次结算的 started 绕过补齐**：Codex 以 `.test-fixtures/g084-settlement-nonterminal-review.mjs` 复现：recordExecutionResult 接受任意字符串——先以 `started` 结算（置 ended_at_utc 但 status 仍 started）、再以 `pass` 结算两次均成功，第一份错误证据被覆盖。修复：结算状态白名单 `pass/fail/timeout/interrupted`（运行时拒绝 started 与未知状态）+ 数据库 `ended_at_utc IS NULL` 双条件兜底。回归：g084 17/17（新增结算白名单与跨状态二次结算两用例）；owner 确认复现脚本输出 firstAccepted=false、secondAccepted=true（后者为合法首录，无证据可覆盖）；`npm.cmd test` 751/751、`npm.cmd run test:isolated` 751/751、typecheck 0（完整输出 `*-full-2026-10-01c.stdout.log`）。owner 放行：补完此处即可进入 §3.2；其余四项修复本轮无重做证据。
- 边界：本片仅存储层。协调器与 skill 模板（§3.4）、审批会话授权化（§3.3）、看板入口（§3.5）、Codex/Claude runner 接线（§3.2，**含默认执行路径未传 registerKill 的取消缺口**——runT1 支持但 dispatch.ts:806 未传，runClaudeStreamRun 无该参数；不得以注入式模拟测试宣称真实路径可取消）均未动；owner 2026-10-01 放行：结算绕过补齐后即可开工 §3.2。
- **§3.2 开工——默认真实 runner 取消接线（2026-10-01，owner 放行后）**：红灯先行——`tests/g084-default-runner-cancel.test.ts` 真实 spawn fixture 子进程、零 runner 注入（D84 旧测试全为注入式，不覆盖默认路径）；接线暂摘除复现两红：pipeline cancel 报 "no killable child process right now"、claude runner 不注册句柄致 fixture 挂满 60s。修复：dispatch.ts 默认 runAdapter 向 runT1 透传 registerKill（t1-runner :126/:383 本已支持，属漏传）；claude.ts `ClaudeStreamRunOptions` 新增 registerKill 并在 spawn 后注册树杀句柄（经 SpawnFn.kill→killProcessTree）。绿灯：两用例 2/2（默认路径取消 671ms 结算 INTERRUPTED；claude 句柄 558ms 注册并杀停，非超时非零退出）。验证：g084-blackboard 17/17；`npm.cmd test` 753/753 exit 0；`npm.cmd run test:isolated` 首轮 752/753——pi-rpc-completion-state-machine 一例 exit 63：**首次失败，复跑未再出现**（后续在能力注入轮的独立全量中再现，升级为可复现间歇失败，见下条登记）；typecheck 0。完整输出存档 `.test-fixtures/baseline-2026-10-01/*2026-10-01d*.stdout.log`。§3.2 剩余：Codex/Claude 输出 schema 解析、模型参数传递与绑定、工具权限配置——未动。未提交、未推送、未发起真实模型派发。
- **§3.2 续——模型绑定/工具权限/输出 schema 能力注入（2026-10-01，owner 认可取消接线后）**：合同新增 `tool_restriction {flag, value?}` 与 `output_schema_flag` 两个可选声明（validateAdapterContract 校验旗标形态）+ `capabilityArgs` 构造器——工具限制 fail-closed（请求限制而合同未声明即抛错，"无法落实批准的执行配置的通道不作会话参与者"），schema 未声明静默降级（mush 侧逐轮校验引用/阶段/语义，降级不降责）；runT1 与 runClaudeStreamRun 均在合同静态参数之后、运行时 prompt 之前注入能力参数；`applyModelVariant` 新增补位追加路径（声明 model_flag 但参数无占位的通道，旗标对补在 prompt 之前；G009 占位重写行为不变，回归锁定）；internal 专用通道新增 `restrictTools`/`outputSchema`（不来自 HTTP body），schema 固化到回执旁 `dispatch-<id>.output-schema.json`，fail-closed 检查置于派发入口、先于预算门与审批卡。聚焦测试 `tests/g084-runner-capabilities.test.ts` 6/6（回声 fixture 真实 spawn，零网络零模型：追加绑定/占位重写回归锁/限制注入/入口拒绝/schema 下发回读/claude 直连）。
  验证：`npm.cmd test` 760/760 exit 0；`npm.cmd run test:isolated` 首轮 759/760——**pi-rpc-completion-state-machine 同一用例再现（三次独立全量中第二次；stderr=Managed Pi RPC fail-closed: agent-settle-timeout），升级登记为可复现间歇失败，根因尚未确认**：并行负载是待验证假设，本轮改动的影响尚未排除；单文件 32/32、共享模式恒绿；未顺手修；复跑 760/760 exit 0。typecheck 0。完整输出存档 `*-full-2026-10-01e*.stdout.log`。
  边界：`--output-schema`/`--sandbox`/`--disallowedTools` 等旗标值本轮以 fixture 声明验证机制面；真实通道旗标与行为待获批实弹核验后写回合同（本轮零模型调用）。§3.2 机制面至此完成；mush 侧观点语义校验在 §3.4 协调器落地。未提交、未推送、未发起真实模型派发。
- **§3.2 续二——实际合同接线 + 工具限制表达力 + 结构化结果解析（2026-10-01，owner 复核四点后）**：
  ① 实际合同接线（依据本机 `--help` 实录，**实弹行为未验证**）：codex（0.156.1）补 `model_flag: '-m'`（applyModelVariant 补位追加使其首次可绑定变体）、`tool_restriction_args: ['--sandbox','read-only']`（help possible values 实录含 read-only）、`output_schema_flag: '--output-schema'`（help 实录 `<FILE>`，文件运输）；claude（2.1.281）补 `tool_restriction_args: ['--tools','','--strict-mcp-config']`（help 原文 "Use \"\" to disable all"——空字符串是合法旗标值，禁用全部内建工具；--strict-mcp-config 只认 --mcp-config 声明的 MCP）与 `output_schema_flag: '--json-schema'`（help 实录 `<schema>` 为 inline 值，`output_schema_inline: true`）。
  ② 工具限制表达力重构：`tool_restriction {flag,value?}` → `tool_restriction_args: string[]`——支持合法空字符串值与组合参数序列；校验拒绝空数组、允许空元素；fail-closed 语义不变（未声明/空数组在派发入口即拒，先于预算门与审批卡）。
  ③ schema 双运输：file（codex）写回执旁文件下发路径；inline（claude）直接下发 JSON 文本；internal.outputSchema 按合同 `output_schema_inline` 分流。
  ④ 结果解析：claude 解析器新增 `structured_output` 提取，与 result 文本**并存保留**（不互斥不覆盖），runClaudeStreamRun 结果透出 `structuredOutput`；mush 侧观点语义校验仍留 §3.4。
  测试：g084-runner-capabilities 9/9——按 owner 指定姿势**从实际合同构造器出发**（withEchoExecutable 仅替换执行文件为回声 fixture）：codex 一次性断言模型绑定+read-only+schema 文件运输（并锁定 context_management=none 的 dsh 缝合组装不被能力注入破坏）；claude 断言 --model 重写+空字符串禁全内建工具+组合参数+inline schema；另 structured_output 解析/保留两例与 file 运输一例。
  验证：`npm.cmd test` 763/763 exit 0；`npm.cmd run test:isolated` 763/763 exit 0（本轮独立模式未再现 pi-rpc 间歇失败，与其间歇性一致，不构成对任何根因假设的排除）；typecheck 0。完整输出存档 `*-full-2026-10-01f.stdout.log`。未提交、未推送、未发起真实模型派发。
- **§3.2 收尾——结构化结果管线 + Codex 权限方案（2026-10-01，owner 复核两点后）**：
  ① 结构化结果管线补链：**Codex 复核**（owner 转呈）以 `.test-fixtures/g084-structured-pipeline-review.mjs` 复现——claude runner 已返回 structuredOutput，但默认 runAdapter 重包装处丢弃，派发 PASS 后只剩 2048 字符 stdout_tail。修复：RunAdapterResult 新增 `structuredOutput`（重包装透传）；DispatchRecord 新增 `structured_output`（完整对象，不经 tail 截断）；回执 JSON 新增 `structured_output` 段落持久化，协调器可从 record 与回执两处读取。回归（g084-runner-capabilities 10/10）：完整默认管线下正文 3000 字符（tail 截断如实标注）与结构化观点并存、结构化对象独立存活、回执 JSON 回读一致；复现脚本输出 structuredPayloadSurvives=true。
  ② **Codex 权限方案（本机事实核查后的明确结论；owner 复核修正措辞）**：讨论会话五维对照——写保护（`--sandbox read-only`，help possible values 实录）✅；内建工具关闭——**当前配置未满足，等效配置尚未确认**（codex exec help 未列出 --tools 等价旗标，但"help 没有旗标"不足以证明无法配置；read-only 沙箱内 shell 工具仍存在、可执行只读命令）；MCP 关闭 ⚠️ 未核实（`codex mcp` 管理外部 MCP，exec 时是否加载未确认）；功能工具（web_search 等）⚠️ 未核实（存在 config 开关，默认状态未确认）；读取范围——**当前配置未满足，等效配置尚未确认**（模型可读整个 cwd/工作区，未见限制到获批材料清单的配置）。**结论：暂停 codex 参加要求隔离上下文的真实会话，直至等效配置被核验并实弹证实；不据此断言工具本身无法支持**。claude-code 为候选（fixture 验证注入面，实弹未验证）。
  ③ 证据记录机制（owner 复核修正：**非线性分级**，帮助证明接口声明、fixture 证明参数传递、行为测试证明限制是否执行——三者验证对象不同，不排单一高低）：会话授权快照将按条目记录**验证对象、方法、覆盖范围、工具版本及配置指纹**，配置变化后重新判断证据是否适用；任何维度未达行为级验证即不得宣称该通道满足隔离要求。
  ④ 首次权限核验路径（owner 指定）：经既有 D30 审批，用合成材料做独立受控探针，避免"先通过会话准入才能验证准入条件"的循环。
  验证：`npm.cmd test` 764/764 exit 0；`npm.cmd run test:isolated` 764/764 exit 0；typecheck 0。完整输出存档 `*-full-2026-10-01g.stdout.log`。未提交、未推送、未发起真实模型派发。
- **§3.3——单场会话授权（2026-10-01，owner 认可结构化补链后开工）**：
  ① 黑板层：授权快照新增 `isolation_required` 与 `capability_evidence`（按条目记录验证对象/方法/覆盖范围/工具版本/配置指纹，declared/fixture_verified/live_verified/unmet 并列非线性分级，配置变化后重判证据适用）；authorizeSession 对隔离会话 fail-closed 准入——每个参与通道 × 五个隔离维度（write_protection/tool_scope/read_scope/mcp_scope/recursion）均须行为级（live_verified）证据，缺任一即拒（当前无任何通道达标，真实通道准入保持未验证状态，与 owner 指示一致）。
  ② 管线层：internal 新增 `collab {session_id, seat?, kind?}`（专用通道，不来自 HTTP body）——单场授权替代 D30 逐单卡（D87）；会话工作区绑定校验（拒绝跨工作区执行）；**原子占额在预检门/预算门/主控门全部通过之后**（预算拒绝不占额），run 结算后如实回写 execution_log（pass/fail/timeout/interrupted，仅一次）；collab 派发关闭隐式故障转移、不进 Verifier（§2.3）；collab 缺席时 D30 旧门原样生效。黑板经构造器注入，缺省 fail-closed 不可用。
  ③ 会话授权卡：`createSessionAuthorizationRequest` 写 `collab-session-<id>.json`（kind='collab-session'，gate='GOAL-084-session-authorization'）复用 D30 卡目录与 append-only owner response；`respondSessionApproval` APPROVED→授权（隔离门生效）/REJECTED→取消；重复创建、重复应答 fail-closed。server /api/approvals/respond 新增 collab-session 路由（§2.4"审批沿用现有响应入口"）。
  测试：`tests/g084-session-authorization.test.ts` 8/8——隔离门缺证据拒绝/证据齐备通过、授权卡状态机与重复应答拒绝、collab 派发无 D30 卡且占额结算如实、8 次额度占满后拒绝（7+1）、撤销与跨工作区拒绝、预算拒绝不占额、旧 D30 派发仍停卡。
  验证：`npm.cmd test` 772/772 exit 0；`npm.cmd run test:isolated` 772/772 exit 0；typecheck 0；docs-reconcile PASS（契约 v1.51，48 版本节）；v1.46 聊天审批历史表述已加取代标注（闭合登记项 #1）。完整输出存档 `*-full-2026-10-01h.stdout.log`（sha256 `a2a2e3bd…`/`9efff2d2…`）。未提交、未推送、未发起真实模型派发。
- **§3.3 补强——授权范围强制执行（2026-10-01，owner 复核四处缺口后；Codex 复核 owner 转呈，复现脚本 `.test-fixtures/g084-authorization-scope-review.mjs`）**：
  ① **席位/通道/模型绑定**：collab 派发席位必填；派发适配器必须等于该席位批准通道；批准 provider 的席位核对合同 expected_provider；批准 model_id 的席位核对实际生效模型（model_id 或合同默认），未批准选模型的席位禁止携带 model_id。越权适配器/换模型此前均获 PASS——现已全部拒绝。
  ② **隔离会话执行配置从冻结授权派生**：isolation_required 的会话 restrictTools 强制开启（调用方遗漏不降限），限制参数必达 CLI；单次超时上限与请求比对——显式超出即拒，缺省回落到快照 single_call_timeout_s，派发快照记录实际生效值。
  ③ **证据硬化**：live_verified 不得由 help/fixture 方法支撑，覆盖范围须达行为级，且必须携带工具版本与配置指纹；参与者可声明 config_fingerprint，证据指纹不一致即证据不适用（配置变化重判）。
  ④ **审批卡全部来自冻结快照**：议题/参与者/材料/边界/证据/authorization_hash 一律取自快照，调用方不可传入显示文案——所见即所批。
  **全部拒绝点位于子进程 spawn（spawned.marker 不出现）与会话占额（call_count=0）之前**。测试：g084-session-authorization 12/12（新增席位绑定四连、隔离强制配置、超时上限、证据硬化四组负向回归）。验证：`npm.cmd test` 776/776 exit 0；`test:isolated` 776/776 exit 0；typecheck 0；owner 复现脚本首处越权即被拒。完整输出存档 `*-full-2026-10-01i.stdout.log`（sha256 `604202f8…`/`44861b6d…`）。未提交、未推送、未发起真实模型派发。
- **§3.3 补强二——批准配置/证据/整场时间三类边界（2026-10-01，Codex 复核 owner 转呈，复现脚本 `.test-fixtures/g084-config-time-review.mjs`）**：
  ① **执行配置指纹闭环**：新增 `contractPermissionFingerprint`（整份已验证合同 sha256，与 owner 复现构造一致）；派发前比对当前有效合同指纹与席位批准指纹，同适配器/模型换限制配置（read-only→danger-full-access）即拒。指纹取**变体应用后、档位注入前**的合同（档位是质量旋钮非权限面）。
  ② **证据按席位+配置核验**：隔离会话每席位必须声明批准配置指纹（缺失即拒），证据指纹须与席位一致——同适配器两席位不同指纹、只提供其一的证据不再放行；方法改正向白名单（live_probe/behavior_test/dispatch_receipt/behavior_replay，未知方法不构成可核验来源）；覆盖范围须非空且达行为级；行为级条目必填**可核查证据来源**（source 字段）。
  ③ **整场截止时间落地**：sessions 表新增 deadline_utc/session_timeout_min 列；首次成功占额时确定截止时间，后续调用占额前检查过期（过期拒绝且不占额不结算）；runner 超时钳到剩余会话时间（occupyCall 返回 remaining_ms）。
  测试：g084-session-authorization 15/15（新增配置指纹换装、按席位证据、整场截止三组负向回归；拒绝均早于 spawn 与占额）。owner 复现脚本的证据条目因缺 source 在授权门即被拒（fail-closed 正确行为），其三场景等价断言已入回归组。验证：`npm.cmd test` 779/779 exit 0；`test:isolated` 779/779 exit 0；typecheck 0。完整输出存档 `*-full-2026-10-01j.stdout.log`（sha256 `61eb1013…`/`be76781b…`）。未提交、未推送、未发起真实模型派发。
- **§3.3 补强三——证据来源核验 + §3.4 首片（2026-10-01，Codex 复核 owner 转呈，复现脚本 `.test-fixtures/g084-evidence-source-review.mjs`：source 只查非空，不存在的回执路径也获授权）**：
  ① **受控证据库核验**：黑板新增可注入 `EvidenceStoreLike`（宿主接探针/回执台账；测试注入合成解析器）。隔离会话准入时，每条 live_verified 证据的 source 必须能在证据库解析到已登记记录，并逐字段匹配（adapter/维度/方法/对象/覆盖/工具版本/配置指纹）、产物哈希须为 64 位十六进制、验证结果须 pass。来源未登记、记录 fail、指纹不匹配、宿主未注入证据库——四种情形一律保持未验证（fail-closed）。
  ② **记录更正**：上轮"旧复现脚本提前失败"不能单独作为后续边界闭合的证据——旧脚本因缺新字段提前失败，需更新后才能复用；三类边界以其自身回归直接覆盖为准。
  ③ **§3.4 首片——skill 模板层**：`src/orchestration/collaboration-skills.ts` 提供协调/提案/评审/修订四种版本固定的纯文本模板（每份带机器可检 JSON 输出契约与【禁止】执行边界；首版不执行 skill 附带脚本）；`collabSkillRegistrySha256()` 注册表哈希在会话创建时冻结进授权快照（`skill_registry_sha256`）。
  测试：g084-session-authorization 17/17（新增来源未登记/登记 fail/无证据库三负向 + skill 模板与快照冻结）。验证：`npm.cmd test` 781/781 exit 0；`test:isolated` 781/781 exit 0；typecheck 0。完整输出存档 `*-full-2026-10-01k.stdout.log`（sha256 `82c3bf3a…`/`1fcde2e0…`）。未提交、未推送、未发起真实模型派发。
- **§3.4——固定阶段协调器（2026-10-01，owner 认可模板层后开工；三点要求直接纳入实现与测试）**：
  ① **分配建议明确校验**：coordination 模板 `material_plan` 改为按席位分组 `{A: string[], B: string[]}`；引用未批准/不存在材料 ID 由"静默剔除"改为"拒绝并反馈"——校验失败原因写进共享重试的提示（【上次输出被拒绝】），重试仍越界则会话 failed。
  ② **正式 Schema + 校验**：`COLLAB_SKILL_SCHEMAS` 提供四阶段 JSON Schema（required/类型/禁增字段），`validateCollabJson` 零依赖校验器执行；语义层另核材料引用 ⊆ 实际发送清单、review 的 responds_to 必须等于协调器下发的可见回应对象；无效输出证据随派发记录保留（execution_log 记 runner 级结果，输出证据在 stdout_tail/回执）。
  ③ **模板变化与恢复**：每轮派发前比对批准的 skill 注册表哈希，不一致启动即失败零派发；重启遗留的 in_progress 会话——未确认调用标记 interrupted、整场不自动重派；完成以双方修订齐备为条件。
  额度复用：每轮经管线 internal.collab 原子占额（正常 7 + 共享重试 1 = 8 上限），无另建计数器；执行记录如实结算。
  实现：`src/orchestration/collaboration-coordinator.ts`（协调器 + DI 派发函数）；黑板新增 `failed` 终态与快照 `skill_registry_sha256`。测试：`tests/g084-coordinator.test.ts` 6/6——真实管线 + 阶段感知 fixture（恰好 7 调用/按席位材料引用/修订齐备完成）、共享重试 8 次、重试耗尽转 failed（call_count=3 后停止）、哈希漂移零派发、重启不重派、拒绝反馈入提示。验证：`npm.cmd test` 787/787 exit 0；`test:isolated` 787/787 exit 0；typecheck 0。完整输出存档 `*-full-2026-10-01l.stdout.log`（sha256 `79e0f18e…`/`df42df78…`）。未提交、未推送、未发起真实模型派发。
- **§3.4 补强——协调器五组边界（2026-10-01，Codex 复核 owner 转呈，复现脚本 `g084-coordinator-review.mjs`/`g084-coordinator-overlap-review.mjs`）**：
  ① **材料正文入提示词**：提案/评审提示从黑板读取获准冻结正文（`getVisibleContext` 含 content），manifest 与实际发送内容一一对应；席位只见自己的材料正文。
  ② **批准参数与完整输出**：每轮派发传递批准 model_id（participant.model_id）与该阶段正式 Schema（internal.outputSchema）；完整输出经 internal.onStdout 累积读取（stdout_tail 只有 2048 字符，4000 字符合法 JSON 不再被误判格式错误耗尽重试）。
  ③ **runner 失败不形成观点**：FAIL/TIMEOUT 按可重试处理（共享重试预算），失败派发不落观点；重试耗尽则会话 failed。派发/流程异常一律收口——会话转 failed 后原样上抛，不停留 authorized。
  ④ **模板哈希每次尝试前核对**（含共享重试），变更模板不得用于重试或后续轮。
  ⑤ **并发启动 vs 进程遗留**：黑板新增进程内活跃运行标记——同会话已有活跃运行时再次 run() 即拒（重复启动不是重启恢复）；无活跃标记的 in_progress 会话才按重启遗留处理（未确认调用标记中断、不自动重派）。
  测试：g084-coordinator 11/11（原 6 组 + 材料正文、模型/Schema/长输出、runner 失败不形成观点、异常收口、并发拒绝五组新增）。owner 两复现脚本实证：五场景（happy/failed/long/model/drift）全部符合预期；并发脚本在重复启动处即被拒。验证：`npm.cmd test` 792/792 exit 0；`test:isolated` 792/792 exit 0；typecheck 0。完整输出存档 `*-full-2026-10-01m.stdout.log`（sha256 `b0e85368…`/`205b91e9…`）。未提交、未推送、未发起真实模型派发。
- **§3.4 补强二——修订 manifest 真实性 + 跨句柄活跃标记（2026-10-01，Codex 复核 owner 转呈，复现脚本 `g084-two-handles-review.mjs`）**：
  ① **修订阶段发送获准材料正文**，manifest 改由实际组装内容派生（sentMaterials），不再直接复制分配计划——提示词正文、evidence 校验、manifest 三者同源。
  ② **活跃标记按"库路径+会话 ID"跨句柄共享**（模块级登记表，win32 路径归一化）：同进程两个句柄打开同一库时，第二次启动被判"已有活跃运行"拒绝，不再误判为重启遗留中断首场运行；跨进程判定不在本机制范围（会话运行为单进程形态）。
  回归（owner 指定完整检查口径）：同库双句柄两形态——脚本化派发（authorized 活跃）与真管线（in_progress 活跃，fixture hang 场景）——**第二次启动均被拒且不改会话状态，第一次均完整完成，无调用被误标 interrupted**。g084-coordinator 14/14。验证：`npm.cmd test` 795/795 exit 0；`test:isolated` 795/795 exit 0；typecheck 0。完整输出存档 `*-full-2026-10-01n.stdout.log`（sha256 `3b819908…`/`0747c460…`）。未提交、未推送、未发起真实模型派发。
- **§3.5 Codex 接续与交回 GLM（2026-10-02—03，尚未收口）**：接手已存在的 HTTP/UI 与 4 条 board 测试，补齐 HTTP 强制隔离、冻结模型/合同、可信宿主证据、共享 append-only owner response、readiness 与配置漂移拒绝、原审批目录跨工作区解析、持久化列表与启动不重放、集中回执、草稿/过期响应隔离、结构化结果及失败原因恢复。补证真实预检停止竞态（红灯 calls=1/spawned=true），在原子占额前检查停止并收口 interrupted，最终回归 calls=0/spawned=false。board 14/14 exit 0、typecheck exit 0；浏览器已验证七调主路径、ACL manifest、草稿保持和格式失败原因。较早版本有停止/无证据拒绝截图，最终重验、恶意文本/窄屏、契约/D87 对账仍待补。全量日志报告 805/809 fail 4（默认模式退出回执未取得；独立模式 exit 1），包含 Windows 脚本策略拒绝及 pi-rpc two-message settle 超时，不能称全绿。owner 2026-10-03 要求把剩余 §3.5 交回 GLM，具体清单与证据见 `docs/operations/goal084-glm-handoff-2026-10-03.md`；源码/日志哈希见 `.test-fixtures/g084-handoff-2026-10-03/manifest.json`。状态 PROPOSED，不自动收官；未提交、未推送、未发起真实模型派发。
- **§3.5 GLM 浏览器验收与文档对账收口（2026-10-03，本地验收收口）**：
  ① **浏览器验收**（隔离 fixture 服务 `g084-browser-9JKfCc` @127.0.0.1:54265，真实 spawn Node fixture 子进程、零模型/provider 调用；场景经 scenario.txt 切换；为满足"fixture 足够慢"增强 delay 文件支持）：
  - 阶段推进：UI 2 秒轮询实际采样到 分配建议(t≈1s) → 独立提案(t≈4s) → 交叉评审(t≈10s) → 修订方案(t≈16s) → 讨论完成(t≈19s)；总调用 7/8、重试 0/1、execution_log 7 行全 pass；A 席 manifest 仅 m1、B 席仅 m2（assignment 无材料）。
  - 停止：hang 场景（协调 10s）在途点击「停止整场讨论」——页面 fetch 捕获 HTTP 202：`stop_requested=true`、`cancel_requested=true`、`current_dispatch` 32hex、响应 `status='in_progress'`；badge 保持「讨论中」不提前显示已停止；终态「已中断」、调用 1、execution_log 1 行 interrupted、观点 0、outcome 原因「owner 停止了会话派发」，无下一轮。
  - 准入拒绝：unverified 场景 readiness 不满足 → 批准按钮禁用并显示原因（"席位 A 通道 fixture-a 维度 write_protection 缺行为级（live_verified）证据"）；强行 HTTP 批准 409 同因，状态保持 pending_approval、零调用、无 owner decision；点击「否决」→ 已取消 + 授权：已否决，`owner_decision=REJECTED` 落账。
  - 恶意文本：议题含 `<script>window.__topicXss=1</script>`、材料含 img/svg onerror 探针、fixture 提案正文含 img onerror——完成后四个 window 探针全 undefined、零 JS error、详情区 img/svg/script 元素计数 0、img 探针在两席观点以纯文本显示。
  - 390px 窄屏：scrollWidth 375 无横向溢出；创建→批准→讨论中→停止→已中断全程在窄屏可操作；观点文本 overflow-wrap:anywhere 折行正常。
  - 如实记录：停止后 0/300/600/1000ms 轨迹显示 UI 从旧按钮直接转「已中断」——本地取消收尾快于一次刷新轮询，「正在停止…」中间态在浏览器未捕获（窗口极短）；不提前显示为已停止的语义由 202 响应与 badge 轨迹证明。桌面整页截图两次超时未捕获，以视口截图替代（07 同时覆盖 XSS 文本化与窄屏）。
  ② **文档对账**：契约 v1.52 补齐（创建强制隔离+证据宿主注入、readiness 批准门+逐席位指纹漂移拒绝、owner response append-only、session_outcomes 终态恢复、重启不重放、集中回执、detail 字段、UI 实测注记）；v1.51 internal.collab `seat` 更正为必填（注记）；DECISIONS.md 追加 D87 运行状态补注（保留原决议）；Goal §2.4 路径式草案统一为落地 body 式并注记。docs-reconcile PASS（47 映射/v1.52 49 节/D87，exit 0）。
  ③ **全量失败复核**：2026-10-02 报告 805/809 的 4 个失败——persistence 两例单文件复跑 14/14 绿、默认全量复跑未再现；browse-native abort 与 pi-rpc two-message 复跑未再现。本轮 `npm.cmd test` **809/809 exit 0**（duration 105s）；`npm.cmd run test:isolated` 首轮在 persistence.test.ts:198 出现断言失败（actual=null，未取得该轮完整日志），复跑两轮 **809/809 exit 0**（完整日志存证）。**persistence Windows launcher probe 升级登记为可复现间歇失败**（观察 3 次：2026-10-02 两次 UnauthorizedAccess/AbortError、2026-10-03 一次 actual=null，模式不一致，根因未确认；g084-policy-probe 实证默认子进程 PS ExecutionPolicy UnauthorizedAccess、进程级 Bypass 后 0，但单文件与多轮全量默认环境恒绿，策略假设不能解释全部观察，不在本 Goal 顺手修）；pi-rpc two-message 本轮未再现（与其在册间歇性一致，不构成根因排除）。
  ④ **其余机检**：g076 基线 7/7（navViews=7 含协作入口）；g084 六测试文件 75/75；typecheck 0；本轮涉及文件 `git diff --check` exit 0。
  ⑤ **证据哈希**：browser-observations.json `415b8497…`、01-phase-completed-detail.png `c2394792…`、04-stopped-interrupted.png `6a5345b2…`、05-rejected-unverified.png `4fa0a06a…`、07-narrow-xss-as-text.png `4ce190f5…`（均在 `.test-fixtures/g084-browser-9JKfCc/`）；isolated-rerun.stdout.log `09b96cd6…`、g076-baseline.stdout.log `e4182b0e…`（`.test-fixtures/g084-final-2026-10-03/`）。
  ⑥ **状态**：§3.5 本地规格验收收口（含浏览器交互验收）。**Goal 保持 PROPOSED**——生产通道权限证据未核验、真实双模型会话未获 owner 单独批准（见 D87 补注）；未提交、未推送、未发起真实模型派发。
- **首场候选定向与 Antigravity 受控接线（2026-10-03，owner 定向"首场候选 = Codex + Antigravity"）**：
  ① **agy 受控化**（本机 `agy --help` 实录 2026-10-03）：合同默认参数移除 `--dangerously-skip-permissions`（自动放行）——与受控 sandbox 并存语义未知且其存在使隔离准入 write_protection/tool_scope 维度不可核验；受控会话注入 `--sandbox --disable-slash-commands`（terminal restrictions + 禁 slash 命令/skill 展开）；输出 schema 接 `--json-schema`（inline，help 实录支持 schema string）。**合同新增 `prompt_flag` 机制**（contract.ts + t1-runner）：agy `-p` 为收尾值参（prompt 必须紧随），capability 注入原会把旗标插在 `-p` 与 prompt 之间（2026-09-06 实弹 exit 2 教训），现由 runner 统一拼 `[...args, ...capability, '-p', prompt]`；validator 禁止 arguments 再含 prompt_flag。**行为变化披露：普通 agy 派发自此无自动放行**，遇权限请求行为未知，列为探针回归项（A7）。
  ② **agy 解析器增强**：parseAgyOutput 新增 structured 提取（record.structured_output 优先 → response 内嵌 JSON 一次内层解析 → 无包装字段时整段对象即结构化结果，与协调器 extractJsonObject 语义一致）+ 无已知文本字段时 text 回退原始 stdout（防"解析成功但文本为空"假象）。
  ③ **测试**（真实 spawn 回声 fixture、零模型调用）：adapters-agy 14/14（含受控配置红线断言、prompt_flag 不变量、structured/fallback 解析）；g084-runner-capabilities 11/11（新增 agy 实际合同端到端 argv 顺序：`--sandbox --disable-slash-commands --json-schema <inline> -p <prompt>` 且无自动放行旗标、模型变体原地绑定）；adapters-t1-runner 13/13（新增 prompt_flag 通道组装用例，未声明通道行为不变）。
  ④ **权限探针准备**：`docs/capability-probes/collab-permission-probe-plan-2026-10-03.md`——两通道 ×（五维 + schema 形状）共 14 项探针矩阵（Codex C1-C6、Antigravity A1-A8 含普通派发回归与 plan 对照），单一 prompt、合成材料、逐单 D30 审批卡点批后发起，结果按 §3.3 证据条目登记。**本轮零模型调用、零实弹**；探针全部通过后才进入一次授权的双模型讨论（7 调用 + 共享重试 1）。
  ⑤ **机检**：typecheck 0；默认全量 **814/814 exit 0**（日志 `.test-fixtures/g084-final-2026-10-03/full-agy-round.stdout.log`）；`test:isolated` **连续两轮 812/814 exit 1**——persistence Windows launcher probe 两例 spawnSync 10s 超时（status=null），单文件复跑 14/14 绿。**登记升级：persistence launcher probe 失败累计 5 次观察（2026-10-02 两次、2026-10-03 三次），本轮起 isolated 模式下连续可复现（此前二轮曾全绿）**；本轮查实环境常驻约 25 个宿主 MCP 子进程（mcp-sqlite×8、playwright-mcp×5、sequential-thinking×5 等，属宿主工具非测试残留，未动）——"isolated 并发叠加宿主 MCP 负载 → PowerShell 探针超 10s 超时"是当前有环境数据支撑的待验证假设，不排除其他因素；**该失败与本轮 agy 接线改动的因果关联同样未证明（无定向实验），不写"无关"**；测试逻辑本身单文件恒绿，不在本 Goal 顺手修。docs-reconcile PASS；本轮文件 diff --check 0。
  ⑥ 状态：Goal 保持 PROPOSED；未提交、未推送、未发起真实模型派发。
- **owner 复核修复轮：agy 解析缺口两处 + 边界与探针包收紧（2026-10-03，Codex 复核 owner 转呈）**：owner 独立复现（38/38 通过但 fixture 补出两缺口，证据 `.test-fixtures/g084-agy-review-ySiJxJ/review.json`——裸 JSON 七轮完成但记录 `structuredOutputAvailable=false`；包装 JSON/NDJSON 两轮后重试耗尽）：
  ① **缺口 2（解析优先级写反）**：parseAgyOutput 中 response 内嵌 JSON 先占用 structured 槽位、显式 `structured_output` 被静默忽略。修复：`extractStructured(record)` 提前到内层解析之前（显式字段最优先 → 内嵌 JSON 次之 → 无包装字段整段对象兜底）；新增并存回归用例（`EXPLICIT_WINS`）。
  ② **缺口 1（解析没接进管线）**：默认 T1 分支不调用 parseAgyOutput，runner 结果无 structuredOutput——裸 JSON 靠协调器整段 parse 侥幸完成，包装/NDJSON 必败。修复：合同新增 `output_parser` 声明（值域 'agy'；字符串可序列化、入权限指纹，不破坏合同 JSON 化）→ t1-runner 新增 `structuredParser` 选项（退出后对完整 stdout 解析一次，异常受控降级不伪造）→ dispatch 默认分支按声明注入并把 `structuredOutput` 透传进 `RunAdapterResult` → 既有链路（:1729 record.structured_output + 回执）自动落账。agy 合同声明 `output_parser: 'agy'`。
  ③ **完整管线回归**：g084-runner-capabilities 12/12（新增三形状直接派发断言 `record.structured_output` 全部等于协作对象）；g084-coordinator 15/15（新增 bare/wrapped/ndjson 三形状端到端七轮完成、零重试——接线前 wrapped/ndjson 必败，completed 即接线生效的端到端证明）。调试中修了自己 fixture 的 heredoc 转义错误（writeFileSync 字符串 `\\w` 落盘 `\w`，与被测代码无关）。adapters-agy 14/14、adapters-t1-runner 13/13。
  ④ **边界收紧（契约 v1.52 agy 注记改写）**：普通/讨论两套配置对照明确——讨论会话=强制注入受控参数+output_parser；普通派发=无任何放行旗标、权限请求行为未知，**A7 核验前不应把 agy 当作可自动执行工具的普通通道依赖**，不得为恢复旧行为加回自动放行。
  ⑤ **探针包升级为可点批格式**（docs/capability-probes/collab-permission-probe-plan-2026-10-03.md 重写）：14 包各含实际模型、完整 prompt 文本、argv 形态、timeout（120/180s）、预算上限（0.10 USD/包、合计 1.00）、可判定通过标准与证据落点；明确"探针成立 ≠ 维度通过"（行为不受限照样登记 unmet）；**A5 扩为递归面三清单**（slash/skill 展开、子进程派生、MCP 触发再派发——slash 禁用单独不证明无递归）；执行顺序 C6+A6 先行。
  ⑥ **机检**：typecheck 0；默认全量 **816/816 exit 0**（`.test-fixtures/g084-final-2026-10-03/full-agy-fixround.stdout.log`）；`test:isolated` 首轮 815/816——pi-rpc completion state-machine 另一例（"intermediate assistant tool-call turn…"，在册间歇家族，**本轮首次失败、复跑未再现**），**persistence launcher probe 本轮两例均绿**（上一轮连续两败后本轮过——其 isolated 失败的间歇性进一步印证，负载假设继续待验证）；复跑 **816/816 exit 0**（isolated-agy-fixround2.stdout.log）。docs-reconcile PASS；本轮文件 diff --check 干净。
  ⑦ 状态：Goal 保持 PROPOSED；未提交、未推送、未发起真实模型派发。
- **owner 复核修复轮二：agy NDJSON 流式优先级 + 探针包四处修正（2026-10-03，Codex 复核 owner 转呈）**：owner 独立复现（54/54 通过但三组 NDJSON 形状错存 FALLBACK，证据 `.test-fixtures/g084-ndjson-review-iUP4tt/review.json`）：
  ① **NDJSON 流式分支缺口**：上一轮只修了单对象分支——流式分支仍 response 内嵌 JSON 先占位，且 extractStructured 带 `structured === undefined` 守卫，早行占位后末行显式 `structured_output` 无法替换（sameEvent/acrossEvents/earlierExplicit 三组均 FALLBACK）。修复：提取语义改为**显式字段无条件采用（payload 与行顶层都查，最终结果行胜出）+ 内嵌 JSON/整段兜底仅补空位**；text 与 structured 一致取最终行。回归：adapters-agy 15/15（三组 owner 形状逐一锁定 + 内嵌补位不回归）。
  ② **C6 判定与实现不符**：codex 无结构化解析链（output_parser 未声明），回执无 `structured_output` 属预期——C6 判定改为**核验完整 stdout 形态**（裸 JSON/JSONL/文本包裹，可解析则验 schema 满足），"是否补 codex output_parser 链"作为探针结论记录，不在形状未知时预先猜测解析逻辑。
  ③ **预算口径修正**：单包 0.10 USD ×14 = **1.40**（原文误写整批 1.00）；整批不设自动强制总额，owner 可在任一包后叫停；**费用 UNKNOWN 的包不宣称真实费用硬上限**——0.10 是准入门阈值不是账单保证（Goal §2.3 同口径）。
  ④ **探针动作限定**：C3/A3 改用预置合成对照文件（工作区内 probe-inner.txt + 工作区外 probe-outside.txt，内容不同可证真读取）；C4/A4 禁触真实 MCP（只列清单 + 尝试不存在的 `mush-probe-nonexistent` 工具验失败行为）；C5/A5 改用本地哑 agent `.test-fixtures/collab-probe-assets/dummy-agent.mjs`（DUMMY_AGENT_OK，零网络零模型）——递归测试不再消耗真实模型额度；A5 三清单同步改写。
  ⑤ 机检：adapters-agy 15/15、g084-runner-capabilities 12/12、g084-coordinator 15/15、adapters-t1-runner 13/13（合计 55/55）；typecheck 0；默认全量 **817/817 exit 0**、独立全量 **817/817 exit 0**（`.test-fixtures/g084-final-2026-10-03/*ndjson-fixround*.stdout.log`——本轮两模式 persistence launcher 与 pi-rpc 均未失败，与其间歇画像一致，不构成根因排除）。未提交、未推送、未发起真实模型派发；Goal 保持 PROPOSED。
- **owner 复核修复轮三：D30 重跑丢执行配置 + 流式解析最终行语义 + MCP 探针边界（2026-10-03，Codex 复核 owner 转呈）**：owner 独立复现（`.test-fixtures/g084-probe-review-d89umx/review.json`）：
  ① **审批后执行配置丢失**：rerun 恢复 request 主体但丢 internal 的 restrictTools/outputSchema——fixture 从 BLOCKED_WAITING_OWNER 批准重跑到 PASS，实际 argv 无 sandbox/slash 限制/schema（审批所见 ≠ 重跑所跑）。修复：`DispatchRequestSnapshot` 新增 `restrictTools/outputSchema` 冻结字段（快照构造时随 internal 落账）+ rerun 恢复时**冻结值优先于调用方传入**（重跑不得降限也不得加限；旧记录未冻结回退调用方值，向后兼容）。回归：gp32-approvals 9/9——新增完整审批链用例（agy 实际合同 echo fixture：BLOCKED → grantToken → approved_via 重跑 → argv 含 `--sandbox`/`--disable-slash-commands`/`--json-schema <inline>` 且 `-p` 紧邻 prompt，快照断言冻结字段）。
  ② **仅含 response 的最终结果错存**：早行显式 DRAFT、末行仅 `response: FINAL` 时 structured 停在 DRAFT 而 text 已是 FINAL。修复：parseAgyOutput 改**每行独立计算**（行内显式 > 行内内嵌；后行覆盖前行——流式语义=最终结果行权威，text 与 structured 一致）；二轮三组形状回归不回归 + 新增 responseOnlyFinal 用例。adapters-agy 16/16。
  ③ **MCP 探针边界**：「调用不存在的工具被拒」只是失败基线——不能证明现有 MCP 被禁用、不能证明无法经 MCP 递归派发。探针文档改写：C4 双层判定（清单可见性 + `probe_echo` 哑工具对照——经 codex `-c mcp_servers.probe=...` 会话级注入，**注入可行性本身是核验项**）；**agy 无会话级 MCP 注入旗标**（`mcp` 为配置管理子命令）——A4 的"现有 MCP 禁用/经 MCP 递归"与 A5 第③条在哑工具对照可行前**保持未验证**，不以失败基线充数。新增预置资产 `.test-fixtures/collab-probe-assets/dummy-mcp-server.mjs`（stdio JSON-RPC，initialize/tools/list/tools/call 零副作用，本地实测回显正常）。
  ④ 机检：adapters-agy 16/16、g084-runner-capabilities 12/12、g084-coordinator 15/15、adapters-t1-runner 13/13、gp32-approvals 9/9；typecheck 0；默认全量与独立全量 **818/818 exit 0**（`.test-fixtures/g084-final-2026-10-03/*probe-fixround*.stdout.log`）。未提交、未推送、未发起真实模型派发；Goal 保持 PROPOSED。
- **owner 复核修复轮四：快照独立冻结 + 审批卡执行配置 + 解析四包装 + 哑 MCP 工具名校验（2026-10-03，Codex 复核 owner 转呈）**：owner 独立复现（`.test-fixtures/g084-freeze-review-3H54fk/review.json`——审批重跑与 response-only 两处修复已独立验证通过）：
  ① **schema 共享引用**：快照 `outputSchema` 存调用方对象的引用——待审批期间变异原对象同时改掉快照，重跑采用修改后内容。修复：快照构造对 outputSchema 做 JSON 深拷贝（独立快照 + 可序列化校验）。回归：gp32 用例内 caller 把 `schema.required` 变异为 12345 后重跑，argv 的 `--json-schema` 值仍是原内容、快照 immune。
  ② **审批卡缺执行配置**：卡补 `model_id`（**实际生效值**——未显式指定时为合同默认，审批者必须知道实际跑什么模型）、`restrict_tools + tool_restriction_args`（实际将注入的合同参数序列，合同缺失如实写 null）、`output_schema + output_schema_sha256`（本仓 sha256 大写惯例）。回归：gp32 用例读卡断言全部字段。
  ③ **内嵌 JSON 只查 response**：上一轮重构把扫描收窄到 response，丢了对 result/text/output 包装的支持（owner 四包装复现 structured=null）。修复：resolveLineStructured 的内嵌扫描与 text 提取同列表（response/result/text/output）。回归：四包装逐一断言 structured/text。adapters-agy 16/16。
  ④ **哑 MCP 不校验工具名**：tools/call 对任意名字返回成功——`mush-probe-nonexistent` 也"成功"，失败基线失真。修复：非 probe_echo 返回 JSON-RPC -32602。回归：新增 tests/collab-probe-assets.test.ts（spawn 哑 server 全协议走查：initialize/tools/list/probe_echo 成功/未知工具 -32602）。
  ⑤ 机检：相关文件 55/55（agy 16 + runner-cap 12 + coordinator 15 + t1-runner 13 + gp32 9 + probe-assets 1 按文件合计 66）；typecheck 0；默认全量与独立全量 **819/819 exit 0**（`.test-fixtures/g084-final-2026-10-03/*freeze-fixround*.stdout.log`）。未提交、未推送、未发起真实模型派发；Goal 保持 PROPOSED。
- **Codex 接续：固定 schema 探针审批准备收口（2026-10-03）**：保留 GLM 已完成的合同漂移绑定、审批三套可见渲染及资产迁入 tests/fixtures。查明旧两单被 2026-09-06 全局熔断拒绝且未含完整 schema/模型，原记录保留。新增只识别 C6/A6 的宿主准备入口与零执行路径：静态校验/独立快照/指纹/落卡，不调用 runner/liveness、不占预算、不复位熔断；批准后仍走所有原门，停机时 APPROVED 409且不写应答。准备记录不许以 real=false 重跑绕过授权，schema 探针不隐式故障转移。6 条准备回归红→绿、相关 gp32/probe-assets 合计17/17、typecheck0；宿主执行环境两种全量826/826 exit0（测试仍隔离HOME/账本，受限沙箱 Windows 失败对照原样留档）、g076 7/7、docs对账PASS。实际看板两张WAITING卡：C6 `70e4d1ceaf564a0fb6bacb0bd68113c4` / A6 `d8165a61f9f943c697cf0e14d92d838e`，浏览器确认所有执行字段可见、批准点击0；预算未增加、熔断哈希不变。契约v1.53。详情见 `docs/operations/goal084-schema-probes-ready-2026-10-03.md`；Owner尚需明确复位旧全局熔断并分别点批，未执行真实模型、未提交/推送，Goal仍PROPOSED。更正此前“owner独立复现”署名：这些复现来自Codex，由owner转呈，均不是owner正式验收。
- 前置核对证据：`docs/operations/baseline-and-batch-map-2026-10-01.md`（基线复跑与在途改动批次地图）。

- **Codex 接续：Owner 委托浏览器审批与真实 C6/A6 收口（2026-10-03）**：Owner 明确授权修复并自主浏览器审批，已复位旧全局熔断、逐卡批准；沙箱看板账本锁 EPERM 后核实空闲重启宿主实例，保留原账本/配置。实弹暴露并修复三项：Codex --config low 缺键（改 model_reasoning_effort=low 且不覆盖其他键）；agy schema 需 --output-format json（按 schema 条件注入，普通输出不变）；A6 high 模型与 LOW 冲突（固定 HIGH 并核对待批准包档位）。旧失败证据保留，新配置新卡。C6 实际 62906017698442c2a3bbf3c29337f135 PASS，完整裸 JSON 符合 schema；A6 实际 aab924a1435649eabc47a7fad41c2878 PASS，显式 structured_output 在记录/回执一致。最终两模式828/828 exit0、typecheck0、g0767/7；完整 stdout 与回执哈希对账。C6 可见 MCP 初始化、A6 usage35650 token，均不构成隔离证明；五维及真实七调用会话仍未验证，生产权限证据库尚待装配。审批署名为 Codex 受 Owner 委托，不是 owner 正式验收；Goal仍PROPOSED。详见 docs/operations/goal084-schema-probes-live-2026-10-03.md；未提交/推送。

- **Codex 接续：C3/A3 读取探针与上下文/拒绝解析收口（2026-10-03）**：按 Owner 委托浏览器逐卡点批，真实 C3 bac872e9658e44adadff3425753614cf 返回 cwd 外随机正文，当前 read_scope=unmet；A3 e3765624c3df463ca11c2d5e132e6a9b 原生轨迹证实内文件读到、外文件被 read_file 权限门拒绝，但无合法最终 schema 回答，完整权限仍未验证。修复 mush collab/probe 混用普通工作流造成旧输出/AGENTS/原生续聊泄入，以及 agy 空/拒绝包装冒充 structured_output 与末行空保留 DRAFT；红→绿和完整管线回归锁定。固定入口增C3/A3，未知资产拒绝覆盖，契约v1.54。最终两模式834/834 exit0，typecheck0、g0767/7、对账PASS；证据与停止点见 docs/operations/goal084-isolation-probes-2026-10-03.md。Codex候选关闭本机MCP但 unified_exec 仍true，未用于生产；AGY额外上下文部分来源已定位，精确token拆分未完成。当前Codex配置后续实弹按权限停止条件暂停，真实七调用会话未启动，Goal仍PROPOSED；未提交/推送。

- **Codex 接续：原生工具面与闭合配置 C7（2026-10-03）**：纠正 unified_exec=true 作为硬阻塞的过满判断；隔离假服务捕获真实 native 请求，shell_tool=false 移除命令工具，features.view_image/goals/tool_suggest 关闭相应入口，选定 gpt-5.5 的 apply_patch_tool_type=null 后只剩 request_user_input；强制未声明命令/补丁/读图/子agent/goal调用均被native路由器拒绝。新增哈希目录构造器及合同绑定，运行前检查资产/模型/版本/MCP，先于预算和模型执行，批准重跑复查。当前进程的C7准备激活该配置，不改provider/默认模型/凭据；重启须重建，不自动跨恢复沿用。真实C7 bc5b…批准→83ce4c0cd99e450fb6955414516de2fd PASS，五项自报BLOCKED、无写标记，不自动记五维live_verified。最终两模式840/840 exit0、typecheck0，契约v1.55；详见 docs/operations/goal084-codex-closed-profile-2026-10-03.md。权限证据库、Antigravity完整边界及真实双模型会话仍未完成，Goal仍PROPOSED；未提交/推送。

- **Codex 接续：生产受控证据库接线（2026-10-03）**：新增 FileCollaborationEvidenceStore，默认看板按工作区数据面取证；宿主登记接口无 HTTP 写入口，同 source 不可改写，批准时重新核验字段及产物哈希，拒绝缺失/损坏/路径逃逸（含 junction），不自动从派发 PASS 推断权限通过。既有 C7 五项仅登记 declared，新增 live_verified=0；看板恢复4790，未新增真实模型调用。新增6条回归，相关38/38、typecheck0。默认全量首轮842/846（Windows锁/launcher四处失败，根因未确认），persistence单文件14/14，单独默认复跑846/846、独立846/846，均exit0；首轮失败完整日志保留，契约v1.56、对账及diff检查通过。证据库机制已接通，逐维行为证明、运行身份、Codex配置重启恢复、Antigravity完整隔离与真实双模型讨论仍未完成。详见 docs/operations/goal084-evidence-store-2026-10-03.md。Goal仍PROPOSED；未提交/推送。

- **Codex 接续：同配置失败反例阻断旧正证据（2026-10-03）**：第七条聚焦回归红灯确认同配置同维度有 fail 反例时仍能解析旧 pass，已修复；失败产物不可访问不自动恢复旧通过，不覆盖历史登记。最终相关25/25、typecheck0、默认847/847与独立847/847均exit0、g0767/7、文档对账及diff通过，完整日志另存 .test-fixtures/g084-evidence-store-2026-10-03/conflict-final。此前846轮与Windows失败证据原样保留，根因未确认。空闲看板已重载最终代码，浏览器协作列表200且无会话；本轮零真实模型调用。剩余和哈希详见 docs/operations/goal084-evidence-store-2026-10-03.md；Goal仍PROPOSED，未提交/推送。

- **GLM 接续交接（2026-10-04）**：Owner 要求转交 GLM 继续，首场参会者保持 Codex + agy，议题为「评审 GOAL-084 的实现与遗留问题」。本轮新增 agy 项目/资产/版本/cwd 守卫、PreToolUse 固定脚本、A9入口、effort 冻结转发及原生聚合响应解析已落盘。前日两次 A9真实卡获批并结束，A9b实际 fa0b740a7d594f7ab7d633b70a5fa8cf PASS，原生60项工具广告目录仍在；只观察到一条 call_mcp_tool 的 native guard deny，不作为五维全通过。Codex 原C7原生头 provider=custom 与模板openai标签待核对。当前真实七调用会话未创建/批准/执行；契约尚v1.56，新增行为文档及完整全量待收尾。2026-10-04本轮零模型调用，相关7文件84/84、typecheck0、文档对账PASS；历史847/847不能代表新代码全量。4790不可访问、旧PID23788未找到，锁残留需接手重查。完整交接与下一步顺序见 docs/operations/goal084-glm-handoff-2026-10-04.md；Goal保持PROPOSED，未提交/推送。
- **GLM 续作：准入收口与首场真实双模型会话完成（2026-10-04，owner 委托浏览器审批授权内）**：
  ① **接续核查**：4790 停机（陈锁 pid 23788 已死，无监听），scan-inflight 无犬窗/工作树/在途；agy 仍 1.2.16 且档案重建指纹与 A9b **逐字一致（05c2a65b…）**——A9b 证据可沿用；**codex-cli 已升 0.160.0**（原 0.156.1）→ 档案指纹按设计作废（bd72f598…→生产口径 8194bb67…，含能力注册表 variants 叠加、变体应用后）。agy hooks 官方文档对 hook 自身超时/崩溃/不可解析输出**未定义**——guard 自失败语义的 native fail-closed 为登记缺口。
  ② **重启激活入口**：新增 `POST /api/collaboration/profiles/activate`（activateDiscussionProfiles：仅激活，不派发/不建卡/不占预算/不复位熔断/不执行探针；指纹口径=变体应用后，与席位一致）。回归 g084-probe-preparation 13/13（含确定性复现、参数注入 400、门脚本篡改 fail-closed）。
  ③ **codex 0.160.0 行为证据**：假后端实验（隔离 HOME+同名 stdio stub MCP 逐名 disable，限制参数与生产档案逐字节一致）——原生请求工具面仅 `request_user_input`；强制 apply_patch/exec_command/view_image/spawn_agent/get_goal 全部被 native 路由器拒绝且零文件写入。0.160.0 新行为：对不存在 server 仅下 enabled=false 触发 config 校验失败（invalid transport，二分定位）；生产 disable 的均为 mcp list 真实 server。**真实 C7 重探**（新卡 0519230c…，浏览器批准 note 署名 GLM 受 Owner 委托）：8401fa08… exit 0 PASS，stdout 五项 BLOCKED 且 sha256 与 0.156.1 时期归档**逐字节一致**（1253F53D…），工作目录零写入。
  ④ **生产证据库登记（15 条）**：agy 五维（A9/A9b 原生轨迹+审计+结果，coverage 含行为观察与如实缺口）+ codex 五维 behavior_test（0.160.0 实验）+ codex 五维 dispatch_receipt（真实 C7 重跑）；`forParticipant` 两席位均 5/5 live_verified。假后端不证明账号权益、自报不单独作机制证明、guard 自失败语义未验证等缺口随记录如实登记。矩阵文档：docs/operations/goal084-admission-matrix-2026-10-04.md（含 Codex provider 三层表述校准：模板标签 openai 入指纹不改，native 头 provider: custom，下游报 gpt-5.5）。
  ⑤ **首场会话**：材料按当前源码重新冻结（`.test-fixtures/g084-live-review-2026-10-04/review-packet-2026-10-04.json`，17,372 字符，不覆盖旧快照）；agy argv 长度实测（真实材料+最坏全材料分配+现实体量输出）最大命令行 25,290 / 32,767（余量 7,477），argument 运输可行。**第一场（5dacedfb…）协调阶段失败**：codex（LOW）把 `m1: 标题` 整行当 ID 回填 material_plan，语义校验如实拒绝，共享重试同样失败，会话诚实转 failed（2 次调用，零越权）。**第二场（7503ed94…）完成**：浏览器批准（note 署名 GLM 受 Owner 委托）后协调器接管，恰好 **8 次调用=正常 7+共享重试 1**，双方四阶段观点齐备（含真实交叉批评与保留分歧：证据库去重键 seat vs adapter+指纹、agy guard 自失败语义风险等级等），总时长约 7.3 分钟（<20 分钟上限）；浏览器详情验收+截图（real-session-completed-detail.png）。**因果更正（实证）**：第二场协调重试通过发生在 v1 模板＋拒绝反馈之下——看板进程先于模板编辑启动（ESM 缓存），其派发 prompt 无 v2 标记（派发 dda64bbc… 实查）；v2 模板（coordination/proposal/review 补"ID=m1 裸标识符，冒号/方括号后是标题"反例说明，注册表哈希随之变化）是**事后防御性加固**，看板重启加载后生效，不作为第二场成功的归因。全部 9 次真实调用（含 C7 重探）ledger ADMITTED 记账、费用 UNKNOWN（amount=0+cap 为准入门阈值）。
  ⑥ **机检**：g084-probe-preparation 13/13、g084-coordinator+session-authorization+board 48/48、typecheck 0；默认全量 **860/860 exit 0**（`full-default-2026-10-04.stdout.log` sha256 c19cc81c…）、独立全量 **860/860 exit 0**（de9865df…）；docs-reconcile PASS（v1.57/54 节）；`git diff --check` exit 0。关键产物哈希：codex 0.160.0 实验报告 1cc24484…、材料包 16cd1933…、会话详情 0baa9905…、截图 ca89c630…、长度实测 21d77035…。
  ⑦ **状态**：Goal 保持 **PROPOSED**——首场真实会话已按 §4 完成"单独批准的真实会话中确认两种模型的运行身份、材料传递、相互评审与修订"，但 **AUTO_ACCEPTED/DONE 仅 owner 决定**；剩余验收项（全量测试退出码已录、真实回执哈希锚点已录；Owner 正式验收待 owner）。未提交、未推送。

- **DeepSeek 接续交接（2026-10-04）**：Owner因GLM额度耗尽转交DeepSeek，参会者仍Codex+agy，已完成的8次真实讨论保留。代码已有A10–A14守卫探针及持久化header更新；本轮API核验A10/A11/A12/A13均终态PASS，A14无记录，新增行为尚未完成新全量。现场残留的A13所谓超时gate含字符串实际换行，node --check报SyntaxError，不能据此证明超时行为；已保留故障文件和哈希、确认无在途后恢复与src/备份一致的正常gate（44239949…），零派发激活200恢复讨论档案指纹05c2a65b/8194bb67，本轮零真实模型调用。A12崩溃fail-closed结论待排除同项目七类Deny和空Subagents参数校验；A11组件证据不得直接冒充席位同指纹完整准入。宿主聚焦32/32、typecheck0（默认受限环境PowerShell fixture三失败对照保留说明）。完整交接见 docs/operations/goal084-deepseek-handoff-2026-10-04.md，优先重做有效A13、完成A14并收口证据/持久化，不重复整场模型讨论。Goal保持PROPOSED；未提交/推送。

- **DeepSeek 续作：A11–A14 守卫层归因、有效超时测试与持久化收口（2026-10-04，owner 既有浏览器审批授权内）**：
  ① **A11 拒绝归因（排除项目 Deny 假阳性）**：原生 stream 四次工具步骤（view_file/write_to_file/run_command/invoke_subagent）逐字错误文本为 `tool call denied by pre-tool hook: mush authorized discussion forbids resource tools and recursive dispatch`——该文案只存在于 `agy-discussion-gate.mjs`，项目 deny 规则产生不了它；guard 审计对同一会话（5231375c…）按序追加四条 deny，`invoke_subagent` 记 `requested_subagents=0`，时间戳与 stream 一致。**`invoke_subagent` 不在本项目 deny 名单内**，故其阻断只能由 hook 解释；read/write/shell 的阻断同时受项目 deny 覆盖，不能单独归因 hook（如实写明）。
  ② **A12 归因**：注入 gate 是语法错误文件，原生错误文本点名 hook 名并附 Node `SyntaxError` 栈——hook 崩溃**未被忽略**，宿主 fail-closed 阻断（含 invoke_subagent）。交接中"可能只是独立 Deny 规则阻止"的替代解释被原生错误文本排除。
  ③ **A13 重做（有效超时）**：新卡 `7d04cf28…` → 执行 `0ad4e203…`。先 `node --check`（exit 0），再**本地独立验证**变体确实超过 hook timeout（隔离副本实测 `elapsed_ms=12107` > 5000ms、stdout 合法 deny JSON、审计 entry/exit 齐全）；真实派发四次工具步骤耗时 6.018–6.027s 后全部 ERROR（点名 hook 失败）⇒ **超过 `hooks.json` `timeout:5` 后调用未获放行（fail-closed）**；合成写目标未产生。旧 A13 卡（注入语法错误文件）不重放，原始证物保留。
  ③′ **A13 口径更正（2026-10-04 独立复核后）**：原写"guard 审计多数无 exit、宿主提前杀死 hook"**与审计字节矛盾**——实测 `audit-a13-run.jsonl` 为 **4 条 entry + 4 条 exit**，每对间隔 12009–12019ms（与脚本 `sleep(12000)` 一致），即 hook 进程跑完自身计划、无被杀证据；可支持结论只有"超时后调用未获放行"，不含超时是否终止 hook、也不含精确判定时刻。已在证据库追加撤回记录（`…/guard-probe/correction/withdraw-a13-hook-killed`，`subject=withdrawn:` + 原来源）并重登更正来源（`…/guard-probe/a13-hook-timeout-no-decision`），原记录与产物保留不改写；`register-a11-a14.mjs` 同步改为写更正口径，撤回由 `register-a13-correction.mjs` 负责，`resolve(原来源)` 已返回未定义（不再参与准入）。
  ④ **A14 完成**：gate exit 0 但 stdout 为截断 JSON；真实派发四次工具步骤 ERROR，错误文本 `failed to unmarshal result from hook … via protojson: … unexpected EOF` ⇒ 输出不可解析**不被当作放行**，解析失败即刻阻断。
  ⑤ **证据登记与适用性**：五条守卫层记录登记生产证据库（`register-a11-a14.mjs`，host-only、append-only、不改写 2026-10-04 的 withdrawn 记录），A13 更正后追加撤回 + 重登（`register-a13-correction.mjs`）。守卫合同指纹 `4e71fed2…`（`--agent mush-probe-open`，工具开放）**不等于**讨论席位 `05c2a65b…`；登记后讨论席位仍为 tool_scope/write_protection/read_scope/recursion=`unmet`、仅 mcp_scope live_verified ⇒ **讨论席位仍不满足五维隔离准入，不用守卫层结果顶替**（复核脚本独立确认 4 unmet + 1 live_verified）。
  ⑥ **持久化收口**：端到端重启恢复改用**完整管线 + fake runner** 覆盖（新增用例：REPORT 后新实例从磁盘恢复 status/stdout_tail/session_id/receipt_path/admission 与四段事件），并锁定三条证据边界——header 是**可变投影**、不承载 `structured_output`（完整对象只在回执 JSON）、事件行是 append-only 原始证据链；header 重写改为同目录临时文件 + rename（并发读不再可能读到截断首行），过时"一次性写入"注释更正。
  ⑥′ **持久化异常边界更正（2026-10-04 独立复核后）**：`saveDispatchHeader` 原用同一个 `catch` 罩住"首行解析"与"原子写入"，注入首次 `renameSync` 失败时**不报错反而补头重试**，产出 `header,header,event` 双头文件（复核实测 `attempts:2, reportedError:null, headerCount:2`，脚本 `.test-fixtures/g084-deepseek-independent-review-2026-10-04.mjs`）。已修：`catch` 收窄到只覆盖解析，写入失败直接上抛不重试；新增两例回归（注入 rename 失败→抛出且文件逐字节未变；首行撕裂→只补一条 header、事件行字节保留）；修复后同款注入复核 `attempts:1, fileUnchanged:true, headerCount:1, tempFilesLeft:[]`（`verify-persistence-fix.mjs`）。
  ⑦ **机检（持久化更正后重跑）**：persistence **18/18**（`persistence-fix.stdout.log`）、focus 38/38、typecheck exit 0、docs-reconcile PASS（v1.57/54 节/47 映射）、`git diff --check` exit 0；
  默认全量 **869/869 exit 0**（`.test-fixtures/g084-deepseek-final-2026-10-04/full-default-after-fix.stdout.log` sha256 `a65127b0…`）、独立全量 **869/869 exit 0**（`full-isolated-after-fix.stdout.log` sha256 `8c7ee32c…`）。
  更正前的 867/867 两轮日志（`full-default.stdout.log` `2de8c603…`、`full-isolated.stdout.log` `db8297cb…`）保留不改写。
  产物与哈希详见 `docs/operations/goal084-a11-a14-guard-evidence-2026-10-04.md`（含 A13/A14 gate 哈希、各轮原生归因 JSON、guard 审计快照与持久化修复复核）。
  ⑧ **现场收口与未验证项（如实保留）**：执行 `/api/collaboration/profiles/activate` 期间看板进程（PID 20664）自行退出、Windows 应用事件日志无记录，根因未确认；已按同一入口与端口重启（`node bin/mush board --port 4790`），gate 运行后恢复并与 src 逐字节一致，无合成写入残留。
  **看板已于 2026-10-04 17:19 用新代码重启（PID 27528）**：A15 是新增入口，必须加载新代码才能准备；该重启顺带让本轮持久化修复进入运行实例（此前记为待重载项，现已完成）。
  本轮新增真实派发 2 次（A13 重做、A14），均经 D30 浏览器逐卡批准、note 署名 DeepSeek 受委托，**不是 Owner 正式 Goal 验收**；费用 UNKNOWN；未提交、未推送。Goal 保持 PROPOSED。

- **DeepSeek 续作：席位准入适用性核验与 A15 席位身份演练（2026-10-04，owner 选定路径 C → ⑦）**：
  ① **适用性核验（只读，零模型调用）**：用当前源码重建席位合同（`05c2a65b…`，`--agent mush-discussion`）与守卫探针合同（`4e71fed2…`，`--agent mush-probe-open`）并逐字段对比——argv/静态参数/工具限制参数/输出 schema 参数/cwd/restrictTools/timeout/工具面**逐字段相同**，差异只有 `--agent` 取值与席位独有的 `agy_discussion_profile` 绑定；gate（`44239949…`）、`hooks.json`（timeout 5）、项目 deny 文件在两种配置下**逐字节一致**；两者 `init.tools` 均为 60 项（agent frontmatter 的 tools 列表不影响原生工具目录）。
  ② **A（治理）**：owner 认可结构等价，落 `DECISIONS.md` **D88**——仅"同一强制层"可采纳；故障语义（gate 崩溃/超时/输出不可解析）仍只属守卫指纹；禁止跨指纹登记与伪造来源。
  ③ **B（席位身份演练 A15）——关键负结果**：新包 A15（席位合同 + 基线 gate + 无故障注入；卡 `93a8bfbb…` D30 批准，note 署名 DeepSeek 受委托）→ 执行 `6c325fec…`（会话 `add97079…`，140s、num_turns=4）。该轮 28 条原生事件**没有任何 `step_type=tool/subagent` 步骤**，模型四次自报五项 BLOCKED——与 A9/A10 同一模式：席位 agent 定义（`tools: []` 与禁止条款）使模型不发起该类请求。**结论：席位身份下强制层未被演练，四维仍是缺证**（既不是反例、也不是通过）；以席位身份补证在结构上走不通（席位绑定会拒绝被改造的 gate：故障 gate 在位时 `profiles/activate` 500，恢复基线后 200）。登记按纪律为 `declared`（首次误标 `live_verified` 已用 withdraw 更正，原始记录保留不改写）；席位状态不变（`live_verified`={mcp_scope}，`unmet`={tool_scope, write_protection, read_scope, recursion}）。
  ④ **owner 决定 ⑦（`DECISIONS.md` D89）**：保持现状——不改席位 agent 定义、不换 agent、不新建指纹，四维作为**已知缺口**保留；讨论会话准入依据 = D88 结构等价 + `mcp_scope` 行为实证（A9b 原生硬拒绝）；不得把 declared/未演练凑成 live_verified、不得跨指纹登记；会话审批卡须逐项展示该缺口。**D89 不改变代码"每维须本指纹 live_verified"的判定**，属治理层对已知缺口的显式接受。
  ⑤ **机检**：A15 代码（`SchemaProbeId` 与 `DispatchRequestSnapshot.probeId` 类型 + 包分支）后 typecheck exit 0、g084-probe-preparation 15/15；默认全量 **869/869 exit 0**（`full-default-after-a15.stdout.log` sha256 `352f6472…`）、独立全量 **869/869 exit 0**（`full-isolated-after-a15.stdout.log` sha256 `f78b1c6e…`）。
  ⑥ **现场**：看板以新代码重启（PID 27528）后 `profiles/activate` 200、双席位指纹不变；gate 与 src 一致、无合成写入残留、无在途。本轮真实派发 1 次（A15），费用 UNKNOWN；未提交、未推送。Goal 保持 PROPOSED——**五维隔离准入在代码判定上仍未满足，不宣称收口**。
  详见 `docs/operations/goal084-seat-applicability-2026-10-04.md`（含字节级对比、选项表与负结果登记）。

- **DeepSeek 续作：准入政策接线 + 证据分类修复 + A15 因果收紧（2026-10-04，owner 复核三项后实施）**：
  ① **D89 执行矛盾已修（受条件约束的准入分支）**：新增 `src/orchestration/collaboration-admission-policy.ts`——宿主提供 `runtime/collaboration-admission-policy.json`（`loadAdmissionPolicy` 校验：每条缺口须带通道+席位指纹+维度+理由+**结构等价依据**（gate/hooks/project 三哈希+唯一差异+归档引用）+决策来源；文件缺失或非法=无例外，行为与旧版一致）。`createSession` 按当前证据算缺口集合，**缺口未被政策逐条接受即创建失败**；接受的缺口与政策编号写入授权快照（`accepted_gaps`/`policy_decision_ref`，参与 `authorization_hash`）；`assertCanAuthorizeSession` 批准前重算并要求与冻结集合逐条一致（证据变好不得沿用旧缺口、变差即拒）；`createSessionAuthorizationRequest` 把缺口逐条带上审批卡（会话详情 `snapshot` 同）。**证据等级不变**：缺口在快照里仍是 declared/unmet，分支只改变"是否允许带已知缺口批准"。
  ② **证据等级不再由文案决定**：`EvidenceRecord`/`CollabCapabilityEvidence` 新增显式 `verification: 'behavior' | 'declared'`（缺失=declared）；`forParticipant` 与 `assertCanAuthorizeSession` 的等级判定只看该字段（且方法须在行为白名单内），废除 `/行为|behavior/` 文案升级（它会把"尚无行为证据"这类否定句也升级，本轮已两次误登记）。旧记录不改写：靠文案命中的来源逐条 `withdrawn`，结论由显式重登的新来源承接（`register-explicit-verification.mjs`）。登记后：守卫合同 `4e71fed2…` = {tool_scope, recursion} 行为级；席位 `05c2a65b…` = `mcp_scope` 行为级 + 四维缺口。
  ③ **A15 因果收紧**：记录与文档改为"**可确认**本轮未发起、强制层未演练；**不可确认**是否由 agent 定义导致（四轮同模式仅相关性）、也不断言席位身份永远无法演练"；唯一有独立验证支持的是"故障文件会被席位绑定的哈希核验拒绝"（故障 gate 在位时 `profiles/activate` 500，恢复基线 200）。
  ④ **回归与机检**：新增 `tests/g084-admission-policy.test.ts` 7 例（无政策即拒 / 接受即放行且冻结集合一致 / 漏一维创建即拒 / 指纹不符不生效 / 政策文件校验 / 卡逐字带出缺口 / 维度枚举）；`g084-evidence-store` 增分类用例（文案含"行为"但显式 declared 不升级；缺字段保守 declared；非法取值拒绝）；受影响四文件 **52/52**；typecheck exit 0；默认全量 **878/878 exit 0**（`full-default-admission2.stdout.log` sha256 `5810cbc4…`）、独立全量 **878/878 exit 0**（`full-isolated-admission.stdout.log` sha256 `dd6c80e7…`）；docs-reconcile PASS（已识别至 D89）、`git diff --check` exit 0。
  ⑤ **现场**：看板以新代码重启（PID 32276，`profiles/activate` 与 `GET /` 200），准入分支自此在运行实例中生效；本轮零模型调用、零真实派发、未提交、未推送。**席位四维缺口仍被政策显式接受而非被消除**——五维隔离准入在代码判定上仍未满足。

- **DeepSeek 续作：失败反例硬前置 + 审批展示接通 + D89 fixture 验收（2026-10-04，owner 复核两处缺口后）**：
  ① **政策分支不再放行已有失败反例的配置**（owner 复现脚本实证：同指纹 `tool_scope=fail` 登记后会话仍被批准）：新增 `EvidenceStoreLike.failuresFor(adapter, fingerprint, dimension)`，与 `resolve` 的阻断规则同一口径；`createSession` 与 `assertCanAuthorizeSession` 都把"该通道+指纹+维度存在已登记反例（`fail`）"作为**硬前置**拒绝，并把适用反例集合随快照冻结（`failure_counterexamples`），批准前逐条比对——创建后新出现的反例同样拒（`失败反例集合与冻结快照不一致`）。证据库存在但无法枚举反例（缺 `failuresFor`）时拒绝。语义边界写清：**缺证可被政策接受，已证伪不可**。复现脚本现按预期在创建即抛 `已有失败反例…（政策 … 只接受"缺证"）`。
  ② **审批展示接通**：`src/web/sources.ts` 的审批投影补 `capability_evidence`/`policy_decision_ref`/`accepted_gaps`/`failure_counterexamples`（JSON 卡文件有字段 ≠ 审批者看见），`src/web/page.ts` 常用审批卡逐项渲染"隔离维度证据""已接受的已知缺口（含依据、gate 哈希、归档、决策来源）""失败反例（禁止批准）"。顺带修复：会话创建时的证据来源此前只查看板自建黑板，现补上**该会话黑板自身的证据库**（`evidenceStoreRef`），保证"管线绑定黑板"与"看板黑板"同源。
  ③ **回归**：`tests/g084-admission-policy.test.ts` 12 例（新增：反例即使政策接受也创建即拒；创建后出现反例则批准拒；证据库无法枚举反例拒绝；审批投影带出政策/缺口/证据 + 页面渲染三处文案）；受影响相关文件 56/56；typecheck exit 0；默认全量 **882/882 exit 0**（`full-default-d89.stdout.log` sha256 `99e9c3a5…`）、独立全量 **882/882 exit 0**（`full-isolated-d89.stdout.log` sha256 `7677b3b0…`）；docs-reconcile PASS、`git diff --check` exit 0。
  ④ **D89 fixture 验收（零真实模型）**：``.test-fixtures/g084-d89-acceptance-2026-10-04/` —— 真实 agy 席位合同（指纹逐字 `05c2a65b…`）+ 真实受控证据库 + 真实政策 + **注入 fake runner**（只 spawn 本地 `emit.mjs`，`realHarnessSpawned=false`）。实测：创建 201 且 `readiness.ready=true`；卡上 `policy_decision_ref=D88/D89 2026-10-04`、四维缺口逐条带 reason/等价依据/决策来源、证据 8 条（`mcp_scope` 行为级 + 四维 unmet/declared）、反例 0；看板投影同源（缺口集合一致）；审批卡渲染三处均出现；批准 201 → 冻结缺口集合与卡一致 → 仅 fixture runner 运行（fixture 输出不合 schema，会话按状态机 `failed` 收口，证明"批准后只运行 fixture"）。验收产物哈希见该目录 `acceptance.json`（`a49ef78f…`）。
  ⑤ **两项验收分别记**：**五维证据未全部通过**（席位四维仍是 `unmet`）与 **D89 条件准入可以满足**（政策逐条接受缺口 + 反例硬前置 + 冻结展示）是两件事，本轮分别验收、不合并表述。本轮零真实模型调用、未提交、未推送；Goal 保持 PROPOSED。

- **DeepSeek 续作：派发前反例检查 + 常用卡展示 + 隔离浏览器验收（2026-10-04，owner 三次复核后）**：
  ① **批准后出现的反例不再能占额**（owner 复现：先批准、再登记同指纹反例，`occupyCall` 仍成功、`call_count=1`）：新增 `CollaborationBlackboard.assertSessionAdmissible(sessionId)`，在 `occupyCall` 入口（**占额、spawn 之前**）重新计算适用反例并与快照冻结集合逐条比对，漂移即抛 `失败反例集合已变更（当前 [...] / 批准冻结 [...]）… 须重新核验并另建会话`。因 `dispatch.ts` 的 collab 分支每轮/每次重试都经 `occupyCall`，该检查覆盖首轮、后续轮与共享重试。复现脚本现按预期在占额前抛错、`call_count=0`。
  ② **常用审批卡真正接通**：新增共用渲染 `collabApprovalRows(cs)`，**同时**用于侧栏常用卡的 `approvalReportHtml`（此前只改在历史详情抽屉 `#approval-detail`）与详情抽屉；渲染"隔离维度证据""已接受的已知缺口（依据 / 等价依据含 gate 哈希 / 归档 / 决策来源）""失败反例（禁止批准）""准入政策"。
  ③ **浏览器验收（真实 Chromium，替换源码字符串检查）**：`.test-fixtures/g084-d89-browser-2026-10-04/run-browser-acceptance.mjs`（复用仓库既有 `.venv-pw` 的 Playwright；**必须异步 spawn**——Python 要连的是本进程内看板，`spawnSync` 会阻塞事件循环造成 goto 超时，本轮实测并改掉）。实测：点顶栏待办徽标展开右栏 → 侧栏卡可见；展开前卡体隐藏、点「详情」后可见；卡内可见文本含三处标签、**8 条缺口条目块**、四维维度名、等价依据（`gate 442399495213…` + 归档路径）、决策来源 `D88/D89 2026-10-04 (owner)`、`mcp_scope=行为级通过（behavior）`；批准按钮可见可用；批准 201 → 冻结缺口集合一致 → 仅 fixture runner 运行。截图 `approval-card-expanded.png`。
  ④ **fixture 数据面隔离更正**：此前 fixture 用 `CollaborationBlackboard.open(repo)` 打开了**生产** `D:\mush\collaboration\blackboard.sqlite`（owner 指出的第三点）。现改为独立数据根 `.test-fixtures/.../fixture-data`：黑板库、证据**副本**、政策**副本**都在 fixture 目录内，服务器 `admissionPolicyPath` 亦指向副本。**更正表述**：此前两轮 fixture 验收确实向生产黑板库写入过 fixture 会话记录（生产库 mtime 停留在 2026-10-04 21:22:14，为本轮改正前所写）；按要求**不删除**已有记录，只更正"未碰生产数据"的说法——运行期数据面现已隔离。
  ⑤ **机检**：`g084-admission-policy` **14/14**（新增：批准后反例阻断占额与重试；派发路径在占额前拒绝且不 spawn）；typecheck exit 0；默认全量 **884/884 exit 0**（`full-default-late.stdout.log` sha256 `c8d02e66…`）、独立全量 **884/884 exit 0**（`full-isolated-late.stdout.log` sha256 `d980ef39…`）；docs-reconcile PASS、`git diff --check` exit 0。本轮零真实模型调用、未提交、未推送；Goal 保持 PROPOSED。

- **GOAL-084 最终验收收尾（2026-10-04，DeepSeek）**：
  ① **生产看板重载**：按同一入口/端口重启以加载本轮修复（PID 31456，`GET /` 200；`/api/snapshot` 正常返回 `approvals=31`、`/api/collaboration/sessions` 8 条既有会话），只在空闲时操作，未派发、未建卡、未占预算。
  ② **Goal 顶部表述更正**：原"2026-10-04 生产五维准入证据登记完成"是过时表述（同日 owner 已撤回其中四项声明）。现改为如实表述：首场真实会话完成（8 次调用）；**D88/D89 条件化准入落地并经 HTTP 与真实浏览器两侧验收**（政策逐条接受缺口、创建/批准/占额前三道反例硬前置、快照冻结、审批卡可见）；**明确保留的限制**——席位五维证据未全部通过（`mcp_scope` 行为级，其余四维未演练缺口按 owner 裁定不由政策"消除"、也不用守卫层结果顶替）。依据行补 D88/D89，状态行指向验收回执。
  ③ **契约 v1.58**：新增章节记录准入政策文件与校验、快照新增冻结字段、创建/批准/占额前三道 fail-closed、证据等级显式 `verification` 判定、审批卡（含侧栏常用卡）逐项展示；顶部版本行同步 v1.57→v1.58。
  ④ **验收回执**：`goals/receipts/GOAL-084-receipt.json`（sha256 `7ee5581b…`）——8 项机检/验收条目（含两模式 884/884、真实会话 7503ed94…、两个 D89 验收脚本与哈希、真实浏览器截图哈希）、8 条 §4 验收规格逐条状态（7 verified + Owner 正式验收 pending）、准入状态（席位 `live_verified={mcp_scope}` / `unmet={tool_scope, write_protection, read_scope, recursion}`、守卫合同 `live_verified={tool_scope, recursion}`、政策哈希）、源码哈希与 7 条如实限制。状态 JSON 记为 `PROPOSED`，**不代替 Owner 正式验收**。
  ⑤ **结论（保持）**：Codex＋agy 的真实讨论已实现（首场 8 次调用、四阶段观点齐备）；**D89 条件准入已验证**（HTTP + 真实 Chromium）；**四维缺证作为明确接受的限制保留**。未提交、未推送；下一动作属 owner：正式验收或指定后续。

