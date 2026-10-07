# GOAL-027: 本地会话用量与花费监控 (Local Token & Cost Monitor)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；本地用量与花费监控（契约 v1.13）在库，专测 tests/g027-*.test.ts 通过；目标池 GP-33 已记完成（2026-08-19）；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 依据：`GP-33`、`D32` 与 `CONSTITUTION.md §1`（花钱与证据纪律）。

---

## 1. 目标与价值

目前看板的预算面板（Budget View）主要依赖 mush 内部派发的预扣上限与粗估费用，缺乏对各 Harness 本地真实运行消耗的全面透视。

本目标建立类似 **`ccusage`** 的**零外部依赖、零密钥侵入** 本地会话用量解析与费用投影系统：
1. **多 Harness 本地日志解析**：
   - 自动扫描解析 `~/.claude/projects/`、`~/.pi/agent/sessions/`、`goals/receipts/` 等本地真实会话日志；
   - 提取真实 `input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`。
2. **零密钥定价引擎（Zero-Credential Pricing Engine）**：
   - 内置主流模型基准定价表（支持 Cache 优惠倍率计算）；
   - 精准计算各模型与各犬只的今日花费（Today Cost）与累计花费（All-Time Cost）。
3. **看板全景用量监控面板**：
   - 在单屏看板中直观展示：今日花费、累计花费、Token 吞吐、缓存节省率、各犬花销占比分布。

---

## 2. 验收规格

- [ ] `src/web/pricing.ts` 实现主流大模型基准定价与 Token 计费计算器；
- [ ] `src/web/usage-scanner.ts` 实现本地多 Harness 会话日志扫描与按天/按犬/按模型用量聚合；
- [ ] `src/web/server.ts` 暴露 `GET /api/usage` 契约端点（更新 `src/web/api-contract.md` 至 v1.13）；
- [ ] `src/web/page.ts` 预算/系统面板渲染「📊 用量与花费监控」卡片与分布条形图；
- [ ] 自动化测试全部绿灯通过（410+ tests 100% PASS）。
