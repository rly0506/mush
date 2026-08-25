# GOAL-071: 冻结区观察模式与双项目实战演练 (Frozen-Zone Observation Mode & Dual-Project Live Drill)

- 状态：`DONE`（2026-08-25：观察模式全链落地 + 双项目演练 17/17 全绿，战报 docs/dispatch/rm011-m1-dual-drill.md；写面口径=提示级章程+事后审计（owner 批准），GP-14 落地后可升级硬拦截。余项：VelocityMatrixEngine 战报导出并入 G072 前置批）
- 来源：owner 规划会指定意向项目作为演练靶场；因宪法冻结区红线改为「观察模式只读参演 + 常规项目全写演练」双轨
- 优先级：高
- 依赖：GOAL-070（演练犬优先用 free 档）

---

## 1. 目标与价值

GOAL-068 热切换引擎重建了约 20 个数据面的生命周期，机检全绿但从未经历真实负载长时序检验——这是当前最大风险敞口。本 Goal 一石二鸟：(1) 为黄金参照区（D:\意向项目）建立「观察模式工作区」能力，使其可**零写入**参演实战演练；(2) 以「观察态意向项目 + 全写常规真实项目」双项目跑通挂载→派发→审批→交付→切换→对账全流程，产出首份真实演练战报与缺陷清单。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/web/dispatch.ts` [MODIFY] — 新增观察模式状态与命令白名单闸（分析类零写命令放行，任何写操作/文件创建拒绝）；冻结区 select/create 守卫保留不动
- `src/web/server.ts` [MODIFY] — `POST /api/workspaces/observe { path }`：仅当路径命中冻结区特征时允许进入观察态；观察态不写 `<ws>/.mush/workspace.json`、不落任何 runtime 数据到冻结区
- `src/web/page.ts` [MODIFY] — 工作区卡「观察模式」入口与 OBSERVATION 徽标；审批卡标注观察态派发
- `docs/dispatch/` [NEW] — 双项目演练战报（复用 VelocityMatrixEngine 导出）

### 2.2 关键接口与数据契约
- `POST /api/workspaces/observe`：成功返回 `{ ok, observing, path }`；对非冻结区路径返回 400（常规项目请走正式 select）；
- 观察态派发审批卡 `meta.observation=true`，台账照常记账（犬成本仍真实发生）；
- 契约升版记录于 api-contract.md。

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g071-observation-mode.test.ts`
- [ ] 观察模式下冻结区路径**零写入**断言（含 .mush 元数据、runtime、goals 目录均不得出现）
- [ ] 白名单外写命令在观察态被拒且留审计痕迹；正常分析类命令（git status/log/diff、grep 类）可执行
- [ ] 双项目演练全程穿越热切换 ≥3 次，任务池/聊天/派发追踪无串台；战报归档
- [ ] 严格遵守宪法红线：冻结区零修改、零凭据泄露、Windows 路径安全
