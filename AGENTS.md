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

- 证据 append-only：摘要不覆盖原文，事件带哈希锚点；
- 用户显式接受才 DONE，模型不自行宣布完成（D15：机检验收规格全绿可升
  AUTO_ACCEPTED，不阻断后续 Goal；DONE 与否决权仍归 owner）；
- 语言/运行时：Node/TS（D2）；UTF-8 原生，不引入 PS5.1 式编码补丁；
- 测试即验收规格：新实现行为与 fixture/影子回放不一致即为缺陷；
- 技能：用户全局技能目录可用；本仓库暂无专属技能，需要时按 DECISIONS D12 处理。

## 当前状态

M1–M3 完成（158 tests 全绿；GOAL-001/002/003 均 AUTO_ACCEPTED）。真实 dispatch
已获 owner 批准但因凭据环境 BLOCKED_ENV（缺 DEEPSEEK_API_KEY、claude 未登录——
owner 侧动作，mush 不代做）。
下一步 GOAL-004（M4 dogfood live loop，已排队）：前置 = 凭据就绪后重跑
GOAL-003 dispatch 闭环；首任务（M5 看板 vs zcode 接入）待 owner 一句话选定。
findings 默认裁决记录：docs/auto-decisions-log.md（D16）。
GitHub 私有远端同步为常规动作（D19）；无人值守调度器仍默认关（D8）。
