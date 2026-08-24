# mush Board API 契约 v1

- 状态：`v1.44`（2026-08-22 GOAL-068 多项目完全数据隔离与热切换 + GOAL-069 typecheck 门禁；v1.43 GOAL-067 全栈审计修复；v1.42 本机工作区系统原生与目录树双模选择器、多模态附件读取、工犬直连终端；v1.41 跨 Harness 多第三方 Provider 动态探测与生态医生诊断；v1.40 RM-009 M5 代码库模块化解耦与 DoD 一键收官工具；v1.39 RM-009 M1~M4 通用工作区自由挂载、动态思维链规格、头像直连交互与子级 Auto-Resume；本文件为权威源）
- 宿主：`src/web/`（node:http，零依赖）；默认只绑 `127.0.0.1`（对外暴露 = 触发门 4，不实现）
- 序列化：JSON（UTF-8，LF 结尾）；SSE 用 `text/event-stream`，帧格式 `data: <json>\n\n`
- 错误约定：失败响应一律 `{ "ok": false, "error": "<human-readable>" }`
- 版本演进：v1 字段**只能向后兼容新增**；删除/改义/改型 = 破坏性变更，需头犬批准并同步 GOAL-007

## 威胁模型（GOAL-067 / D80 明示）

mush 是**单机 loopback 个人工具**，「本机即信任边界」，此为 owner 认可的设计立场：

- **Caller Token 的真实定位是 CSRF/跨站防线**，不是身份鉴别：
  - `GET /api/session/token` 可由任意本机进程无 Origin 头直接获取；Token 亦渲染于主页 `<meta>`；
  - 它有效拦截的是**浏览器跨站攻击面**（配合 Host 白名单防 DNS rebinding、Origin 校验、变更方法强制鉴权）——这部分是闭环的；
- **GET 只读端点免 token**：本机其他进程/用户本可读取同机文件，只读端点不构成额外暴露；含 `prompt_preview` 截断投影属已知可接受面；
- **UNC 路径一律拒绝**（fs-tree 等）：防止跨站请求诱导本机进程发起 SMB 认证（NTLM 凭据泄漏原语）；
- 对外网暴露不在威胁模型内（触发门 4，永不实现）。

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

### v1.10 向后兼容扩展（GOAL-014，2026-08-18；M0 carve-out 安全底座）

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

## 实现与契约一致性

- `src/web/api-contract.md` 为本文件；实现改动必须同步本文件（同 commit）。
- 契约测试：对每个 v1 端点至少一条 fake 路径测试（含错误码分支）。
