# Agent 调 Agent 编排项目调研

- 调研日期：2026-09-05
- 范围：寻找能让一个 agent/harness 调用或协调另一个 agent/harness 的 CLI、skill、MCP、SDK 和协议；不包含 Hermes。
- 证据口径：优先使用项目仓库 README、官方协议和官方文档。本文只记录公开资料能力，不把本地配置、历史探针或项目 star 数当作可用性证据。

## 结论先行

1. **有成熟参考，但没有一个项目同时解决跨 harness 调用、供应商余额、预算审批和结果审计。**
   - 直接贴近 mush 的是 [agent-bridge](https://github.com/xyva-yuangui/agent-bridge)：本地 CLI + MCP + harness hook + 任务板。
   - 偏工程调度的是 [Gas Town](https://github.com/gastownhall/gastown)：Mayor/Polecat、持久工作状态、邮箱、调度容量和合并队列。
   - 偏进程和工作区管理的是 [Claude Squad](https://github.com/smtg-ai/claude-squad)：tmux + git worktree，可以启动 Claude Code、Codex、Gemini、Aider，但不是语义级父子任务编排器。
   - 偏服务端控制面的是 [OpenHands Agent Canvas/SDK](https://github.com/OpenHands/OpenHands) + [Software Agent SDK](https://github.com/OpenHands/software-agent-sdk)：多 Agent Server、REST/WebSocket、自动化和 ACP-compatible agent。
2. **协议应分层看。** [A2A](https://github.com/a2aproject/A2A) 解决远程 agent-to-agent 互操作和任务生命周期；[ACP](https://github.com/agentclientprotocol/agent-client-protocol) 解决编辑器到 coding-agent 的统一会话；[MCP](https://github.com/modelcontextprotocol/modelcontextprotocol) 解决客户端调用工具/服务。mush 更适合先提供 MCP 工具接口，再视跨机器需求增加 A2A；ACP 可作为具体 coding harness 的进程适配层。
3. **这些项目都不能证明第三方供应商“有余额、具备 API 权益或不会 403/404”。** Gas Town 的 scheduler 只控制并发以减少 rate limit，mcp-agent 的 TokenCounter 只做用量计数，agent-bridge 的 doctor 只检查宿主集成；它们都不是 provider 账单查询。mush 现有 GOAL-080 的 L0/L1/L2/L3 liveness 和 `UNKNOWN` 额度语义仍应保留。
4. **不要把外部 Codex/Claude 直接改名为 mush 的 head-dog。** 更稳的角色模型是：外部 harness = `caller/controller`，mush 内部 head-dog 继续负责计划、D30 审批门和审核；被调用的 Claude/Kimi/ZCode 等是 `executor`。这样允许 Codex 调 mush，而不破坏当前“头犬是治理与审核角色”的契约。

## 项目对比

| 项目 | 形态和调用方式 | 能否跨 harness | 状态、审批、预算、额度 | 对 mush 的可借鉴点 | 不应照搬 |
|---|---|---|---|---|---|
| [agent-bridge](https://github.com/xyva-yuangui/agent-bridge) | Python 标准库本地任务板；CLI `bridge send/claim/done/review`；`bridge_mcp`；Codex 用 AGENTS.md + MCP，Claude 用 UserPromptSubmit hook，ZCode 用 plugin hook | **可以，限本机/共享文件状态**；README 明确支持 Codex、Claude Code、Reasonix、ZCode | 有 pending/working/review/complete 生命周期和 delivery 状态（`queued`、`acknowledged`、`failed` 等）；无供应商余额/API 权益查询；无 mush 的 D30 预算账本 | task card、delivery honesty、agent profile/skill routing、hook/MCP 双入口、失败不丢任务 | 它是共享任务板，不是父级规划器；默认无跨机服务和远端 provider 认证；本地评估也指出它没有 mush 式父→子 loop、计划门和预算闸门 |
| [Gas Town](https://github.com/gastownhall/gastown) | `gt` CLI + tmux + git worktree + Beads；Mayor 协调，Polecats 执行，Witness/Deacon 监督，Refinery 合并 | **可以**；内置 Claude、Gemini、Codex、Copilot、Cursor、OpenCode、Pi 等 runtime preset，`gt sling --agent` 可覆盖执行器 | Beads/convoy/mailbox/handoff 持久化；scheduler `max_polecats` 控并发防 rate limit；有升级、停滞监控、合并验证；未声明 provider 余额/订阅/API entitlement 或人工逐单审批 | Mayor/Polecat 分离、容量 governor、可恢复工作状态、失败合并隔离、mailbox/handoff、seance 上下文恢复 | 依赖 Go/Dolt/Beads/tmux，拓扑较重；默认“让 Mayor 自主编排”与 mush 的 D30 逐单审批不等价；不能把 scheduler 视为额度探针 |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | TUI `cs`；每个会话 tmux + 独立 git worktree；`cs -p "codex"`、`cs -p "gemini"`、`cs -p "aider ..."` | **可以启动多个 CLI**，但主要是并行会话管理，不是 agent 语义委派 | 有会话、分支、diff、checkout/review；`--autoyes` 可自动接受；无父子任务协议、预算审批或 provider 额度探针 | 将 harness 启动命令抽象成 profile；工作区隔离和人工 review 前置 | TUI/人工操作重；`autoyes` 与 mush 的审批红线冲突；没有结果回执、预算台账和健康可信度等级 |
| [OpenHands Agent Canvas](https://github.com/OpenHands/OpenHands) + [Software Agent SDK](https://github.com/OpenHands/software-agent-sdk) | 自托管控制面；多个 Agent Server，REST/WebSocket/TypeScript client；可接本机、VM、Docker、云；支持 Claude、Codex、Gemini 及 ACP-compatible agent | **可以，按 backend/server 连接**；自动化服务可按事件/计划分解和派发 | 有 conversation/workspace/event/run history；SDK 支持长任务；README 未承诺供应商余额、API 权益、D30 类审批或统一成本账本 | 统一 backend contract、server capability/health、事件流、把本机 CLI 和远程 agent 作为同一执行面 | 运行面较重且多仓库；其自动化/调度策略不能绕过 mush 的 owner approval；多 backend 可连不等于每个 provider 当前可用 |
| [mcp-agent](https://github.com/lastmile-ai/mcp-agent) | Python MCP-native SDK；Agent、MCP server、workflow decorator；可把 agent 暴露成 MCP server（server-of-servers） | **协议层可以**；支持 router、parallel/map-reduce、orchestrator-workers、swarm、evaluator-optimizer | Temporal backend 支持 pause/resume/retry/human input；TokenCounter 做 token 用量；没有 provider 余额查询或 CLI harness 身份证明 | 最接近“把 mush 作为另一个 agent 可调用的 MCP 工具”；可借鉴 workflow state、human input、token usage 事件和 adapter façade | 需要应用方自己实现 provider/CLI adapter、审批政策、额度来源和凭据隔离；不应把 token count 当余额 |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | Python/JS SDK；`handoffs`、`agents as tools`、MCP tools、guardrails、sessions、tracing、human-in-the-loop | **应用内 agent 协作**，不是直接启动 Claude Code/Kimi CLI | 有 guardrail、人工中断、trace/session；provider-agnostic API 接入；无本机 harness doctor 或第三方订阅余额查询 | `agents as tools` 的显式委派、handoff 与 guardrail 语义、trace 关联父子运行 | 不能直接证明一个 CLI harness 或供应商可用；API provider abstraction 不能替代 mush 的宿主探针 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 图/状态机编排框架 | **应用内**，可把不同模型包装为节点；不是跨 CLI 运行器 | durable execution、checkpoint、human-in-loop、memory、trace；无 provider 余额和 D30 语义 | 持久状态、可恢复 checkpoint、显式 interrupt/resume、父子 run ID | 引入整套图运行时会扩大 mush 架构；不能用图节点完成宿主 CLI/供应商健康证明 |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Python `Crews`（自主协作）+ `Flows`（事件流程）；当前 README 也列 MCP/A2A 支持 | **应用内为主**；需要自己把外部 harness 封装成 tool/server | 支持 human input、checkpoint、async、observability；无第三方 provider 额度探针 | Crews/Flows 的“自治协作 vs 确定性流程”分层，可用于产品语义比较 | “自治 Crew”容易越过 mush 的审批/预算边界；不适合作为现有 Node/TS 主链的直接依赖 |

## 协议层判断

### A2A：适合跨进程/跨机器 agent-to-agent

A2A 官方 README 将其定义为让不同公司、框架、服务器上的 opaque agents 互通；核心是 Agent Card 能力发现，JSON-RPC 2.0 over HTTP(S)，同步、SSE streaming、异步 push、文件/结构化 JSON 和认证。它还明确说明 A2A 与 MCP 互补：MCP 偏 agent 调工具，A2A 偏 agent 调 agent。

对 mush 的映射可以是：

- `GET /.well-known/agent-card.json` 或等价只读能力描述：列出可接受的任务类型、支持的 transport、当前 liveness 置信度和“额度未知/已验证”标签，但**不暴露密钥**。
- A2A task ID 映射 mush `dispatch_id`，状态事件映射 `ADMITTED/EXECUTE/REPORT/REVIEW`。
- A2A 的认证、超时、push 只解决传输；D30 approval、预算 cap、provider quota 和 completion gate 仍由 mush 保留。

### ACP：适合统一 coding harness 进程接口

ACP 官方定义是“code editor ↔ coding agent”协议，当前稳定协议版本为 1，使用 JSON-RPC/schema 和 capability negotiation。它不是 agent-to-agent 任务协议，但适合把 Claude Code、Codex、Gemini 等运行时封装成统一 session/stream 客户端。OpenHands README 已把 ACP-compatible agent 纳入可连接 backend。

对 mush 的价值是减少 `src/adapters/*.ts` 中每个 CLI 的交互差异；它不能带来 provider 额度证明、统一计费，也不能替代 mush 的审批卡。

### MCP：适合把 mush 能力暴露给调用方

MCP 本身是 client/server 工具协议，不是“一个 agent 自由支配另一个 agent”的治理协议。mush 可提供只读/受控 MCP tools，例如：

- `mush.harness_doctor`：CLI、当前 provider、配置存在性、最近 L0/L1 探针；
- `mush.channel_status`：`availability/quota/api_access`，未知就返回 `UNKNOWN`，附来源和时间；
- `mush.plan_dispatch`：只生成计划，不发起真实模型调用；
- `mush.request_approval` / `mush.dispatch`：强制 D30 owner approval、预算 cap、工作区和回执关联；
- `mush.get_dispatch` / `mush.stream_events`：让外部 Codex/Claude 观察状态和结果。

这样 Codex 可以通过 MCP 调 mush，但它是 `caller/controller`，不是绕过 mush 的 head-dog 或 owner。

## 对“Codex 作为头犬调用 Claude/Kimi”的边界建议

### 推荐角色

```text
外部 Codex / Claude / AGY
        │  MCP/CLI/API（caller/controller）
        ▼
mush plan + provider doctor + D30 approval + mission supervisor
        │
        ├── child dispatch: Claude/Kimi/ZCode/AGY ...（executor）
        └── receipts / SSE / ledger / completion gate
```

- `caller/controller` 可以提出计划、选择候选 harness、读取结果；不能把“本地 CLI 存在”宣称为“供应商有额度”。
- `head-dog` 仍是 mush 内部治理角色：计划、审批前置、失败重排建议、审核和最终验收；不必等同于发起调用的外部 agent。
- `executor` 只接收已批准的单；每个真实子派发保留 `dispatch_id`、provider 快照、预算 cap、attempt/failover 和回执。
- 外部 agent 若要求“自动派多个子级”，先生成计划卡，owner 批准计划或批准的预算包；实际换道仍经过 GOAL-080 admission 和 G073 circuit breaker。

### 不足以证明可用的信号

以下信号都不能单独代表“能用”：

- `which claude`、`codex --version`、CLI profile 存在；只证明 L0 本地进程层。
- provider 在 cc-switch/配置文件中出现；只证明本地配置层。
- 模型列表、免费标签、历史成功；不能证明当前余额、API entitlement 或当前 endpoint 不会 403/404。
- 启动 tmux/session、MCP server 返回握手成功；只证明 transport/host 层。

建议继续沿用 mush 的可信度阶梯：L0/L1 零成本预检；L2 免费实际回路；L3 低预算真实调用。远端余额和 API 权益没有供应商官方查询时显示 `UNKNOWN`，不要在 UI 或 prompt 中伪装成 `READY`。

## 推荐给 mush 的最小后续方向

1. **先做 MCP caller surface，不改 head-dog 语义。** 将 `harness_doctor`、`channel_status`、`plan_dispatch`、`dispatch_status` 作为只读/审批受控工具；复用现有 `/api/harness/doctor`、`/api/dogs/liveness` 和聊天/派发状态。
2. **给调用方一个明确的父子关联模型。** 在不新增 provider 的前提下，增加概念性的 `caller_id`/`parent_run_id`/`child_dispatch_id` 关联；外部 Codex 只是调用方，head-dog 仍负责治理。
3. **优先借鉴 agent-bridge 的 delivery honesty、Gas Town 的容量 governor、mcp-agent 的 durable workflow 事件和 OpenHands 的多 backend 形态；不要直接引入它们的运行时。** 当前 mush 是 Node/TS、Windows-first、D30 强审批，直接移植 Go/Dolt/Temporal/tmux 会扩大依赖面。
4. **额度探测必须独立于编排。** 除非某供应商提供官方余额/权益 API，否则保留 `UNKNOWN`；可用性只能由分级 liveness + 真实低预算验收逐步提升置信度。

## 本地已有资料对照

- [外部项目参考评估（2026-08-15）](../references/external-project-evaluations-2026-08-15.md)：已记录 `agent-bridge` 和 EchoBird；其中 agent-bridge 被判断为共享任务板，不是 mush 式父级调度器。
- [GOAL-075 头犬思维链与计划门](../../goals/GOAL-075-head-dog-cot-and-dispatch-plan-gate.md)：头犬计划、计划门和逐单审批边界。
- [GOAL-080 Harness 链可靠性](../../goals/GOAL-080-harness-link-reliability.md)：L0-L3 liveness、预检、failover、熔断和诚实标签。
- [GOAL-082 Mission Supervisor](../../goals/GOAL-082-mission-supervisor.md)：停滞检测、干预阶梯、完成核验和监督事件。
- [GOAL-077 零门槛上手](../../goals/GOAL-077-novice-harness-and-zero-threshold.md)：现有首单引导应区分本地配置、provider 额度、API 权益和实际可用性。

## 来源与访问日期

以下链接均于 **2026-09-05** 访问，内容以当日仓库默认分支/官方文档为准：

- [agent-bridge README](https://github.com/xyva-yuangui/agent-bridge#readme)
- [Gas Town README](https://github.com/gastownhall/gastown#readme)
- [Claude Squad README](https://github.com/smtg-ai/claude-squad#readme)
- [OpenHands Agent Canvas](https://github.com/OpenHands/OpenHands#readme)
- [OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk#readme)
- [mcp-agent README](https://github.com/lastmile-ai/mcp-agent#readme)
- [OpenAI Agents SDK README](https://github.com/openai/openai-agents-python#readme)
- [LangGraph README](https://github.com/langchain-ai/langgraph#readme)
- [CrewAI README](https://github.com/crewAIInc/crewAI#readme)
- [Agent2Agent (A2A) protocol](https://github.com/a2aproject/A2A#readme)；[A2A specification](https://a2a-protocol.org/latest/specification/)
- [Agent Client Protocol (ACP)](https://github.com/agentclientprotocol/agent-client-protocol#readme)；[ACP site](https://agentclientprotocol.com/)
- [Model Context Protocol specification](https://github.com/modelcontextprotocol/modelcontextprotocol)；[MCP introduction](https://modelcontextprotocol.io/introduction)

## Owner clarification: context-local head dog

本文前文把 `head-dog` 保留为 mush 内部治理角色，是对审批、预算和回执责任的建议，不限制用户的调用语义。当前决定是：从哪里打开并发起调用，哪个外部 agent 就是该次上下文的头犬；例如在 Claude Code 内调用 mush，Claude Code 是头犬，在 Codex 内调用则 Codex 是头犬。mush 在其中充当可调用的帮手，负责计划、D30 审批门、状态/结果回执和 executor 派发；这不等于取消治理门，也不代表调用方可以伪造 owner 批准。
