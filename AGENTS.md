# mush - agent 工作区指引

适用范围：本仓库。mush 是个人跨 harness 多 agent 编排工具，使用 Node.js >=24 / TypeScript。

## 按当前请求执行

- 默认简体中文，结论先行，说明具体改动、证据与遗留项；区分事实、推断和建议，不夸赞、不把猜测写成定论。
- 用户明确要求修改或修复，即授权在该范围内读取、编辑和本地验证；先简述动作后执行，不重复询问“是否开始”。“继续”沿用最近明确的任务，不自行开启新方向。
- 用户只问解释、评审或方案时先保持只读。只有目标歧义会实质影响结果、存在不可逆选择或触发下述审批门时才问，合并必要问题。
- 本文件统一仓库工作约定；[CLAUDE.md](CLAUDE.md) 仅引用本文件。遵守运行环境更高优先级指令；本文件不覆盖其权限或安全要求。
- [CONSTITUTION.md](CONSTITUTION.md) 是治理基准，[DECISIONS.md](DECISIONS.md) 中已生效修订按范围执行。用户最新要求决定本次范围；治理红线变更追加决议。

## 必要审批与固定边界

- 五类触发门：超 cap/预算；外发/发布；无恢复路径的删除/覆盖；权限、范围、数据面或依赖扩张；provider/身份/凭据变更。触发时暂停相关动作，等 owner 决定。
- 外发的既有例外仅为 D19：本仓 `master` 同步至私有 `github.com/rly0506/mush`，先扫描待推送内容，密钥与未扫描内容不得携出。普通修改不顺带提交、推送或发布。
- `D:\意向项目` 只读参照，D85可切换；不安装全局包、不改系统配置或凭据路径。密钥不入库、不入日志、不入 prompt；需要此类变更先明确报批，授权也不允许泄露密钥。
- D30 只管**新发起的真实模型派发**：每单停看板审批卡等 owner 点批，免费通道也适用；不以常设审批文件替代。当前对话内直接改文件、静态检查及 mock/fixture 测试不是新派发。
- 真实派发前运行 `powershell -NoProfile -File D:\mush\scripts\scan-inflight.ps1`。此脚本看板探针固定为 4790；端口不同需核查实际实例，连接失败不代表没有在途任务。
- 同一派发包只走看板或手开窗口一个通道（AD-34/35）；手开用 `D:\mush\scripts\dog-window.cmd <packet> <dog>`，不重复启动在执行任务。
- 无人值守调度默认关闭（D8）。角色、模型和通道能力按当前配置与实测判断；历史故障不自动扩大为对当前模型的全面禁用，也不自动解除原故障通道限制。

## 任务与技能按需使用

- 小修复、文档整理、局部调整直接做，允许连同相关测试跨文件修改；不因文件数量强制新 Goal、worktree、架构设计、全面审计或多 agent 派发。
- 需要跨会话跟踪的新功能或多 agent 协作，先查 `goals/GOAL-*.md`，确需新建按 [模板](goals/TEMPLATE.md) 记录目标、边界与验收；Goal 文档自动入任务池（D67），入池不等于获准真实派发，局部任务在当前对话直接执行即可。
- 只加载与本次任务直接相关的技能及必要引用，不按“修改代码”“继续”等宽泛词串联整套流程，不为每次编辑无条件读取全库；技能是方法参考，已安装且足用时不重复下载安装，已批准动作不再次索要批准。
- 任务描述尽量写清目标、完成条件、验证命令和停止条件；隔离 fixture、本地测试和无生产访问范围内可连续执行，真实模型仍逐单审批。
- 优先已有模式、标准库和最小可验证实现；无具体收益不拆文件、不加抽象/依赖/配置层，不为流程而写长文档。300 行是上下文裁剪阈值，不是源码文件上限。
- 发现范围外问题简短记录，不顺手修；安全检查围绕实际变更，涉及鉴权、预算、外部暴露或新数据面时重点核查对应边界。

## 调用方与帮手

- 发起调用的 harness 是该次 `caller/controller`；Claude Code、Codex 等均可调用 mush，不固定等同头犬。
- mush 提供计划、doctor/liveness、审批、事件和回执；executor 只接收 D30 派发。配置、MCP 握手或历史成功不等于余额/API 权益，未知为 `UNKNOWN`。
- CLI/Agent 审批复用审批卡和 append-only owner response，返回 `WAITING`、摘要和任务号；完整审批面未实现前不绕过看板。

## 上下文入口

先看 `git status --short` 和相关 diff，保护现有修改；读宪法后按任务查以下入口，不要求每轮重读全部历史或上下文中已有的未变文件。

| 需要了解 | 入口 |
| --- | --- |
| 安装、命令、运行环境 | [README.md](README.md)、[package.json](package.json) |
| 当前开发交接 | [2026-10-05 交接](docs/project-handoff-2026-10-05.md)，作当日证据，现状以代码和新验证为准 |
| 目标与排期 | [目标池](docs/goal-pool.md)、`goals/GOAL-*.md`；目标池需与 Goal 状态对账 |
| 路线图 | `docs/rm-*.md`；RM-001 是已结束的自举阶段，不是永远的当前路线 |
| Web 行为与生产治理 | [API 契约](src/web/api-contract.md)、[派发管线](src/web/dispatch.ts) |
| 参照实现 | [src/loop/README.md](src/loop/README.md)：D80 定为离线 fixture，不与生产链路强制合流 |
| 历史裁决与验收 | [默认裁决](docs/auto-decisions-log.md)、`goals/receipts/`；按主题查决议，不补造缺失编号 |

## 编辑与验证

- 保留用户及其他 agent 的在途修改；先读再接续，不使用破坏性 reset/checkout 或覆盖无关 diff。
- 文件用 UTF-8。Windows 复杂、多行或多层转义逻辑先写脚本，再用 `node <绝对路径>` 或 `powershell -NoProfile -File <绝对路径>` 执行；不用多行 `node -e` / `bash -c` / `powershell -Command`。
- PowerShell 脚本源码纯 ASCII，用户目录运行时获取；模板内正则/反斜杠按目标语言正确转义。临时脚本放 `.test-fixtures/`，使用明确 Windows 路径。下列命令以 `D:\mush` 为 cwd，npm 脚本和 import 路径可相对仓库根目录。
- 新行为和缺陷修复补聚焦测试，优先复用 fixture/影子回放；不削弱断言或放开生产审批来凑绿。测试隔离用户配置、模型 CLI 与真实账本，单独运行也预加载 [tests/setup.ts](tests/setup.ts)。
- 纯文档检查引用、命令和 diff；代码改动跑相关测试与 typecheck；共享状态、跨模块契约、测试入口或发布候选再跑全量及隔离模式。UI 改动加对应回归，视觉/交互改动需浏览器实测，不把 HTTP/DOM 冒烟称为视觉验收。

在仓库根目录执行（Windows 使用 `npm.cmd`）：

| 验证 | 命令 |
| --- | --- |
| 类型检查 | `npm.cmd run typecheck` |
| 默认全量 | `npm.cmd test` |
| 独立进程全量 | `npm.cmd run test:isolated` |
| 单文件示例 | `node --import ./tests/setup.ts --test --test-isolation=none D:\mush\tests\persistence.test.ts` |
| 看板 HTTP/DOM 冒烟 | `node --import ./tests/setup.ts D:\mush\scripts\g076-board-regression-baseline.cjs` |
| 补丁格式 | `git diff --check` |

命令来源以 package.json 和实际脚本为准；没有通用 build/lint/format 脚本，不猜造命令。测试记录保留在 `.test-fixtures/`，不要读取或改写真实用户账本来做 fixture。

## 证据与交付

- 决议、事件和验收回执 append-only；更正追加，摘要不覆盖原证据，关键验收产物带哈希锚点。
- 报告实际运行的命令、结果与未验证部分，不引用历史测试数宣称当前全绿。
- 普通修改直接报告“已修改/已验证”。正式 Goal 满足适用机检规格及回执要求可为 `AUTO_ACCEPTED`（D15）；只有 owner 明确接受才记 `DONE`，不通过自动收官脚本绕过。
- 不在本文件堆积里程碑状态。派发会将本文件注入 prompt，维护时保持不超过 4000 字符，避免规则被截断。
