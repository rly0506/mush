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

- [ ] 新建自动化测试 `tests/g072-chaos-injection.test.ts` 全绿 ✅（2026-08-25 四用例全过）
- [ ] 注入矩阵全过：犬进程中途击杀 / 服务重启 / ledger 并发撕裂 / 审批令牌重复消费 ✅
- [ ] 8h+ soak 完成（free 模型），零内存泄漏趋势（句柄/RSS 曲线归档 docs/dispatch/）
- [ ] 严格遵守宪法红线：混沌仅注入沙盒工作区，不触碰冻结区与生产台账

## 附录：soak 通道可用性矩阵（2026-08-25 实测）

| 通道 | 结果 | 归因 |
|---|---|---|
| opencode free | ⚠️ 可用但抖动 | 当晚静默失败率 ~60%（exit1 零输出、与提示词无关），白天时段曾 5/6 稳定；RSS 曲线已实证零泄漏 |
| deepseek-dsh | ❌ CLI 本体损坏 | cordis 插件加载器崩溃（本机环境问题，需重装修复；D-红线禁 agent 装全局包→owner 操作） |
| kimi-code | ❌ 余额耗尽 | 403 预扣费失败：剩 ¥0.2209 < 需 ¥0.6828 |
| zcode | ❌ 余额耗尽 | 同一代理池：剩 ¥0.2209 < 需 ¥0.2233 |
| claude-code | ❌ 管线缺口（新缺陷） | 合同为 stream-json 协议，泛用管线默认 runner 仅支持 t1/pi-rpc——需补 stream-json 执行路径方可派发 |

**owner 决策点**（三选一）：① 充值 kimi/zcode（¥10-30 级）后以该通道跑 8h；② 等 opencode free 上游恢复时段重跑（今晨曾稳定）；③ 授权补齐 claude-code stream-json 执行路径（开发量最大，但解锁订阅通道长期价值）。
