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
- 目标池：docs/goal-pool.md（D23，头犬维护，owner 增删），队列排程从池取材。

## 当前状态

**RM-001 DONE；RM-002 DONE（2026-08-17 owner 收官）。** 下一阶段待立（目标池
GP-04/05/14/18/21-27 待选）。基线 255 tests 全绿；看板 127.0.0.1:4790（桌面
快捷方式）；五犬在册（deepseek/claude/zcode/codex/opencode，kimi 待入册）。
findings 默认裁决：docs/auto-decisions-log.md（D16）。
GitHub 私有远端同步为常规动作（D19）；无人值守调度器仍默认关（D8）。
