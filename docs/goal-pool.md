# mush 目标池（Goal Pool）

> 依据：DECISIONS.md D23、D67、D68（三重治理架构与单一合法 Goal 实体）。
> 维护原则：全库统一以 `goals/GOAL-*.md` 为唯一合法实体，历史 `GP-xx` 草稿条目已全部映射归并至对应 Goal。
> 状态流转：由 `syncGoalsDirectoryToTasks` 自动双向对账（PROPOSED/READY → IN_FLIGHT → DONE）。

---

## 初始规划池（已全面映射至 RM-001 ~ RM-007 / GOAL-001 ~ GOAL-055）

| 历史编号 / Goal | 标题与范畴 | 来源 | 优先 | 状态 | 对应 Goal 规格文档 |
| --- | --- | --- | --- | --- | --- |
| **GP-01 / GOAL-040** | 跨 harness 影子分流验证：同 prompt 投多犬，比对输出与耗时 | D1 | 低 | done | `goals/GOAL-040-shadow-eval-bench.md` |
| **GP-02 / GOAL-018** | 会话持久化与真 resume：各 harness 本地 session 机制接入 | D4 | 高 | done | `goals/GOAL-018-workstreams.md` |
| **GP-03 / GOAL-007** | 看板状态重启重放：服务重启后从事件流恢复全量视图 | D8 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-04 / GOAL-038** | 多轮上下文滚动压缩：长会话 token 压力预警与轻量蒸馏 | D18 | 中 | done | `goals/GOAL-038-context-rolling-distillation.md` |
| **GP-05 / GOAL-007** | 失败重试与退避策略：瞬态错误自动重试，持续失败熔断 | D8 | 中 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-06 / GOAL-017A** | 预算超限前预警：按日/按周预警阈值，超阈发 notification | D14 | 中 | done | `goals/GOAL-014-realwork-flagship.md` |
| **GP-07 / GOAL-039** | 异构犬能力路由：按任务特征多维画像自动推荐犬只 | D1 | 低 | done | `goals/GOAL-039-smart-task-routing.md` |
| **GP-08 / GOAL-018** | 审批请求多渠道通知：看板内联 + 系统通知 | D6 | 中 | done | `goals/GOAL-018-workstreams.md` |
| **GP-09 / GOAL-007** | 历史派发快照回放：按 dispatch_id 提取全生命周期记录 | D11 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-10 / GOAL-007** | 一键重跑：看板历史记录卡点"重跑"，克隆参数快速再发 | D10 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-11 / GOAL-035** | 派发结果 diff 视图：展示犬只修改的工作区 git diff | D1 | 中 | done | `goals/GOAL-035-dispatch-diff-viewer.md` |
| **GP-12 / GOAL-018** | 真实长任务冒烟：owner 授权后跑通一次真实复杂编码任务 | D6 | 高 | done | `goals/GOAL-018-workstreams.md` |
| **GP-13 / GOAL-014** | 密钥安全扫描 CI：push 前自动扫描密钥，防误提交 | D19 | 高 | done | `goals/GOAL-014-realwork-carveout.md` |
| **GP-14 / GOAL-014** | 意向项目只读代理：受控只读访问意向项目，零写回 | D19 | 高 | done | `goals/GOAL-014-realwork-carveout.md` |
| **GP-15 / GOAL-041** | 看板操作日志导出：一键导出全量审计日志为 markdown | D11 | 低 | done | `goals/GOAL-041-audit-log-export.md` |
| **GP-16 / GOAL-025** | 犬只健康心跳检测：定期 ping 适配器，异常标红 | D8 | 中 | done | `goals/GOAL-025-model-live-probing.md` |
| **GP-17 / GOAL-007** | 任务取消/中断：运行中派发一键 kill 子进程 | D10 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-18 / GOAL-018** | 完成桌面通知：任务结束触发系统级 Web Notification | D10 | 中 | done | `goals/GOAL-018-workstreams.md` |
| **GP-19 / GOAL-032** | 代码库索引增强：轻量 AST/符号依赖分析与上下文精准自动装配 | D1 | 中 | done | `goals/GOAL-032-smart-codebase-indexer.md` |
| **GP-20 / GOAL-007** | 多工作区切换：看板支持多项目目录注册与快速切换 | D1 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |


---

## 2026-08-17 增补（owner 试用反馈 GP-21..24）

| ID | 标题 | 来源 | 优先 | 状态 | 依赖 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| GP-21 | dsh preset 切换：dispatch 暴露 profile 字段（--profile 注入），UI 预设下拉；模型切换可经 per-model profile 实现（owner 建 ~/.dsh/profiles/*）——**已完成** | owner Q2 | 中 | done | — | deepseek 后端 + kimi UI |
| GP-22 | effort 档位按模型适配：合同声明 effort_levels + 注入方式（flag/env），从各 harness 官方文档核对（GPT 5 档等），UI 按犬渲染——**已完成** | owner Q3 | 中 | done | — | 替换硬编码 LOW/HIGH/XHIGH |
| GP-23 | 前端美化：运行中犬只动效 logo（CSS 动画 + 内联 SVG，零外链红线内）；整体视觉升级——**已完成** | owner Q4 | 中 | done | — | kimi |
| GP-24 | 看板 Carve-out 声明式写面可视化工作台（GOAL-034 / GP-24）：切片查询接口 GET /api/carveouts + 看板写面白名单工作台 + 倒计时与紧急熔断撤销——**已完成（2026-08-19，全量 439 tests PASS）** | owner Q1 | 高 | done | GP-14 | 声明式写面安全控制面正式交付 |
| GP-27 | DEF-10：派发默认工作区取持久化选择（.mush/workspace.json 启动恢复）；GP-18 完成通知升级——**已完成** | owner 2026-08-17 | 中 | done | — | 启动恢复与会话留痕 |
| GP-28 | Linux 对照续：dsh 凭据容器化方案（最小凭据挂载或 env 注入，密钥不进命令行/日志）；完成后补 Linux nonce 基线与对照结论 | AD-27 | 低 | idea | — | 副线，Windows 原生已够用 |
| GP-29 | pi 通道复活——**已完成（AD-44，2026-08-18）**：pi-rpc 生产 runner 接入，真实冒烟经 tbtk-ds/deepseek 全线贯通（绕开 DEF-13）；后续：codex 密钥模型经 pi auth 复用 + GP-35 逐模型实测升 verified | D28+owner 紧急令 | 高/done | done | G018 后 | dsh 真续跑的正路 |
| GP-30 | dsh 上游版本观察：headless 加 --resume 即重探（机会性） | D28④ | 低 | idea | — | 被动受益 |
| GP-31 | 完整流管理面板与交接编辑器（GOAL-033 / GP-31）：工作流四态生命周期（ACTIVE/PAUSED/ARCHIVED/MERGED）+ 结构化 Handoff Block 读写 + Fork 分支流派生与上下文继承——**已完成（2026-08-19，全量 437 tests PASS）** | D29 | 中 | done | G018 后 | 完整控制面与长线多犬交接 |
| GP-32 | D30 实现修正：①审批单次消费制（AD-38，契约 v1.8）；②看板调用者身份 Bearer Token 握手鉴权（GOAL-030，契约 v1.15）——**全部完成** | D30/AD-34 | 高 | done | — | 头犬安全审查线与调用者安全防御 |
| GP-33 | 用量监控（GOAL-027 / D32）：模仿 ccusage——本地多 harness 会话日志解析（claude/pi/receipts）+ 基准定价表 → per-actor / per-model Token 用量与真实费用全景投影进看板；零依赖、零密钥——**已完成（2026-08-19，全量 412 tests PASS）** | owner 2026-08-17 + 头犬调研 | 高 | done | GP-35/37 | 成本与消耗透明化 |
| GP-34 | 「雪原营地」前端改版（D33+**D34 融合**，章程 goals/GOAL-020-snowfield-taskpool.md = 雪原 B1-B4 + 任务池前端 B5 合一）：单屏指挥台 + 审批内联收编 + 冷白纸面 + 排版阶梯 + 三泳道入新骨架——**已完成（GOAL-020，2026-08-17）** | kimi 计划书 + owner 转呈 | 高 | done | p19b 合并后 | 雪原营地 UI 生产上线 |
| GP-35 | 模型实测选择（GOAL-025）：选定 harness 后**探测该 harness 当前密钥下实际可用的模型清单**（cc-switch 通道数据 + nonce 证据），模型下拉以实测为主、合同声明为兜底；派发回执中的**实际返回模型**回填 roster（权威优先于自述）；官方模型优先但不排除第三方；UNKNOWN 诚实标注——**已完成（2026-08-19，全量 404 tests PASS）** | owner 2026-08-17 | 高 | done | GP-33 监控（同一探测数据面） |
| GP-36 | 任务自动完成探测与可视化路径导图（GOAL-024）：派发 PASS/FAIL 自动推进任务状态机（IN_FLIGHT/DONE/BLOCKED）+ 看板任务思维导图/DAG 路径图（四态鲜明配色绿/蓝/灰/红 + 贝塞尔连线 + 点击直通三透镜）——**已完成（2026-08-18，全量 400 tests PASS）** | owner 2026-08-18 | 高 | done | GOAL-023 | 任务池自动化与全景流向闭环 |
| GP-37 | 零 Token 消耗探测与四级调度信度梯队（GOAL-026）：零消耗元数据过滤 + 顺风车派发回执权威晋升 + 四级信度徽章（🟢实测畅通 / 🟡配置就绪 / ⚪目录候选项 / 🔴受阻阻断）+ 命令行无注入通道犬只防呆保护——**已完成（2026-08-19，全量 408 tests PASS）** | owner 2026-08-19 | 高 | done | GP-35 | 消除虚假繁荣与零成本精准调度 |
| GP-38 | 多元组织拓扑与 LLM-as-a-Verifier 协同架构演进（GOAL-028）：解除单一父级垄断 + 增加流水线 SOP / 陪审辩论 / 悬赏市场拓扑 + 引入独立 LLM 验证犬（解耦生成与验证）+ 赋予人类架构选择权——**已完成（2026-08-19，全量 419 tests PASS）** | owner 2026-08-19 | 高 | done | GP-33/37 | 迈向多元社会化 Agent 协作 |
| GP-39 | 对话实时流式打字机与 Thinking 思考链展开（GOAL-029）：单屏指挥台 SSE 逐字打字机 + Thinking 动态伸缩气泡（心跳秒表/自动折叠/展开）+ 滚动吸附锁——**已完成（2026-08-19，全量 421 tests PASS）** | owner 2026-08-19 | 高 | done | RM-004 M2 | 消除黑盒等待与流式可视化 |
| GP-40 | 看板调用者身份鉴别与握手保护（GOAL-030 / GP-32②）：会话级 Caller Token 签发 + 状态变更 API 校验 + 防跨源伪造握手——**已完成（2026-08-19，全量 424 tests PASS）** | D30 安全红线 | 高 | done | GP-32① | 杜绝未授权本地进程越权控制 |
| GP-41 | RM-004 M1 实战运营与 agy 旗舰真实闭环（GOAL-031）：基于 carve-out 写面白名单 + agy 真实执行 (gemini-3.7-flash-high) + 独立 Verifier 审判 + 审批卡放行 + 事件链留痕——**已完成（2026-08-19，全量 428 tests PASS）** | RM-004 M1 | 高 | done | GP-40 / GOAL-028 | 实战运营与真活交付闭环 |

---

## 2026-08-19 进阶规划池（GOAL-035..042 储备体系，状态均为 PROPOSED）

| ID / Goal | 标题与核心范畴 | 来源 | 优先 | 状态 | 对应 Goal 文档 |
| --- | --- | --- | --- | --- | --- |
| **GP-11 / GOAL-035** | 看板 Git Diff 视觉审查器（内联 unified diff、敏感文件高亮、单文件回滚）——**已完成（2026-08-19，全量测试 PASS）** | D1 设想 / D38 | **高（下一阶段推荐）** | done | `goals/GOAL-035-dispatch-diff-viewer.md` |
| **D38-L2 / GOAL-036** | 派发 Trace 步骤树与耗时瀑布图（Langfuse 式阶段节点、瀑布甘特图、Token 膨胀曲线）——**已完成（2026-08-19，全量测试 PASS）** | D38 透镜二 | 中 | done | `goals/GOAL-036-dispatch-trace-waterfall.md` |
| **D37 / GOAL-037** | 犬只直连会话控制台（点击头像直连面板、Transcript 回看、断线续接）——**已完成（2026-08-19，全量测试 PASS）** | D37 / D38 透镜三 | 中 | done | `goals/GOAL-037-dog-direct-console.md` |
| **GP-04 / GOAL-038** | 多轮长上下文滚动蒸馏与记忆持久化（70%/85%/95% 压力预警、轻量蒸馏、跨会话注入）——**已完成（2026-08-19，全量测试 PASS）** | D18 预研 | 中 | done | `goals/GOAL-038-context-rolling-distillation.md` |
| **GP-07 / GOAL-039** | 异构犬能力感知智能路由（任务特征多维提取、能力画像增量学习、Top-3 推荐）——**已完成（2026-08-19，全量测试 PASS）** | D1 设想 | 低 | done | `goals/GOAL-039-smart-task-routing.md` |
| **GP-01 / GOAL-040** | 跨 Harness 影子分流评测台（同 prompt 多犬独立 worktree 并行评测与比对报告）——**已完成（2026-08-19，全量测试 PASS）** | D1 设想 | 低 | done | `goals/GOAL-040-shadow-eval-bench.md` |
| **GP-15 / GOAL-041** | 看板审计日志归档导出（全量事件/台账/探测数据聚合一键生成结构化 Markdown）——**已完成（2026-08-19，全量测试 PASS）** | D11 扩展 | 低 | done | `goals/GOAL-041-audit-log-export.md` |
| **Phase-C / GOAL-042** | 符号化记忆图谱与跨犬直连协作协议（TencentDB 式图节点/边、无中转 DAG 消息总线）——**已完成（2026-08-19，全量测试 PASS）** | 奠基提案 Phase C | 低（远期） | done | `goals/GOAL-042-symbolic-memory-interagent.md` |

---

## 2026-08-19 RM-005 合作框架规划池（社会化 Agent 协作与自适应工作台）

> 依据：2026-08-19 owner `/grill-me` 深度访谈裁决 + `docs/rm-005-social-collaboration.md`。

| ID / Goal | 标题与核心范畴 | 来源 | 优先 | 状态 | 对应 Goal 文档 |
| --- | --- | --- | --- | --- | --- |
| **RM005-M1 / GOAL-043** | 聊天底栏协作模式快捷开关与调度总线（自由/辩论/流水线/攻防胶囊切换、推荐阵容一键微调）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | **最高（首发 M1）** | done | `goals/GOAL-043-chat-collaboration-bus.md` |
| **RM005-M1 / GOAL-044** | 圆桌辩论对席排版与自动仲裁工作台（双栏 Pro/Con 对峙、3阶段质询、共识提纯、page.ts 伴随瘦身）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | **最高（首发 M1）** | done | `goals/GOAL-044-debate-arena-studio.md` |
| **RM005-M2 / GOAL-045** | SOP 工序流水线与工件自动接力工作台（5阶段卡片链、跨犬工件无损自动流转、阶段门禁）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M2） | done | `goals/GOAL-045-assembly-pipeline-studio.md` |
| **RM005-M3 / GOAL-046** | 红蓝对抗验证室与闭环自动打回流（Generator !== Verifier 物理隔离、破坏性用例、自动修复重写）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M3） | done | `goals/GOAL-046-red-blue-verification-studio.md` |
| **RM005-M4 / GOAL-047** | Contract Net 悬赏招投标市场与动态撮合池（任务公开出标、自主竞标、动态负载均衡调度）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M4） | done | `goals/GOAL-047-bounty-market-studio.md` |

---

## 2026-08-19 RM-006 技能与时空规划池（跨犬技能联邦与时空状态内核）

> 依据：2026-08-19 owner `/grill-me` 深度访谈裁决 + `docs/rm-006-skills-and-time-travel.md`。

| ID / Goal | 标题与核心范畴 | 来源 | 优先 | 状态 | 对应 Goal 文档 |
| --- | --- | --- | --- | --- | --- |
| **RM006-M1 / GOAL-048** | 跨 Harness 技能双向转译与统一热挂载引擎（Claude/Codex/AGY 技能互转、动态挂载、安全沙箱）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M1） | done | `goals/GOAL-048-cross-harness-skills-federation.md` |
| **RM006-M2 / GOAL-049** | 会话与代码时空状态树与因果时间旅行快照（Git-like 微快照、一键 undo/redo、平行分支实验）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M2） | done | `goals/GOAL-049-time-travel-state-kernel.md` |
| **RM006-M3 / GOAL-050** | 跨犬共享黑板协作空间与读写白名单仲裁（Artifacts/Issues 分区、无中转去中心化、事件条件唤醒）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M3） | done | `goals/GOAL-050-shared-blackboard-workspace.md` |
| **RM006-M4 / GOAL-051** | 液态临时战时攻关小队与指挥犬选举协议（战时指挥动态选举、敏捷小队集结、任务后自解散）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M4） | done | `goals/GOAL-051-dynamic-liquid-squads.md` |

---

## 2026-08-19 RM-007 进化与伴侣规划池（战绩天梯自进化与轻量桌面伴侣）

> 依据：2026-08-19 owner `/grill-me` 深度访谈裁决 + `docs/rm-007-evolution-and-companion.md`。

| **RM007-M1 / GOAL-052** | 影子评测与实战战绩 ELO 天梯榜引擎（自动盲审对决、Pass@1/能效/延迟综合评分、段位大屏）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M1） | done | `goals/GOAL-052-auto-benchmark-elo-engine.md` |
| **RM007-M2 / GOAL-053** | 战绩反馈闭环与自适应路由权重自进化（实战样本闭环打标、在线梯度自适应权重调优）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M2） | done | `goals/GOAL-053-self-evolving-routing-optimizer.md` |
| **RM007-M3 / GOAL-054** | 极简系统托盘常驻伴侣与全局热键雪橇浮窗（Alt+Space 呼之即来、划词审查、原生非阻塞通知）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M3） | done | `goals/GOAL-054-floating-sled-desktop-companion.md` |
| **RM007-M4 / GOAL-055** | 多犬协作全景战报与研发能效大屏（DORA/SPACE 研发效能矩阵、全景战报生成、吞吐走势图）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M4） | done | `goals/GOAL-055-velocity-matrix-and-sled-report.md` |

---

## 2026-08-21 RM-010 商业化就绪与安全加固规划池 (RM-010 Commercial Readiness & Security)

> 依据：2026-08-21 商业化深度审计 (P0) + owner D79 决策 + `docs/rm-010-commercial-readiness-and-security.md`。

| ID / Goal | 标题与核心范畴 | 来源 | 优先 | 状态 | 对应 Goal 文档 |
| --- | --- | --- | --- | --- | --- |
| **RM010-M1 / GOAL-063** | 核心安全闸门闭环与零信任鉴权加固（强制 Token 鉴权、废除匿名 Token 领取、CSRF 校验、路径白名单、Session 强校验、ELO XSS 与 SVG 沙箱）——**已完成（2026-08-21，全量测试 PASS）** | 商业化审计 (P0) / D79 | **最高（P0-1）** | done | `goals/GOAL-063-security-gate-closure-and-zero-trust-auth.md` |
| **RM010-M2 / GOAL-064** | 服务端权威预算、实际成本回写与账本持久化（服务端权威 Cap 锁定、Telemetry 真实消耗回写、JSONL 磁盘持久化）——**已完成（2026-08-21，全量测试 PASS）** | 商业化审计 (P0) / D79 | **高（P0-2）** | done | `goals/GOAL-064-authoritative-budget-and-ledger-persistence.md` |
| **RM010-M3 / GOAL-065** | 进程生命周期韧性、树杀与 Fail-Closed 纠偏（EPIPE 崩溃防护、Windows 进程树收割、pi-rpc Fail-Closed 纠偏、审批令牌原子 Rename 消费）——**已完成（2026-08-21，全量测试 PASS）** | 商业化审计 (P0) / D79 | **高（P0-3）** | done | `goals/GOAL-065-process-tree-resilience-and-fail-closed-audit.md` |
| **RM010-M4 / GOAL-066** | MVP 桌面封装、许可协议与试运行发版（Apache-2.0 协议、商用 EULA 责任限制、单文件桌面打包与试运行发版）——**已完成（2026-08-21，全量测试 PASS）** | 商业化战略 / D79 | **中（P0-4）** | done | `goals/GOAL-066-mvp-desktop-packaging-and-trial-release.md` |
