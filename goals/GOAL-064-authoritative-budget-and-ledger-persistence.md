# GOAL-064: 服务端权威预算、实际成本回写与账本持久化 (Authoritative Budget & Ledger Persistence)

- 状态：`DONE`
- 来源：商业化安全审计 (P0) / owner 决策 D79
- 优先级：高
- 依赖：GOAL-063

---

## 1. 目标与价值

重构资金与用量闸门，防止 API 预算被恶意绕过与过度开销：
1. **服务端权威 Budget Cap**：请求体中的 `cap_usd` 仅作为单次上限，必须 $\le$ 服务端配置的 `budgetCaps[adapterId]`，客户端无法随意覆盖提额；
2. **实际消耗真实回写 (Cost Feedback Loop)**：每次派发完成后，提取真实 Telemetry / Token 消耗并实时回写到 `budget-ledger`；
3. **台账 Append-Only 磁盘持久化**：将预算台账由内存 Map 升级为 `runtime/budget-ledger.jsonl`，看板重启或多实例自动加载历史总消耗，杜绝重启清零漏洞。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/core/budget.ts` [MODIFY] — 金额转为微美元 (Micro-USD) 整数计算防浮点漂移；增加磁盘持久化与重放恢复逻辑
- `src/web/dispatch.ts` [MODIFY] — 强制校验 `cap_usd <= serverCap`；派发完成后提取真实消耗并追加 Ledger 记录
- `src/web/budget-caps.ts` [MODIFY] — 增加权限与范围校验，杜绝非授权随意提额

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g064-budget-persistence.test.ts`
- [ ] 验证客户端传递超额 `cap_usd` 被服务端硬性截断或报错拒绝
- [ ] 验证派发产生的真实 Token 消耗准确回写至预算台账并扣减余额
- [ ] 验证服务重启后已消耗预算不丢失、继续生效
- [ ] 全量 534+ 测试套件保持 100% 绿灯
