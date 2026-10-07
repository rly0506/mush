# mush Board API 契约 v1

- 状态：`v1.70`（2026-10-06：GOAL-085 第三阶段第二片——`mush mcp` 本地 stdio MCP 薄入口（collab 五工具），零新端点；本文件为权威源）
- 宿主：`src/web/`（node:http，零依赖）；默认只绑 `127.0.0.1`（对外暴露 = 触发门 4，不实现）
- 序列化：JSON（UTF-8，LF 结尾）；SSE 用 `text/event-stream`，帧格式 `data: <json>\n\n`
- 错误约定：失败响应一律 `{ "ok": false, "error": "<human-readable>" }`
- 版本演进：v1 字段**只能向后兼容新增**；删除/改义/改型 = 破坏性变更，需头犬批准并同步 GOAL-007

## 威胁模型（GOAL-067 / D80 明示）

### v1.70 行为扩展（2026-10-06；GOAL-085 第三阶段第二片：本地 stdio MCP 薄入口）

- **`mush mcp [--board-url <url>]`**：受控讨论的本地 **stdio MCP** 薄入口（`src/mcp-collab.ts`，零依赖最小 JSON-RPC 2.0 实现，newline-delimited 帧；`initialize`/`tools/list`/`tools/call`/`ping`，未知方法 -32601，解析错误 -32700；serverInfo `mush-collab`）。**零新 HTTP 端点、零网络监听**——本进程只经 stdio 与启动它的本地客户端通信。
- **复用同一客户端与审批门**：HTTP 客户端已提取为共享模块 `src/web/collab-client.ts`（回环限制/禁重定向/请求与正文读取截止时间/协议校验），CLI 与 MCP 共用——MCP 不存在第二份客户端实现。board URL 在**启动参数**固定且必须本机回环（非回环/带凭据 → exit 64 拒绝启动）；**工具入参不暴露 board_url**，调用方无法改道。
- **五个工具**（`tools/call`）：`collab_check`（只读查询）、`collab_create`（**仅创建待批准会话，返回 `approval:'PENDING_OWNER_APPROVAL'`——不自动批准（D30），材料支持 `path`/`content` 与 `allowed_seats` 席位权限透传**）、`collab_status`（列表/摘要）、`collab_result`（JSON/Markdown；`out` 为本地文件——原子排他创建拒绝覆盖）、`collab_stop`（只发停止请求，终态以 status 为准）。**不提供 approve/reject 工具**。业务/边界错误按 MCP 惯例转为 `result.isError:true` 文本（协议层不崩）。
- 边界：工具错误不区分进程退出；本 server 常驻直到 stdin EOF（正常退出 exit 0）。skill 封装按 owner 排序随后再做。回归：`tests/g085-mcp-collab.test.ts`（5/5，子进程 stdio 实测协议帧 + fixture 看板 + fake runner，零真实模型）。
- **修复轮修订（2026-10-06，Codex 独立复核一越界三缺口后，同日）**：① **工具面不含文件系统**（owner 裁定 MCP 只接收材料正文、返回结果内容）：`collab_create` 的 materials 只接受 `content` 内联正文——`path` 明确拒绝（isError「path 不受支持」）；`collab_result` 删除 `out` 落盘参数——传入即拒绝且不创建文件；CLI 的文件能力保留。② **连接级初始化状态**（MCP 生命周期）：未收到 `notifications/initialized` 前只接受 `initialize`/`ping`/初始化通知，其余请求回 `-32600 "Server not initialized"`（此前 tools/call 未初始化也会执行）；`jsonrpc` 字段必须恰为 `"2.0"`（非 "2.0" → -32600）；缺 method 的无效请求（含空对象 `{}`）回 -32600，不再静默丢弃。③ **工具入参严格类型校验**：字段存在但类型错误一律 isError 拒绝（如 `effort:99`、`topic:123`、非法 `format`），不再静默丢弃后用默认值。④ **启动错误写 stderr**：非回环 `--board-url` 启动失败时 stdout 无输出（留给协议帧），错误在 stderr、exit 64。回归扩至 **7/7**（新增未初始化/非法帧/空请求、严格类型、path/out 拒绝、stdout 纯净断言；子进程 stdio 实测）。
- **修复轮修订二（2026-10-06，Codex 独立复核三残留后，同日）**：① **完整握手状态**——`McpSession` 增加 `initializeResponded`：`notifications/initialized` 通知只在 `initialize` 请求已被响应后才置 `initialized`，"只发通知不发 initialize"的绕过路径失效（后续请求仍 -32600 not initialized）；**请求 id 校验**：id 必须是 string 或 number（MCP 2024-11-05），对象/布尔/null id → -32600 且响应 id 恒为 null（不原样回显无效 id）；无法确定 id 的无效请求（如空对象）响应 id 同样为 null。② **严格类型校验补全**：`workspace_root`/`constraints`（string）、`refresh`/`isolation_required`（boolean）存在但类型错误一律 isError 拒绝——已声明字段全部覆盖，无静默省略。③ **MCP 前置错误走 stderr**：`mush mcp` 的未知旗标/重复旗标等用法错误写 stderr、stdout 零输出（非 MCP 命令不受影响）。回归扩至 **10/10**（新增绕过握手、对象/null id、字段类型补全、前置旗标 stderr 四例）。
- **修复轮修订三（2026-10-06，Codex 独立 SDK 客户端验收与四轮复核后，同日）**：**握手置位闭合**——`initializeResponded` 只在**合法的 initialize 请求**（有可响应 id、实际产生响应）时置位；无 id 的 initialize **通知**不回响应、不推进握手状态（此前"发无 id initialize 通知 + notifications/initialized"可绕过握手直接创建待批会话）。官方 SDK（@modelcontextprotocol/sdk 1.29.0）独立客户端验收通过：握手/ping/五工具发现、工具 schema 无文件系统与 board_url、零依赖零配置零调用（`.test-fixtures/stage3b-independent-sdk-client.json`）。回归扩至 **11/11**（新增无 id initialize 通知绕过用例）。

### v1.69 行为扩展（2026-10-06；GOAL-085 第三阶段第一片：CLI 薄入口）

- **`mush collab <check|create|status|result|stop>`**：受控讨论的 CLI 薄入口（`src/cli.ts`）。**零新 HTTP 端点**——全部子命令是既有看板 API 的 loopback 薄客户端（默认 `http://127.0.0.1:4790`，`--board-url` 覆盖；token 经 `GET /api/session/token` 获取，仅本机回环），底层完全复用看板的审批/编排/停止/账本。旗标并集扩充：`--adapter-a/--model-a/--effort-a/--adapter-b/--model-b/--effort-b/--topic/--material/--constraints/--refresh/--format/--out`；同名旗标重复出现时聚合为数组（`--material` 可多次，既有命令不受影响）。
- 子命令到端点映射：`check` → `POST /api/collaboration/check`（只读查询，`ready=false` 仍是成功查询 exit 0）；`create` → `POST /api/collaboration/sessions`（**仅创建待批准会话并返回 `approval:'PENDING_OWNER_APPROVAL'`、`request_file` 与 readiness——不自动批准（D30）**，批准必须由 owner 在看板审批卡完成；409 准入/版本 fail-closed 拒绝 → exit 2 原样原因）；`status` → `GET /api/collaboration/sessions`（无 `--session` 列表）或 `POST .../detail`（摘要：状态/阶段/授权/执行/调用数/席位/评审关系/结束结果）；`result` → `POST /api/collaboration/sessions/result`（`--format json|markdown`，stdout 输出导出内容本身、`--out <path>` 写文件并回 bytes）；`stop` → `POST .../cancel`（只发停止请求，终态以 `status` 为准；409 → exit 2）。
- 退出码约定：0 成功（含 check 的 ready=false）；2 看板业务拒绝（409）；3 看板不可达；64 用法错误（400/缺参/未知旗标/未知子命令）；1 其他失败。CLI stdout 不携带 caller token（回归断言）。
- 边界：CLI 不读取/不入库任何凭据；材料经 `--material "名称=路径"` 读本地 UTF-8 文件为正文（缺失 → exit 64）；不提供 approve/reject 子命令——完整审批面未实现前不绕过看板（既有约定）。回归：`tests/g085-cli-collab.test.ts`（5/5，fixture 看板 + fake runner，零真实模型）。
- **修复轮修订（2026-10-06，Codex 独立复核五缺口后，同日）**：① `--board-url` 只允许本机回环（localhost/127.0.0.0/8/::1），拒绝 userinfo 凭据 URL，`fetch` 一律 `redirect:'error'`（重定向即失败 exit 3），所有请求带有限截止时间（默认 30s，`MUSH_COLLAB_TIMEOUT_MS` 可覆盖）——材料正文永不外发出回环。② `create` 新增 `--request <file>` UTF-8 JSON 请求入口（与逐项旗标互斥；materials 支持 `{path}` 引用本地文件与 `allowed_seats` 席位权限原样透传），`--workspace` 透传为 `workspace_root`。③ 重复旗标统一处理：`--material`（多值）两种写法（`--material=x` 与 `--material x`）均聚合；其余标量旗标重复出现 → exit 64 明确列出。④ `--out` 默认拒绝覆盖已存在文件（exit 64，原文件保留）。⑤ 响应协议校验：200 但结构不符（缺 ok/result/sessions、非 JSON、markdown content-type 不符）→ exit 1，不输出 `undefined`；不可达（连接失败/超时/重定向）统一 exit 3。回归扩至 **12/12**（新增 7 例覆盖五缺口，含 mock 看板的重定向/超时/非协议响应用例）。
- **修复轮修订二（2026-10-06，Codex 独立复核四边界后，同日）**：① `--out` 改为**原子排他创建**（`flag:'wx'`）——existsSync 前置检查只为友好报错，检查与写入之间的竞态窗口同样被拒绝（EEXIST → exit 64，原文件保留）。② `check` 协议校验补齐必需成功字段（`ok:true` + `ready` 布尔值）；`stop` 协议校验要求 `ok:true` 且（`status:'cancelled'` 或 `stop_requested:true`），非协议 200 一律 exit 1，不再声称"停止请求已提交"。③ 响应**正文**读取纳入请求截止时间封装（`collabReadText`）——headers 到达后正文挂起的超时同样归 exit 3。④ IPv6 回环 `http://[::1]:…` 被正确接受（WHATWG URL 的 hostname 带方括号，剥离后比较）。回归扩至 **16/16**（新增并发 `--out` 竞态、check/stop 非协议、正文挂起超时、`[::1]` 四例）。

### v1.68 行为扩展（2026-10-06；GOAL-085 第二阶段：结果整理与本地导出）

- `POST /api/collaboration/sessions/result`：只读结果导出，沿用 caller token 防线；body `{session_id, format?: 'json'|'markdown'}`（缺省 json，非法值 400；未知/未登记会话 400）。数据只来自协作黑板与派发管线既有事实源（授权快照、观点、材料哈希、执行日志、结束原因、USD 台账），不写库、不建卡、不调用模型、不新增任何总结步骤。
- `format=json` 返回 `{ok,session_id,format,file_name,result}`；`result` 为完整导出文档（`schema=mush.collaboration-session-result`，`schema_version=1`）：`session`（状态/阶段/授权与执行状态/停止标记/调用计数/评审关系/授权哈希/模板注册表哈希）、`participants`（席位/通道/模型/强度/协调者/配置指纹）、`materials`（标识+sha256+来源+可见席位，**不含正文**）、`completion`（全体席位均有最终修订才 `complete:true`；否则给 `missing_revision_seats`、`last_phase_with_content` 与未完成说明）、`opinions`（各席位全部落板观点原文：回应对象/材料引用/发送清单/保留分歧/created_at；`body` 为模型原始 JSON 原文）、`end`（终态+结束原因+派发 ids；无终态记录为 null）、`fees`、`execution_log`（逐调用摘要行，不含原生流）、`evidence_references`（隔离维度证据/已接受缺口/失败反例/准入政策引用）。
- `format=markdown` 返回 `text/markdown; charset=utf-8` 附件（`collab-result-<id8>.md`），由同一构建器渲染、与 JSON 同源；看板详情区提供「导出结果 JSON / Markdown」按钮，经 Blob 本地下载，不落服务端文件。
- 费用可见性：逐派发对台账 `meta.kind='ACTUAL_COST'` 申报求和（超 cap 被拒的实付回写计入，与 `computeSpentUsd` 同口径）；无申报记录的派发一律 `visibility:'UNKNOWN'`、`declared_cost_usd:null`，全场无申报时 `total_declared_usd:null`——**UNKNOWN 不是 0**；台账申报≠账单硬上限。
- 排除项（设计固定，回归断言）：caller token、凭据类字段、派发记录原生流（stdout/stderr tail、raw_stream、完整原生审计事件）不进入导出；观点 `body` 原始 JSON 按约定允许导出；材料正文不导出。
- 结果页（`page.ts` 详情）：默认展示各席位最终修订（正文/立场/修订说明 changes/保留分歧 reserved_disagreements）并附逐席位模型/强度、会话状态与调用数；提案、互评与分配建议收进可展开「过程视图」（回应对象/材料引用/发送清单/原始观点 JSON）；无修订的席位**按该席位自己**的最后有效阶段回退显示（全场最新阶段过滤已废弃——A 已修订、B 只有提案时 B 的提案仍可见）；不合成"共同结论"，互评缺陷/建议标注「模型观点，未经核实」。
- **修复轮修订（2026-10-06，Codex 独立复核四缺口后，同日）**：① `completion.complete` 语义收紧为**当前双模型流程完成**（修订齐备 **且** 会话 `completed` 终态 **且** 恰 2 席），修订齐备这一子命题单列新增字段 `completion.revisions_complete`；失败/中断/历史三席位即使修订齐备也不再 `complete:true`。② `fees.visibility` 三态化：`DECLARED`（全部派发有申报）/**`PARTIAL`**（部分申报、部分 UNKNOWN——整场费用不完整，`total_declared_usd` 只是已知小计）/`UNKNOWN`（无任何申报），并新增 `declared_dispatch_count`/`unknown_dispatch_count`。③ 详情轮询重渲染保留 `<details>` 展开状态（过程视图按元素 id、卡内"来源与发送记录"/"原始观点 JSON"按观点卡 `data-vp`+summary 键控；跨会话切换不携带）。页面完成提示与导出 note 同口径收紧。回归 `tests/g085-session-result.test.ts` 扩至 **8/8**（新增：修订齐备但 failed、三席位修订齐备、全申报 DECLARED 三态闭合）；Chromium 修复轮验收 `.test-fixtures/g085-result-browser-fix-2026-10-06/`（展开后等 ≥2 次轮询仍展开、部分修订会话 B 提案按席位可见）。
- 历史读取保留：失败/中断/历史三席位会话同一路径可查看、可导出；历史三席位的批准/启动/取消入口维持 409（v1.62/v1.65 语义不变），不冒充双模型验收通过；不删记录、不改写历史状态/卡片/应答/回执。
- 回归：`tests/g085-session-result.test.ts`（5/5：完整结果含部分申报费用、缺修订失败、中断、历史三席位只读、待批准+未知会话；导出一致性与敏感字段排除）；真实 Chromium fixture 验收 `.test-fixtures/g085-result-browser-2026-10-06/verified.json`（桌面/窄屏/展开原文/双格式下载/停止/历史导出，fake runner 零真实模型）。

### v1.67 行为扩展（2026-10-06；稳定联通第一阶段）

- `POST /api/collaboration/check`：沿用回环 Caller Token；body 为 `workspace_root?`、两位 `participants[{adapter_id,model_id?,effort?}]` 与 `refresh?`。只读查询，不创建会话或审批卡、不占额、不调用模型。结构错误为400；已登记组合的准入或版本阻断仍200，`ok=true,ready=false,reason`；真实创建入口同一阻断为409。
- 响应新增 `checked_at_utc`、`participants`（服务端派生模型/强度/指纹）、`channels[{adapter_id,ready,checked_at_utc,frozen_version?,observed_version?,config_fingerprint?,reason?}]`、`real_reproduction{status:VERIFIED|UNTESTED,session_id?,receipt?}`、`account_quota=UNKNOWN`。`ready`仅表示当前配置、隔离证据/政策与原生版本满足检查，不证明账号权益或未来调用必成功。
- 仅缓存原生观测，按合同完整内容键控、最多30秒；`refresh=true`强制刷新。资产与接受政策每次重判，失败反例不缓存；创建、批准和启动预检均不使用展示缓存。批准拒绝发生在owner-response写入之前；启动仍早于首轮占额，逐轮原有检查保持。
- 正式成功索引只使用两份已核实、哈希绑定的D98/D99回执与其冻结详情；按席位顺序、通道、provider、模型、强度、配置指纹及实际原生版本精确匹配。缺文件、哈希变化、fixture根或任何选择变化均不外推为VERIFIED；UNTESTED不是准入豁免。
- 表单保留模型/强度选项，展示当前准入、组合实测与额度未知三个事实；模型不匹配当前档案时阻断，新强度满足现有准入但无实测记录时仍可创建待批卡。未参会通道不参与该场检查；旧卡与旧证据不改写，重启本身不使旧卡失效。

mush 是**单机 loopback 个人工具**，「本机即信任边界」，此为 owner 认可的设计立场：

- **Caller Token 的真实定位是 CSRF/跨站防线**，不是身份鉴别：
  - `GET /api/session/token` 可由任意本机进程无 Origin 头直接获取；Token 亦渲染于主页 `<meta>`；
  - 它有效拦截的是**浏览器跨站攻击面**（配合 Host 白名单防 DNS rebinding、Origin 校验、变更方法强制鉴权）——这部分是闭环的；
- **GET 只读端点免 token**：本机其他进程/用户本可读取同机文件，只读端点不构成额外暴露；含 `prompt_preview` 截断投影属已知可接受面；
- **UNC 路径一律拒绝**（fs-tree 等）：防止跨站请求诱导本机进程发起 SMB 认证（NTLM 凭据泄漏原语）；
- 对外网暴露不在威胁模型内（触发门 4，永不实现）。

### v1.63 行为扩展（2026-10-05；GOAL-085 D95 显式接受 Claude 原生版本漂移）

- **派发前的 Claude 原生版本门支持"owner 显式接受的漂移"**：`verifyClaudeDiscussionBinding` 在观察版本与合同绑定版本不符时**默认仍 fail-closed**；只有当 owner 登记文件 `runtime/collaboration-admission/claude/version-drift-acceptance.json` 的 `frozen_native_version` 与合同绑定值一致、**且观察版本被 `accepted_versions` 逐个列出**时才放行。放行不改变席位指纹（实测 `5b5096e9…` 不变）、不改变证据归属、不放宽模型/参数形态/资产哈希三道复核；放行事实写入派发记录新增可选字段 **`version_drift_accepted`**（`decision`/`accepted_by`/`frozen_native_version`/`observed_native_version`），并打一条 `console.warn`。登记文件缺失、坏 JSON、形态非法或列出别的版本 → 一律按原样拒绝。撤销 = 删除登记文件或移除版本；代码内不内置默认放行。回归：`tests/g085-claude-version-drift.test.ts`（6/6，含"指纹不变"与"只覆盖列出版本"断言）+ 零成本生产资产核对脚本 `.test-fixtures/g085-verify-version-drift-acceptance.mjs`。

### v1.62 行为修正（2026-10-05；GOAL-085 待批投影排除终态会话）

- **待批投影排除终态会话**：`/api/snapshot` 的 `approvals[]` 中，`kind='collab-session'` 的授权卡若其会话已进入**终态**（`completed` / `failed` / `cancelled` / `interrupted`），状态由 `WAITING` 改为新增值 **`SESSION_TERMINAL`**，并附 `session_terminal_status`（实际会话状态）与 `stale_reason`（人话原因）。语义边界：**原卡文件与历史一律保留、不写 owner response、不伪造决定**——只是不再计入"待批"（侧栏常用卡、待批计数、对话内联卡与"处理"按钮都按 `WAITING` 过滤，因此自动排除；审批列表仍如实展示该卡并显示失效原因）。会话状态由服务端只读查询（管线绑定黑板的 `getSession`），查不到时保持旧的 `WAITING` 行为，不误标。回归：`tests/g085-collab-session-projection.test.ts`（单元级 + 真实 HTTP：取消后会从待批移除、未取消的不受影响、卡文件与"无应答"事实均保持不变）。

### v1.61 行为扩展（2026-10-05；GOAL-085 终局优先级／协作表单模型初值／原生隔离实验）

- **答案由最后一个权威终局决定（终局优先级）**：权威终局 = 标识"本次运行已结束"的原生事件（claude `type:'result'`、agy `event:'result'`）。协调器的观点提取与 claude 通道解析器统一为——**只有最后一条终局有效**：该终局内优先显式 `structured_output`，其次解析终局携带的答案文本；**失败终局（`subtype≠success` / `status≠SUCCESS` / `is_error`）拒绝整段**，既不沿用更早终局的 `structured_output`，也不回退到更早的答案行；该终局里没有可解析答案即视为本轮无答案。原生流里**没有**权威终局时才回退（通道解析器的 `structured_output` 优先，其次最后一个非信封对象——fixture 裸 JSON、codex 文本输出）。修复前"倒序扫描 + 带字段才覆盖"会让早期草稿在两种情形胜出：最后成功终局只在文本里给答案（纯文本不可解析 → 回退早期结构化草稿）、最后终局失败（缓存字段绕过拒绝检查）。回归：`tests/g085-answer-envelope.test.ts`（终局优先级三例 + 两个信封集成例）。
- **协作表单的模型初值**：名册投影新增 `collab_default_model_id` = 讨论档案绑定的模型；协作表单用它作模型初值（**只影响协作表单**，普通聊天/派发默认模型不变），用户显式选过的模型继续保留，换犬时才回到绑定模型；未经验证的组合照旧被准入拒绝并原样说明原因。此前表单初值取名册默认模型（本机 codex 实测 `gpt-5.6-sol`），而证据按指纹 `8194bb67…`（`gpt-5.5`）登记——用默认值创建会得到正确的 409，属 UX 陷阱。
- **原生隔离实验（零付费，机器级事实）**：真实 `claude` 可执行文件 + 本地假 Anthropic 后端 + 合成凭据 + 隔离数据根（零真实模型调用、零费用）。实测：① 严格档案向模型后端广告的工具面**只剩 schema 工具 `StructuredOutput`**（无内建工具）；② 假后端强制回吐 `tool_use`（`Read`/`Write`/`Bash`）时 CLI **一律不执行**并回以 `No such tool available: X … disabled for this session`，**无落地副作用**；③ **严格配置**下工作区 `CLAUDE.md` **未被自动注入**（基线为 true）。措辞边界（owner 复核）：基线同时改动多个参数，因此**不把差异单独归因于 `--safe-mode`**；上下文结论只作**配置级事实**，**不升级 `read_scope`**。
- **证据登记（按证明对象分别登记，owner 2026-10-05 裁定）**：`tool_scope` 登记为该席位的**行为级**证据（`source=g085://claude-native-isolation-2026-10-05/claude-code/tool-scope-strict-surface`、`verification=behavior`、`result=pass`、指纹 = 席位指纹 `5b5096e9…`）；**证明对象**写明"本机 2.1.286、严格参数下只广告 `StructuredOutput`、强制 Read/Write/Bash 被 CLI 拒绝"。归属依据为**机器核对**（用生产 profile/注册表重建合同 → 指纹与席位一致；实验合同与生产合同唯一差异 = `claude_discussion_profile.workspace_root`；有效 argv 逐字节相同），并要求并列说明隔离 HOME／本地假后端／隔离工作目录与生产环境的差异。**不登记** `write_protection`（只有局部证明，不得外推为所有写入路径已验证）、`read_scope`、`mcp_scope`、`recursion`；**不加 D89 豁免**。登记后 Claude 席位 `tool_scope=live_verified`、其余四维 `unmet` → 仍不通过隔离准入。

### v1.60 行为扩展（2026-10-05；GOAL-085 身份门／证据运输／答案信封／逐席位强度）

- **运行时模型身份门（关闭 v1.59 的"已登记限制"）**：受控讨论派发在**执行成功**（exit 0 且未超时）时解析原生 `system/init` 上报的模型身份并与批准模型比对；**缺失、不可解析（UNKNOWN）或不匹配一律 FAIL**（此前只在解析到已知身份时比较，`UNKNOWN` 会静默放行）。FAIL 时**记录与回执都不保留**该次 `structured_output`，回执另记 `identity_failed`/`identity_reason`；超时或非零退出**不参与**身份判定（否则真正的 TIMEOUT 会被改写成"身份缺失"）。
- **回执保留原始流**：回执新增 `raw_stream`（≤64 KiB 直存原文）、`raw_stream_bytes`、`observed_model_id`。修复前 runner 会把 stream-json 归一成一行 final text 再返回，导致 `stdout_sha256` 锚的是**归一化文本**而非原始流（C11 实测：`17AAD74F…` 正好等于那条 102 字符结果 JSON 的 sha256，`8CA0B1C9…` 才是 29 450 字节原始流）。`system/init`、`tool_use`/`tool_result`、`permission_denied`、`task_*` 因此不再随回执丢失。
- **协调器答案信封解析**：观点提取口径统一为——① 事件行显式 `structured_output`；② **成功终局 `result` 事件**的答案文本（`result`/`response`/`text`/`output` 内嵌 JSON，含 agy 把结果对象嵌在 `result` 里的 NDJSON 形状）；③ 无信封标记的裸 JSON。**其余原生事件（`system`/`assistant`/`step_update` 等）不得整对象当作观点**，**失败终局（`subtype≠success`/`status≠SUCCESS`/`is_error`）不冒充观点**（该段整块不采信，含更早的草稿）。修复前的"只跳过同时带 `type` 与 `subtype` 的行"会同时制造两类错误：合法答案放在 `result` 字符串里时整行被跳过（连吃两次拒绝后会话 failed），只带 `type` 的 `assistant` 行反被当作观点对象。
- **逐席位强度选择**：`POST /api/collaboration/sessions` 的 `participants[].effort` 为**可选**字段——服务端按该通道合同声明的 `effort_levels` 校验（非法档位/非字符串一律 400），校验通过即**随授权快照冻结**；缺省沿用既有冻结默认（codex/Claude 讨论档案 `LOW`、agy 讨论档案 `HIGH`）。名册投影新增 `collab_default_effort`（界面初值与其同源，避免两处各写一份后漂移）；协作表单为每个席位提供强度下拉（档位取自该通道声明）。派发路径继续要求请求强度与冻结值**逐字相等**，批准后改强度仍被拒。强度按 §3.3 仍是**质量旋钮**：不参与 `config_fingerprint`，因此既有证据/准入口径不变；把强度纳入批准面属治理变更，需另立决议。
- **预算口径修复**：超 cap 的实付（decision=DENIED）此前被排除在 `spentUsd` 之外，导致"实际花掉的钱"读成 0、下一单零预估请求被 ADMITTED。现在实付一律计入（覆盖预估的判定不看 decision）。

### v1.59 行为扩展（2026-10-04；GOAL-085 Claude 通道与双／三模型讨论）

- **第三通道 claude-code（受控讨论档案）**：宿主装配 `claude_discussion_profile`（模型、规范化原生版本、独立讨论工作目录、空 MCP 配置与空 settings 两个资产哈希），并把这些写进合同指纹。受控参数顺序冻结：`--safe-mode`、`--tools ""`（禁用全部内建工具）、`--strict-mcp-config`、`--mcp-config <宿主空配置>`、`--settings <宿主空设置>`、`--disable-slash-commands`、`--permission-mode dontAsk`、`--no-session-persistence`；**不使用 `--bare`**（会改变加载与认证来源）。`--json-schema`（inline）与 `--output-format stream-json` 沿用；结构化输出同时进入派发记录与回执。派发前与批准重跑复核模型/版本/参数形态/资产哈希，任一漂移即拒；实际执行 cwd 从绑定派生，拒绝 cwd/carveout 覆盖。
- **独立零派发激活入口**：`POST /api/collaboration/profiles/activate-claude`（caller token 防线内，body 必须为空对象）。只重建 Claude 讨论档案并装入当前管线，返回 `claude_fingerprint`；不派发、不建卡、不占预算、不复位熔断，**不影响既有 codex/agy 档案与旧批准**。既有的 `POST /api/collaboration/profiles/activate` 行为保持兼容。
- **双／三模型会话**：`POST /api/collaboration/sessions` 的 `participants` 接受 **2（A/B）或 3（A/B/C）** 位，其余人数拒绝。服务端派生并冻结：席位、模型、强度（codex/Claude=LOW、agy=HIGH）、**评审关系** `review_relations`、额度与时限。双模型 7+1 次／20 分钟；三模型 13+1 次（协调 1＋提案 3＋两两互评 6＋修订 3）／40 分钟；单次上限 180 秒。客户端**不得**注入执行参数、证据或政策豁免（`execution`/`policy`/`review_relations` 一律拒绝）。
- **两两互评门**：三模型冻结关系为 `A→B,A→C,B→A,B→C,C→A,C→B`；双模型 `A→B,B→A`。提案与修订每席位各一条；评审每位作者对每个目标提案最多一条。自评、关系不在冻结集合、跨会话回应、重复评审、遗漏关系下推进阶段一律拒绝。每次评审只携带被评审的那份提案与该席位获准材料；修订只接收针对自己提案的全部评审。
- **存储迁移**：`viewpoints` 唯一键由 `(session_id, author_seat, kind)` 改为含目标的四元组（提案/修订目标恒为空串），使"每人每目标至多一条评审"可由数据库约束。迁移先备份、事务内重建表、保留历史 ID/正文/授权快照/回执，幂等且可回滚。
- **投影与界面**：会话详情与 `collab-session` 审批卡带出 `review_relations`；详情展示参会者数量、评审关系与计划调用数；结果按参会者数量渲染两列或三列，窄屏（≤700px）纵向排列。协作表单支持双／三模型选择、第三席位，材料可见范围按当前席位勾选（默认全选）。**侧栏常用审批卡**同样展示参会者／评审关系／额度时限／证据状态／已接受缺口（不只历史详情节点）。
- **Claude 证据纪律**：Claude **不自动继承** agy 的 D89 缺口政策；自报 BLOCKED 或"没有尝试工具"不得登记为行为通过，证据使用显式 `verification` 分类。认证、身份或隔离证据不足时如实停止真实会话准备，不换 provider、不降低限制。
- **审批备注（note）随决定提交（GOAL-085）**：侧栏常用审批卡的展开体提供备注输入框，批准/否决时随 `decision` 一起 POST；空备注不提交（保持服务端默认值）。此前 Web 审批面**不发 note**，而委托审批必须写明"谁受谁委托"，只能落到服务端默认值——该缺口已修。owner response 仍是 append-only。
- **设计内准入拒绝返回 409（GOAL-085）**：准入/黑板业务拒绝（隔离证据不足、缺口未被政策逐条接受、失败反例等 fail-closed 结果）以 **409 + 原样原因**返回；此前一律 500 `internal error (see server log)`，既误导使用者，也让设计内拒绝与真正的服务端缺陷无法区分。`InputError` 仍为 400，真正的内部错误仍为 500。
- **Claude 探针 C8 实测（2026-10-05，owner 逐单 D30 批准）**：受控档案下一次真实调用——回执 `exit_code=0`、`timed_out=false`、`structured_output={"body":"PROBE_SCHEMA_OK","stance":"support"}`。证明**受控参数集实际下发**到 `claude` CLI、**inline schema 运输生效**、结构化输出被完整解析进回执；**不证明**运行时模型身份（身份另走 nonce 证据）也不证明任何隔离维度。
- **已登记限制（未修）**：讨论派发路径目前**不比对运行时上报的模型身份**（合成实验：假后端宣称其它模型仍结算 PASS）。身份证明当前走 nonce 探针，合同层由绑定复核保证；把运行时身份比对纳入派发门属范围扩张，待 owner 决定。

### v1.58 行为扩展（2026-10-04；GOAL-084 D89 条件化准入与失败反例硬前置）

- **准入政策文件（宿主出具、owner 认可）**：`runtime/collaboration-admission-policy.json`，由 `loadAdmissionPolicy` 校验（`schema_version=1`、`decision_ref` 非空、每条缺口须含 `adapter_id`/`dimension`/`config_fingerprint`/`reason`/`equivalence{gate_sha256,hooks_sha256,project_sha256,differing,reference}`/`decided_by`）。文件缺失或结构非法 → 空政策，行为与旧版一致（任何缺口都拒）。看板宿主可用 `admissionPolicyPath` 覆盖路径；**政策只接受"缺证"，不覆盖已证实的失败**。
- **会话快照新增冻结字段**：`accepted_gaps[]`（被政策逐条接受的已知缺口，含理由、结构等价依据与决策来源）、`policy_decision_ref`、`failure_counterexamples[]`（适用的已登记反例，`result='fail'`）。三者随 `authorization_hash` 冻结；缺口条目在 `capability_evidence` 中的等级仍是 `declared/unmet`（本分支不提升证据等级）。`POST /api/collaboration/sessions/detail` 的 `snapshot` 与 `collab-session` 审批卡文件同步带出这些字段。
- **创建时 fail-closed**：未启用政策时任何缺口仍拒；启用政策时缺口未被政策逐条接受即创建失败；该通道+指纹+维度**存在已登记反例**即拒绝（不复用"未验证"通道）；证据库存在但无法枚举反例（缺 `failuresFor`）亦拒绝。
- **批准前重算并逐条比对**：缺口集合或反例集合与冻结值不一致即拒（证据变好不得沿用旧缺口、变差即拒、事后出现反例即拒）。
- **占额前复查（覆盖每一轮与每次重试）**：`occupyCall` 在占用额度前调用 `assertSessionAdmissible`，重算适用反例并与冻结集合比对，漂移即抛错且不占额、不 spawn。
- **证据等级判定改为显式分类**：登记记录新增 `verification: 'behavior' | 'declared'`（缺省=declared，保守）；`forParticipant` 与准入判定只读该字段（且方法须在行为白名单内），废止此前的 `coverage` 文案关键词升级。
- **看板审批卡（含侧栏常用卡）逐项展示**：`isolated 维度证据`（逐维状态+显式分类）、`已接受的已知缺口`（逐条：依据/等价依据含 gate 哈希与归档/决策来源）、`失败反例（禁止批准）`、`准入政策`；侧栏常用卡与历史详情抽屉共用同一渲染。JSON 卡文件含字段不等于审批者可见——浏览器可见性以真实浏览器验收为准（`.test-fixtures/g084-d89-browser-2026-10-04/`）。

### v1.57 行为扩展（2026-10-04；GOAL-084 档案激活与首场真实会话）

- **讨论档案重启激活**：新增 `POST /api/collaboration/profiles/activate`（caller token 防线内，body 必须为空对象）。宿主按当前原生观测重建两份讨论档案并装入当前管线合同表，返回 `agy_fingerprint`/`codex_fingerprint`（变体应用后口径，与席位批准/准备卡一致）。仅激活：不派发、不建审批卡、不占预算、不复位熔断、不执行探针或旧会话；旧批准仍按指纹漂移规则不自动沿用。codex 档案由最新原生版本/目录/MCP 清单重建——三者任一变化即产生新指纹，旧证据按设计失效（fail-closed）。
- **codex-cli 0.160.0 重建与 C7 重探**：0.156.1→0.160.0 后旧指纹 bd72f598… 作废，档案在新版本重建（批准指纹 8194bb67…）。0.160.0 行为变化：对**不存在**的 MCP server 仅下 `mcp_servers.<name>.enabled=false` 触发 config 校验失败（invalid transport）；生产派发 disable 的均为 `mcp list` 实际返回的真实 server（定义合并后合法），派发前 inspector 另查 mcp list 全部 enabled=false（fail-closed）。假后端行为实验与真实 C7 重跑（8401fa08…，exit 0，stdout 与 0.156.1 时期逐字节一致）证据均已登记生产证据库。
- **agy 原生聚合响应解析**（讨论档案合同内）：`--output-format stream-json` + schema 条件注入；NDJSON 流式分支按行独立提取（行内显式 structured_output > 内嵌 JSON 覆盖 response/result/text/output 四包装），后行覆盖前行（最终结果行权威，text 与 structured 一致）；原生聚合 response 与全部已完成步骤正文逐字吻合时才提取最后完成的答案；拒绝性终局（denied_actions 等）不冒充 structured_output；已知文本字段全部缺席时 text 回退原始 stdout。严格解析不丢原始流。
- **席位 effort 冻结**：创建会话时按档案类型固定 codex=LOW / agy=HIGH 冻结进快照；每轮派发传递批准 effort，入口拒绝升档或遗漏（`effort … does not match the approved effort`）。实际执行 cwd 从档案绑定派生（agy=档案 workspace_root），逻辑工作区不变；请求记 `execution_cwd`。
- **skill 模板 v2**：coordination/proposal/review 三阶段模板升级 v2——补充"材料 ID 是 m1 等裸标识符，清单行 'm1: 标题' 冒号后是标题不是 ID"的反例说明（首场真实会话协调阶段 codex 把整行清单当作 ID 回填 material_plan，校验如实拒绝、共享重试同样失败、会话诚实转 failed；**第二场重试通过发生在 v1+拒绝反馈之下——派发 dda64bbc… prompt 实查无 v2 标记**；v2 为事后防御性加固，看板重启加载后生效）。注册表哈希随正文变化，新会话冻结新值，旧快照不回写。
- **首场真实会话（7503ed94…，2026-10-04）**：Codex gpt-5.5 LOW + agy gemini-3.7-flash-high HIGH，议题"评审 GOAL-084 的实现与遗留问题"。恰好 8 次调用（正常 7 + 共享重试 1，协调阶段一次校验拒绝后重试通过），双方四阶段观点齐备，总时长约 7.3 分钟（<20 分钟上限），费用 UNKNOWN（记账 amount=0 + cap 为准入门阈值非账单保证）。同日首建会话（5dacedfb…）因模板 v1 歧义协调失败（2 次调用，诚实终态 failed），两场均经浏览器 D30 卡批准、note 署名 GLM 受 Owner 委托。五维准入证据登记与如实缺口见 docs/operations/goal084-admission-matrix-2026-10-04.md。
- **A9 闭合探针（2026-10-03 补记）**：固定准备入口 A9 = agy 档案绑定（项目 UUID/agent/hooks/gate 四类资产哈希+版本+模型入合同指纹）；执行前复核资产/模型/版本，实际 cwd 从绑定派生；PreToolUse 门只放行 finish（解析失败保持 deny），审计只记工具名/会话/哈希不记参数正文。两次 A9 真实派发经浏览器批准完成（A9b fa0b740a… PASS，原生 call_mcp_tool 拒绝实证）；60 项工具广告目录仍在，只观察一条拒绝，不作为五维全通过。

### v1.56 行为扩展（2026-10-03；GOAL-084 生产证据库）



- 宿主未显式注入 collaborationEvidenceStore 时，按各工作区数据面启用本地证据库 `<dataRoot>/collaboration/evidence`；创建会话从库中筛选通道与当前合同指纹精确匹配的证据。业务工作区切换仍沿用 D86 集中数据面，不在外部业务目录登记证据。
- 证据登记仅有宿主代码接口，无 HTTP 写入口。source 经哈希映射为登记文件名，不能当任意文件路径读取；登记与产物以独占创建写入，同 source 不能改写。登记的字段、方法、维度、时间、配置指纹和产物哈希须合法；源文件/产物经真实路径检查不得越出数据面。
- 每次解析（含批准时）重新检查登记及产物 SHA-256；缺失、损坏、哈希不符、路径逃逸或无法访问均保持未验证。HTTP 自报 capability_evidence 仍拒绝，显式宿主注入接口保持兼容。
- 同通道、同配置指纹、同维度存在已登记 fail 反例时，旧 pass 来源解析失效；不能选择另一份有利证据绕过反例。失败记录产物丢失也不自动恢复旧 pass，需要先处理失败配置和证据。
- 只有宿主已经审核的行为覆盖且 result=pass 条目作为 live_verified 候选；失败为 unmet，模型自报为 declared。字节完整性不等于结论正确，宿主仍须对记录的验证对象和覆盖范围负责。C7 五项自报登记为 declared，不补造五维行为证明，不自动授权讨论。

### v1.55 行为扩展（2026-10-03；GOAL-084 Codex 闭合配置）

- 固定准备入口新增 C7：Codex gpt-5.5、LOW、180秒、cap=0.10。宿主从原生 CLI 的版本、内置模型目录与 MCP 清单构造配置；这三类查询不调用模型，原始 MCP 配置不写日志，只取名称。调用方仍只能提供 packet_id，不能注入配置、目录或凭据。
- 配置保留 executable/provider/default model/普通 CLI 参数，仅移除选定 gpt-5.5 的 apply_patch 能力，并关闭 shell、读图、目标管理、工具搜索、插件、子 agent、hooks/memories 等入口，逐个禁用已配置 MCP。公开模型目录写成 catalog-<sha256>.json，路径/哈希/模型/原生版本进入合同绑定与指纹；其他模型目录记录不变。讨论配置改用 stdin 运输，避免参数加长挤占 Windows prompt 空间；普通通道不会注入这些限制参数。
- 合同 codex_discussion_profile 为宿主配置字段，不来自派发 HTTP body。restrictTools 或隔离会话生效时，在预算门/模型执行前核对目录哈希、选定模型、原生版本和有效 MCP 清单；有启用/未知状态 MCP 即拒绝。禁止与另行 cwd/carveout 控制混用。prepareOnly 只做静态文件核验，批准重跑重新核验实际状态。
- C7 准备在当前管线内激活该配置，保留 actor/provider/default model。旧审批合同指纹不匹配即失效。激活尚未持久化为普通账号配置；服务重启后须通过准备入口重建配置，旧审批不自动跨恢复沿用。
- C7 仅授权合成读写/echo/本地哑 agent，以及 MCP 可用性检查；不触真实 MCP 工具或子模型。response 的五项为 BLOCKED/AVAILABLE/NOT_ATTEMPTED，不能仅凭自报写 live_verified；完整会话仍须逐维受控证据和独立真实会话授权。费用 UNKNOWN。
- 原生诊断更正：unified_exec=true 不等于命令工具存在。installed-native fake-provider 请求与强制调用均证明 shell_tool=false 可移除/拒绝 exec_command、write_stdin；移除 apply_patch_tool_type 后补丁调用也拒绝。此为本机原生行为测试，覆盖边界见 docs/operations/goal084-codex-closed-profile-2026-10-03.md。

### v1.54 行为扩展（2026-10-03；GOAL-084 权限探针与上下文边界）

- 固定准备入口新增 C3/A3，现仅接受 packet_id=C6/A6/C3/A3。C3=Codex gpt-5.5 LOW、A3=agy gemini-3.7-flash-high HIGH；120 秒、cap=0.10。仅在宿主 runtime 内预置两份合成随机正文：一份在运行目录，一份在该探针 assets 目录；调用方不能指定路径/正文/模型/权限参数。审批 prompt 展示路径和 sha256，不包含正文；相同包复用未变的待批准卡。已有未知资产拒绝覆盖。
- C3/A3 仍是逐单 D30、无自动重试/故障转移的探针，不是受控讨论准入。进程 PASS 与行为维度通过分开记录：返回目录外随机正文即 read_scope=unmet；单纯未返回正文不得当作限制生效；可按本轮合成会话的原生轨迹补证。
- 协作 internal.collab 和固定 internal.probeId 不经过普通 work-stream 组装：只发送协调器/固定包本轮 prompt，不拼入旧输出、项目 AGENTS、交接章程，也不自动原生续聊。显式 stream_id/new_stream/resume_session/profile 控制在派发前拒绝，不占会话额度。普通非协作派发沿用原工作流行为。
- 此收口只覆盖 mush 自己的上下文拼接；native harness 自动加载的项目规则、skill/插件、MCP 与原生工具仍需独立行为验证，不宣称同步被禁用。
- agy 空 response / denied_actions 状态包装不作为 structured_output；NDJSON 最终结果无结构化回答时清除早行 DRAFT。原始 stdout 与拒绝证据保留，exit 0 的 runner 仍按 PASS 记录，观点合法性由协调器校验。
- 同日 C3 实测 read_scope=unmet；A3 native 轨迹显示目录内读取成功、目录外 read_file 被权限拒绝，但最终无 schema 回答，完整隔离仍未验证。未开放真实七调用讨论；详见 docs/operations/goal084-isolation-probes-2026-10-03.md。

### v1.53 行为扩展（2026-10-03；GOAL-084 C6/A6 审批准备）

- `POST /api/collaboration/probes/prepare` 只接受 `{packet_id:"C6"|"A6"}`，沿用 caller token / Origin / Host 防线。模型、schema、限制参数、档位（C6=LOW，A6=HIGH；agy high 模型必须匹配 HIGH）、180 秒与 cap=0.10 由宿主固定包生成；调用方不能注入 internal、provider、凭据或执行参数。
- 返回 201、dispatch_id、request_file、BLOCKED_WAITING_OWNER、reused、breaker_halted、execution_checks=NOT_RUN、fee_status=UNKNOWN。相同未变包重复准备复用原待批准记录。工作目录是宿主 runtime/collab-probes/<id>/workspace，仅登记合成目录，不切换 owner 当前工作区。
- 准备只做静态校验、独立快照、合同指纹与审批落卡：不调用 runner / liveness、不占主预算或派发预算，不复位熔断。prepared_only / probe_id 写入记录与卡片；准备不是行为通过证据。
- 停机时普通真实派发的 APPROVED 响应返回 409，尚不落 owner-response；REJECTED 仍可受理。复位必须 owner 显式执行现有 breaker/reset，批准不隐含复位。
- 获批重跑恢复限制/schema/合同指纹，仍重新检查预检、预算、熔断。准备记录不能借 real=false 重跑绕过审批；C6/A6 每次授权仅一次指定通道尝试，不隐式故障转移、自动重试或追加总结。
- 2026-10-03 实弹修正：Codex effort 经 `--config model_reasoning_effort=<level>` 下发；只改写该键，保留其他 `--config`。agy 请求 schema 时由合同 `output_schema_args` 追加 `--output-format json`，不请求 schema 的普通派发不追加；模型/档位/schema/伴随参数均写入或绑定冻结配置，新配置需新卡，不复用旧批准。C6/A6 格式探针已通过，五维隔离仍未验证；详见 `docs/operations/goal084-schema-probes-live-2026-10-03.md`。
- cap_usd 是既有准入门阈值，实际费用/账户权益在通道回执未提供可核验数据时仍为 UNKNOWN；不宣称美元账单硬限。真实双模型讨论准入依然需要五维行为证据，schema 探针不授予隔离会话资格。

### v1.52 行为扩展（2026-10-01 起草，2026-10-03 补齐；GOAL-084 §3.4/§3.5 协调器与看板）

- **受控会话看板端点**：`POST /api/collaboration/sessions`（创建，只生成待批准会话，创建本身不发起模型调用）；`GET /api/collaboration/sessions`（列表）；`POST /api/collaboration/sessions/detail|approve|reject|start|cancel`（body `session_id`）。批准走会话绑定管线（工作区切换不影响绑定），APPROVED 后自动获准执行（协调器接管）；`cancel` 先阻止后续调用再取消在途派发，响应 `stop_requested` + 状态保持运行中，终态以详情/SSE 为准，不提前显示为已停止。隔离会话在无受控证据库时批准被 409 诚实拒绝。
- **创建强制隔离与证据来源（2026-10-03 补）**：创建请求 `isolation_required:false` 或自带 `capability_evidence` 一律 400——权限证据只能由宿主受控证据库注入（服务装配项，不接受调用方自报；合成证据仅限测试 fixture）。创建响应 `201` 含 `session_id`、`authorization_hash`、审批卡 `request_file` 与 `authorization_readiness`；创建即生成 `collab-session-<id>.json` 审批卡。
- **批准门 readiness（2026-10-03 补）**：批准前复核三件事——快照强制隔离、受控证据准入（逐席位×逐维度）、每席位**当前**合同指纹与冻结快照 `config_fingerprint` 一致；任一不满足 → UI 禁用批准按钮并显示人话原因，强行 HTTP 批准 409（原因相同）。owner response 严格 append-only（应答文件已存在即拒绝），审批卡 `authorization_hash` 与黑板不一致拒绝受理。`approve` 200 = 已批准并自动获准执行；`reject` 200 = 已否决（会话取消，REJECTED 落账）；状态机拒绝（重复应答、终态）→ 409。
- **D30 派发审批卡的执行配置与合同绑定（2026-10-03 补，owner 复核后）**：审批卡（`dispatch-<id>.json`）与看板审批投影（`/api/snapshot` 的 `approvals[].dispatch`）新增**执行配置**——`model_id`（实际生效值：未显式指定时为合同默认）、`restrict_tools + tool_restriction_args`（实际将注入的合同参数序列）、`output_schema + output_schema_sha256`、`contract_fingerprint`（批准时生效合同的 sha256，变体应用后、档位注入前）；审批弹窗同栏展示。**重跑合同绑定**：请求快照冻结 `contract_fingerprint`，重跑（approved_via）时与当前生效合同比对——**不符即拒绝**（`contract has drifted … re-approve`），原记录保持 BLOCKED，旧批准不跨合同漂移沿用；未冻结的旧记录向后兼容（不核对）。快照中的 `outputSchema` 为独立深拷贝（待审批期间变异调用方对象不影响快照）。
- **终态 outcome 与重启恢复（2026-10-03 补）**：黑板新增追加式 `session_outcomes` 终态表——失败/中断原因持久化，重启后详情仍可见（`outcome.reason`）。服务启动时恢复持久化会话登记；遗留 `in_progress` 且无活跃运行 → `started` 执行行结算 `interrupted`（"服务恢复：此前调用未确认结束，不自动重派"）、会话转 `interrupted`，不自动重放。
- **集中回执（2026-10-03 补）**：collab 受控会话派发回执写集中数据面（`<dataRoot>/.mush-receipts`），不在外部业务工作区落 `.mush-receipts` 足迹。
- **会话详情**：`POST /api/collaboration/sessions/detail` 返回冻结快照（含 authorization_hash）、已批准/执行状态分开显示（`owner_decision` 与 `execution`：running/settled/not_started；会话状态 pending_approval → authorized → in_progress → completed/failed/cancelled/interrupted）、双席位观点（manifest 含材料哈希）、执行记录、`stop_requested`、额度计数与 `authorization_readiness`。
- **SSE 新增 `kind: 'collab'`** 帧：session_started/round_dispatched/round_settled/viewpoint/completed/failed/interrupted/run_settled。
- **通道受控配置（2026-10-03 补，同日 owner 复核收紧）**：Antigravity（agy）合同受控化与**普通/讨论两套配置边界**——
  - **讨论会话配置**（隔离会话派发，管线强制）：合同默认参数 `--model <id> --effort <level>` + 强制注入 `--sandbox --disable-slash-commands`（终端限制 + 禁 slash 命令/skill 展开）+ `--json-schema <inline>`（阶段 schema）；`prompt_flag: '-p'` 由 runner 收尾拼接（能力注入参数恒在 `-p` 之前——消除旗标被当作 prompt 的实弹教训）。合同 `output_parser: 'agy'` 声明通道解析器：派发记录携带 `structured_output`（裸 JSON / 包装 JSON（`response` 内嵌）/ NDJSON 三形状；显式 `structured_output` 字段 > 内嵌 JSON > 整段对象），协调器据此解析观点，不再依赖整段 stdout 兜底。
  - **普通派发配置**（聊天等非会话派发）：合同默认参数**不含任何权限放行旗标**（原 `--dangerously-skip-permissions` 已移除）——agy 遇到工具权限请求时的行为**当前未知**（提示/拒绝/挂起均有可能，待探针 A7 核验）。**在 A7 核验前，不应把 agy 当作可自动执行工具的普通通道依赖**：纯对话/只读任务不受影响（推断，同样待核验）；需要执行工具的普通派发请选用其他已核验通道。不得为恢复旧行为把自动放行旗标加回默认参数。
  - 旗标均按本机 `agy --help` 实录接线，**实弹行为未验证**；探针派发包见 `docs/capability-probes/collab-permission-probe-plan-2026-10-03.md`。
- **协调器（§3.4）**：固定七调流；每轮派发传批准 model_id 与阶段 outputSchema（通道未声明时降级）；完整输出经 internal.onStdout 累积（不经 2048 tail）；FAIL/TIMEOUT 可重试且失败派发不形成观点；派发异常收口会话转 failed；模板注册表哈希每次尝试前核对；同库跨句柄活跃运行标记（重复启动拒绝，不误判重启遗留）；修订阶段提示包含获准材料正文，manifest 由实际组装派生。
- **看板 UI**：新增「🤝 协作」视图（会话列表/创建表单/快照与边界/双席位观点/停止按钮），模型文本一律客户端 esc() 安全渲染（浏览器实测：script/img/svg 探针均按文本显示且不执行，390px 窄屏无横向溢出）；审批卡弹窗对 collab-session 卡展示冻结快照字段；批准与否决在详情中分开显示（已批准/已否决 与 执行状态独立）。

### v1.51 行为扩展（2026-10-01；GOAL-084 §3.2/§3.3 受控会话）

- **审批响应新增 `kind: 'collab-session'`**：`POST /api/approvals/respond` 对 `collab-session-<session_id>.json` 卡路由——APPROVED → 黑板授权（隔离会话按快照内证据条目 fail-closed 准入）；REJECTED → 会话取消。重复应答由会话状态机拒绝。
- **派发记录/回执新增 `structured_output`**：runner 提取的结构化结果完整对象随 DispatchRecord 与回执 JSON 持久化，不经 `stdout_tail` 2048 字符截断（GOAL-084 §3.2）。
- **派发 internal 通道新增 `collab`**（不接受外部 HTTP 请求指定）：`{ session_id, seat, kind? }`（**2026-10-03 注：`seat` 实为必填**，本节起草时的 `seat?` 与实现不符，以实现为准——席位缺失 fail-closed 拒绝）——单场会话授权替代 D30 逐单卡（D87）；占额在预算门/预检门之后原子执行，额度拒绝/撤销/跨工作区 fail-closed 拒绝；受控会话派发关闭隐式故障转移、不进 Verifier（§2.3）。collab 缺席时 D30 旧门原样生效。
- **会话授权快照新增 `isolation_required` 与 `capability_evidence`**：后者按条目记录验证对象、方法、覆盖范围、工具版本及配置指纹（非线性分级：declared/fixture_verified/live_verified/unmet 并列，声明存在 ≠ 权限生效）。

### v1.46 主流程修正（2026-09-05）

- `POST /api/chat` 保留异步 202，透传可选 `model_id`。输入消息不等于批准执行；聊天与重试均须 D30 单次审批。历史中关于聊天直接视作 owner 授权的描述以本条更正为准。（**2026-10-01 注：聊天部分的审批要求已被 v1.47/D83 取代——聊天豁免 D30；看板/CLI 非聊天派发仍按本条。**）
- 派发请求快照新增内部 `chat: { session_id, solo }`，不接受外部请求直接指定；审批及重试继承该关联，回复仍写入原工作区、原会话。
- 历史轮次新增可选 `status`；`REPORT` 如实区分 `BLOCKED_WAITING_OWNER`、失败与成功。重放 `ADMITTED` 帧可带 `payload.rerun_of`。
- 快照、派发 SSE 和聊天 SSE 增加 `workspace_root`；前端只在对应工作区更新任务与会话，切换后按工作区恢复本地会话选择。
- `first_task` 保留 `zero_config`、`free_adapter_id`，新增 `local_ready: string[]` 和 `channels`。每个 channel 包含 `adapter_id`、`provider_id`、`provider_name`、`active`、`local_status`、`availability`、`quota`、`api_access`。
- `local_status` 是 `READY | NOT_INSTALLED | CONFIG_MISSING`，只表示本地安装及配置路径检测；opencode 允许已安装但零凭据的首单准备路径。其余三个远端维度目前均为 `UNKNOWN`，不以本地配置、模型目录、历史 harness 缓存或免费标签代替供应商实证。
- 更正 v1.45 的旧说明：现有 `zero_config` 实际按 `probe_status === 'ONLINE'` 派生，非合同 `verified`；该信号本身不证明当前供应商余额或 API 权益。

### v1.50 布局变更（2026-09-06；D86 集中托管）

- **外部工作区数据面**：热切换到非宿主工作区时，任务池/聊天/派发台账/审批/令牌等全部落 `<宿主>/runtime/workspaces/<slug>-<路径哈希8>/`（确定性派生）；**目标工作区文件夹零足迹**（不创建 `.mush/`、`runtime/`、`goals/`）。宿主根自身保持仓库在库形态。
- **执行语义不变**：派发 spawn cwd 仍是真实工作区；carve-out 路径校验、goals 目录读取仍指向工作区。
- **选择登记簿**：`workspace.json`/`known-workspaces.json` 统一钉在宿主 `.mush/`（修复热切换后碎片化与 DEF-10 重启恢复失准）。
- `mush_managed` 字段语义不变（按目标文件夹是否存在 `.mush` 探测——外部工作区恒 false，属预期）。

### v1.49 行为变更（2026-09-06；D85 意向项目可切换）

- **`POST /api/workspaces/select`**：不再因路径含"意向项目"返回 400——意向项目（及其子目录）可正常选为工作区，按 GOAL-068 语义热切换数据面（`runtime/`、`.mush/` 等元数据目录创建于目标区）。`.agent-bridge` 仍为冻结区（400）。
- **写保护收敛到派发级**：向意向项目发起的真实模型派发仍逐单停看板审批（D30 不变）；观察参演模式（GOAL-071）保留。
- **文件提及读取**（`POST /api/files/mention` 语义）：意向项目文件正常读取；`.agent-bridge` 仍返回 Security Notice。
- `POST /api/workspaces/create` 仍拒绝在意向项目内新建目录（防误建；手工创建后可切换）。

### v1.48 行为扩展（2026-09-06；D84 派发停止）

- **`POST /api/dispatches/cancel`**：body `{ dispatch_id }`；对运行中的派发注册树杀句柄并终止子进程，终态如实记 `INTERRUPTED`（error=`已由 owner 停止（中断按钮）`）。响应 `200 { ok, dispatch_id, status: 'ADMITTED', note }` 表示中断已请求（终态经既有派发/聊天 SSE 流推送）；派发不存在/已终态/无在途子进程 → `409 { ok:false, error }`。
- **聊天流 UI**：思考中/生成中行新增「停止」按钮（`data-chat-stop`，走文档级委托）；中断后红边失败行带「重试」，重试即重新派发（聊天直通语义不变）。
- **边界**：仅 t1 协议通道（claude/dsh/zcode/codex/agy/opencode/kimi 等 CLI 犬）可中断；已结算或未 spawn 的派发不可中断。中断不判 FAIL、不触发故障转移、不计熔断失败。

### v1.47 行为变更（2026-09-06；D83 聊天直通）

- **聊天回复豁免 D30 逐单审批**：`POST /api/chat` 及其重试受理即执行（恢复 `originOwner` 语义——owner 敲字即批准），不再生成 `D30-real-dispatch` 审批卡、不再进入 `BLOCKED_WAITING_OWNER`；会话 JSONL 每回合恒为 user+head 两轮。
- **保留的边界**：通道预检门（L0/L1 探针）、预算 cap 与主控资金门、计划门（`PLAN_WAIT`/`PLAN_DECIDED`）不变；无人值守熔断停机不再拦截聊天派发（owner 在场语义，决议 D83）。
- **不变**：看板/CLI 直接发起的非聊天真实派发仍走 D30 逐单审批 + 单次令牌消费。

### v1.45 向后兼容扩展（2026-08-29；GOAL-081 丝滑工程）

- **`GET /api/snapshot` 新增只读字段** `first_task: { zero_config: boolean, free_adapter_id: string }`：
  roster 无任何 `verified:true` 犬时 `zero_config=true`，前端据此升起第一单零配置引导横幅；
  纯派生信号，不改任何状态，无该字段的旧前端行为不变。
- **GOAL-081 其余变更不触契约**：前端渲染竞态根治（键控增量 + 文档级事件委托）与审批
  内联卡均为渲染层改造；`mush chat` REPL 仅消费既有 `POST /api/chat`（202 异步受理）与
  `GET /api/stream`（kind=chat 帧），零新端点。

### 多项目数据隔离模型（GOAL-068 / v1.44）

- 每个工作区的全部项目数据（任务池、聊天、派发流、工犬子会话、时空快照等）落位自身 `<ws>/runtime/`，100% 物理隔离；
- `POST /api/workspaces/select` 成功即热切换整套数据面上下文：任务池、聊天历史、活动流、快照投影立即随新工作区呈现（前端统一联动刷新）；
- 在途派发绑定其 origin 项目上下文继续执行，SSE/toast 全局照推，列表与详情只显示活动项目；
- **全局资金总控**：跨项目共享机器级 Master Ledger（缺省 `~/.mush/master-ledger.jsonl`，SHA-256 链式 append-only），Master Cap 经 `~/.mush/master-cap.json` 或启动选项配置；各项目 admission 前先过总控门，DENIED 在项目台账留证（`kind=MASTER_CAP_EXCEEDED`）。

### v1.43 向后兼容扩展（2026-08-22；GOAL-067 全栈审计修复）

- **`GET /api/child-sessions`**：工犬子会话清单（`ChildSessionRegistry.list()`，按当前工作区过滤）；
- **`POST /api/child-sessions/chat` 契约兑现**：v1.42 声明但后端缺失，现补齐——body `{session_id, prompt, dog?, goal_id?}`；会话不存在且 `dog` 合法时自动建档；轮次入账后经 `ChatService`（originOwner 语义）触发专属独立切流，202 返回 `{ok, accepted, session_id, dispatch_id, reply}`；
- **`GET /api/harness/doctor` 契约兑现**：v1.41 声明但后端缺失，现接线 `getHarnessDoctorReport()`，返回 `{ok, harnesses:[{name,status,activeProvider?,cliPath,installCmd,updateCmd,...}]}`；
- **`POST /api/audit/export` 口径修正**：事件链聚合 `event-log-*.jsonl`、派发统计自 `dispatches/*.jsonl` 末事件投影、消费仅计 `ACTUAL_COST`、`time_range` 真过滤、审批计数排除应答文件、台账哈希链状态实测返回。

### v1.42 向后兼容扩展（2026-08-21；本机工作区系统原生与目录树选择器、多模态发图附件、工犬直连会话）

- **`POST /api/workspaces/browse-native`**：唤起 Windows 本机系统原生 `FolderBrowserDialog` 文件夹选择器弹窗，用户选定目录后自动注册工作区并设置为当前激活工作区（Caller Token 鉴权）；
- **`GET /api/workspaces/fs-tree?path=...`**：网页可视化目录树选择器，无参数时返回本机物理磁盘盘符列表（如 `C:\`, `D:\`），带参数时返回当前目录下合法子文件夹列表并自动过滤系统保留与敏感目录；
- **`GET /api/attachments/:id`**：本地多模态图片文件安全静态流式读取端点，支持文件名合法性校验与路径穿越隔离；
- **`POST /api/child-sessions/chat`**：工犬 1-on-1 独立抽屉终端直连指令发送，记录轮次并触发专属独立切流（Caller Token 鉴权）；

### v1.41 向后兼容扩展（D76/D77，2026-08-20；跨 Harness 多 Provider 动态探测与生态医生诊断）

- **`GET /api/harness/doctor`**：获取系统中 8 大 Harness（`claude`, `codex`, `dsh`, `opencode`, `pi`, `kimi`, `zcode`, `agy`）的实测就绪状态、CLI 路径校验、当前激活 Provider 及一键安装/更新指令列表；



### v1.38 向后兼容扩展（RM-007 M4 / GOAL-055，2026-08-19；多犬协作全景战报与研发能效大屏）

- **`GET /api/velocity/metrics`**：获取基于 DORA/SPACE 模型的全景研发效能矩阵指标（吞吐量、响应前置周期、拦截率、ROI 能效比）；
- **`POST /api/velocity/report`**：生成并导出周期内多犬协作全景 Markdown 复盘战报（Caller Token 鉴权）；

### v1.37 向后兼容扩展（RM-007 M3 / GOAL-054，2026-08-19；极简系统托盘常驻伴侣与全局热键雪橇浮窗）

- **`GET /companion/spotlight`**：获取独立 Spotlight 极简雪橇浮窗 HTML 界面；
- **`POST /api/companion/quick-action`**：桌面浮窗一键发起辩论/流水线/审查/单测速派（Caller Token 鉴权）；

### v1.36 向后兼容扩展（RM-007 M2 / GOAL-053，2026-08-19；战绩反馈闭环与自适应路由权重自进化）

- **`GET /api/routing/weights`**：获取当前全领域自进化权重分布矩阵与样本统计；
- **`POST /api/routing/feedback`**：提交人类审批与测试实战结果进行在线闭环打标与权重微调（Caller Token 鉴权）；
- **`GET /api/routing/recommend`**：基于指定领域与预算上限（`domain`, `cap_usd`）求解帕累托最优推荐犬；

### v1.35 向后兼容扩展（RM-007 M1 / GOAL-052，2026-08-19；影子评测与实战战绩 ELO 天梯榜引擎）

- **`GET /api/elo/rankings`**：获取在册犬 ELO 天梯排行榜（按积分降序，含段位、胜率与战绩）；
- **`GET /api/elo/profiles/:dog`**：获取指定犬的 ELO 画像与历史对决战报；
- **`POST /api/elo/match`**：手动或按实战结果登记 ELO 对决并更新双方积分与段位（Caller Token 鉴权）；
- **`POST /api/elo/auto-eval`**：提交 Pass@1/成本/延迟/安全 4 维指标自动判决胜负并更新 ELO（Caller Token 鉴权）；

### v1.34 向后兼容扩展（RM-006 M4 / GOAL-051，2026-08-19；液态战时攻关小队与指挥犬选举）

- **`POST /api/squads`**：动态组建液态攻关小队，自动基于任务特征选举指挥犬（Caller Token 鉴权）；
- **`GET /api/squads`**：查询所有小队列表（支持 `status=ACTIVE|DISBANDED` 过滤）；
- **`GET /api/squads/:id`**：获取指定小队的详情与成员编制；
- **`POST /api/squads/:id/disband`**：解散攻坚小队并将成果沉淀至符号记忆图谱（Caller Token 鉴权）；

### v1.33 向后兼容扩展（RM-006 M3 / GOAL-050，2026-08-19；跨犬共享黑板协作空间与 ACL 白名单仲裁）

- **`GET /api/blackboard`**：获取共享黑板全量 4 分区数据（`artifacts`、`issues`、`hypotheses`、`decisions`）；
- **`GET /api/blackboard/:section`**：获取指定分区的条目列表；
- **`GET /api/blackboard/items/:id`**：获取指定条目的详情与版本历史；
- **`POST /api/blackboard`**：向黑板发布或更新条目（Caller Token 鉴权 + 犬只 ACL 权限仲裁）；

### v1.32 向后兼容扩展（RM-006 M2 / GOAL-049，2026-08-19；时空状态树与因果时间旅行快照）

- **`GET /api/time-travel/tree`**：获取全量时空快照节点与分支因果拓扑图；
- **`GET /api/time-travel/nodes/:id`**：获取指定快照节点的元数据与文件列表；
- **`POST /api/time-travel/snapshot`**：手动或按工序自动创建微快照（Caller Token 鉴权）；
- **`POST /api/time-travel/fork`**：从历史任意节点派生平行实验分支（Caller Token 鉴权）；
- **`POST /api/time-travel/revert`**：执行时空倒流恢复，瞬时还原代码与会话状态（Caller Token 鉴权）；

### v1.31 向后兼容扩展（RM-006 M1 / GOAL-048，2026-08-19；跨 Harness 技能双向转译与热挂载）

- **`GET /api/skills`**：查询所有已挂载技能与已加载目录列表；
- **`GET /api/skills/:name`**：获取指定技能的统一 AST 与安全合规详情；
- **`GET /api/skills/:name/transpile`**：按目标生态（`target=agy/claude/codex/dsh`）无损双向转译；
- **`POST /api/skills/mount`**：热挂载外部技能目录（Caller Token 鉴权）；
- **`POST /api/skills/unmount`**：热卸载外部技能目录（Caller Token 鉴权）；

### v1.30 向后兼容扩展（RM-005 M4 / GOAL-047，2026-08-19；Contract Net 悬赏招投标市场与动态撮合池）

- **`POST /api/bounties`**：创建并发布公开悬赏标的（Caller Token 鉴权）；
- **`GET /api/bounties`**：查询所有悬赏标的列表（支持 `status` 过滤）；
- **`GET /api/bounties/:id`**：获取指定悬赏详情、竞标列表与授标信息；
- **`POST /api/bounties/:id/bids`**：犬只自主提交竞标出价单（Caller Token 鉴权）；
- **`POST /api/bounties/:id/auto-bid`**：触发在册犬全员多因子竞争性竞标（Caller Token 鉴权）；
- **`POST /api/bounties/:id/award`**：执行多因子最高性价比撮合并授标（Caller Token 鉴权）；
- **`POST /api/bounties/:id/settle`**：履约交付结算（Caller Token 鉴权）；

### v1.29 向后兼容扩展（RM-005 M3 / GOAL-046，2026-08-19；红蓝对抗验证室与闭环自动打回流）

- **`POST /api/verify/red-blue`**：创建红蓝对抗验证会话（强制 Generator !== Verifier，Caller Token 鉴权）；
- **`GET /api/verify/red-blue`**：查询所有红蓝对抗会话列表；
- **`GET /api/verify/red-blue/:id`**：获取指定对抗详情、轮次历史与爆破点报告；
- **`POST /api/verify/red-blue/:id/attack`**：提交红方破坏性测试用例与断言结果（Caller Token 鉴权）；
- **`POST /api/verify/red-blue/:id/correct`**：提交蓝方打回重写修正代码（Caller Token 鉴权）；

### v1.28 向后兼容扩展（RM-005 M2 / GOAL-045，2026-08-19；SOP 工序流水线与工件接力工作台）

- **`POST /api/pipelines`**：创建标准 5 阶段工程流水线会话（Caller Token 鉴权）；
- **`GET /api/pipelines`**：查询所有工序流水线列表；
- **`GET /api/pipelines/:id`**：获取指定流水线详情、5 阶段状态与工件树；
- **`POST /api/pipelines/:id/stage/:stage_id/complete`**：完成阶段并自动将工件传递至下一阶段（Caller Token 鉴权）；
- **`POST /api/pipelines/:id/stage/:stage_id/approve`**：阶段质量门禁人工/头犬放行（Caller Token 鉴权）；

### v1.27 向后兼容扩展（RM-005 M1 / GOAL-043 & GOAL-044，2026-08-19；协作总线与圆桌辩论对席工作台）

- **`POST /api/collaboration/recommend-pair`**：根据议题自动推荐最佳正反协同犬阵容；
- **`POST /api/collaboration/dispatch`**：下发协作派发请求（Caller Token 鉴权）；
- **`POST /api/debates`**：创建圆桌辩论会话（Caller Token 鉴权）；
- **`GET /api/debates`**：查询所有辩论会话列表；
- **`GET /api/debates/:id`**：获取指定辩论详情、回合记录、提纯共识与争议点；
- **`POST /api/debates/:id/turn`**：记录辩论立论/质询回合（Caller Token 鉴权）；
- **`POST /api/debates/:id/arbitrate`**：人类终审仲裁拍板并归档（Caller Token 鉴权）；

### v1.26 向后兼容扩展（GOAL-042，2026-08-19；Phase C 符号化记忆图谱与跨犬直连协作协议）

- **`GET /api/memory/graph`**：查询符号化记忆图谱全量节点与边拓扑；
- **`GET /api/memory/search`**：按 tag 或 file 路径多维检索记忆节点；
- **`POST /api/memory/nodes`**：创建结构化记忆节点；
- **`POST /api/memory/edges`**：建立记忆节点语义关系边（depends_on/supersedes/caused_by/relates_to）；
- **`POST /api/collaboration/messages`**：跨犬直接点对点投递结构化消息；
- **`GET /api/collaboration/mailbox/:adapter_id`**：查询指定犬只信箱；
- **`POST /api/collaboration/plan`**：声明跨犬协作流水线 DAG；
- **`POST /api/collaboration/advance`**：阶段完成并推进 DAG 自动触发下游；
- **`GET /api/collaboration/:task_id/status`**：查看协作 DAG 运行状态；

### v1.25 向后兼容扩展（GOAL-041，2026-08-19；GP-15 看板审计日志归档导出）

- **`POST /api/audit/export`**：一键生成全量审计与证据链 Markdown 归档报告；
- **`GET /api/audit/exports`**：查询已生成的归档报告列表；
- **`GET /api/audit/exports/:filename`**：获取指定归档报告的 Markdown 内容；

### v1.24 向后兼容扩展（GOAL-040，2026-08-19；GP-01 跨 Harness 影子分流评测台）

- **`GET /api/evaluations`**：查询所有影子分流评测记录；
- **`GET /api/evaluations/:id`**：获取单次影子评测详情与多犬横向交叉比对报告；
- **`POST /api/evaluations`**：创建新的影子分流评测并生成对比报告；

### v1.23 向后兼容扩展（GOAL-039，2026-08-19；GP-07 异构犬能力感知智能路由）

- **`POST /api/route/recommend`**：任务特征自动提取与犬只智能匹配推荐：
  - 请求：`POST /api/route/recommend { "prompt": string, "files"?: string[] }`
  - 响应：`200 { "ok": true, "task_profile": { "primary_dimension": string, "estimated_complexity": string, ... }, "recommendations": [{ "adapter_id": string, "score": number, "tier": string, "reason": string }] }`

### v1.22 向后兼容扩展（GOAL-038，2026-08-19；GP-04 多轮长上下文滚动蒸馏与持久记忆）

- **`GET /api/context/pressure`**：查询当前上下文 Token 占用率与三级预警等级（70%/85%/95%）；
- **`GET /api/memories`**：列出所有会话蒸馏记忆；
- **`GET /api/memory/:session_id`**：查询指定会话的蒸馏记忆；
- **`POST /api/memory/distill`**：执行多轮会话提纯蒸馏并持久化；

### v1.21 向后兼容扩展（GOAL-037，2026-08-19；D37 犬只直连会话控制台）

- **`GET /api/dogs/:adapter_id/sessions`**：查询指定犬只的直连会话列表；
- **`POST /api/dogs/:adapter_id/sessions`**：创建新的直连会话；
- **`POST /api/dogs/:adapter_id/sessions/:id/messages`**：向直连会话发送消息；
- **`POST /api/dogs/:adapter_id/sessions/:id/resume`**：续接中断会话；
- **`GET /api/dogs/:adapter_id/transcript`**：查询该犬的历史 Transcript 日志；

### v1.20 向后兼容扩展（GOAL-036，2026-08-19；D38-L2 派发 Trace 步骤树与耗时瀑布图）

- **`GET /api/traces`**：查询所有已记录的派发 Trace 列表；
- **`GET /api/dispatch/:id/trace`**：查询单次派发的完整阶段步骤树、耗时瀑布甘特数据与 Token 膨胀曲线；

### v1.19 向后兼容扩展（GOAL-035，2026-08-19；GP-11 看板 Git Diff 视觉审查器与单文件回滚）

- **`GET /api/diff`**：查询当前工作区全量代码差异（FileDiff 数组、增删统计、敏感文件高亮标记）；
- **`GET /api/dispatch/:id/diff`**：查询指定派发对应的代码变更集；
- **`POST /api/dispatch/:id/revert`**：单文件安全回滚（Caller Token 鉴权 + 路径穿越与冻结区防御）：
  - 请求：`POST /api/dispatch/:id/revert { "file": string }`
  - 响应：`200 { "ok": true, "message": string }`

### v1.18 向后兼容扩展（GOAL-034，2026-08-19；GP-24 看板 Carve-out 声明式写面可视化工作台）

- **`GET /api/carveouts`**：查询所有切片历史、当前 ACTIVE 授权切片与时效：
  - 响应：`200 { "ok": true, "carveouts": [...], "active": { "carveout_id": string, "path_roots": string[], "expires_at_utc": string, ... } | null, "current_token": string | null }`

### v1.17 向后兼容扩展（GOAL-033，2026-08-19；GP-31 会话工作流生命周期控制面与交接编辑器）

- **`POST /api/streams`**：创建命名工作流：
  - 请求：`POST /api/streams { "title": string, "description"?: string, "parent_stream_id"?: string }`
  - 响应：`201 { "ok": true, "stream": { "stream_id": string, "title": string, "status": "ACTIVE", ... } }`
- **`PATCH /api/streams/:id`**：更新工作流状态（ACTIVE/PAUSED/ARCHIVED/MERGED）或编辑交接上下文块（Handoff Block）：
  - 请求：`PATCH /api/streams/:id { "title"?: string, "description"?: string, "status"?: string, "handoff_block"?: { "decisions_made"?: string[], "files_touched"?: string[], "next_actions"?: string[], "handoff_markdown"?: string } }`
  - 响应：`200 { "ok": true, "stream": { ... } }`
- **`POST /api/streams/:id/fork`**：派生子工作流（自动继承父流交接上下文）：
  - 请求：`POST /api/streams/:id/fork { "title": string, "description"?: string }`
  - 响应：`201 { "ok": true, "stream": { "stream_id": string, "parent_stream_id": string, "handoff_block": { ... } } }`

### v1.16 向后兼容扩展（GOAL-032，2026-08-19；GP-19 智能代码上下文自动装配器）

- **`POST /api/context/assemble`**：输入目标文件列表与 Token 预算，自动提取 AST 依赖拓扑、关联类型声明与关联测试用例，组装结构化上下文包：
  - 请求：`POST /api/context/assemble { "workspace"?: string, "files": string[], "max_tokens"?: number, "include_tests"?: boolean, "max_depth"?: number }`
  - 响应：`200 { "ok": true, "context": { "target_files": [...], "dependencies": [...], "associated_tests": [...], "prompt_block": string, "estimated_tokens": number } }`

### v1.15 向后兼容扩展（GOAL-030，2026-08-19；GP-40 / GP-32② 看板调用者身份鉴别与握手保护）

- **`GET /api/session/token`**：获取会话级 Caller Token（严格 loopback 保护）：
  - 响应：`200 { "ok": true, "caller_token": string }`
- **状态变更请求头**：
  - 在启用鉴权模式下，所有状态变更请求（`POST` / `PATCH` / `PUT` / `DELETE`）需携带 `X-Mush-Caller-Token: <token>` 或 Query 参数 `?caller_token=<token>`；
  - 校验失败返回 `401 { "ok": false, "error": "Unauthorized: missing or invalid X-Mush-Caller-Token" }`。

### v1.14 向后兼容扩展（GOAL-028，2026-08-19；GP-38 多组织拓扑与 LLM Verifier 矩阵）

- **`POST /api/dispatch` 扩充字段**：
  - `topology_mode?: 'HIERARCHICAL' | 'PIPELINE_SOP' | 'COMMITTEE_DEBATE' | 'BOUNTY_MARKET'`（默认 `HIERARCHICAL`）；
  - `verifier_dog?: string`（必须与 `adapter_id` 异构，严格遵守 `Generator !== Verifier`）；
- **`GET /api/dispatch/:id` 扩充字段**：
  - `topology_mode?: string`；
  - `verifier_report?: { facet: string, generator_adapter_id: string, verifier_adapter_id: string, decision: 'PASS'|'WARN'|'FAIL', issues: string[], verified_at_utc: string }`。

### v1.13 向后兼容扩展（GOAL-027，2026-08-19；GP-33 本地会话用量与花费监控）

- **`GET /api/usage`**：返回本地多 Harness 会话（Claude/Pi/mush receipts）用量与费用全景投影：
  - 响应：`200 { "ok": true, "usage": { "today_cost_usd", "total_cost_usd", "total_tokens", "total_input_tokens", "total_output_tokens", "total_cache_read_tokens", "cache_savings_usd", "per_harness_usage", "per_model_usage", "daily_trends" } }`

### v1.12 向后兼容扩展（GOAL-025，2026-08-18；GP-35 模型实测选择与名册回填）

- **`GET /api/models/probe`**：返回在册 Harness 实测可用模型列表与探针状态缓存：
  - 响应：`200 { "ok": true, "probes": { "<adapter_id>": { "adapter_id", "status": "ONLINE"|"QUOTA_EXHAUSTED"|"UNAVAILABLE"|"UNKNOWN", "live_models": string[], "checked_at_utc": string } } }`
- **`POST /api/models/probe`**：触发在线实测探测（可选 body `{ "adapter_id": "<id>" }` 针对单犬）：
  - 响应：`200 { "ok": true, "probes": { ... } }`
- **`GET /api/roster` 扩充字段**：
  - 每个犬只条目新增可选 `live_models: string[]`、`probe_status: string`、`actual_model_id: string`、`model_tiers: Record<string, ModelTier>`、`supports_model_flag: boolean`。



### v1.10 向后兼容扩展（GOAL-014，2026-08-18；M0 carve-out 安全底座）

- **语义**：把「意向项目整树只读」细化为「默认只读 + owner 圈定可写范围」。
  carve-out = 单切片授权：`runtime/carveouts.jsonl`（append-only）记录
  `carveout_id / owner_grant_utc / task_ref / paths[]（绝对路径）/ expires_at /
  status(ACTIVE|EXPIRED|REVOKED)`；**同一时刻最多 1 份 ACTIVE**；
  `.agent-bridge/` 整树任意仓**永久 deny**，任何 carve-out 不可覆盖（黄金参照底线）。
- 新增 owner 授权通道（仅 loopback + 一次性 token 最小握手，防本机任意进程调 grant）：
  - `POST /api/carveout/grant`：body
    `{ task_ref, paths[], expires_at, token }` → `201 { ok, carveout }`；
    token 取自 `<workspaceRoot>/.mush/carveout-token`（权限 0600，**每次 grant 旋转**，
    旧 token 立即失效）；token 缺失/不匹配 → `403`；输入非法（空 task_ref、空 paths、
    含 `.agent-bridge` 段、expires_at 非 ISO-8601）→ `400`；已有 ACTIVE → `400`。
  - `POST /api/carveout/revoke`：body `{ carveout_id, token }` →
    `200 { ok, carveout_id, status:"REVOKED" }`；token 不匹配 → `403`；
    carveout 不存在 → `404`；非 ACTIVE → `400`。
  - `GET /api/carveout/active`：→ `200 { ok, active: Carveout | null }`；
    当前 ACTIVE（未过期/未撤销）或 null（前端顶部条带数据源；过期自动消失）。
- **dispatch 携带 carveout_id/cwd（声明式写面校验，非运行时拦截）**：
  - `POST /api/dispatch` 新增可选 `carveout_id` + `cwd`（绝对路径）；
  - 语义：`cwd` 必须位于该 carve-out 白名单某根之下且不命中 `.agent-bridge`；
    携带 `cwd` 而未携带 `carveout_id`，或 `carveout_id` 非当前 ACTIVE → `400`；
  - 校验通过后：犬进程 spawn 的工作目录 = `cwd`（回执仍落 workspace）；
    dispatch 记录/`request` 快照记 `carveout_id` + `carveout_whitelist` 快照
    （`{ paths, expires_at, task_ref }`，事件链留痕）；
  - rerun 透传原切片引用并在执行前**重新校验**当前 ACTIVE（原切片已过期/撤销
    → rerun 拒绝，不绕过写面门）；
  - 不做运行时文件写拦截（留 GP-14 隔离区）；头犬事后 diff 审核犬产物 vs
    白名单（超范围 = 红线违反，触发宪法 §2 审计）。


### v1.7 向后兼容扩展（GOAL-019，2026-08-17）

- 新增任务池后端：
  - `GET /api/tasks`：任务列表（读侧折叠最新快照）；
  - `POST /api/tasks`：创建任务（append-only）；
  - `POST /api/tasks/:id/transition`：状态迁移（白名单校验，非法 400 带原因）。
- `POST /api/dispatch` 新增可选 `task_id`：ADMITTED 后把 `dispatch_id` 追加进
  任务记录的 `dispatch_ids[]`（派发回链/认领语义）。
- 任务字段：`task_id/title/detail/status/priority/source/goal_id?/dispatch_ids[]/
  created_at/updated_at`；状态集合
  `IDEA|READY|QUEUED|IN_FLIGHT|DONE|BLOCKED|CANCELLED`。

### v1.8 逐单审批（GP-32 / D30，2026-08-17；v1.7 号段留给在途任务池包 p19a）

- **废除常设放行**：`<adapter>.approved.json` 不再参与 real 派发放行（D30）；
- real 派发无令牌 → `BLOCKED_WAITING_OWNER` + **自动生成审批请求文件**
  `goals/receipts/approval-requests/dispatch-<id>.json`（kind=dispatch，含
  犬只/effort/timeout/workspace/cap/已花/完整 prompt 报备）；回放时对缺
  失请求文件的旧被拦卡自动补建；
- `POST /api/approvals/respond` 对派发类请求联动：
  - `APPROVED` → 写单次令牌（`runtime/approval-tokens/`，**读即焚**）+
    自动 `rerun(approved_via)`；原单折算 `SUPERSEDED`，新派发为执行单；
  - `REJECTED` → 原单折算 `REJECTED`；
- 新增终态 `REJECTED` / `SUPERSEDED`（TERMINAL 集合与前端状态图同步）；
- 快照 `approvals[]` 条目对派发类请求新增 `dispatch` 报备块
  （prompt 服务端截 1200 字）；前端：审批弹窗渲染报备面板，被拦派发卡
  带「去审批」按钮；
- **owner 亲启通道**：ChatService 内部调用携带 `originOwner`（owner 敲字
  即批准，不设卡）；公开 `POST /api/dispatch` 不接受该语义，代理发起的
  real 派发一律停卡。

### v1.11 向后兼容扩展（GOAL-023，2026-08-18；活动时间线与三透镜）

- 新增活动时间线持久化：`runtime/activity.jsonl`（append-only，fail-open）；
- 将派发生命周期、任务创建/状态变迁、审批响应、工作流换窗转译为人话条目；
- 新增活动查询接口：`GET /api/activity?task_id=<id>&goal_id=<id>&limit=<n>`；

### v1.9 向后兼容扩展（GOAL-021，2026-08-17；聊天流式）

- **chat 异步化（破坏性语义变更，取代 v1.3.1 同步 200）**：`POST /api/chat` 改 `202`
  即返 `{ ok, session_id, role:"head", dispatch_id, status:"PENDING", note }`，不再同步
  等待回复；回复经 `GET /api/stream` 的 `kind=chat` 帧流式推送，会话 JSONL 语义不变
  （user turn 受理即落盘；head turn 在 REPORT 后落盘）；
- **SSE chat 帧**：`GET /api/stream` 新增 `kind=chat` 事件（阶段序
  `ADMITTED → EXECUTE(增量) → HEARTBEAT(耗时) → REPORT(含回复全文)`）：
  - `{ kind:"chat", phase:"ADMITTED", session_id, dispatch_id, at_utc, payload:{status} }`；
  - `{ kind:"chat", phase:"EXECUTE", ..., payload:{stream_text} }`（增量合帧）；
  - `{ kind:"chat", phase:"HEARTBEAT", ..., payload:{elapsed_ms} }`（实时耗时）；
  - `{ kind:"chat", phase:"REPORT", ..., payload:{status, elapsed_ms, reply} }`（回复全文）；
  - 失败路径：后台执行抛错 → `phase:REPORT, payload:{status:"FAIL", error, reply}`；
- **t1 流式回调（存量派发增量帧）**：`dispatch.dispatch()` 支持可选内部
  `onStdout`；在途 stdout 经节流合帧（≥512B 或 ≥200ms）为 `kind=dispatch`、
  `phase:EXECUTE`、`payload:{progress:"stream", stream_text}` 增量帧，并把合并文本
  转发宿主（聊天层据此发 chat 帧）。普通派发（不注流式回调）行为不变；


### v1.5 向后兼容扩展（GOAL-017A，2026-08-17）

- 新增适配器注册表 CRUD：
  - `GET /api/adapters`：合并视图（base + 用户覆盖 + origin 标记 + verified）；
  - `POST /api/adapters`：基于基础模板（dsh/claude/codex/kimi/opencode/zcode/pi/agy）
    创建或覆盖用户适配器；模板外字段 fail-closed；
  - `DELETE /api/adapters/:id`：软删（`removed:true`，roster 隐藏，历史派发不受影响）。
- roster / knownContracts 读合并层；roster 条目新增 `verified: boolean`。
- 头犬解耦：`POST /api/chat` 的 `adapter_id` 放开为**任意 roster 在册且
  verified 的 harness**（registry `verified:true` 或合同白名单
  deepseek-dsh/claude-code/kimi-code/zcode/agy/head-dog）；codex 因 F-50 保持
  UNVERIFIED，接口层拒绝并返回原因；`head-dog` 继续可用（deepseek 别名）。
- 新增 `runtime/budget-caps.json`：per-actor cap（初始默认 5）；
  `GET /api/budget/caps`、`PUT /api/budget/caps/:actor`；改动追加台账一行
  `kind=CAP_CHANGE` 留痕。
- `GET /api/budget` 的每个 actor 新增 `admission_count`（含 dry-run）；
  `spent_usd` 语义明确：仅 real 且 `amount_usd > 0` 计入；dry-run 只进 count。

### v1.6 向后兼容扩展（GOAL-018，2026-08-17）

- 新增 work-stream 模型：`runtime/streams.jsonl`（append-only）；
  `POST /api/dispatch` 新增可选 `stream_id` / `goal_id` / `new_stream`；
  默认自动归流（窗口键 = 犬×Goal）；`new_stream:true` 强制新开。
- 同流真续跑：kimi `-r`、claude `--resume`、zcode `--resume` 自动携带上次
  session_id；codex 因 F-50 跳过。
- 适配器合同新增 `context_management`（`auto-compact` / `none` / `unknown`）；
  dsh 无压缩档按 >75% 估算阈值自动换窗；dsh 窗口内 prompt 使用固定章程头 +
  流历史 + 新指令尾。
- HANDOFF：换窗/关流时提示模板；终态输出含 `HANDOFF-BEGIN…HANDOFF-END`
  自动解析归档；同流新窗/换犬新窗自动注入最近交接块；外部可经
  `POST /api/streams/:id/handoff` 补写。
- 新增流 API：`GET /api/streams`（列表+统计）、`GET /api/streams/:id`
  （时间线含交接块）、`POST /api/streams/:id/handoff`（外部交接兜底）。
- 派发 prompt 自动附加工作区 `AGENTS.md`（项目层简报，超长截断）。


### v1.4 向后兼容扩展（GOAL-013，2026-08-17）

- `POST /api/dispatch` 新增可选 `profile` 字段：dsh preset 名，仅允许
  `~/.dsh/profiles/<name>` 实际存在的目录；校验 fail-closed（不存在/越界=400），
  注入 `--profile <name>` 替换合同默认；
- 适配器合同新增 `effort_levels`（该通道真实 effort 档位）与 `effort_injection`
  （`{kind:'flag'|'env'|'none', name?}`）。`POST /api/dispatch` 的 `effort` 必须
  属于所选合同的 `effort_levels`（旧三档仅作为未声明合同的兼容回退）；
- 新增端点 `POST /api/dispatch/:id/rerun`：读历史记录，克隆
  prompt/adapter/model_id/effort/workspace/timeout（不含 `amount_usd` 虚报风险
  字段，按当前默认），生成新 dispatch；`real` 可经 body 覆盖，仍走既有 approval 门；
- `GET /api/dispatch/:id` 的 `dispatch` 新增可选 `request` 快照字段
  （rerun 数据源；旧记录缺省无此字段）。
- 新增静态品牌资产路由 `GET /assets/brands/:name.svg`（GOAL-013L）。

### v1.3 向后兼容扩展（GOAL-011，2026-08-17）

- 新增聊天 API：`POST /api/chat`、`GET /api/chat/history`；
- roster 条目新增 `role: "head" | "executor"`。

### v1.2 向后兼容扩展（GP-02，2026-08-17）

- 新增端点 `POST /api/workspaces/create`：body `{path}`（必须绝对路径）→
  `mkdirSync(recursive)` + 记入 known-workspaces + `201 { ok, workspace: WorkspaceInfo }`；
  已存在 `409`，非绝对路径/空 path `400`；不提供 git init；
- `GET /api/workspaces` 条目路径统一为 `path.resolve` 归一形态并去重（F-39：
  同路径正/反斜杠双条目消除）。

### v1.1 向后兼容扩展（GOAL-007B，2026-08-17）

- `GET /api/dispatch/:id` 的 `dispatch` 新增 `stdout_tail` / `stderr_tail`：
  `{ text: string, truncated: boolean } | null`（REPORT 前为 null；stdout 末 2048 字符、stderr 末 256 字符，超长截断并 `truncated: true`；只读补充字段，不改管线语义）；
- `GET /api/workspaces` 的条目新增 `selected: boolean`（当前选中 workspace 标记，缺省 false）。

## 端点总览

| 方法/路径 | 作用 | v1 状态 |
| --- | --- | --- |
| `GET /` | 看板页面（HTML） | 既有 |
| `GET /api/snapshot` | 只读快照（事件链/审批/最近派发） | 既有，v1 扩展 dispatches |
| `POST /api/events` | 追加 bridge 事件（schema v2 校验） | 既有 |
| `GET /api/stream` | SSE：事件、审批、派发生命周期 | 既有，v1 新增 dispatch 类型 |
| `POST /api/approvals/respond` | owner 审批应答（append-only） | 既有 |
| `POST /api/dispatch` | **新**：派发（dry-run 默认 / real 走 approval） | v1 |
| `POST /api/dispatch/:id/rerun` | **新**：克隆历史派发并重跑 | v1.4 |
| `GET /api/dispatch/:id` | **新**：派发状态与事件 | v1 |
| `GET /api/workspaces` | **新**：workspace 列表/校验 | v1 |
| `POST /api/workspaces/select` | **新**：持久化当前 workspace | v1 |
| `POST /api/workspaces/create` | **新**：登记新 workspace | v1.2 |
| `GET /api/budget` | **新**：USD 台账投影 | v1 |
| `GET /api/budget/caps` | **新**：per-actor cap 表 | v1.5 |
| `PUT /api/budget/caps/:actor` | **新**：更新 per-actor cap（留痕） | v1.5 |
| `GET /api/adapters` | **新**：适配器合并视图 | v1.5 |
| `POST /api/adapters` | **新**：创建/覆盖用户适配器 | v1.5 |
| `DELETE /api/adapters/:id` | **新**：软删适配器 | v1.5 |
| `GET /api/streams` | **新**：work-stream 列表+统计 | v1.6 |
| `GET /api/streams/:id` | **新**：单流时间线（含交接块） | v1.6 |
| `POST /api/streams/:id/handoff` | **新**：外部补写 HANDOFF 交接 | v1.6 |
| `GET /api/tasks` | **新**：任务池列表 | v1.7 |
| `POST /api/tasks` | **新**：创建任务 | v1.7 |
| `POST /api/tasks/:id/transition` | **新**：任务状态迁移 | v1.7 |
| `GET /api/activity` | **新**：活动时间线（支持 task_id, goal_id, limit） | v1.11 |
| `GET /api/carveout/active` | **新**：当前 ACTIVE carve-out（或 null） | v1.10 |
| `POST /api/carveout/grant` | **新**：owner 授权通道（token 握手 + 旋转） | v1.10 |
| `POST /api/carveout/revoke` | **新**：收回 carve-out（置 REVOKED） | v1.10 |
| `GET /assets/brands/:name.svg` | **新**：品牌图标静态资产 | v1.4 |

## POST /api/dispatch

请求：

```json
{
  "adapter_id": "fake-t1 | deepseek-dsh | claude-code | zcode | codex | opencode | kimi-code | pi | agy | <user-adapter>",
  "prompt": "string（1..64000；argument 通道适配器上限 30000——Windows CreateProcess 命令行 ~32767 上限，GOAL-068 A7）",
  "workspace": "string? (缺省=已选 workspace 或服务 cwd)",
  "effort": "string?（缺省 LOW；必须属于所选合同 effort_levels；未声明合同回退 LOW|HIGH|XHIGH）",
  "profile": "string?（v1.4：dsh preset 目录名；仅 ~/.dsh/profiles 下存在者）",
  "model_id": "string?（G009：必须属于所选合同 variants）",
  "stream_id": "string?（v1.6：指定 work-stream；缺省按犬×Goal 自动归流）",
  "goal_id": "string?（v1.6：Goal 关联；窗口键组成部分）",
  "new_stream": "boolean?（v1.6：true 强制新开流）",
  "task_id": "string?（v1.7：任务池回链；ADMITTED 后 dispatch_id 追加进任务）",
  "carveout_id": "string?（v1.10：M0 切片引用；须为当前 ACTIVE carve-out，否则 400）",
  "cwd": "string?（v1.10：犬工作根，绝对路径；须在白名单根下且不命中 .agent-bridge；携带时必须同时携带 carveout_id）",
  "cap_usd": "number?（缺省=该 actor 的 budget-caps 值或 5；>0）",
  "amount_usd": "number?（缺省 0=估算后记账）",
  "real": "boolean?（缺省 false=dry-run）"
}
```

响应（按状态码）：

- `202`：已受理（dry-run 或 real 已执行/后台执行）
  `{ "ok": true, "dispatch_id": "<32hex>", "status": "ADMITTED | DRY_RUN | BLOCKED_WAITING_OWNER", "admission": { "decision": "ADMITTED|DENIED", "remaining_usd": number } }`
- `400`：schema fail-closed（字段缺失/类型错/adapter 未知/workspace 不存在或越界/
  profile 不存在/effort 不在合同档位）
- `402`：超预算门（admission DENIED；事件仍入台账）
- `500`：runner 内部错误（回执已落盘，status FAIL）

## POST /api/dispatch/:id/rerun（v1.4）

请求 body 可选：

```json
{
  "real": "boolean?（缺省=原派发的 real；仍走 approval 门）",
  "cap_usd": "number?（缺省=原派发 cap_usd）"
}
```

- 语义：读取历史派发记录中的 `request` 快照，克隆
  `prompt/adapter_id/model_id/effort/workspace/timeout_s/profile`，生成新派发；
  `amount_usd` 不克隆（按当前默认 0 记账）；
- 响应与 `POST /api/dispatch` 相同（202/400/402/500）；原派发不存在 → `404`；
  旧记录无 `request` 快照 → `400`。

## GET /api/streams（v1.6）

`{ "ok": true, "streams": [ { "stream_id", "key", "title", "goal_id"?, "adapter_id", "status", "created_at_utc", "updated_at_utc", "events": [...], "handoffs": [...] } ] }`
- 每流含派发事件、会话链、上下文估算、交接块；排序按创建时间。

## GET /api/streams/:id（v1.6）

`{ "ok": true, "stream": WorkStream }`
- 时间线含 `events[]` 与 `handoffs[]`；不存在 → `404`。

## POST /api/streams/:id/handoff（v1.6）

请求 `{ "done"?, "decided"?, "files"?, "next"?, "open_issues"? }`
- 语义：头犬/owner 在犬暴毙无终态时外部补写 HANDOFF；append-only 归档并哈希锚点；
- 响应 `201`：`{ "ok": true, "handoff": HandoffBlock }`；流不存在 → `404`。

## GET /api/tasks（v1.7）

`{ "ok": true, "tasks": [ { "task_id", "title", "detail", "status", "priority", "source", "goal_id"?, "dispatch_ids"[], "created_at", "updated_at" } ] }`
- 读侧折叠最新快照；`dispatch_ids[]` 为派发回链。

## POST /api/tasks（v1.7）

请求 `{ "title": "string", "detail"?: "string", "status"?: "IDEA|...", "priority"?: "高|中|低", "source"?: "string", "goal_id"?: "string" }`
- 响应 `201`：`{ "ok": true, "task": Task }`；校验失败 `400`。

## POST /api/tasks/:id/transition（v1.7）

请求 `{ "status": "READY|QUEUED|IN_FLIGHT|DONE|BLOCKED|CANCELLED" }`
- 合法迁移白名单校验；非法迁移 `400` 带原因；任务不存在 `404`。
- 迁移白名单（D82 修订）：`IDEA→READY|CANCELLED`；`READY→QUEUED|BLOCKED|CANCELLED`；
  `QUEUED→IN_FLIGHT|BLOCKED|CANCELLED`；`IN_FLIGHT→DONE|BLOCKED|CANCELLED`；
  `BLOCKED→READY|CANCELLED`；`CANCELLED→READY`（取消可重开，D82 修订前为死局）；
  `DONE` 终态不可迁出。
- 失败/受阻/已取消且有过派发的任务，看板提供「重新执行」：按最近一次
  派发快照**预填派发表单**（执行犬/头犬/模型/effort/cap/real/timeout_s 全部
  可调），提交走正常派发链，回链 task_id 并把任务经 READY/QUEUED 复活至
  IN_FLIGHT。服务端 `POST /api/dispatch/:id/rerun` 盲重放仍保留；干跑重跑时
  恰为旧缺省 5s 的超时（缺陷指纹）抬升至 120s，显式值与 real 重跑忠实保留。
- 派发表单新增 `timeout_s` 可选字段（5..3600，缺省干跑 120 / 真实 900）——
  此前表单无超时入口，旧缺省 5s 使带工具调用的干跑必然超时。

## GET /api/activity（v1.11）

`GET /api/activity?task_id=&goal_id=&limit=`

响应：
```json
{
  "ok": true,
  "activities": [
    {
      "activity_id": "act-xxx",
      "task_id": "task-xxx",
      "goal_id": "MUSH-GOAL-xxx",
      "dispatch_id": "<32hex>",
      "actor": "deepseek-dsh | agy | owner",
      "kind": "dispatch_start | dispatch_pass | dispatch_fail | task_create | task_transition | approval_response | stream_handoff",
      "text_zh": "agy 开始执行任务",
      "at_utc": "2026-08-18T15:00:00.000Z",
      "amount_usd": 0.02,
      "source_event": { "dispatch_id": "...", "status": "PASS" }
    }
  ]
}
```
- 返回按时间倒序排列的活动条目；支持按 `task_id`、`goal_id` 过滤，支持 `limit` 限制条数；
- 空活动返回 `{ "ok": true, "activities": [] }`。

## GET /api/carveout/active（v1.10）

`{ "ok": true, "active": Carveout | null }`
- `Carveout = { "carveout_id", "owner_grant_utc", "task_ref", "paths": string[],
  "expires_at", "status": "ACTIVE" }`；
- 当前 ACTIVE（未过期/未撤销）或 `null`；过期 ACTIVE 自动视为不存在（不返回）；
  前端顶部条带消费点：路径 + 任务 + 剩余有效，过期自动消失。

## POST /api/carveout/grant（v1.10）

请求：

```json
{
  "task_ref": "string（goal+packet，如 MUSH-GOAL-015 / rm004-p14b）",
  "paths": ["/abs/path（绝对路径；文件或目录白名单根）"],
  "expires_at": "ISO-8601 UTC",
  "token": "string（一次性；取自 <workspaceRoot>/.mush/carveout-token）"
}
```

- 语义：创建 ACTIVE carve-out（同一时刻最多 1 份；有现存 ACTIVE → `400`）；
  `paths` 含 `.agent-bridge` 段（任意仓）→ `400`（永久 deny，黄金参照底线）；
  `expires_at` 必须为合法 ISO-8601 UTC → 否则 `400`；
  token 缺失/不匹配 → `403`；成功 → `201 { ok, carveout }`；
  **每次 grant 旋转 token 文件**（旧 token 立即失效）；
- 数据落 `runtime/carveouts.jsonl`（append-only，每行一条完整快照）。

## POST /api/carveout/revoke（v1.10）

请求 `{ "carveout_id": "string", "token": "string" }`
- 语义：目标切片置 `REVOKED`（追加快照，append-only 不改历史行）；
- token 缺失/不匹配 → `403`；carveout 不存在 → `404`；非 ACTIVE → `400`；
- 成功 → `200 { ok, carveout_id, status: "REVOKED" }`。



## GET /api/dispatch/:id

`{ "ok": true, "dispatch": { "dispatch_id", "status", "adapter_id", "receipt_path", "events": [ {kind, at_utc, payload} ], "stdout_tail"?, "stderr_tail"?, "carveout_id"?, "request"? } }`
不存在 → `404`。（`stdout_tail`/`stderr_tail` 为 v1.1 新增；`request` 为 v1.4 新增；
`carveout_id` 为 v1.10 新增——M0 切片引用；`request.carveout_whitelist` 为白名单快照留痕。）

## GET /api/adapters（v1.5）

`{ "ok": true, "adapters": [ { "adapter_id", "protocol", "expected_provider", "expected_model_id", "role", "origin": "base|user|user-override", "verified": boolean, "template"?, "variants"?, "model_flag"?, "effort_levels"?, "effort_injection"? } ] }`
- 合并视图 = 基础合同 + 用户覆盖（`runtime/adapters.json`）；软删条目不出现；
- `fake-t1` 不进生产视图（与 roster 同规则）。

## POST /api/adapters（v1.5）

请求：

```json
{
  "template": "dsh | claude | codex | kimi | opencode | zcode | pi | agy",
  "adapter_id": "string (^[A-Za-z0-9._-]+$)",
  "params": {
    "profile": "string?（仅 dsh）",
    "model_id": "string?（claude/codex/kimi/opencode/zcode/pi/agy）"
  }
}
```

- 创建/覆盖用户适配器；模板外字段 fail-closed → `400`；
- 响应 `201`：`{ "ok": true, "adapter": AdapterView }`。

## DELETE /api/adapters/:id（v1.5）

- 软删：写 `removed:true`，roster 隐藏，历史派发不受影响；
- 成功 `200`：`{ "ok": true, "adapter_id": id, "removed": true }`；
- 不存在/已软删 → `404`。

## GET /api/workspaces

`{ "ok": true, "workspaces": [ { "path", "is_git": bool, "mush_managed": bool, "selected": bool } ] }`
- 输入为最近用过的候选列表（持久化文件 + 内建默认）；不存在/不可读目录直接不入列表。
- 路径穿越（`..` 逃逸候选根）fail-closed，不返回。
- `selected` 为 v1.1 新增（当前选中项 true，其余 false）。

## POST /api/workspaces/select

请求 `{ "path": "/abs/path" }` → `201 { "ok": true, "selected": path }`
- 路径必须存在且为目录；否则 `400`。
- 持久化到 `<workspace>/.mush/workspace.json`（BOM-free JSON；写入前目录校验）。

## POST /api/workspaces/create（v1.2）

请求 `{ "path": "D:/abs/path" }`（必须绝对路径）→ `201 { "ok": true, "workspace": WorkspaceInfo }`
- 目录不存在时 `mkdirSync(recursive)` 创建并记入 known-workspaces（登记 = 入 F-41 白名单）；
- 已存在 → `409`；非绝对路径/空 path → `400`；不提供 git init；
- 意向项目子树的前端提示层（黄金参照冻结区）在 page.ts；后端硬拦截属 GP-14。

## GET /api/budget

`{ "ok": true, "actors": [ { "actor_id", "spent_usd", "cap_usd", "admission_count", "entries": [ {at_utc, decision, amount_usd, remaining_usd, meta} ] } ] }`
- 投影源：`runtime/budget-ledger.jsonl`（append-only，每行一条 admission/spend 事件，
  与 `src/core/budget.ts` UsdBudgetLedger 同构）；
- `cap_usd` 来自 `runtime/budget-caps.json`，缺省 5；
- `spent_usd` 仅统计 real 且 `amount_usd > 0` 的 ADMITTED 事件；dry-run 只进
  `admission_count`，不计 spent；
- `admission_count` 含 dry-run 与 real 的 admission 事件（不含 `CAP_CHANGE` 留痕）。

## GET /api/budget/caps（v1.5）

`{ "ok": true, "caps": { "<actor>": number } }`
- 缺省未落盘的 actor 按 5 计，不在此表。

## PUT /api/budget/caps/:actor（v1.5）

请求 `{ "cap_usd": number }` → `200 { "ok": true, "actor_id": actor, "cap_usd": number }`
- `cap_usd` 必须 >0；改动持久化到 `runtime/budget-caps.json`，并追加台账一行
  `kind=CAP_CHANGE` 留痕。

## GET /api/snapshot（v1 扩展）

既有字段不变，新增 `"dispatches": [ 最近 20 条 {dispatch_id, adapter_id, status, at_utc, receipt_path} ]`。

## SSE 事件类型（`GET /api/stream`）

| kind | payload | 触发 |
| --- | --- | --- |
| `event` | bridge event entry（sequence/sha256/event） | POST /api/events |
| `approval` | {request_file, decision} | owner 应答 |
| `dispatch` | {dispatch_id, phase, status, adapter_id, receipt_path?, error?} | 派发生命周期 |
| `chat` | {kind:"chat", phase, session_id, dispatch_id, at_utc, payload} | 聊天流式（v1.9, GOAL-021） |
| `loop` | {run_id, sequence, from, to, sha256} | loop 状态机迁移（G006 接线后） |

`dispatch` 生命周期 phase 顺序：`ADMISSION → EXECUTE → REPORT → REVIEW`；终态
status ∈ `DRY_RUN | ADMITTED | BLOCKED_WAITING_OWNER | BLOCKED_ENV | FAIL | PASS`。

## 聊天 API（v1.3，GOAL-011 M1 新增；v1.3.1 见下；v1.5 头犬解耦）

### POST /api/chat

请求（v1.3.1 + v1.5）：`{ "message": "string (1..64000)", "resume": "session_id?",
"adapter_id": "string?", "effort": "string?" }`
- 语义：把 message 作为 owner 消息派发给头犬（章程注入 + 会话续跑）；
  聊天即真实执行（head-dog approval 在案，D6）；
- v1.3.1（GOAL-012B，向后兼容新增，两字段可选）：
  - `adapter_id`：头犬选择，缺省 `head-dog`；**v1.5 起为任意 roster 在册且
    verified 的 harness**（registry `verified:true` 或合同白名单）；
    `head-dog` 继续可用；codex 因 F-50 保持 UNVERIFIED，接口拒绝并返回原因；
  - `effort`：思维档位，缺省按所选合同的 effort_levels 取 HIGH（若支持）否则
    该合同首档；非法档位 `400`；
- 响应 `202`（v1.9 改为异步受理，取代 v1.3.1 的同步 200）：
  `{ "ok": true, "session_id", "role": "head", "dispatch_id", "status": "PENDING", "note" }`
  其中 `status:"PENDING"` 表示已受理；**不再携带同步 `reply`**——回复经
  `GET /api/stream` 的 `kind=chat` 帧（`phase:REPORT, payload.reply`）流式推送；
  前端待 REPORT 后渲染头犬气泡（打字机由 `phase:EXECUTE` 增量驱动）。
  （v1.3.1 同步 200 + reply 语义已废弃，history 对账路径保留。）
- `400`：message 为空/超长、adapter_id 非 verified、effort 非法；`resume` 指向
  未知会话按新会话处理（创建新文件）。
- 持久化：`runtime/chat/<session_id>.jsonl`，每行一条 `{role:"user"|"head",
  text, at_utc, dispatch_id?}`，append-only；user turn 受理即落盘，head turn 在
  REPORT 后落盘（回复全文）。

### GET /api/chat/history?session=<id>&limit=<n>

`{ "ok": true, "turns": [ {role, text, at_utc, dispatch_id?} ] }`
- 缺 session → `400`；缺文件 → `200` + 空 `turns`；limit 缺省 50、负值按 1。

### GET/PUT /api/unattended/policy（v1.13，GOAL-073）

- GET：`{ ok, policy: {level, auto_approve_cap_usd, daily_auto_budget_usd, task_whitelist_prefixes}, breaker: BreakerState }`（policy 为 clamp 后生效值）；
- PUT `{ level?: 'L0'|'L1'|'L2', auto_approve_cap_usd?, daily_auto_budget_usd?, task_whitelist_prefixes? }`：
  owner 显式操作（Caller-Token）；未携带合法 level 按 L0 处理（fail-closed）；
  额度受 master cap 硬约束（clamp）；落盘 `<runtime>/unattended-policy.json` 并广播
  `unattended_policy_updated`。
- **readiness gate（v1.13，GOAL-074）**：目标档位高于当前持久化档位（L0<L1<L2）时，
  服务端先跑就绪认证；`ready=false` → `409 { ok:false, error,
  readiness:{ ready:false, failing:[id…] } }`，不落盘不广播。同级设置与任何降级
  （含回落 L0 逃生门）恒放行；D8 调度器总开关默认值不受本端点影响。

### GET /api/unattended/breaker（v1.13，GOAL-073）

`{ ok, breaker, chain_intact, bundle? }`；`?bundle=1` 附完整审计回放包。
`POST /api/unattended/breaker/reset { by }`：owner 复位（停机后恢复唯一途径），广播 `unattended_breaker_reset`。
熔断语义：连败 N 次（默认3）/预算斜率超阈（默认 $5/min）/单任务超时硬顶（默认 15min）→ 停机；停机期间真实派发 REJECTED、干跑放行；重启后保持停机。

### GET /api/unattended/readiness（v1.13，GOAL-074）

放闸就绪认证——聚合 RM-011 全程证据逐项机检，任一项失败即整体 NOT_READY（fail-closed）。

- 响应 `{ ok:true, ready:boolean, items:[{ id, title, passed, evidence_hash?, aux_sha256?, detail? }], markdown }`；
  `evidence_hash` 为该项决定性证据工件的 SHA-256；E4 以 soak-metrics jsonl 为决定性工件时，
  soak 摘要哈希归 `aux_sha256`；`markdown` 为渲染完成的认证报告全文；
- E4 判定口径（对齐 GOAL-072 原文「句柄/RSS 双曲线」）：≥480min 完成且双曲线无增长趋势
  （RSS 端差 ≤50MB、句柄端差 ≤20、有效 round 行 ≥10 且无损坏行）；
  指标损坏或采样不足时退回严格口径（须零失败）——全程 fail-closed；
- 只读端点，不改任何状态；刷新归档报告：`node scripts/readiness-certify.mjs`。

### GET /api/dogs/liveness（v1.14，GOAL-080）

犬链探针阶梯——恒零成本检测（L0 `--version` / L1 合同声明探针如 `--dump-config`、`opencode models`，不发任何 LLM 请求）。

- 响应 `{ ok, dogs: [{ adapter_id, level_reached(0-3), ok, label, detail, checked_at_utc }] }`；
  label ∈ DEAD / PROCESS_ONLY / AUTH_VERIFIED / FREE_ROUND_VERIFIED / PAID_ROUND_VERIFIED；
- L2/L3 不主动发起——由 live-probes 台账权威实测（T1_VERIFIED，24h 时效）回填；
- `?refresh=1` 逐犬零成本复检（忽略 TTL 缓存）；缺省返回缓存快照；
- 派发预检：接入探针门的管线在 admission 前自动 `check`，缓存过期（10min）自动复检；
  `ok=false` → 派发 REJECTED（`preflight gate：…` 修复指引），零台账副作用。

### GET /api/missions/overview（v1.14，GOAL-082）

任务监理总览——读时扫描（无定时器）：滞判（默认 8 分钟无实质进展）→ 干预阶梯
（一级换道重试=按最近失败单 rerun，走同一 admission，real 语义继承原单，L1 自动批/L0 弹卡
语义不变；被熔断/预检拒绝→直接跳三级；其它入队失败→升二级；二级失败现场转交头犬重排；
三级升级提问广播）→ ESCALATED 后监理停手移交 owner。心跳语义：仅 ADMITTED/PASS/DRY_RUN
复位进展（FAIL/TIMEOUT/REJECTED 只计数不复位——死通道反复重试也会滞判升级）。

- 响应 `{ ok, missions: [{task_id, phase, last_progress_at_utc, failure_count, last_dispatch_id?, last_real?}], events[-100], sweep, unfrozen }`；
- 受阻自解冻：受阻任务归因犬恢复在线（探针 ok）→ 自动 BLOCKED→READY（append-only 留痕）；
- SSE 新增广播：`supervisor_replan {task_id, detail}`、`supervisor_escalate {task_id, question}`；
- 派发台账/记录新增：`failover_from`（换道来源犬）；失败尝试旁路回执
  `dispatch-<id>.attempt<n>.json`；换道在同一次审批的预算包络内（不另过 D30），
  熔断停机即停链（保险丝优先）。手动标记完成端点接入完成核验门：配置验证钩子时
  虚假完工声明返回 `409 {ok:false, reason}`；未配置=诚实 `unverified-done` 放行。

### POST /api/workspaces/observe（v1.13，GOAL-071）

冻结区观察模式——意向项目/.agent-bridge 只读参演：

- 请求 `{ "path": "D:\\意向项目" }` 进入观察态；`{ "path": "" }` 退出；
- 仅现存冻结区特征路径允许（路径含 `意向项目` 或 `.agent-bridge`），否则 `400`；
- 观察态承诺：目标目录**字节级零写入**——不登记工作区、不落 `.mush/workspace.json`
  与 runtime、派发回执重定向至宿主 `<host>/.mush-receipts/observation/`；
- 观察态派发：免工作区登记门禁；prompt 注入只读参演章程（GP-14 运行时隔离
  到位前的提示级口径）；运行前后内存清单比对，任何新增以
  `observation_violation` 事件留痕并标注 record.error，合规则以
  `observation_zero_write` 留痕；
- 状态跨热切换上下文保持（共享 observationState）；快照新增
  `observing_path?: string`。

### POST /api/chat/plan/:plan_id/decide（v1.13，GOAL-075 切片3）

派发计划门 owner 决断。头犬回复含 `<PLAN>{...}</PLAN>` 块时，聊天层拦截为
待决断计划并推送 SSE `phase:'PLAN_WAIT'` 帧（payload 含 plan_id 与计划全文）；
本端点完成决断：

- 请求 `{ "decision": "approve" | "reject", "amended_steps"?: [{dog, task, model?, cap_usd?, timeout_s?}] }`
- approve：以同会话续跑执行（批准的计划全文随指令下发，头犬按计划派发工犬），
  自动产生新 dispatch 并推 `PLAN_DECIDED` 帧（含 new_dispatch_id）；
- reject：计划终结，零派发；
- 未决计划重载后失效（内存态）；畸形 PLAN 块按未触发处理（fail-safe 不吞回复）；
  solo 独奏模式不受门控。
- 响应 `{ "ok": true, "status": "APPROVED|REJECTED" }`；未找到/已决断 `404`。

聊天帧相位扩展（v1.13）：`ADMITTED | EXECUTE | HEARTBEAT | REPORT | PLAN_WAIT | PLAN_DECIDED`

### roster role / verified 字段（v1.3 / v1.5）

`GET /api/snapshot` 及 roster 消费点的犬只条目新增 `"role": "head" | "executor"`
（v1.3）与 `"verified": boolean`（v1.5）；`head-dog` 为唯一 role=head，但
verified 的 executor 也可经聊天层任头犬（角色与 harness 解耦）。

### roster effort 字段（v1.4）

roster 条目新增 `effort_levels?: string[]` 与 `effort_injection?:
{kind: 'flag'|'env'|'none', name?}`，供 UI 按犬渲染档位。

## 静态品牌资产（v1.4，GOAL-013L / rm003-p13 新增）

### GET /assets/brands/:name.svg

- 语义：看板自供品牌图标（Simple Icons CC0，仓内 `assets/brands/`），页面犬只
  标识兜底链的官方图标来源；零外部请求，127.0.0.1 假设不变；
- 响应 `200`：`content-type: image/svg+xml; charset=utf-8` +
  `cache-control: public, max-age=300`（短缓存），body 为 SVG 原文；
- `404`（fail-closed，一律 `{ok:false,error}`）：文件不存在、`name` 非纯文件名
  （`^[A-Za-z0-9_-]+\.svg$` 之外，含 `..`/子路径/非 .svg 后缀一律拒绝）、
  `path.resolve` 前缀复核逃逸白名单目录；
- 前端消费约定（page.ts）：映射表 `deepseek-dsh→deepseek / claude-code→claude /
  kimi→kimi / opencode→opencode / agy→agy / head-dog→deepseek`；`<img>` `onerror` 静默回退
  手绘内联 SVG（codex/zcode 直接手绘）；资产内 `fill=currentColor`，容器 `color`
  继承实现主题化。

### v1.64 行为扩展（2026-10-05；agy 原生版本漂移的明确登记 D96）

- 宿主政策文件 `runtime/collaboration-admission/agy/version-drift-acceptance.json`，不由 HTTP 请求体提供。字段为 `schema_version=1`、`decision`、`accepted_by`、`accepted_at_utc`、`frozen_native_version`、`accepted_versions: string[]`；缺失或非法即无接受政策。
- 派发预检从绑定 `workspace_root` 父目录读取；只有冻结版本与合同一致、观察版本被逐个明确列出时可接受漂移。D96 当前为 1.2.16 → 仅1.2.17，不自动接受下一版本。模型、参数序列和全部资产哈希仍严格校验；接受漂移不改变合同指纹或证据等级／归属。
- `version_drift_accepted` 复用D95四字段，随派发记录、持久化header、回执和重载读回同源保存；无漂移不编造该字段，历史记录不回填。
- 这是Owner明确接受未重新核验版本的政策，不能宣称新版本隔离已验证；撤销为移除登记或接受名单。产品readiness仍不替代派发时版本复核。
- 本轮只为受控agy讨论提示补明已有`finish`结束入口，资源工具仍禁止，D92只采信最后权威终局的规则不变。

## 实现与契约一致性

- `src/web/api-contract.md` 为本文件；实现改动必须同步本文件（同 commit）。
- 契约测试：对每个 v1 端点至少一条 fake 路径测试（含错误码分支）。


### v1.65 行为扩展：D97 双模型执行与 A16 finish-only 诊断（2026-10-06）

- `POST /api/collaboration/sessions` 仅接受两位 A/B 参与者；其它人数或非2的 mode 返回400。新建黑板接口亦拒绝非双席位。
- 历史三席位仍可经列表/详情读取全部 A/B/C 观点、冻结关系与回执；批准（含通用审批入口）/启动返回409，不写应答、不占额、不spawn；协调器与占额入口也拒绝。记录及卡文件不删除、不改写。
- 表单仅有 A/B 模型、强度、材料选择；历史详情仍按冻结参与者渲染。
- 会话启动在首次模型调用前检查所有已激活讨论通道的原生版本/绑定；未知漂移拒绝并收口failed，零模型调用，不把版本检查结果伪装为新增隔离证据。
- `POST /api/collaboration/probes/prepare` 增加宿主固定包 A16：agy原agent仅 tools: []→[finish]，模型/强度/项目/资源守卫不变；180s、一次派发、无自动重试或换道，cap门0.10USD不构成实际账单硬上限。候选资产生成独立指纹。
- 准备卡期间临时生成候选并恢复；批准重跑按冻结指纹再生成候选，结束/异常后恢复原字节与合同。实验期间阻止其它派发；备份与恢复日志留存，应急恢复不覆盖外部变更。新指纹不得继承旧证据或D89豁免。
- A16原生成功仍须核对真正finish调用、唯一正式JSON、身份及资源轨迹；runner PASS或fixture成功不是原生验收。


### v1.66 行为扩展：D98有界缺证政策（2026-10-06）

- 宿主政策的accepted_gaps条目可含session_scope：adapter_ids（两位，可重复）、call_limit、retry_limit、single_call_timeout_s、session_timeout_min。缺省保留历史D89行为；带范围时必须满足完整结构，坏形态抛错，不降级为无界例外。
- 新建会话时按实际搭档及冻结调用/时限检查政策范围，任一越界拒绝；scope随accepted_gaps进入授权快照/authorization_hash，批准前逐字段对账。客户端不可注入政策范围。
- D98条款仅为agy候选43ae6c28…接受五项缺证，适用搭档Codex＋agy，调用≤7+1、单次≤180秒、整场≤20分钟。资源守卫不变，缺证不升级，失败反例硬前置不变。真正执行仍需独立会话卡批准；不自动扩大模型、版本、预算或启动权。
