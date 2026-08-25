# GOAL-072: 故障注入与长时序稳定性 soak (Chaos Injection & Long-Run Soak)

- 状态：`IN_PROGRESS`（RM-011 M2；混沌矩阵 4 用例全绿 + soak 执行器入库，8h 长跑独立进程进行中——收官后归档曲线刷新 E4 并转 DONE）
- 状态备注：`READY`（RM-011 M2 原值，2026-08-25 开工）
- 来源：头犬提案，owner 规划会批准 RM-011 骨架（含本里程碑）
- 优先级：中
- 依赖：GOAL-070（soak 用 free 模型零成本执行）, GOAL-071（真实负载路径为混沌靶标）

---

## 1. 目标与价值

机检绿 ≠ 实战绿：进程被杀、服务重启、账本撕裂、8 小时连续派发这些真实世界必然事件从未被系统性注入验证。本 Goal 用受控混沌用例把「崩溃恢复」变成规格而非运气，并以 GOAL-070 的 free 模型零成本跑通 8h+ soak，产出内存/句柄增长基线与全部缺陷修复证据。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `tests/g072-chaos-injection.test.ts` [NEW] — 混沌用例集
- `src/web/dispatch.ts` [MODIFY] — 犬进程 SIGKILL 中途恢复路径（审批卡状态机断点续接）
- `src/web/server.ts` [VERIFY] — 服务重启后事件回放与 SSE 重订阅一致性（GOAL-065 基础上加压）
- `src/core/budget-master.ts` [MODIFY] — 并发追加撕裂行容错已有基础，补多进程竞争写入用例与自愈

### 2.2 关键接口与数据契约
- soak 执行器复用既有派发管线，脚本化于 `scripts/`（PowerShell 纯 ASCII 铁律遵守）；不新增对外端点。

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g072-chaos-injection.test.ts` 全绿
- [ ] 注入矩阵全过：犬进程中途击杀 / 服务重启 / ledger 并发撕裂 / 审批令牌重复消费
- [ ] 8h+ soak 完成（free 模型），零内存泄漏趋势（句柄/RSS 曲线归档 docs/dispatch/）
- [ ] 严格遵守宪法红线：混沌仅注入沙盒工作区，不触碰冻结区与生产台账
