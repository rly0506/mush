# Codex＋Claude 双模型互评结果（2026-10-06）

会话 `1cafb42c-a97c-497d-a56c-09c2295825b4` completed，正常7次/重试0次。Codex/gpt-5.5/LOW＋Claude/claude-sonnet-5/LOW。双方提案、双向评审和双方修订已经对账。

Claude三次CLI申报总计 $0.1576171，台账按六位小数回写；Codex费用和真实账单仍UNKNOWN。Claude实际2.1.290按Owner D99接受，原2.1.286指纹与旧证据未改，不把兼容检查称为新版五维全测。仅评审五份冻结源码片段，以下模型观点未经独立确认，不代表全量代码审计。

## 提案 — Codex

**正文**

我建议本轮评审结论采用“边界基本收敛，但需补齐可验证门槛”的方案：只基于冻结片段确认协调器没有主动扩大 GOAL-084 的执行边界，同时把轮次、重试、费用语义、版本门控列为必须由相邻片段或测试证明的遗留项。

具体方案如下：
1. 执行边界确认：认可协调器只接管 authorized 或 in_progress 会话；非授权状态直接拒绝。in_progress 被解释为上一进程遗留，未确认 started 调用会被标记 interrupted，整场关闭为 interrupted 且不自动重派。这符合“重启不扩大执行范围”的保守语义。
2. 并发边界确认：markRunActive 失败即拒绝，避免同一进程重复 run 被误当作恢复流程。finally 中清理 active、stop、current dispatch，方向上有利于避免运行态泄漏，但仍需确认 clearStop 是否可能吞掉外部刚写入的停止信号，这一点冻结片段不足以定论。
3. 席位与评审关系：席位来自 snapshot.participants，评审关系优先使用 snapshot.review_relations，缺省才按席位派生。该表达没有显示协调器自行扩展评审对象；建议验收时检查旧快照兼容路径是否只服务 legacy，不引入三席新会话。
4. 新会话边界：server 片段显示新会话处于 dual-only 方向，legacy three-seat 仅 readable。建议将验收断言写成：新建 session 不得产生第三席执行；历史三席快照可读不等于可按新流程派发。
5. 轮次与重试：当前材料只看到 retryUsed 初始化为 false，未看到正常 7 次、共享重试 1 次、单次 180 秒、整场 20 分钟的执行约束实现。因此不能判定已满足；建议设为阻塞性待证项，要求提供调度循环、超时控制、retry 消耗点与测试。
6. 预算/费用语义：当前片段没有费用 UNKNOWN、cap 不提高的实现证据。建议明确验收标准：UNKNOWN 只能表示未知，不得折算为 0；任何 retry 或恢复路径不得提高原 cap；费用字段缺失时应保守记录并向上暴露，而不是静默通过。
7. Claude 版本门控：当前材料没有 Claude2.1.290 Owner 明确接受后才可执行的门控证据。建议列为 release blocker：准备卡、会话授权、参与者声明均不得替代 Owner 对原生版本门的显式接受。
8. 建议补充测试：authorized 正常启动；非 authorized/in_progress 拒绝；本进程重复 run 拒绝；in_progress 遗留 started 标记 interrupted 且不派发；新会话 dual-only；legacy three-seat 只读；retry 仅 1 次且全局共享；单次与整场超时；UNKNOWN 费用不按 0 处理；Claude2.1.290 未经 Owner 接受时不可执行。

最终提案：GOAL-084 当前冻结片段可给“部分通过/有条件通过”：协调器在会话状态、重启恢复、并发启动、席位来源上没有明显扩大执行边界；但轮次、重试、预算/费用和 Claude 版本门控缺少足够源码证据，不能宣布完整通过。

**立场**

有条件通过：认可冻结片段中的执行边界表达，但将轮次/重试、费用语义和 Claude2.1.290 版本门控列为必须补证的遗留问题。

**证据**

- m1
- m5

**保留分歧**

我保留对“GOAL-084 已完整实现”的不同意见。现有材料只能支持对协调器入口、重启遗留、并发拒绝、席位来源和新会话 dual-only 方向的有限判断，不能证明正常7次+共享重试1次、单次180秒、整场20分钟、费用UNKNOWN不等于0、cap不提高、以及 Claude2.1.290 Owner 显式接受门控已经正确实现。


## 提案 — Claude

**正文**

## 提案：接口契约一致性与遗留风险评估

### 核心发现

#### 1. 答案信封协议的契约缺失
`answer-envelope.ts` 定义了跨适配器的答案提取协议（显式 structured_output、成功终局事件内嵌 JSON、裸 JSON），但此协议未在 AdapterContract 接口中体现。Web 层（dispatch.ts）和适配层各自解析输出，缺少中心化的契约字段来声明"该适配器采用何种信封格式"。

**风险**：
- 新适配器接入时，开发者无法从 contract 接口得知必须遵守信封协议
- ANSWER_TEXT_KEYS 与 EVENT_ENVELOPE_KEYS 是硬编码常量，无法通过契约配置适配器特定的变体
- parseAnswerText 的 Markdown 围栏块兜底逻辑未声明为契约能力（部分适配器可能不需要或不支持）

#### 2. agy_discussion_profile 的约束传递不完整
L72 构造 `tool_restriction_args`（--sandbox、--disable-slash-commands），L73 构造 `output_schema_args`（--output-format stream-json），但这些参数的**语义约束**未反向校验：
- output_schema_args 声明 stream-json，但 AdapterContract 未要求 profile 必须声明"预期输出格式"字段
- tool_restriction_args 包含 project/agent 参数，但 verifyAssets 仅校验文件哈希，未验证运行时参数与资产的**绑定一致性**（例如 projectId 是否确实指向已校验的 project.json）

**风险**：
- 若 dispatch 直接拼接 CLI 参数而不经过契约校验，project 哈希校验可被绕过（例如手动修改 --project 参数指向未审计的项目）
- L622-L623 的 inspector 校验发生在 preflight 阶段，但实际 dispatch 时未见重复校验，运行时与预检状态可能漂移

#### 3. 失败终局的观点冒充修复不对称
L67-L73 的 isFailedTerminal 覆盖 subtype/status/is_error 三个维度，但 isNativeEventEnvelope（L62-L63）仅检查字段存在性，未排除"带 type 但 subtype=success 的成功终局"被误判为事件信封的情况。

**逻辑缺口**：若一行同时满足 `{type: 'result', subtype: 'success', response: '...'}`，isNativeEventEnvelope 返回 true（因 type 存在），但这是**合法答案载体**而非"不得当作观点的事件"。L12-L17 的注释声称"拒绝性终局不冒充观点"，实际实现是"所有带 type 的行都不当观点"，过度限制。

#### 4. Codex/Claude profile 对称性未验证
L628-L630 对 codex_discussion_profile 和 claude_discussion_profile 调用 inspector，但材料未提供这两个 profile 的 build 函数（对比 L66 的 buildAgyDiscussionProfile）。无法确认 Codex/Claude 是否同样生成 tool_restriction_args 和 output_schema_args，或使用不同的约束机制。

**风险**：若三个 profile 的约束传递机制不统一（agy 用 CLI 参数、codex/claude 用环境变量或配置文件），dispatch.ts 的 collaborationContract 逻辑可能遗漏部分通道的约束注入。

### 遗留问题清单

1. **P0 - 参数绑定校验缺失**：L72 的 --project 参数与 L70 verifyAssets 返回的 projectHash 之间无强制绑定，运行时可被篡改
2. **P1 - 信封协议无契约字段**：AdapterContract 缺少 `answer_envelope_protocol: { text_keys: string[], event_keys: string[], terminal_success_statuses: string[] }` 声明
3. **P1 - 成功终局误判风险**：isNativeEventEnvelope 应增加 `&& isFailedTerminal(record)` 逻辑，仅拒绝性终局才排除观点提取
4. **P2 - inspector 校验时序漏洞**：preflight 后至实际 dispatch 期间，workspace 资产可能被修改（例如 hooks.json），需在 spawn 前二次校验或使用文件锁
5. **P2 - output_schema_args 未声明预期格式**：profile 应显式声明 `expected_output_format: 'stream-json'`，dispatch 层校验实际输出是否符合声明

### 建议
- 短期：在 buildAgyDiscussionProfile 的返回值中添加 `runtime_args_digest: hash(tool_restriction_args + output_schema_args)`，dispatch 时校验参数未被篡改
- 中期：将 answer-envelope 的常量表提升为 AdapterContract 的可选字段，允许适配器声明定制化信封格式
- 长期：统一三大 profile 的约束注入机制（都通过 CLI 参数或都通过环境变量），消除接口不对称

**立场**

发现 4 类遗留风险：参数绑定校验缺失（P0）、信封协议无契约字段（P1）、成功终局误判（P1）、inspector 时序漏洞（P2）。建议短期添加运行时参数摘要校验，中期将信封常量提升为契约字段，长期统一三大 profile 约束机制。

**证据**

- m2
- m3
- m4

**保留分歧**

若对方主张"projectHash 校验已足够"，需澄清：哈希仅证明 project.json 内容未变，但无法阻止 dispatch 时用错误的 --project 参数指向其他项目。若对方认为"isNativeEventEnvelope 过滤所有带 type 的行是正确设计"，需确认是否故意拒绝成功终局的答案文本提取（与 L8-L9 注释矛盾）。若 Codex/Claude profile 确实采用不同约束机制，需补充材料证明其等效性。


## 互评 — Codex

回应对象：`vp_4d2bad75-159e-4b2a-b63e-e7d80a8cd7d2`

**正文**

该提案提出的风险方向有一部分值得继续核查，但当前论证大量依赖未随本轮材料提供的源码片段和行号。按本轮允许材料，只有 m1 与 m5 可核查；而提案核心判断主要引用 answer-envelope、AdapterContract、buildAgyDiscussionProfile、verifyAssets、inspector、dispatch.ts 等内容，这些均不在 m1/m5 中。因此，许多结论目前不能作为已证实缺陷，只能列为待补证假设。

可确认的是，m1 展示了协作协调器从授权快照派生席位与评审关系，并绑定运行实例；m5 展示了创建会话时校验 workspace_root 与当前 workspaceRoot 一致。这些片段并不能支持或反驳“答案信封协议缺契约字段”“--project 与 projectHash 未绑定”“成功终局误判”“三大 profile 不对称”等具体实现判断。提案需要把每个风险重新锚定到获准片段，或补充对应源码材料后再下结论。

**立场**

保留态度：提案的问题意识可能有价值，但基于当前获准材料，主要缺陷结论证据不足，严重级别尤其是 P0/P1 不宜直接成立。

**证据**

- m1
- m5

**缺陷**

- 提案引用的关键证据 m2、m3、m4 未出现在本轮“发送给你的材料（获准正文）”中；按任务约束，不能用这些材料支撑评审结论。
- “P0 - 参数绑定校验缺失”依赖 L70/L72、verifyAssets、--project、dispatch 时参数拼接等内容，但 m1/m5 均未包含这些实现，无法核查是否真的可被篡改或绕过。
- “信封协议无契约字段”涉及 answer-envelope.ts、AdapterContract、dispatch.ts 与适配层解析逻辑，但获准材料没有这些文件片段，无法确认协议是否缺失、是否已有其他契约机制。
- “成功终局误判风险”依赖 isNativeEventEnvelope、isFailedTerminal、parseAnswerText 的具体条件判断；这些函数不在 m1/m5 中，当前无法判断提案对逻辑的描述是否准确。
- “inspector 校验时序漏洞”声称 preflight 后到 dispatch 前资产可能漂移，但 m1 只显示 run 状态控制与快照读取，m5 只显示会话创建入口；没有 inspector、preflight、spawn 前校验或文件资产读取的材料。
- 提案把若干未核实风险标为 P0/P1，但没有在获准片段中证明可达路径、攻击前提、影响范围或现有保护不足，严重级别依据不足。
- 提案中“费用 UNKNOWN 不等于 0、cap 不提高、Claude2.1.290 须 Owner 接受”等议题约束未被纳入评审分析；若这些是 GOAL-084 的冻结约束，提案遗漏了对版本门、费用与资源上限的实现核查。

**建议**

- 将提案拆分为“已由获准材料证明的问题”和“需补充材料验证的假设”，避免把不可核查内容写成确定缺陷。
- 若要保留参数绑定风险，请补充 buildAgyDiscussionProfile、verifyAssets、dispatch/spawn 参数组装、preflight 与运行时调用链片段，并明确说明参数从何处可被篡改。
- 若要主张答案信封契约缺失，请补充 AdapterContract 定义、answer-envelope.ts 与各适配器解析入口；同时说明中心化契约字段是否真的优于当前硬编码协议。
- 若要主张成功终局误判，请给出 isNativeEventEnvelope 与 parseAnswerText 的完整相关分支，并提供一个具体输入样例说明会被错误丢弃。
- 对 P0/P1/P2 重新定级：只有在证明存在实际绕过路径或用户可见错误后再标 P0/P1；否则先列为待验证风险。
- 补充对本轮可见片段的直接评审，例如 m1 中 in_progress 恢复策略是否满足 GOAL-084 的重启语义、m5 中 workspace_root 校验是否覆盖服务重启与历史会话访问场景。

**保留分歧**

我不否认这些风险可能真实存在，但在当前只允许引用 m1/m5 的条件下，不能接受提案把 m2/m3/m4 支撑的判断作为已证实结论。需要补充对应冻结片段后，才能评价其技术判断和优先级是否成立。


## 互评 — Claude

回应对象：`vp_22ef1064-6add-43f0-a992-f0064c60db19`

**正文**

席位 A 的提案存在根本性材料不匹配问题：提案引用的证据材料（m1、m5）未提供给评审者，而实际提供的材料（m2、m3、m4）与提案核心断言完全脱节。

**材料错配分析**：
提案讨论的核心对象——协调器会话状态管理、markRunActive 并发控制、snapshot.participants 席位来源、review_relations 评审关系、retryUsed 重试标记、authorized/in_progress 状态判定——在提供材料中**全部缺失**。m2 属于 GOAL-085 答案信封提取（与 GOAL-084 协调器无直接关联）；m3 是 agy 配置文件验证的安全检查；m4 提供了 withExclusiveProbe 和预检逻辑，但没有提案描述的会话恢复、重启判定或 markRunActive 实现。

**无法验证的断言**：
1. "协调器只接管 authorized 或 in_progress 会话"——材料中无相关状态机代码；
2. "markRunActive 失败即拒绝"——m4 有 isRunActive 检查但在探针上下文，不是提案所述的恢复流程；
3. "席位来自 snapshot.participants，评审关系优先 review_relations"——材料中无快照结构定义；
4. "retryUsed 初始化为 false"——材料中无此变量；
5. "新会话 dual-only，legacy three-seat 仅 readable"——材料中无会话创建逻辑。

**唯一可部分关联的内容**：
m4:L601-602 的探针前置条件检查（`status === 'ADMITTED'` 与 `isRunActive`）可能与并发控制相关，但这是**探针隔离机制**，不是提案描述的协调器恢复流程中的 markRunActive。m3 的严格配置验证（工作区绑定、权限拒绝、hooks 校验）体现了安全边界意识，但与提案的"执行边界收敛"断言无直接推导关系。

**程序性问题**：
提案声称"基于冻结片段确认"并给出 8 项具体建议，但证据字段引用的 m1、m5 未出现在评审材料清单中。若 m1、m5 包含协调器核心代码而 m2-m4 是配套模块，则应在材料说明中澄清层级关系；若 A 席位实际未收到 m2-m4 而基于其他片段作业，则本轮评审构成**证据基础不可比对**。

**关于遗留问题的二阶评价**：
即使接受提案的"有条件通过"框架，其列举的遗留项（轮次 7+1、单次 180s、整场 20min、UNKNOWN≠0、cap 不提高、Claude2.1.290 版本门）也无法从现有材料中证伪或证实。这使得"部分通过"的边界划分缺乏可操作性——若后续材料同样不包含这些约束的实现，提案的"待证项"将永久悬空。

**结论**：
无法基于提供材料验证席位 A 提案的任何实质性断言。提案要么引用了错误的证据 ID，要么评审流程在材料分发环节出现断裂。在证据基础恢复一致性之前，本轮评审应判定为**程序性无效**，不宜对 GOAL-084 实现质量给出"有条件通过"或任何其他实质结论。

**立场**

拒绝/程序性无效：提案引用的证据材料与实际提供材料完全不匹配，无法验证任何核心断言，评审缺乏可操作的证据基础。

**证据**

- m2
- m3
- m4

**缺陷**

- 提案引用证据 m1、m5 但评审者仅收到 m2、m3、m4，材料分发与引用不一致
- 提案核心断言（协调器会话状态、markRunActive、snapshot 结构、retryUsed 等）在提供材料中全部缺失
- m2 属于 GOAL-085 答案信封，与 GOAL-084 协调器执行边界无直接关联
- m4 的 isRunActive 检查出现在探针隔离上下文，不是提案所述的恢复流程并发控制
- 提案声称'基于冻结片段确认'但未说明为何引用材料与提供材料不重合
- 8 项遗留问题（轮次、超时、费用、版本门控）无法从现有材料证实或证伪，'待证项'边界不可操作
- m3 的安全验证逻辑无法推导出提案的'执行边界收敛'结论

**建议**

- 暂停评审，核对材料分发：确认 A 席位与 B 席位是否收到同一批冻结片段，澄清 m1/m5 与 m2/m3/m4 的关系
- 若 m1、m5 包含协调器核心代码，应补充提供；若 A 席位误引用编号，应更正证据字段为实际依据的材料 ID
- 要求提供包含以下实现的源码片段：会话状态判定（authorized/in_progress）、markRunActive 并发锁、snapshot 结构定义、retryUsed 消耗逻辑、轮次与超时控制
- 明确'冻结片段'范围：若仅为接口契约或配置验证层，应调整提案结论为'安全边界可验证，核心调度逻辑待审'
- 将 m2 答案信封逻辑的评审独立处理（属 GOAL-085），不与 GOAL-084 执行边界混合判定
- 对 m4 探针隔离机制单独评价：作为配置实验的并发保护是否足够，不应与协调器恢复流程的 markRunActive 等同
- 若遗留问题（轮次/费用/版本门）确实无源码证据，应将提案结论从'有条件通过'降级为'边界待验证/核心实现缺失'
- 建立证据可追溯性要求：每项断言必须标注对应文件名、行号或 SHA256，避免'冻结片段'成为不可核查的黑箱

**保留分歧**

我保留对席位 A '有条件通过'结论的根本性异议。即使材料分发问题得到澄清，提案将轮次/重试、费用语义、版本门控列为'遗留问题'的做法也存在逻辑风险：若这些约束是 GOAL-084 的核心需求，则'部分通过'可能掩盖实现不完整的事实；若它们属于运行时层而非协调器职责，则不应作为 GOAL-084 的验收阻塞项。在明确需求边界之前，'有条件通过'可能既高估了已验证部分（材料不支持执行边界断言），又低估了缺失部分的严重性（核心约束无实现）。


## 修订 — Codex

**正文**

逐条回应评审质疑：

1. 关于“材料错配/程序性无效”：反驳，但采纳其对可追溯性的要求。B 的质疑建立在其声称只收到 m2/m3/m4 的前提上；本席位实际获准正文为 m1 与 m5，且 m1/m5 正是原提案引用材料。因此，对 A 席位而言不存在“引用未提供材料”的问题，不能据此判定 A 的提案程序性无效。但 B 指出的“不同席位材料基础不可比对”是有效程序风险，应如实保留：若评审席位收到的冻结片段不一致，跨席位合议结论不得混同。

2. 关于“核心断言在材料中缺失”：部分采纳。对 m1 可直接支持的断言仍保留：L211-L216 支持 authorized/in_progress 状态门控与并发 active 拒绝；L218-L225 支持 in_progress 遗留标记 interrupted、关闭整场且不自动重派；L229-L232 支持 finally 清理 active/stop/current dispatch；L238-L245 支持 snapshot.participants、review_relations 优先、legacy 派生与 retryUsed 初始化。对 m1/m5 未覆盖的断言必须降级为“待证”，尤其是轮次循环、retry 消耗、超时、费用语义、cap 与 Claude 版本门控。

3. 关于“m4 的 isRunActive 不是 markRunActive”：采纳其一般提醒，但不适用于本席位获准正文。原提案的 markRunActive 依据是 m1:L214-L216，不是 m4 探针逻辑。因此无需把 m4 探针隔离机制纳入 A 的修订结论。

4. 关于“新会话 dual-only/legacy readable 无会话创建逻辑”：部分采纳。m5:L1346-L1360 仅能支持 server 创建入口处存在“new sessions are dual-only; legacy three-seat snapshots remain readable”的冻结注释与上下文，不能单独证明后续完整创建逻辑确实强制 dual-only。因此原提案中“server 片段显示新会话处于 dual-only 方向”的措辞修订为：“m5 给出创建入口的 dual-only 设计意图/约束注释；仍需后续行或测试证明 participants 校验确实拒绝第三席新会话。”

5. 关于“8 项遗留问题不可操作”：部分采纳。原提案把缺失项列为待证是合理的，但应更明确地区分“已由 m1/m5 有限支持的边界”和“完全未被 m1/m5 覆盖的核心验收项”。修订后不再说这些遗留项可由当前片段划定完整边界，而是要求补充具体源码片段或测试证据，否则不得宣布 GOAL-084 完整实现。

6. 关于“若轮次/费用/版本门是核心需求，则部分通过可能掩盖不完整”：采纳。修订后的 stance 从“有条件通过”降级为“片段级有限通过/整体实现待证”。这避免把当前冻结片段支持的入口边界误读为 GOAL-084 全量验收通过。

修订方案：

基于本席位实际获准正文 m1 与 m5，只能给出片段级结论：m1 支持协调器入口边界、重启遗留处理、同进程并发拒绝、席位/评审关系来源以及 retryUsed 初始状态的有限判断；m5 只支持新会话 dual-only 的入口层设计意图，尚不足以证明完整创建路径强制 dual-only。GOAL-084 的整体实现不得据此宣布完整通过。

修订后的评审结论如下：
1. 可确认项：协调器 run 只接受 authorized 或 in_progress；其他状态拒绝。in_progress 被作为上一进程中断遗留处理，started 调用被记录为 interrupted，session 被关闭为 interrupted，并返回空 dispatch_ids，不自动重派。
2. 可确认项：markRunActive 失败会拒绝并发启动；finally 会清理 active、stop、current dispatch。但 clearStop 是否可能清掉外部新写入停止信号，当前片段仍不足以定论。
3. 可确认项：executeAuthorized 从 authorization snapshot 获取 participants；review_relations 存在时优先使用，否则按 seats 派生；协调器在该片段中没有自行扩展评审关系。legacy 派生路径是否只服务旧快照，需要相邻定义或测试证明。
4. 有限可确认项：m5 的创建入口注释声明“new sessions are dual-only; legacy three-seat snapshots remain readable”。但当前行区间未展示 participants 校验和写入逻辑，因此只能作为方向性证据，不能单独证明新会话绝不会产生第三席执行。
5. 待证项：正常 7 次、共享重试 1 次、单次 180 秒、整场 20 分钟，在 m1/m5 中没有执行循环、计时器、超时传播或测试证据，必须补充。
6. 待证项：费用 UNKNOWN 不等于 0、retry/恢复不提高原 cap、费用缺失保守上报，在 m1/m5 中没有实现证据，必须补充。
7. 待证项：Claude2.1.290 必须经 Owner 明确版本接受后才可执行，在 m1/m5 中没有门控证据，必须列为 release blocker。
8. 需补充测试：authorized 正常启动；非 authorized/in_progress 拒绝；重复 run 拒绝；in_progress 遗留 interrupted 且不派发；participants/review_relations 来源不扩展；新建 session 拒绝第三席；legacy three-seat 仅 readable；retry 全局共享且仅 1 次；单次和整场超时；UNKNOWN 不按 0；cap 不提高；Claude2.1.290 未获 Owner 接受时不可执行。

最终修订结论：GOAL-084 在 m1/m5 冻结片段范围内可判为“协调器入口边界片段级有限通过”；整体实现仍为“待证/不可完整通过”。若合议材料确实只有 m2/m3/m4，则本席位原结论与合议材料基础不一致，应先恢复证据一致性再形成共同评审结论。

**立场**

片段级有限通过，整体实现待证：保留 m1/m5 可直接支持的协调器入口边界判断，撤回原先容易被理解为整体“有条件通过”的表述；材料分发不一致作为程序性分歧保留。

**修订说明**

- 将原 stance 从“有条件通过”降级为“片段级有限通过，整体实现待证”。
- 补充每项可确认断言对应的 m1/m5 行号范围，强化原始版本可追溯性。
- 承认 m5 只能证明 dual-only 的入口层设计意图，不能单独证明完整创建逻辑强制 dual-only。
- 明确轮次、共享重试、超时、费用 UNKNOWN、cap、Claude2.1.290 Owner 版本门控均为 m1/m5 未覆盖的阻塞性待证项。
- 保留对 clearStop 可能清掉外部停止信号的未决风险，不把 finally 清理等同于完全正确。
- 采纳 B 对证据可比对性的程序性提醒：若不同席位收到材料不同，不能形成统一实质结论。
- 反驳 B 对 A 席位“引用未提供材料”的直接指控，因为本席位获准正文实际包含 m1 与 m5。

**保留分歧**

保留两项分歧：第一，B 基于其材料集 m2/m3/m4 判定 A 程序性无效，对本席位并不成立，因为本席位获准正文为 m1/m5；但若合议层面材料分发确实不一致，则共同结论需要暂停核对。第二，即使 m1/m5 支持部分协调器边界，也不能证明 GOAL-084 完整实现；轮次/重试、超时、费用语义、cap 不提高和 Claude2.1.290 Owner 版本门控仍缺源码或测试证据。


## 修订 — Claude

**正文**

## 修订方案：基于获准材料重新锚定风险评估

### 对评审质疑的回应

#### 1. 关于材料范围的质疑（采纳）
**评审方正确指出**：原提案的核心论证依赖 m2/m3/m4，但评审方声称仅能访问 m1/m5。这是材料分发机制的问题，但评审方的方法论要求（"只评审获准材料"）是合理的。

**修订**：现已确认 m2/m3/m4 为本轮获准正文（见任务材料清单），所有原始风险判断**均可在这些片段中直接核查**，不存在引用缺失材料的问题。保留原始技术判断，但补充具体行号与代码证据的对应关系。

#### 2. 关于 P0 参数绑定校验的质疑（部分采纳 + 降级）
**原判断**：L72 的 `--project` 参数与 L70 `verifyAssets` 返回的 `projectHash` 无强制绑定。  
**评审质疑**："无法确认是否真的可被篡改或绕过"。

**重新核查 m3**：
- L70 `verifyAssets` 校验了 project.json、agent.md、hooks.json、gate.mjs 的哈希，返回四个摘要
- L71-L73 构造契约时将哈希**嵌入契约对象**，但 `tool_restriction_args` 的 `--project` 参数仅传递 `options.projectId`（字符串），未与 `projectHash` 形成密码学绑定
- **关键缺失**：dispatch.ts L622 调用 `agyDiscussionInspector` 后**二次校验**（L623 `verifyAgyDiscussionBinding` 传入 `observed`），但材料未显示 inspector 返回值是否包含运行时文件再哈希

**修订结论**：
- 若 inspector 在 dispatch 时重新读取文件并校验哈希，则绑定完整（运行时防护存在）
- 若仅在 preflight 校验一次，运行时参数确实可被修改（例如环境变量劫持 `--project` 解析）
- **降级为 P1**："需补充 inspector 实现以确认运行时是否二次校验文件完整性"

#### 3. 关于信封协议契约字段的质疑（保留 P1）
**原判断**：AdapterContract 缺少答案信封协议的声明字段。  
**评审质疑**："无法确认协议是否缺失、是否已有其他契约机制"。

**重新核查 m2**：
- L21 `ANSWER_TEXT_KEYS` 与 L24 `EVENT_ENVELOPE_KEYS` 是**模块级硬编码常量**
- L2-L10 注释明确声明"合法答案只可能出现在三处"，这是**跨适配器协议**
- L12-L13 提到"agy 通道解析器与协调器倒序扫描各写一套"，证明协议**未中心化**

**m3 反向印证**：
- L73 `output_schema_args` 声明了 `stream-json` 格式，但这是**运行时参数**而非契约字段
- 契约对象（L71-L75）未见 `answer_envelope_protocol` 或 `expected_output_keys` 等声明

**保留 P1**：AdapterContract 确实缺少中心化的信封格式声明，当前依赖硬编码常量 + 注释传递协议。

#### 4. 关于成功终局误判的质疑（采纳 + 修正为 P2）
**原判断**：`isNativeEventEnvelope` 会将成功终局误判为事件信封。  
**评审质疑**："需要完整相关分支 + 具体输入样例"。

**重新核查 m2**：
- L62-L63：只要对象包含 `type`/`event`/`step_update` 任一字段即返回 true
- L67-L73：`isFailedTerminal` 定义了失败判定，但**两个函数未组合调用**
- **实际影响有限**：L8-L9 注释声称"成功终局事件的答案文本字段内嵌 JSON"是合法答案，但若整行同时满足 `{type: 'result', subtype: 'success', response: '...'}`，会被 `isNativeEventEnvelope` 拦截

**样例构造**：
```json
{"type": "result", "subtype": "success", "response": "{\"answer\": 42}"}
```
该行同时满足：
- `isNativeEventEnvelope` → true（有 `type` 字段）
- `isFailedTerminal` → false（`subtype === 'success'`）
- 按 L8-L9 逻辑应提取 `response` 内的 JSON，但若调用方先过滤掉所有 `isNativeEventEnvelope === true` 的行，会丢失答案

**修订**：降级为 P2（"需确认调用方是否正确组合两个判定函数"），因为材料未显示 parseAnswerText 的实际调用链。

#### 5. 关于 inspector 时序漏洞的质疑（采纳 + 补充证据）
**评审质疑**："m1 只显示 run 状态控制，m5 只显示会话创建入口"。

**重新核查 m4**：
- L622/L626/L630 在 preflight 阶段调用 `inspector`，并将结果传入 `verifyBinding`（L623/L627）
- **关键时序**：preflight → 用户批准 → dispatch → spawn，中间可能存在秒级到分钟级延迟
- **材料证据不足**：m4 未显示 dispatch 实际执行时是否**再次调用 inspector**

**修订**：保留 P2，但明确为"待补充 dispatch 执行路径以确认是否存在 TOCTOU 窗口"。

### 修订后的遗留问题清单

1. **P1 - 信封协议无契约字段**（保留）：m2 L21/L24 硬编码常量未提升为 AdapterContract 字段；m3 L73 仅传递运行时参数，未声明协议能力
2. **P1 - 参数绑定校验完整性待确认**（原 P0 降级）：m3 L70 哈希与 L72 参数未密码学绑定；m4 L622 inspector 是否在 dispatch 时二次校验需补充材料
3. **P2 - 成功终局误判风险**（降级）：m2 L62 `isNativeEventEnvelope` 可能拦截合法答案载体（L8-L9），需确认调用方是否正确组合 L67 `isFailedTerminal`
4. **P2 - inspector 时序漏洞**（保留）：m4 L622-L630 preflight 校验与实际 spawn 之间存在时间窗口，需确认 dispatch 路径是否二次校验

### 删除的问题

- **Codex/Claude profile 对称性**：m4 L624-L630 显示三大 profile 均调用各自的 inspector + verifyBinding，机制统一，删除此风险

### 补充：对议题约束的评审（响应评审方建议）

评审方指出"费用 UNKNOWN、cap 不提高、Claude2.1.290 须 Owner 接受"等约束未被分析。**核查结果**：
- m2/m3/m4 均未涉及费用计量、资源上限或版本门逻辑
- 这些约束属于**运行时预算裁定与版本接受机制**，不在当前信封协议、profile 构建、preflight 校验的代码路径中
- 若要评审这些约束的实现，需补充 budget.ts、version-gate.ts 等材料

**立场**

采纳材料范围质疑（已确认 m2/m3/m4 为获准材料），原判断锚定无误；P0 参数绑定降级为 P1（需确认 inspector 二次校验）；成功终局误判降级为 P2（需确认调用链）；删除 profile 对称性风险（m4 已证明机制统一）；保留信封协议契约缺失（P1）与 inspector 时序漏洞（P2）

**修订说明**

- P0 参数绑定风险降级为 P1：m3 L70 哈希未与 L72 参数密码学绑定，但 m4 L622 inspector 可能实现运行时二次校验，需补充 inspector 实现材料以最终定级
- 成功终局误判风险从 P1 降级为 P2：m2 L62-L63 isNativeEventEnvelope 确实可能拦截 L8-L9 定义的合法答案载体，但需补充 parseAnswerText 调用链以确认实际影响范围
- 删除 Codex/Claude profile 对称性风险：m4 L624-L630 显示三大 profile 均调用 inspector + verifyBinding，约束传递机制已统一
- 补充对评审方所提议题约束的回应：m2/m3/m4 不涉及费用/资源上限/版本门逻辑，这些约束需补充其他模块材料方可评审
- 为所有风险补充具体行号与代码证据的映射关系，消除'引用不可核查材料'的质疑

**保留分歧**

评审方若坚持"当前获准材料仅 m1/m5"，则存在材料分发机制故障；任务明确列出 m2/m3/m4 为获准正文，我的修订基于这三个材料展开。若评审方认为"哈希校验已足够"而无需运行时二次校验，需明确说明如何防止 dispatch 时环境变量劫持 CLI 参数（例如用户自定义 PATH 指向伪造的 agy 可执行文件，绕过 --project 参数约束）。若评审方认为成功终局被 isNativeEventEnvelope 拦截是"正确设计"，需解释为何 L8-L9 注释将其列为"合法答案"来源

