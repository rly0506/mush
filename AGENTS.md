# mush — agent 工作区指引

mush 是个人跨 harness 多 agent 编排工具（雪橇队）。你在本仓库工作时遵守：

## 必读（按序，都很短）

1. `CONSTITUTION.md` — 最高治理文件：双模式治理 + 五类触发门 + 证据纪律
2. `DECISIONS.md` — 全部奠基决议（append-only，不改写历史条目）
3. `docs/rm-001-dogfood-bootstrap.md` — 当前路线图与里程碑

## 硬红线（违反即停，等 owner 决定）

- 不 push 任何远端、不发布、不发送数据离开本机（**唯一例外**：D19 授权的私有远端
  `github.com/rly0506/mush`，仅限本仓 master 同步，不得携出密钥或未扫描内容）；
- 不修改 `D:\意向项目` 内的任何文件（agent-bridge 是冻结的黄金参照，只读）;
- 不安装全局包、不变更凭据/密钥路径；密钥不入库、不入日志、不入 prompt；
- 花钱超 per-actor cap 前必须停下弹审批（CONSTITUTION.md §1）;
- 永久删除、权限/范围扩张、身份变更同样先停。

## 治理与执行体系（三重架构 + 双轨引擎 D67/D68）

1. **三重事实架构（Single Source of Truth）**：
   - **规划层（Spec）**：`spec/`（系统蓝图、宪法边界、研发验收总则）；
   - **路线图（Roadmap）**：`docs/roadmaps/`（RM-001 ~ RM-007 阶段演进）；
   - **执行目标（Goal/RFC）**：`goals/GOAL-*.md`（单一合法任务实体，标准模板见 `goals/TEMPLATE.md`）。全库废除旧 `GP-xx` 杂糅命名。
2. **双轨自适应编排引擎（Dual-Track Orchestration）**：
   - **Goal 轨（持久化宏观目标）**：跨文件修改、多工序协同或新功能迭代，头犬必须先在对话中与 owner 确认大纲，自动生成 `goals/GOAL-xxx.md` 落盘后入池派发；
   - **Tasklet 轨（瞬态即时微任务）**：局部微调、探索问答、即时探针，头犬直接生成提示词向工犬派发，无需写独立文档；
   - **工犬直调感知**：owner 直接手操工犬修改代码时，头犬保持只读感知并在下次对话时主动对账与审查。
3. **工作区 Goal 文档全自动入池（D67）**：
   - 无论是人类还是 AI 在 `goals/` 创建 `GOAL-*.md`，任务池与思维导图 8 秒内自动解析标题、元数据与「目标与价值」简报并入池；
   - 任务卡一键直通派发（`data-task-dispatch`）自动携带目标规格。

## 工作约定


- **Windows 转义铁律（DEF-07/08 教训，人犬一律遵守）**：复杂逻辑（多行 JS、
  含反斜杠/引号/CJK 的参数、PowerShell）**必须先写脚本文件再执行**
  （`node scripts/xxx.cjs` / `powershell -File xxx.ps1`），禁止 `node -e`、
  `bash -c`、`powershell -Command` 内联多行；PowerShell 脚本源码保持纯 ASCII
  （路径用 `[Environment]::GetFolderPath()` 运行时取）；文件一律用显式
  Windows 绝对路径（`C:/Users/.../x.cjs`），不用 `/tmp` 相对形态；
  模板字符串内的正则/反斜杠必须双写（DEF-07）。
- 证据 append-only：摘要不覆盖原文，事件带哈希锚点；
- 用户显式接受才 DONE，模型不自行宣布完成（D15：机检验收规格全绿可升
  AUTO_ACCEPTED，不阻断后续 Goal；DONE 与否决权仍归 owner）；
- **头犬（zcode）常设职责：审核验收 + 队列编排 + 安全审查**（D23：DEF/F
  漏洞审计与修复验证；任何对外暴露/新数据面前置检查）；
- 语言/运行时：Node/TS（D2）；UTF-8 原生，不引入 PS5.1 式编码补丁；
- 测试即验收规格：新实现行为与 fixture/影子回放不一致即为缺陷；
- 技能：用户全局技能目录可用；本仓库暂无专属技能，需要时按 DECISIONS D12 处理；
- 目标池：docs/goal-pool.md（D23，头犬维护，owner 增删），队列排程从池取材；
- **投喂单通道（AD-34）**：一份派发包同一时刻只走一个投喂通道（owner 手开
  窗口 **或** 看板派发），禁止双开；后续包默认走看板（DEF-12 后 kimi/dsh
  均可被看板真实拉起）；
- **每单审批卡（D30）**：头犬（或任何人）发起的每次真实派发一律停看板
  审批卡等 owner 点批；常设审批文件免检旁路已废除，头犬未经告知自主
  真实派发属越权；
- **在途三件套扫描（AD-35）**：头犬派发前必跑 `powershell -NoProfile -File
  scripts/scan-inflight.ps1`（犬窗口标题/worktree/看板派发三通道）；手开
  犬窗口用 `scripts/dog-window.cmd <packet> <dog>` 启动（自动标题
  `mush|<packet>|<dog>`），已有窗口可在窗口内执行 `title mush|<packet>|<dog>`
  补标——窗口标题对 owner 与头犬均机器可读。

## 当前状态

**RM-001 ~ RM-007 全部 7 大路线图 / 55 个 Goal 经 owner 明确授权已全部正式大圆满收官（D65）。**
- **RM-001：犬队基建与机检验收** ✅（GOAL-001 ~ GOAL-012）；
- **RM-002：看板与工作流治理** ✅（GOAL-013 ~ GOAL-023）；
- **RM-003：会话流式与零成本梯队** ✅（GOAL-024 ~ GOAL-027）；
- **RM-004：多拓扑与实战闭环** ✅（GOAL-028 ~ GOAL-034）；
- **Phase C：视觉审查与记忆图谱** ✅（GOAL-035 ~ GOAL-042）；
- **RM-005：社会化 Agent 合作框架与自适应工作台** ✅（GOAL-043 ~ GOAL-047，圆桌辩论/流水线/红蓝攻防/悬赏撮合）；
- **RM-006：跨犬技能联邦与时空状态内核** ✅（GOAL-048 ~ GOAL-051，跨 Harness 技能双向转译/平行时间旅行/共享黑板/液态小队）；
- **RM-007：自演进评测天梯与雪橇伴侣** ✅（GOAL-052 ~ GOAL-055，战绩 ELO 天梯/路由自进化/托盘伴侣浮窗/全景能效战报）；
- **RM-008：效能经济学与上下文生命周期工程** ✅（GOAL-056 ~ GOAL-057，用量后验对账/Prompt Cache 细分/300行安全门禁/结构化不变式压缩）；
- **RM-009：通用挂载、动态思维链、工犬直连与智能 Resume** ✅（GOAL-058 ~ GOAL-062，自由工作区挂载/多厂商思维链动态Spec/头像直连抽屉/Child Auto-Resume/DoD收官工具/多Provider动态发现与犬队医生 D76~D77）；
- **RM-010：商业化就绪、零信任安全加固与 MVP 发版** ✅（GOAL-063 ~ GOAL-066，Caller-Token 零信任鉴权闭环/CSRF与沙箱白名单/服务端权威预算与台账持久化/EPIPE与进程树杀/Fail-Closed纠偏/Apache-2.0与EULA/桌面便携打包 D79）。

**基线 585 tests 100% 全绿（24 suites, 0 fail）+ typecheck 零错误门禁**；版本 `v0.1.1-pilot`；奠基决议落地至 `D81`；RM-011 实战淬火路线图进行中（M0 GOAL-070 已收官）。
犬队在册（deepseek/claude/kimi/zcode/codex/opencode/pi/agy；codex 因 F-50 故障禁任头犬；pi-rpc 通道实测贯通以绕开 DEF-13 上游挂起）。
findings 默认裁决：docs/auto-decisions-log.md（D16）。
GitHub 私有远端同步为常规动作（D19）；无人值守调度器仍默认关（D8）。




