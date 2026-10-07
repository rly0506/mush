# mush 项目交接说明

核对日期：2026-09-05，Asia/Shanghai。面向接手开发、审查或规划的其他模型。

本说明是状态快照，不替代宪法、owner 决议、Goal 规格或原始验收证据；后续变化应另行追加记录。本次仅新增本文，未修改业务代码、Goal 状态、运行策略或系统环境。

## 1. 一句话结论

mush 已从多模型编排原型发展为功能覆盖较广的本地试运行工作台。当前重点应是重新建立可信测试基线、收口文档与实际状态差异，再推进零门槛上手；现有证据尚不足以把它描述成面向普通用户的成熟商业产品。

判断时分开四件事：功能已实现、机检曾通过、当前环境可用、owner 正式验收。它们不是同一个状态，也不适合合成一个“完成百分比”。

## 2. 接手坐标

| 项目 | 本次核对结果 |
| --- | --- |
| 工作区 | `D:\mush` |
| 版本 | `0.1.1-pilot`，`package.json` 仍为 `private: true` |
| 分支 | `master`，跟踪 `origin/master`；本地状态未显示领先或落后，本次未联网 fetch |
| HEAD | `e1b61bfa68defd61bd93e64181b3a2abca3ed744`，2026-08-29 |
| 最近主线 | GOAL-079/081 前端体验与 GOAL-080/082 通道可靠性、任务监理 |
| 技术栈 | Node.js / TypeScript，ESM；要求 Node >=24，本次实际为 v24.13.1 |
| 依赖形态 | package.json 仅列 TypeScript 和 Node 类型开发依赖；前端沿用原生实现 |
| API 契约 | `src/web/api-contract.md` 顶部版本为 v1.45；部分新增章节仍写 v1.14，需对账 |
| 决议文件 | `DECISIONS.md` 最大已记录编号为 D81，但中间有缺号与空节 |

### 工作区已有改动

以下四项均在本轮开始前存在，应保留其作者归属；本文没有替它们背书、提交或覆盖。

| 文件 | Git 状态 | 意图与接手注意点 |
| --- | --- | --- |
| `scripts/board-up.ps1` | 已修改 | 复用旧看板前增加进程名与端口连通性检查 |
| `src/web/persistence.ts` | 已修改 | 锁检查由 PID 存活扩展为进程类型及监听端口，处理陈锁和 Windows PID 复用 |
| `tests/persistence.test.ts` | 已修改 | 新增默认检查下的陈锁接管测试，但实际输入是不存在的 PID |
| `scripts/set-codex-cli-path.ps1` | 未跟踪 | 写入机器级 `CODEX_CLI_PATH`；属于系统环境变更，本次未执行，执行前交 owner 确认 |

新增锁测试会在 `processAlive` 阶段提前返回，因此它通过不代表新加入的进程识别、端口检查分支已得到验证。后续需要补真实或可控的分支覆盖，尤其是活的非 Node 进程、活的 Node 进程但端口关闭、端口与 PID 对应关系、探测失败时的保守行为。现阶段没有证据把此前全部测试失败归因于这批改动。

## 3. 已经走到哪里

本节的完成状态来自仓库记录，不代表本轮重新执行了所有历史验收。

| 阶段 | 已记录的主要交付 | 状态解读 |
| --- | --- | --- |
| RM-001 至 RM-007 | 基础适配器、调度与审批、预算和证据链、看板、会话流、多种协作拓扑、技能联邦、记忆与快照、评测及效能统计 | AGENTS 与 D65 记录早期 55 个 Goal 已收官；逐项实战成熟度仍需各自证据 |
| RM-008 至 RM-010 | 用量对账与上下文管理、跨工作区挂载、工犬直连和续接、安全加固、桌面便携打包与许可文件 | 文档标记完成；打包能力与发版指南不等于已公开发布或商业验证完成 |
| GOAL-067 至 GOAL-069 | 全栈审计修复、多项目数据隔离与热切换、严格类型门禁 | Goal 文档均为 DONE；D81 明确记录 068/069 的 owner 验收 |
| RM-011 / GOAL-070 至 GOAL-074 | 免费通道、观察模式与双项目演练、混沌与长时 soak、分级授权和熔断、放闸就绪认证 | 五份 Goal 状态均为 DONE；路线图矩阵仍保留 READY，存在摘要落后 |
| GOAL-075、076、078、079、081 | 对话计划门、三段式会话及持久化、六入口侧栏、双主题、胶囊选择器、抽屉、动效、键控增量渲染、内联审批与终端 REPL | 七个近期 AUTO_ACCEPTED 中的五个；正式 DONE 权归 owner |
| GOAL-080、082 | L0-L3 探针、派发预检、一次故障转移、停滞监理、重试/重排/升级、完成核验接口、监理面板 | 均为 AUTO_ACCEPTED；生产启用边界见下文 |
| GOAL-077 | 新手安装、通道与凭据引导、专业/新手分层、干净 Windows 首单体验 | 仍为 PROPOSED，是明确尚未交付的产品目标 |

历史实战证据并非空白：GOAL-072 记录 480 分钟、403 轮 soak、98.9% 成功率和 4 次上游失败；`docs/dispatch/rm011-readiness-certification.md` 记录 2026-08-27 的 READY 认证及 RSS/句柄曲线。这只能说明当时对应环境与版本通过了该轮演练，不保证今日上游通道、余额和本地进程状态相同。

## 4. 当前验证证据

| 证据等级 | 项目 | 结果 |
| --- | --- | --- |
| 本轮实测 | `npm.cmd run typecheck` | exit 0，零类型错误 |
| 本轮实测 | `node --test --test-isolation=none D:\mush\tests\persistence.test.ts` | exit 0，6 tests / 6 pass / 0 fail |
| 本轮实测 | Git 状态、HEAD、差异及关键规格/实现核对 | 确认上述版本、四项已有改动与状态差异 |
| 历史仓库记录 | HEAD 提交消息与 AGENTS 的 698/698、typecheck 0、UI 基线 7/7 | 2026-08-29 的记录，本轮未重新证明 |
| 上一模型交接线索 | 全量 `npm.cmd test` 出现多项失败，随后无输出，被 Ctrl+C 中断 | 不是完整测试报告；原始日志未由本轮核验，失败原因和总数待复现 |
| 本轮未执行 | 全量测试、真实模型派发、浏览器交互复验、桌面包构建、长时 soak | 不据此宣称当前全面通过或当前生产通道在线 |

接手时应把当前基线记为“局部验证通过，全量尚未重新确认”，而非“698 项现时全绿”。

上一模型列出的待复现范围如下；这是排查入口，不是本轮新发现的确定故障清单：

- `tests/g012b-chat-ux.test.ts`：POST /api/chat 202 路径。
- `tests/g018a-workstreams.test.ts`：流列表、详情与外部交接。
- `tests/g070-opencode-free-channel.test.ts`：probeLiveModels。
- `tests/g072-chaos-injection.test.ts`：服务重启回放与 SSE 重订阅。
- `tests/web-board-e2e.test.ts`、`tests/web-board-triage.test.ts`：看板闭环、派发详情与输出尾部。
- `tests/web-dispatch.test.ts`：端点、派发生命周期 SSE、rerun。
- `tests/workspace-browse-and-tree.test.ts`：中止原生目录选择后的服务响应。

优先检查测试隔离、共享状态、残余进程/锁、监听时序和环境探测，再判断是否涉及未提交锁补丁。默认测试脚本使用 `--test-isolation=none`，单文件通过与全套通过应分别记录。

## 5. 现状解读与边界

### 5.1 主要矛盾已从功能数量转向稳定交付

系统已经具有较多协作机制。下一阶段的价值更取决于“任务能否稳定发出、失败能否恢复、结果是否经过核验、用户是否理解下一步”，而非再增加一个工作台模式。GOAL-080/082 正在解决这些问题，但仍需要当前版本的端到端证据。

### 5.2 有机制不等于已经启用

- `src/web/server.ts` 已装配探针门和任务监理，并将 `completionGate` 接到 `approveCompletion`。
- 默认监理 hooks 未装配 `verifyCompletion`；`src/core/mission-supervisor.ts` 在该情况下会记录 `unverified-done`，返回 `done: true, verified: false`。因此“每次完成都有独立模型验证”不是现状。真实验证通道的启用和预算属于 owner 决策。
- PROCESS_ONLY 表示进程级可调度，不代表真实模型请求成功。L2/L3 依赖既有 live-probes 证据，不是零成本命令实时完成了模型调用。
- 无人值守策略、认证和熔断能力已存在，治理默认仍关；本次未读取或修改现场运行策略，未验证是否有 owner 后续临时开启记录。
- 运行时任务的 DONE 和项目治理上的 owner 正式接受应分开解释，避免状态同名造成误判。

### 5.3 Local-First 与强隔离承诺需要准确措辞

以 D80 和 `src/web/api-contract.md` 威胁模型为准：当前是单机 loopback 工具，本机为信任边界；Caller Token 主要防 CSRF/跨站请求，不是多用户身份隔离系统。GOAL-071 还明确观察模式写面为提示级章程加事后审计，硬隔离属于后续升级，勿将其概括为完整 OS 沙箱。

本地保存编排状态也不等于使用远程模型时提示词和代码绝不外传。任何对外产品承诺都应区分 mush 自身存储、harness 行为和模型服务的数据路径。

### 5.4 文档确有漂移，但空复选框不是缺陷证明

- AGENTS 描述 `spec/` 与 `docs/roadmaps/`，本次目录核对中两者均未出现；现有路线图实际位于 `docs/rm-*.md`。
- `docs/goal-pool.md` 最新一批止于 GOAL-066，缺少 067-082 的统一摘要。
- RM-011 引用 D82，但 `DECISIONS.md` 尚无 D82；D68/D69/D70/D77 也未检索到对应条目。补录需要可追溯依据，不凭摘要重建 owner 授权。
- RM-011 的 READY 矩阵、GOAL-078 的空验收项及部分旧 Goal 文案落后于状态行和后续记录，需要逐项对账。
- API 顶部 v1.45 与 080/082 章节 v1.14 存在版本标注不一致。
- 发版指南有公开安装命令及较强产品宣传措辞，但 package 为 private，本轮没有核验公开包、下载链接或市场反馈。它们应视为待验证发布说明。

## 6. 未完成任务与建议优先级

优先级是本说明的接手建议，不是新 Goal 授权或擅自改写既有目标池。

| 优先级 | 任务 | 收口标准 |
| --- | --- | --- |
| P0 | 重新建立可信全量基线 | 保存命令、Node 版本、退出码、失败堆栈与测试汇总；区分确定性失败和环境依赖 |
| P0 | 核实陈锁补丁与测试充分性 | 对新检查分支补覆盖，验证真实旧实例保持互斥、陈锁可接管；保留现有改动直至明确处理方案 |
| P1 | 对账 Goal、路线图、决议与 API 状态 | 找到最新证据和 owner 批复；以追加更正保留历史，勿批量把 AUTO_ACCEPTED 改为 DONE |
| P1 | 对当前版本做核心闭环回归 | 本地启动、发消息、审批、执行、结果查看、刷新恢复、工作区切换、失败重试均有可复跑证据 |
| P1 | 与 owner 确认 GOAL-077 最小实施范围 | 复用 081 首单信号；补引导状态机、健康反馈、分层入口和干净 Windows 五分钟首单验收 |
| P1 | 明确真实完成验证的启用策略 | 核验频率、模型通道、预算和失败处理经 owner 确认后，以独立证据证明实际生效 |
| P2 | 盘点 GOAL-076 P3 剩余项 | 079/081 已承接部分动效与交互；空态、微文案、键盘可达和 a11y 逐项判断，不重复立项 |
| P2 | 验证桌面交付和试用效果 | 干净机器安装/升级/恢复、真实用户首单、任务成功率、人工介入次数和成本均有记录 |

## 7. 未来发展方向

1. **近期：稳定性与证据。** 先把现有功能收成可重复的日常闭环。衡量完整任务成功率、失败恢复率、完成验证覆盖率、恢复耗时，而非单纯增加测试数量。
2. **中期：零门槛上手。** GOAL-077 是最明确的已有方向。先让用户通过可靠通道完成首单，再逐步暴露高级能力；免费通道只是其中一种路径，其上游可用性仍需兜底。
3. **中期：小范围产品验证。** D79 面向个人开发者，077 又提出普通用户方向，目标人群仍需进一步收敛。先用少数真实用户检验安装门槛、任务价值与成本，再决定商业包装。
4. **后续：生态互操作。** GOAL-077 附录提出 CodeBuddy CLI 和 mush MCP Server 候选路线。该附录属于 2026-08-25 的历史调研记录，本轮未联网复核，实际入口、协议与条款应重新验证后立项。不要把 WorkBuddy 桌面形态直接当作已接入执行端。
5. **条件成熟后：有界无人值守。** 由 owner 决定是否启用；在新版本重验的认证证据、预算硬顶、熔断与人工接管机制之上逐级推进，保留默认关闭的治理边界。

长期北极星仍是 D14：用户只需与一个页面交流，规划、派发、执行、审查和必要审批在其后形成可靠闭环。无需为了该目标先扩展成云端多租户平台。

## 8. 给接手模型的执行入口

先按序阅读 `CONSTITUTION.md`、`DECISIONS.md`、`docs/rm-001-dogfood-bootstrap.md`，再读 AGENTS、本文和相关 Goal。新增功能或跨文件实施先与 owner 确认范围；当前状态说明本身不授权修复、发布或真实派发。

建议从以下只读核对及定向机检开始，全量测试前检查各测试的进程、GUI 与环境依赖。以下为建议命令，不表示本轮全部执行过。

```powershell
Set-Location -LiteralPath 'D:\mush'
git status --short --branch --untracked-files=all
git diff -- scripts/board-up.ps1 src/web/persistence.ts tests/persistence.test.ts
npm.cmd run typecheck
node --test --test-isolation=none D:\mush\tests\persistence.test.ts
node --test --test-isolation=none D:\mush\tests\web-dispatch.test.ts
node --test --test-isolation=none D:\mush\tests\web-board-e2e.test.ts
node --test --test-isolation=none D:\mush\tests\workspace-browse-and-tree.test.ts
npm.cmd test
```

需要定位实现时，按职责进入：

| 路径 | 职责 |
| --- | --- |
| `bin/mush`、`src/cli.ts`、`src/web/repl.ts` | CLI、看板启动与终端对话 |
| `src/web/server.ts` | HTTP/SSE、应用装配、工作区热切换与监理接线 |
| `src/web/dispatch.ts` | 生产派发管线、审批、执行、回报与任务状态推进 |
| `src/web/persistence.ts`、`tasks.ts`、`workstreams.ts` | 持久化、实例锁、任务与会话流 |
| `src/adapters/` | Harness 合同、发现、执行器和探针 |
| `src/core/` | 预算、进程、探针阶梯、监理、熔断与就绪认证 |
| `src/orchestration/` | 路由、协作拓扑、验证、记忆、技能、快照和效能 |
| `src/web/page.ts`、`src/web/ui/` | 原生前端页面、样式、视图和键控补丁 |
| `src/loop/` | D80 定性为早期 fixture/参照资产，不是现行生产治理入口 |
| `src/web/api-contract.md`、`goals/`、`docs/dispatch/` | 契约、任务规格和历史演练证据 |

操作约束：保留已有未提交改动；冻结区 `D:\意向项目` 只读；不装全局包、不改凭据或机器级环境；不发布或扩大外部影响，私有远端仅沿用 D19 的定点边界。真实派发前执行 `scripts/scan-inflight.ps1` 并走 D30 每单审批卡，单包单通道。复杂 Windows 逻辑先落脚本再执行，PowerShell 脚本保持 ASCII；本机 npm 执行策略曾拦截 `npm.ps1`，使用 `npm.cmd`。

## 9. 本次证据锚点

以下 SHA-256 锚定本轮核对到的四项既有改动，便于后来者识别是否发生后续编辑；不包含密钥材料。

| 文件 | SHA-256 |
| --- | --- |
| `scripts/board-up.ps1` | `39F9CB76D2960AE4887C3F263D48933ED902581D203BE2FF088F820E884D7640` |
| `src/web/persistence.ts` | `4C041A5A6484B9DE39B39D98E1F3A1646AC30D78FB1C9B74744B9E4153BE0B61` |
| `tests/persistence.test.ts` | `D53993FB5AF74903435392A2941CB92A4DA66C339BEA8728C841C62F166B9FA1` |
| `scripts/set-codex-cli-path.ps1` | `A16F17E43C94FE1CFDED69C11511A0658A24A0FA3F0E2BFB24CB08BC14C211E0` |

本次没有运行真实派发、改变无人值守策略、执行环境配置脚本、提交或推送。新增文件为本交接说明，定向测试仅在 `.test-fixtures/persistence/` 产生测试数据。

## 10. 同日开发续记

以上正文保留为编写时的快照。owner 随后确认由本模型继续开发，已落地 GOAL-083：测试用户目录/主预算账本隔离、环境覆盖恢复、opencode 与 cc-switch 可控样本、计时测试前置阶段隔离，以及陈锁检查端口精确匹配和 PID 归属修复。

本轮最终默认与独立进程测试各 710/710、exit 0，typecheck 零错误，g076 HTTP/DOM 基线 7/7；真实主账本前后哈希一致。GOAL-083 为 AUTO_ACCEPTED，正式 DONE 归 owner。正文第 8 节的旧测试命令需补 `--import ./tests/setup.ts`，以 README 最新开发验证为准；第 9 节源码哈希是修复前快照，修复后证据见 `goals/receipts/GOAL-083-receipt.json`。本轮没有实现 GOAL-077，也没有改动其他 Goal 的验收状态。
