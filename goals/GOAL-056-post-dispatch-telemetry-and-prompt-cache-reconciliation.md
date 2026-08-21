# GOAL-056: 派发回执零开销真实用量对账与 Prompt Cache 细分计量 (Post-Dispatch Zero-Cost Telemetry & Prompt Cache Reconciliation)

- 状态：`DONE`
- 来源：owner 深度探讨与规划 (RM-008 M1)
- 优先级：高
- 依赖：GOAL-017A, GOAL-027, GOAL-055


---

## 1. 目标与价值

当前 mush 的预算与计费体系仅停留在“派发前置名义估算”，缺乏工犬子进程退出后的真实用量回填，且未细分 Prompt Caching（缓存命中与未命中单价差异高达 10~25 倍），导致看板账本失真。

本 Goal 旨在引入**零额外 Token 消耗的本地确定性用量提取引擎与单价矩阵**：
1. 在子进程（Claude, DeepSeek, Codex, Kimi, Pi 等）执行完毕后，由本地 Node.js 解析器秒级提取 `input_tokens`、`output_tokens`、`cache_creation_tokens`、`cache_read_tokens` 并记入 `T1Receipt`；
2. 引入解耦的 `ModelPricingMatrix`，将实际结算费用追加写入 `runtime/ledger.jsonl`；
3. 在看板预算大屏直观展示实际支出与 Prompt Cache 节约总额，消除多 Agent 协同中的经济学黑盒。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/adapters/t1-runner.ts` [MODIFY] — 扩展 `T1Receipt` 结构，增加真实 Token 元数据提取逻辑
- `src/core/budget.ts` [MODIFY] — 实现 `ModelPricingMatrix` 与 Prompt Cache 细分计算逻辑
- `src/web/dispatch.ts` [MODIFY] — 派发完成后回写真实用量至 `ledger.jsonl`，更新 `budgetProjection`
- `src/web/page.ts` [MODIFY] — 预算面板渲染实际支出、Token 明细与 Prompt Cache 节省金额
- `tests/g056-telemetry-reconciliation.test.ts` [NEW] — 零开销回执解析与真实对账单测

### 2.2 关键接口与数据契约
```typescript
export interface TokenUsageTelemetry {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_tokens: number;
  readonly cache_read_tokens: number;
  readonly total_cost_usd: number;
  readonly cache_savings_usd: number;
}
```

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g056-telemetry-reconciliation.test.ts`
- [ ] 验证子进程退出后提取 Token 数据的确定性（0 额外模型调用，耗时 < 5ms）
- [ ] 验证 Prompt Cache 命中单价折算与真实费用对账回填
- [ ] 严格遵守宪法红线：零凭据泄露、零外部网络请求、Windows 路径安全
