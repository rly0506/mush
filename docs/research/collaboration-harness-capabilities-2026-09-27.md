# 多模型方案讨论：harness 能力核查（2026-09-27）

## 结论与边界

现有接入工具足以支持“独立提案 → 互评 → 修订”的有界会话，但 mush 的生产接线还不足以直接提供这一体验。无需操控 TUI，也不必先统一迁移 SDK。

owner 本次确认：首个场景是几个模型一起想方案；审批方向改为一次会话授权。决议见 DECISIONS.md D87。本报告其余流程、阵容和实现优先级是建议，不是具体真实会话的启动授权。

本次核查：工作树源码；8 种本机 harness 的版本及帮助；Kimi 已安装入口源码；pi 随包 RPC 文档；厂商官方文档。只执行版本/帮助命令，没有提交任务 prompt、发起模型推理、修改凭据或系统配置，也没有安装/升级工具。未执行账号权益、配额、真实结构化输出、取消或跨模型讨论测试。所有通道的当前真实可用性均仍待验证。

## 能力矩阵

“原生 schema”指最终回答的字段约束，不等于 JSON 事件流；“支持”指本机帮助/源码声明，不能替代真实运行验收。

| harness / 本机版本 | 非交互与续聊 | 回答格式和权限能力 | mush 当前差距 / 建议 |
| --- | --- | --- | --- |
| Codex 0.156.1 | `exec`、`exec resume <id>`；新建和续聊帮助均列出 `--json`、`--output-schema` | 原生 schema；exec 支持显式 read-only sandbox。只读沙箱不能代替对 MCP/网络/上下文范围的约束 | 合同只有 `exec`，未声明续聊、JSON 归一化、schema、模型选择旗标；历史 F-50 通道限制不可凭帮助自动解除。优先接入候选 |
| Claude Code 2.1.281 | `-p`、`--resume`、stream-json | `--json-schema`；可限制内建工具，`--strict-mcp-config` 控制 MCP 配置；`--max-budget-usd`。工具权限、插件/hooks 和认证配置应分开处理 | 已接 stream-json 和续聊；解析器读 `result`，尚未读取 `structured_output`，不能仅加 schema 参数就称接通。优先候选 |
| OpenCode 1.18.32 | `run --format json`、`--session/-s`；官方 Server 有会话消息及 abort | 当前 run 帮助未列最终回答 schema；官方提供 permission 控制。JSON 事件需取文本后再验证协议 | 已有事件归一化、sessionID 和模型选择；合同没声明 resume。首版可用 CLI 续聊加 mush 校验，不必先启动 Server |
| pi 0.87.1 | `--mode rpc`、`--session-id`；随包 RPC 文档有 prompt/abort | `--no-tools`、`--no-extensions`、`--no-skills` 等；此次未证实原生最终回答 schema | 已接 RPC，但生产 runner 返回类型没有 sessionId，未接统一取消接口；schema 可由 mush 校验。适合后续常驻会话，首版也可单轮进程 |
| Kimi Code 0.36.1 | `-p`、stream-json；公开 `--session/-S`，源码仍保留隐藏 `--resume/-r` | CLI 有 agent 配置及 ACP；本次未证实原生最终回答 schema 或完整禁工具配置 | 合同用 `-p` 和 `-r`，后者仍兼容，不能报为损坏；结构化流/明确工具边界仍待接入。实际包是 `@moonshot-ai/kimi-code`，不能拿另一款同名 CLI 的参数替代 |
| Antigravity agy 1.2.6 | `-p`、`--conversation`；stdin/stdout stream-json 支持多轮输入 | `--json-schema`、`--mode plan`、`--sandbox`、`--print-timeout`；权限有效性仍待验证 | 当前合同纯文本且有 `--dangerously-skip-permissions`；不能直接作为只读讨论配置。完成权限及结构化解析后可做第三位候选 |
| ZCode runtime 0.16.3 / app CLI 3.7.7-13 | `--prompt`、`--resume`、`--continue` | 帮助列出 `--mode plan`、工具白/黑名单、`--max-turns`；未证实 schema，历史代码记录 JSON 参数不兼容 | 当前只接文本和续聊；本机帮助称 prompt 默认 yolo，因此需显式限制。历史失败与帮助声明冲突处保留未证实 |
| DeepSeek dsh 0.1.0-rc.8 | 本机 headless 帮助仅列单次 task；无续聊/JSON 选项 | 当前上游文档已有 `--json`、`--session-id`；与本机帮助不一致，未证实本机可用 | 当前 dsh/head-dog 无原生续聊，聊天由 mush 拼接上下文。可以采用逐轮重放；只读工具配置待确认，不在本轮升级 |

本机 `Get-Command` 找到上述 8 种工具；未找到独立 `gemini` 命令。mush 当前也没有独立 Gemini CLI 模板，Google 模型方向应先评估实际在用的 agy，不能用 Gemini CLI 文档替它证明能力。

## 注册与模型不是同一层

`baseContracts()` 包含 fake-t1、deepseek-dsh、claude-code、claude-tbtk、zcode、codex、opencode、kimi-code、pi、agy、head-dog。后两类重复入口需区分：head-dog 复用 dsh；claude-tbtk 复用 Claude harness，但走自定义网关/模型，并不因此成为 Anthropic 模型。

静态合同列有 GPT、Claude、Gemini、GLM、Kimi、DeepSeek 等名字及 OpenCode 多 provider 模型种子。它们是选项/期望值，不是当前权益清单。根 runtime/capability-registry.json 本次读到 claude-code、codex、opencode 的 verified 均为 false；代码另有静态 VERIFIED_WHITELIST，两者也不能替代本次真实验证。未读取凭据文件、未探测账号余额。

参会者应绑定 harness + provider + model + 配置指纹。Codex/Kimi/ZCode 等合同存在仅声明模型期望值、没有对应命令行选择接线的情况；不能把 UI 选择当成实际选择成功。需针对最终选定的通道逐个确认模型绑定。普通文本 nonce 只能提供运行/响应证据，不能独立证明底层模型身份；网关只报告它实际提供的证据等级。

## 对上一轮方案的具体修正

1. 原生续聊是优化项，不是首版前提。mush 每轮组装“共同材料 + 本人的前轮输出 + 当前需要回应的其他观点”，可让单次 CLI 参加；需限制大小，不能静默截断证据。房间上下文才是共同记录，厂商 session 只是执行锚点。
2. 原生 schema 优先用于 Codex/Claude/agy；其他通道采用提示格式 + 本地校验。即使有原生 schema，也要核查引用、回应对象及字段语义。坏格式保存为失败结果，有限重试计入会话额度。
3. 不使用 `--last` 或全局 continue 来选参与者会话。每位参与者绑定独立 ID、房间和工作区，避免跨房间串话。
4. 讨论用专门执行配置：材料快照、禁写/禁不必要工具、不自行派生 subagent、不默认继承额外 MCP/插件。plan 字样不等于已经实测安全。首版优先禁工具纯讨论，确需补证时返回请求而非自行扩大访问。
5. 当前 default runAdapter 没把 opts.registerKill 传给 runT1；Claude/pi 分支也没接统一取消。dispatch() 虽提供回调、cancel() 虽查 runningKills，但不能据此称真实默认通道可取消。源码静态确认，未执行真实取消测试。
6. 自动故障转移会换参会者，内部重试可能增加模型调用。会话必须约束真实 attempt、参与者和总资源，不能只限制 UI 发言条数；未知内部调用数/费用保持未知。

## 首版实施建议（尚未执行）

优先补齐 Codex + Claude 的讨论配置和输出解析；若具体通道未通过可用性检查，不借旧身份/同名替代通道掩盖失败。第三位优先评估 agy；OpenCode 可作为模型选择面较广的替代。pi/Kimi 同样具备接入基础，无需为了同场协作强制迁移 harness。

先支持 2–3 位参与者、三个阶段：独立提案 → 互评 → 修订；两位正常路径 6 次参与者调用，三位 9 次。这里是应用层调用数，不是各 harness 内部 API 请求数。重试额度单独展示并占总额；最终原样展示修订意见及未解决分歧，不增加一个未计费的“总结模型”。

会话授权建议内容：议题及材料范围、参会 harness/provider/model、权限配置、阶段/调用和重试上限、时间/费用边界、撤销方式。每一轮引用同一批准记录，协调器检查边界并原子占用额度；参与者/数据面变化、扩权、超额重新授权。当前 owner 决定只批准这种授权方向，未确定上述具体数值或某场运行。

取消时先阻止后续调度，再中断在途调用；崩溃恢复不能无证据重放已执行轮次。取消不能承诺撤回已经发给 provider 的请求或费用。

## 核查证据

- 本机版本/帮助输出：`.test-fixtures/collaboration-capability-2026-09-27/help-evidence.json`（Claude 初次帮助被输出上限截断，相关 schema/tools/MCP/budget 项另行定向读取）。
- 执行过：各工具 `--version`；`codex exec --help`、`codex exec resume --help`、`claude --help`、`opencode run --help`、`pi --help`、`kimi --help`、`zcode --help`、`agy --help`、`dsh --help`、`dsh --profile headless --help`。
- mush 源码：`src/adapters/{contract,codex,claude,opencode,pi,pi-rpc-runner,kimi,agy,zcode,deepseek,head-dog,t1-runner}.ts`；`src/web/{adapter-store,dispatch,chat}.ts`。
- Kimi 本机源码：`D:/npm-global/node_modules/@moonshot-ai/kimi-code/dist/main.mjs`，公开 session 选项后注册隐藏 resume 别名。
- pi 本机文档：`D:/npm-global/node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md`，prompt 与 abort。

官方资料（2026-09-27 读取，网页版可能领先本机安装）：

- [OpenAI Docs：非交互模式、schema、resume](https://developers.openai.com/codex/noninteractive/)
- [Claude：程序调用、structured_output](https://code.claude.com/docs/en/headless)
- [OpenCode Server：会话与 abort](https://opencode.ai/docs/server/)、[权限](https://opencode.ai/docs/permissions/)
- [Antigravity：headless、schema、流式多轮输入](https://antigravity.google/docs/cli/headless/)
- [DeepSeek 官方 headless 包文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)
- Kimi 网页 reference/cli 本次读取失败；结论使用已安装官方包的 README、帮助和源码，不用搜索摘要补造。

本报告不是测试通过回执，也不解除历史通道限制。未修改运行代码，未运行全量测试；后续应先用隔离 fixture 验证消息传递、格式失败、额度并发、取消及恢复，再开展获批的有界真实会话。
