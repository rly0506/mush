# mush 目标池（Goal Pool）

> 依据：DECISIONS.md D23、D67、D68（三重治理架构与单一合法 Goal 实体）。
> 维护原则：全库统一以 `goals/GOAL-*.md` 为唯一合法实体，历史 `GP-xx` 草稿条目已全部映射归并至对应 Goal。
> 状态流转：由 `syncGoalsDirectoryToTasks` 自动双向对账（PROPOSED/READY → IN_FLIGHT → DONE）。

---

## 初始规划池（已全面映射至 RM-001 ~ RM-007 / GOAL-001 ~ GOAL-055）

| 历史编号 / Goal | 标题与范畴 | 来源 | 优先 | 状态 | 对应 Goal 规格文档 |
| --- | --- | --- | --- | --- | --- |
| **GP-01 / GOAL-040** | 跨 harness 影子分流验证：同 prompt 投多犬，比对输出与耗时 | D1 | 低 | done | `goals/GOAL-040-shadow-eval-bench.md` |
| **GP-02 / GOAL-018** | 会话持久化与真 resume：各 harness 本地 session 机制接入 | D4 | 高 | AUTO_ACCEPTED | `goals/GOAL-018-workstreams.md` |
| **GP-03 / GOAL-007** | 看板状态重启重放：服务重启后从事件流恢复全量视图 | D8 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-04 / GOAL-038** | 多轮上下文滚动压缩：长会话 token 压力预警与轻量蒸馏 | D18 | 中 | done | `goals/GOAL-038-context-rolling-distillation.md` |
| **GP-05 / GOAL-007** | 失败重试与退避策略：瞬态错误自动重试，持续失败熔断 | D8 | 中 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-06 / GOAL-017A** | 预算超限前预警：按日/按周预警阈值，超阈发 notification | D14 | 中 | AUTO_ACCEPTED | `goals/GOAL-014-realwork-flagship.md` |
| **GP-07 / GOAL-039** | 异构犬能力路由：按任务特征多维画像自动推荐犬只 | D1 | 低 | done | `goals/GOAL-039-smart-task-routing.md` |
| **GP-08 / GOAL-018** | 审批请求多渠道通知：看板内联 + 系统通知 | D6 | 中 | AUTO_ACCEPTED | `goals/GOAL-018-workstreams.md` |
| **GP-09 / GOAL-007** | 历史派发快照回放：按 dispatch_id 提取全生命周期记录 | D11 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-10 / GOAL-007** | 一键重跑：看板历史记录卡点"重跑"，克隆参数快速再发 | D10 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-11 / GOAL-035** | 派发结果 diff 视图：展示犬只修改的工作区 git diff | D1 | 中 | done | `goals/GOAL-035-dispatch-diff-viewer.md` |
| **GP-12 / GOAL-018** | 真实长任务冒烟：owner 授权后跑通一次真实复杂编码任务 | D6 | 高 | AUTO_ACCEPTED | `goals/GOAL-018-workstreams.md` |
| **GP-13 / GOAL-014** | 密钥安全扫描 CI：push 前自动扫描密钥，防误提交 | D19 | 高 | AUTO_ACCEPTED | `goals/GOAL-014-realwork-carveout.md` |
| **GP-14 / GOAL-014** | 意向项目只读代理：受控只读访问意向项目，零写回 | D19 | 高 | AUTO_ACCEPTED | `goals/GOAL-014-realwork-carveout.md` |
| **GP-15 / GOAL-041** | 看板操作日志导出：一键导出全量审计日志为 markdown | D11 | 低 | done | `goals/GOAL-041-audit-log-export.md` |
| **GP-16 / GOAL-025** | 犬只健康心跳检测：定期 ping 适配器，异常标红 | D8 | 中 | AUTO_ACCEPTED | `goals/GOAL-025-model-live-probing.md` |
| **GP-17 / GOAL-007** | 任务取消/中断：运行中派发一键 kill 子进程 | D10 | 高 | done | `goals/GOAL-007-board-frontend-ui.md` |
| **GP-18 / GOAL-018** | 完成桌面通知：任务结束触发系统级 Web Notification | D10 | 中 | AUTO_ACCEPTED | `goals/GOAL-018-workstreams.md` |
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
| GP-33 | 用量监控（GOAL-027 / D32）：模仿 ccusage——本地多 harness 会话日志解析（claude/pi/receipts）+ 基准定价表 → per-actor / per-model Token 用量与真实费用全景投影进看板；零依赖、零密钥——**已完成（2026-08-19，全量 412 tests PASS）** | owner 2026-08-17 + 头犬调研 | 高 | AUTO_ACCEPTED | GP-35/37 | 成本与消耗透明化 |
| GP-34 | 「雪原营地」前端改版（D33+**D34 融合**，章程 goals/GOAL-020-snowfield-taskpool.md = 雪原 B1-B4 + 任务池前端 B5 合一）：单屏指挥台 + 审批内联收编 + 冷白纸面 + 排版阶梯 + 三泳道入新骨架——**已完成（GOAL-020，2026-08-17）** | kimi 计划书 + owner 转呈 | 高 | AUTO_ACCEPTED | p19b 合并后 | 雪原营地 UI 生产上线 |
| GP-35 | 模型实测选择（GOAL-025）：选定 harness 后**探测该 harness 当前密钥下实际可用的模型清单**（cc-switch 通道数据 + nonce 证据），模型下拉以实测为主、合同声明为兜底；派发回执中的**实际返回模型**回填 roster（权威优先于自述）；官方模型优先但不排除第三方；UNKNOWN 诚实标注——**已完成（2026-08-19，全量 404 tests PASS）** | owner 2026-08-17 | 高 | AUTO_ACCEPTED | GP-33 监控（同一探测数据面） |
| GP-36 | 任务自动完成探测与可视化路径导图（GOAL-024）：派发 PASS/FAIL 自动推进任务状态机（IN_FLIGHT/DONE/BLOCKED）+ 看板任务思维导图/DAG 路径图（四态鲜明配色绿/蓝/灰/红 + 贝塞尔连线 + 点击直通三透镜）——**已完成（2026-08-18，全量 400 tests PASS）** | owner 2026-08-18 | 高 | AUTO_ACCEPTED | GOAL-023 | 任务池自动化与全景流向闭环 |
| GP-37 | 零 Token 消耗探测与四级调度信度梯队（GOAL-026）：零消耗元数据过滤 + 顺风车派发回执权威晋升 + 四级信度徽章（🟢实测畅通 / 🟡配置就绪 / ⚪目录候选项 / 🔴受阻阻断）+ 命令行无注入通道犬只防呆保护——**已完成（2026-08-19，全量 408 tests PASS）** | owner 2026-08-19 | 高 | AUTO_ACCEPTED | GP-35 | 消除虚假繁荣与零成本精准调度 |
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
| **RM005-M1 / GOAL-043** | 聊天底栏协作模式快捷开关与调度总线（自由/辩论/流水线/攻防胶囊切换、推荐阵容一键微调）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | **最高（首发 M1）** | AUTO_ACCEPTED | `goals/GOAL-043-chat-collaboration-bus.md` |
| **RM005-M1 / GOAL-044** | 圆桌辩论对席排版与自动仲裁工作台（双栏 Pro/Con 对峙、3阶段质询、共识提纯、page.ts 伴随瘦身）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | **最高（首发 M1）** | AUTO_ACCEPTED | `goals/GOAL-044-debate-arena-studio.md` |
| **RM005-M2 / GOAL-045** | SOP 工序流水线与工件自动接力工作台（5阶段卡片链、跨犬工件无损自动流转、阶段门禁）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M2） | AUTO_ACCEPTED | `goals/GOAL-045-assembly-pipeline-studio.md` |
| **RM005-M3 / GOAL-046** | 红蓝对抗验证室与闭环自动打回流（Generator !== Verifier 物理隔离、破坏性用例、自动修复重写）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M3） | AUTO_ACCEPTED | `goals/GOAL-046-red-blue-verification-studio.md` |
| **RM005-M4 / GOAL-047** | Contract Net 悬赏招投标市场与动态撮合池（任务公开出标、自主竞标、动态负载均衡调度）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M4） | AUTO_ACCEPTED | `goals/GOAL-047-bounty-market-studio.md` |

---

## 2026-08-19 RM-006 技能与时空规划池（跨犬技能联邦与时空状态内核）

> 依据：2026-08-19 owner `/grill-me` 深度访谈裁决 + `docs/rm-006-skills-and-time-travel.md`。

| ID / Goal | 标题与核心范畴 | 来源 | 优先 | 状态 | 对应 Goal 文档 |
| --- | --- | --- | --- | --- | --- |
| **RM006-M1 / GOAL-048** | 跨 Harness 技能双向转译与统一热挂载引擎（Claude/Codex/AGY 技能互转、动态挂载、安全沙箱）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M1） | AUTO_ACCEPTED | `goals/GOAL-048-cross-harness-skills-federation.md` |
| **RM006-M2 / GOAL-049** | 会话与代码时空状态树与因果时间旅行快照（Git-like 微快照、一键 undo/redo、平行分支实验）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M2） | AUTO_ACCEPTED | `goals/GOAL-049-time-travel-state-kernel.md` |
| **RM006-M3 / GOAL-050** | 跨犬共享黑板协作空间与读写白名单仲裁（Artifacts/Issues 分区、无中转去中心化、事件条件唤醒）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M3） | AUTO_ACCEPTED | `goals/GOAL-050-shared-blackboard-workspace.md` |
| **RM006-M4 / GOAL-051** | 液态临时战时攻关小队与指挥犬选举协议（战时指挥动态选举、敏捷小队集结、任务后自解散）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M4） | AUTO_ACCEPTED | `goals/GOAL-051-dynamic-liquid-squads.md` |

---

## 2026-08-19 RM-007 进化与伴侣规划池（战绩天梯自进化与轻量桌面伴侣）

> 依据：2026-08-19 owner `/grill-me` 深度访谈裁决 + `docs/rm-007-evolution-and-companion.md`。

| **RM007-M1 / GOAL-052** | 影子评测与实战战绩 ELO 天梯榜引擎（自动盲审对决、Pass@1/能效/延迟综合评分、段位大屏）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 高（M1） | AUTO_ACCEPTED | `goals/GOAL-052-auto-benchmark-elo-engine.md` |
| **RM007-M2 / GOAL-053** | 战绩反馈闭环与自适应路由权重自进化（实战样本闭环打标、在线梯度自适应权重调优）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M2） | AUTO_ACCEPTED | `goals/GOAL-053-self-evolving-routing-optimizer.md` |
| **RM007-M3 / GOAL-054** | 极简系统托盘常驻伴侣与全局热键雪橇浮窗（Alt+Space 呼之即来、划词审查、原生非阻塞通知）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M3） | AUTO_ACCEPTED | `goals/GOAL-054-floating-sled-desktop-companion.md` |
| **RM007-M4 / GOAL-055** | 多犬协作全景战报与研发能效大屏（DORA/SPACE 研发效能矩阵、全景战报生成、吞吐走势图）——**已完成（2026-08-19，全量测试 PASS）** | owner 访谈 | 中（M4） | AUTO_ACCEPTED | `goals/GOAL-055-velocity-matrix-and-sled-report.md` |

---

## 2026-08-21 RM-010 商业化就绪与安全加固规划池 (RM-010 Commercial Readiness & Security)

> 依据：2026-08-21 商业化深度审计 (P0) + owner D79 决策 + `docs/rm-010-commercial-readiness-and-security.md`。

| ID / Goal | 标题与核心范畴 | 来源 | 优先 | 状态 | 对应 Goal 文档 |
| --- | --- | --- | --- | --- | --- |
| **RM010-M1 / GOAL-063** | 核心安全闸门闭环与零信任鉴权加固（强制 Token 鉴权、废除匿名 Token 领取、CSRF 校验、路径白名单、Session 强校验、ELO XSS 与 SVG 沙箱）——**已完成（2026-08-21，全量测试 PASS）** | 商业化审计 (P0) / D79 | **最高（P0-1）** | done | `goals/GOAL-063-security-gate-closure-and-zero-trust-auth.md` |
| **RM010-M2 / GOAL-064** | 服务端权威预算、实际成本回写与账本持久化（服务端权威 Cap 锁定、Telemetry 真实消耗回写、JSONL 磁盘持久化）——**已完成（2026-08-21，全量测试 PASS）** | 商业化审计 (P0) / D79 | **高（P0-2）** | done | `goals/GOAL-064-authoritative-budget-and-ledger-persistence.md` |
| **RM010-M3 / GOAL-065** | 进程生命周期韧性、树杀与 Fail-Closed 纠偏（EPIPE 崩溃防护、Windows 进程树收割、pi-rpc Fail-Closed 纠偏、审批令牌原子 Rename 消费）——**已完成（2026-08-21，全量测试 PASS）** | 商业化审计 (P0) / D79 | **高（P0-3）** | done | `goals/GOAL-065-process-tree-resilience-and-fail-closed-audit.md` |
| **RM010-M4 / GOAL-066** | MVP 桌面封装、许可协议与试运行发版（Apache-2.0 协议、商用 EULA 责任限制、单文件桌面打包与试运行发版）——**已完成（2026-08-21，全量测试 PASS）** | 商业化战略 / D79 | **中（P0-4）** | done | `goals/GOAL-066-mvp-desktop-packaging-and-trial-release.md` |

## 2026-09-05 基线修复补记

历史 GOAL-067 至 GOAL-082 摘要缺口另行对账，本条仅记录本轮实际开发结果。

| Goal | 标题 | 优先级 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| GOAL-083 | 测试环境隔离与回归基线恢复 | 高 | AUTO_ACCEPTED | 默认/隔离模式各 710/710，typecheck 0，看板基线 7/7；`goals/GOAL-083-test-isolation-and-regression-baseline.md` 与对应回执 |
| GOAL-084 | 受控黑板多模型方案协作 | 高 | PROPOSED | 首场真实双模型讨论已完成（8 次调用＝7+1，四阶段观点齐备，Codex gpt-5.5 LOW＋agy gemini-3.7-flash-high HIGH）。DeepSeek 收尾（2026-10-04）：D88/D89 条件化准入落地并经 **HTTP 与真实 Chromium 两侧验收**（政策逐条接受缺口、创建/批准/**占额前**三道反例硬前置、快照冻结、侧栏常用卡逐项可见）、证据等级改由显式 verification 判定、fixture 数据面隔离；契约 v1.58；两模式 884/884、typecheck0、对账 PASS；验收回执 goals/receipts/GOAL-084-receipt.json（`7ee5581b…`）。**如实保留**：席位五维证据未全部通过（`mcp_scope` 行为级，tool_scope/write_protection/read_scope/recursion 为明确接受的缺口），不用守卫层结果顶替。Owner 正式验收未做。见 docs/operations/goal084-seat-applicability-2026-10-04.md |
| GOAL-085 | Codex／Claude Code／agy 双模型互评稳定复现 | 高 | IN_PROGRESS | **2026-10-06 D97当前范围：先只三种harness，取消三模型验收，复用旧成功记录、定位当前失效链路；以Goal §6为准，不扩八种、不重做已有接入，原三模式入口仍待后续收窄。以下为原规格与历史记录，原三模型待批/未启动状态已由后续失败回执取代。** 受控 Claude 通道（--safe-mode/空 --tools/空 MCP＋空 settings/dontAsk/不持久化，--bare 不采用）＋双/三模型讨论（2/3 席位、两两互评六关系冻结、13+1/7+1、viewpoints 四元唯一键迁移、常用卡与结果两/三列）＋**逐席位强度选择**（默认仍冻结、显式值随快照冻结、不进入权限指纹；D91）＋**终局优先级**（答案只由最后一个权威终局决定、失败终局拒绝整段；D92）。已验收：Claude 档案 6/6＋隔离原生 8/8＋答案信封与终局优先级 7/7＋逐席位强度与模型初值 6/6＋API 5/5＋端到端 3/3＋编排 18/18＋预算回归 2 例、默认全量 **940/940**、独立全量 **940/940**、typecheck 0、对账 PASS（契约 v1.61、D92）；真实 Chromium（双列/三列/窄屏/停止/常用卡逐项/备注输入/逐席位强度/模型初值不再撞准入门）；codex 席位五维经 owner 批准复跑并重新登记为 behavior。**三个真实探针已按 owner 逐单 D30 批准执行**：C8、C9（自报 BLOCKED 不登记）、C11（变体指纹 `4f690148…`：Read 成功读到 canary、Bash(echo) 成功、Write 与子代理 Bash 被 dontAsk 拒绝、子代理终态 completed）。**零付费原生隔离实验完成并分项登记**（D93：真实 CLI＋本地假后端＋合成凭据＋隔离数据根；严格档案工具面只剩 StructuredOutput、强制 Read/Write/Bash 一律被拒且无副作用、严格配置未自动注入工作区 CLAUDE.md → **`tool_scope` 登记为行为级**（指纹归属经机器核对：生产合同重建 = `5b5096e9…`，实验合同唯一差异为 workspace_root、argv 逐字节相同）；`write_protection` 只保留局部证明、其余维度保持缺口，不加 D89 豁免）。同时修掉三条边界：运行时身份门、证据运输（回执保留原始流）、答案信封解析＋终局优先级。C10 解释已更正：`reused=true` = 已存在同内容 C10 待审批包（非"C9 已应答"），该卡仍有效、按 owner 裁定不改提示暂不恢复。**写入覆盖按有限范围推进**（严格档案下 Agent/Task/Workflow/调度六入口全"不存在"、无子任务、持久化新增 0；工作区外读写目标零变化（变体下读/写均被权限门拒）；用户级上下文真实路径确认为 `$CLAUDE_CONFIG_DIR/CLAUDE.md`）。**隔离补证轮已结束**：Claude 席位**五维全部登记为行为级**（D93 `tool_scope` + D94 四条独立来源，产物 `29ca8e83…`/`2ce13840…`/`e25f6330…` 冻结、历史未改写、coverage 写明差异与覆盖限制且声明不外推），独立读回五维 `live_verified`、反例 0；两种会话创建均 201 `ready=true`（双席位 `8fa0232e…`、三席位 `c8c1fb65…`，**未批准、未启动**）。**可报告"Claude 席位五维准入已满足"**；**真实讨论尚未验收**，费用与真实调用暂停不解除、C10 无需恢复。**收尾（owner 2026-10-05 指令）**：两张准入核对会话已**取消**（保留卡片与历史、未写应答）；**待批投影已修正**（契约 v1.62：终态会话投影为 `SESSION_TERMINAL`，不删卡不伪造应答；GOAL-084 三张旧卡实测已排除，无需再次否决；回归 2/2）；**已重新准备两场正式验收卡**（议题「评审 GOAL-084 的实现与遗留问题（源码材料按 2026-10-05 冻结）」、五个带 sha256 锚点的冻结源码材料）——Codex＋Claude `1c1901dd…`（7+1/20min）、Codex＋agy＋Claude `2d082857…`（13+1/40min，六条互评），均 `ready=true` 且**停在待审批、未批准未启动**。**待 owner**：恢复费用授权与**逐卡批准**（先 Codex＋Claude，再 Codex＋agy＋Claude）。**遗留项已处置**：C11 重复准备卡核对七项阻断通过后**否决清理**（note 如实写明"重复包已执行"并记录 schema 差异：卡为 C11 定稿前读探针 schema、执行包为五维闭合 schema；未重跑、零费用、卡与历史保留）；C10 **有卡且有（委托）APPROVED 应答**但记录仍 `BLOCKED_WAITING_OWNER`、无回执 → 保留未执行记录、不补卡不恢复（此前"没有卡文件"的说法已更正）。两场讨论只验证真实协作链路与所提供源码片段，**不构成 GOAL-084 全部源码审计**。回执 goals/receipts/GOAL-085-receipt.json；C11 与隔离实验文档见 docs/operations/goal085-*.md |


GOAL-085 2026-10-06实施补录（Codex）：新建/运行限双席位、历史三席位只读；A16 finish-only独立审批与恢复闭环已接线。旧成功基线沿用，新原生单回合及Codex+agy真实复现仍待单独验收；不记DONE。当前证据以Goal §6.1和本轮独立回执为准。

GOAL-085 A16补录（2026-10-06，Codex）：Owner逐卡授权的一次agy原生探针已通过最小finish结束接口，唯一JSON/身份/恢复已核对；候选新指纹未成为生产席位，未开整场、未迁移证据或豁免。正式双模复现仍待候选准入与授权，Claude2.1.290版本门保持拒绝；Goal不记DONE。

GOAL-085 D98补录（2026-10-06）：Owner接受finish-only新指纹五项缺证，限Codex＋agy 7+1/180s/20min，用于准备新复现卡；状态仍unmet而非live_verified。当前未启动整场；模型/强度可选不代表任意组合验证通过，Claude2.1.290版本门未放宽。跨harness skill/MCP/plugin封装暂缓，先做稳定联通。

GOAL-085最新真实结果（2026-10-06，Codex）：D98新配置下Codex＋agy会话 24675150-8055-4794-93a1-bedd28aa93d0 completed，正常7/重试0，双方提案、互评、修订对账完成，agy三回合finish＋唯一正式JSON成立。费用UNKNOWN、五维缺证未消除；Claude2.1.290仍受D95版本门限制，不能宣称三通道当前全已稳定或任意模型/强度都可用。结果与独立真实回执已落盘，Goal不记DONE，封装暂缓。

GOAL-085最新（2026-10-06，Codex）：D99接受当前Claude2.1.290后的Code＋Claude场 1cafb42c-a97c-497d-a56c-09c2295825b4 completed，7正常/0重试，双方互评/修订及身份/版本审计对账通过。与Code＋agy24675150…共同覆盖三个harness当前批准组合。Claude CLI申报$0.1576171，Code/agy费用仍UNKNOWN；缺证及漂移限制保留，不称任意组合/未来版本可用。待Owner正式验收，不自动DONE，封装暂缓。


GOAL-085稳定联通第一阶段最新补录

Codex执行，2026-10-06：稳定联通第一阶段已实现（v1.67）。零模型check、30秒原生观测缓存、创建/批准/启动前最新版本门、完整组合正式回执索引及表单三类状态已接线。最终默认与独立均961/961、typecheck0、真实Chromium隔离验收、生产两个原批准组合只读ready=true且VERIFIED；看板PID23072加载当前代码。本轮零模型调用、零生产建卡/批准，指纹与接受范围不变。见 goals/receipts/GOAL-085-stability-stage1-receipt.json sha256 be89f4da63fa41e730441ffc897ce7c0f739bf5d8bc62d79b7c27c201e0c763f 与 docs/operations/collaboration-stability-stage1-2026-10-06.md。后两阶段（结果整理、CLI/MCP/skill）未实施，Goal保持PROPOSED，不自动DONE，未提交未推送。

GOAL-085结果整理第二阶段最新补录（GLM，2026-10-06）

GLM执行（owner 指令，零模型调用）：第二阶段（讨论结果整理与本地导出）已实现（v1.68）。新增 POST /api/collaboration/sessions/result（JSON/Markdown 只读导出，事实源=黑板+派发台账，不调用模型）；结果页默认展示各席位最终修订（changes/保留分歧/模型/强度/状态/调用数），提案互评收进可展开过程视图（回应对象/材料引用/发送清单/原始观点 JSON），无修订显示最后有效阶段并说明未完成，不合成共同结论、互评标注未经核实；失败/中断/历史三席位可查看可导出且批准/启动维持 409。费用无申报记 UNKNOWN 不当 0；不导出 caller token/凭据/原生审计流。聚焦回归 tests/g085-session-result.test.ts 5/5；真实 Chromium fixture 验收通过（桌面/窄屏/展开原文/双格式下载/停止/历史导出）；typecheck 0、默认全量 966/966、独立全量 965/966（pi-rpc 一例失败，根因未确认、定向对照 3 轮 32/32，失败日志保留）、对账 PASS、diff-check 0。独立回执 goals/receipts/GOAL-085-result-stage2-receipt.json。第三阶段（CLI/MCP/skill）未实施，Goal 保持 PROPOSED，不记 DONE，未提交未推送。

GOAL-085结果整理第二阶段修复轮补录（GLM，2026-10-06）

Codex 独立复核发现四缺口（完成判定过宽、部分未知费用标已知、未修订席位内容被藏、轮询折回展开状态），GLM 已全部修复：completion.complete 收紧为当前双模型流程完成（新增 revisions_complete）、fees.visibility 三态化（PARTIAL=整场不完整）、无修订席位按席位自身最后有效阶段回退、轮询重渲染保留 details 展开状态。回归扩至 8/8；Chromium 修复轮验收通过（展开≥2 次轮询仍展开、B 提案按席位可见）。typecheck 0、默认 969/969、独立 969/969（上轮 pi-rpc 一例本轮通过，间歇失败根因仍未确认，两轮日志保留）、对账 PASS、diff-check 0。修复轮回执 goals/receipts/GOAL-085-result-stage2-fix-receipt.json；原回执与失败日志不改写不删除。零模型调用、未重载看板、未推进第三阶段、Goal 保持 PROPOSED、未提交未推送。**第二阶段仍不宜收口**，收口与重载待 owner 决定。

GOAL-085结果整理第二阶段收口补录（GLM，2026-10-06）

Codex 独立复核确认四项修复全部通过，owner 裁定第二阶段按本地实现验收收口（不等于 Owner 正式验收或 Goal DONE）。生产看板已空闲重载：旧 PID 23072 停止、新 PID 11044（端口 4790）加载第二阶段代码；重载前 scan-inflight 干净。两个历史真实会话只读核对通过：D98 24675150（complete=true，费用 UNKNOWN 不当 0）、D99 1cafb42c（complete=true，费用 PARTIAL、claude 申报 $0.157617 与 §6.6 一致）；JSON/Markdown 导出均 200 且无 token 泄漏。讨论档案已重新激活（codex 8194bb67…、agy 43ae6c28…、claude 5b5096e9…，与登记一致）。收口回执 goals/receipts/GOAL-085-result-stage2-close-receipt.json。Goal 保持 PROPOSED，Owner 正式验收仍开放；第三阶段（CLI 薄入口）待 owner 启动指令；本轮零模型调用、未提交未推送。

GOAL-085第二阶段收口记录更正补录（GLM，2026-10-06，owner 指示）

两处措辞更正（追加，不改写 §7.4/收口回执）：①"无版本漂移"更正为"配置指纹未变，版本差异仍在既有接受范围内"——agy 实际 1.2.17/冻结 1.2.16（D96）、Claude 实际 2.1.290/冻结 2.1.286（D99），三指纹未变、接受名单不扩大；②收口依据更正为"Codex 独立复核通过，Owner 转呈"，Owner 明确接受（正式验收）尚未发生，Goal 保持 PROPOSED。更正回执 goals/receipts/GOAL-085-result-stage2-close-wording-correction.json。零模型调用。

GOAL-085第三阶段第一片补录（GLM，2026-10-06，owner 启动指令）

mush collab CLI 薄入口已实现（契约 v1.69）：check/create/status/result/stop 五子命令全部为看板 HTTP API 的 loopback 薄客户端（默认 4790），零新端点、零凭据读写；create 仅返回待审批卡（PENDING_OWNER_APPROVAL）不自动批准（D30），不提供 approve/reject；result 支持 json/markdown 与 --out；退出码 0/2/3/64 分明。回归 tests/g085-cli-collab.test.ts 5/5（fixture+fake runner，零真实模型）；typecheck 0、对账 PASS。生产看板 PID 11044 未再次重载，CLI 代码待下次空闲重载上线。MCP/skill 未开工；Goal 保持 PROPOSED；未提交未推送。回执 goals/receipts/GOAL-085-cli-stage3a-receipt.json。

GOAL-085 CLI 薄入口修复轮补录（GLM，2026-10-06，Codex 独立复核五缺口后）

五类缺口已修复并补回归：①--board-url 限本机回环、拒绝凭据 URL、禁重定向、请求带 30s 截止时间（材料正文永不外发）；②create 新增 --request JSON 文件入口（互斥旗标、材料 {path}/allowed_seats 透传）+ --workspace 透传 workspace_root；③重复旗标统一（--material 两种写法均聚合，标量重复 exit 64）；④--out 拒绝覆盖已存在文件；⑤响应协议校验（非协议 200 → exit 1 不输出 undefined）、不可达统一 exit 3。回归 12/12；typecheck 0、默认/独立全量 981/981、对账 PASS、diff-check 0。另按 owner 指示更正 §7.6 回执矛盾表述：CLI 按需启动、当前无需重载看板。零模型调用、未操作生产会话、MCP/skill 暂不推进、Goal 保持 PROPOSED、未提交未推送。修复轮回执 goals/receipts/GOAL-085-cli-stage3a-fix-receipt.json。

GOAL-085 CLI 薄入口修复轮二补录（GLM，2026-10-06，Codex 二轮复核四边界后）

四边界已闭合：①--out 原子排他创建（wx flag，竞态窗口同样拒绝覆盖，并发双 CLI 实测恰一成功一拒绝）；②check/stop 协议校验（check 需 ok+ready 布尔、stop 需 ok+cancelled/stop_requested，非协议 200 一律 exit 1 不声称已提交）；③响应正文读取纳入超时封装（正文挂起归 exit 3）；④IPv6 回环 [::1] 剥方括号接受。回归 16/16；typecheck 0、默认/独立全量 985/985、对账 PASS、diff-check 0。MCP/skill 暂不推进；零模型调用、未操作生产会话、Goal 保持 PROPOSED、未提交未推送。回执 goals/receipts/GOAL-085-cli-stage3a-fix2-receipt.json。

GOAL-085第三阶段第二片补录（GLM，2026-10-06，owner 启动指令）

本地 stdio MCP 薄入口已实现（契约 v1.70）：mush mcp——零依赖最小 JSON-RPC 2.0（initialize/tools/list/tools/call/ping），五工具 collab_check/create/status/result/stop；HTTP 客户端提取共享模块 src/web/collab-client.ts，CLI 与 MCP 复用同一实现（回环限制/超时/协议校验）；board URL 启动参数固定且必须回环、工具入参不暴露；create 仅 PENDING_OWNER_APPROVAL 不自动批准（D30）、无 approve/reject 工具；业务错误转 isError。回归 tests/g085-mcp-collab.test.ts 5/5（子进程 stdio 实测）；CLI 回归重构后 16/16 不变；typecheck 0、默认/独立全量 990/990、对账 PASS、diff-check 0。生产看板未重载（MCP 按需进程直接可用）；skill 未开工；Goal 保持 PROPOSED；零模型调用、未提交未推送。回执 goals/receipts/GOAL-085-mcp-stage3b-receipt.json。

GOAL-085 MCP 片修复轮补录（GLM，2026-10-06，Codex 二轮复核后）

一越界三缺口已修复：①MCP 工具面不含文件系统（materials 只收 content、path 拒绝；collab_result 删 out、传入即拒绝且零文件创建；CLI 文件能力保留）；②连接级初始化状态（未收到 notifications/initialized 前拒绝其它请求）+ 帧校验（jsonrpc 必须恰 "2.0"、空对象等无效请求回 -32600 不静默）；③工具入参严格类型校验（effort:99/topic:123 等存在但类型错一律 isError 拒绝）；④启动错误写 stderr、stdout 只承载协议帧。回归 tests/g085-mcp-collab.test.ts 重写后 7/7；typecheck 0、默认/独立全量 992/992、对账 PASS、diff-check 0。如实记录：修复中一个有缺陷的补丁脚本曾把该测试文件截断为 12 字节，已整文件重写、损坏副本留档；产品代码未受影响。MCP 未接真实客户端人工验收；skill 暂缓；零模型调用、未操作生产会话、Goal 保持 PROPOSED、未提交未推送。回执 goals/receipts/GOAL-085-mcp-stage3b-fix-receipt.json。

GOAL-085 MCP 片修复轮二补录（GLM，2026-10-06，Codex 三轮复核后）

三残留已闭合：①完整握手状态（notifications/initialized 仅在 initialize 已响应后生效，绕过路径实测失效）；②请求 id 必须为 string/number（对象/布尔/null 一律 -32600 且响应 id 恒 null，不原样回显）；③严格类型校验补全（workspace_root/constraints/refresh/isolation_required 存在但类型错一律拒绝，无静默省略）；另 MCP 前置用法错误（未知/重复旗标）统一写 stderr、stdout 零输出。回归 MCP 10/10、CLI 16/16；typecheck 0、默认/独立全量 995/995、对账 PASS、diff-check 0。MCP 接真实客户端验收待 owner 安排；skill 暂缓；零模型调用、未操作生产会话、Goal 保持 PROPOSED、未提交未推送。回执 goals/receipts/GOAL-085-mcp-stage3b-fix2-receipt.json。

GOAL-085 MCP 片修复轮三补录（GLM，2026-10-06，Codex 独立 SDK 验收后）

独立 MCP 客户端验收通过（官方 SDK 1.29.0：握手/ping/五工具发现，工具 schema 无文件系统与 board_url，零依赖零配置零调用）；最后一个握手绕过已闭合——initializeResponded 只在合法 initialize 请求（有可响应 id、实际产生响应）时置位，无 id 的 initialize 通知不回响应不推进握手（回归实测绕过路径 tools/call 仍 -32600、看板零会话）。回归 MCP 11/11；typecheck 0、默认/独立全量 996/996、对账 PASS、diff-check 0。零模型调用、未重跑付费讨论、skill 暂缓、Goal 保持 PROPOSED、未提交未推送。回执 goals/receipts/GOAL-085-mcp-stage3b-fix3-receipt.json。

GOAL-085第三阶段第三片补录（GLM，2026-10-06，owner 启动指令）

薄 skill 已实现（skills/collab/SKILL.md）：纯指引文档——check 准入检查、create 提交议题与材料（PENDING_OWNER_APPROVAL）、等待看板批准（owner 唯一批准入口）、result 读取（UNKNOWN/PARTIAL 语义、不合成结论）、stop 停止；MCP 备选入口；退出码语义与红线（不自动批准、不换模型、费用 UNKNOWN≠0、结果不构成审计）。防漂移回归 tests/g085-skill-collab.test.ts 4/4（文档旗标必须∈KNOWN_FLAGS、五子命令齐全、node bin/mush 本地入口无全局安装、红线与 MCP 工具面一致）；typecheck 0、默认/独立全量 1000/1000、对账 PASS、diff-check 0。零模型调用、未提交未推送、Goal 保持 PROPOSED。回执 goals/receipts/GOAL-085-skill-stage3c-receipt.json。第三阶段三片（CLI→MCP→skill）全部交付，Goal 整体验收待 Owner。

GOAL-085 skill 片文档修正轮补录（GLM，2026-10-07，Codex 复核后）

SKILL.md 四处修正：①create 后交还审批卡与会话号、status 轮询设上限、审批以 owner_decision 为准；②示例全部单行（PowerShell 兼容）、board 备选命令补 --port 4790；③"不换模型"限定为失败后不自动换道/不改已批准配置、初始选择遵从用户、补 --effort-a/--effort-b 示例；④费用三态（DECLARED/PARTIAL/UNKNOWN）完整描述并区分申报口径/账号额度/真实账单。防漂移回归升级 7/7——新增文档五条示例命令在 fixture 看板逐条实跑（check/create/status/result/stop 全部 exit 0）。产品代码仅 KNOWN_FLAGS 导出；讨论引擎未动、零模型调用、未操作生产会话、skill 未全局安装。typecheck 0、默认/独立全量 1003/1003、对账 PASS、diff-check 0、Goal 保持 PROPOSED、未提交未推送。回执 goals/receipts/GOAL-085-skill-stage3c-fix-receipt.json。

GOAL-085 skill 片更正轮补录（GLM，2026-10-07，Codex 复核后）

§7.16 的 typecheck 实际失败（测试 195/201 行 argvOf 多传一个参数，TS2554）被我的管道命令漏报——已修两处并复跑：typecheck exit 0（改用日志重定向取真实退出码，管道吞退出码的教训已记录）、聚焦回归 34/34、默认/独立全量 1003/1003、对账 PASS、diff-check 0。运行时行为未变；讨论引擎与 CLI/MCP 未动；零模型调用、Goal 保持 PROPOSED、未提交未推送。更正轮回执 goals/receipts/GOAL-085-skill-stage3c-fix2-receipt.json。

GOAL-085 skill 项目内加载验证补录（GLM，2026-10-07，零模型调用）

选定 Claude Code（2.1.292）做项目内加载只读验证：SKILL.md 就位项目级目录 .claude/skills/collab/（与源逐字一致、项目级非全局）；frontmatter 合规（name=mush-collab）；内容完整性九项全过；证据 .test-fixtures/stage3d-skill-load-verify.json all_pass=true。如实边界：会话内真实加载需一次模型调用未执行，该残留与 pi-rpc 间歇失败并列保留。机检：typecheck 0、默认/独立全量 1003/1003、对账 PASS、diff-check 0。零模型调用、未提交未推送、Goal 保持 PROPOSED。回执 goals/receipts/GOAL-085-skill-load-verify-receipt.json。

GOAL-085 运行面核查补录（GLM，2026-10-07，零模型调用）

按 owner 顺序四步：①在途核查——无犬窗/无工作树/看板离线不推断无在途、56 个 node 进程甄别无 mush 遗留；②看板恢复——新 PID 29028（4790）加载第三阶段全部代码；③三档案重激活指纹未变（codex 8194bb67…/agy 43ae6c28…/claude 5b5096e9…）；④Claude 2.1.292 免费兼容检查——版本门 fail-closed 拒绝（观察 2.1.292/冻结 2.1.286，不在 D95/D99 名单），codex+agy 对照 ready=true；不能据 skill 文件就位宣称新版 Claude 可参与真实讨论，版本接受与付费复测另行决定。另查明 Claude Code 无零模型 skill 列举通路（发现与模型会话绑定），会话内验证需一次模型调用另行授权。回执 goals/receipts/GOAL-085-runtime-check-receipt.json。
