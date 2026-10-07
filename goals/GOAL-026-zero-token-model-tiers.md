# GOAL-026: 零 Token 消耗模型探测与四级可调度信度梯队

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；零 token 四级信度梯队在库，专测 tests/g026-zero-token-model-tiers.test.ts 通过；目标池 GP-37 已记完成（2026-08-19）；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 依据：`GP-37`，衔接 `GP-35 (GOAL-025)`、`CONSTITUTION.md §1`（零密钥与花钱约束）与 `DEF-13`。

---

## 1. 目标与价值

在大模型编排中，**配置文件或公开价格表中存在的模型，绝不等同于当下真实可调度**。为避免用户踩入 404（未开通）、402/429（欠费限流）或 CLI 旗标缺失等暗坑，同时**坚决杜绝因发 Prompt 探测而白白消耗 Token 和金钱**，本目标建立：

1. **零 Token 消耗探测与预检（Zero-Token Probing & JIT Preflight）**：
   - 优先通过元数据端点与配置解析，不生成任何 Token，花费 $0；
   - 派发回执“顺风车”自动沉淀真实可用性。
2. **四级调度信度梯队（Four-Tier Dispatchability Ladder）**：
   - `🟢 T1 [实测通过 (Verified Live)]`：24h 内真实派发成功或探针通过；
   - `🟡 T2 [配置就绪 (Configured Ready)]`：处于 active profile 或 default_model，通道完整；
   - `⚪ T3 [目录声明 (Catalog Declared)]`：来自公开模型库，上游权限待定；
   - `🔴 T0 [受阻/缺失 (Blocked/Unsupported)]`：429 耗尽或 CLI 缺少参数注入通道。
3. **通道参数保护与透明提示（Channel Guard & Transparent UI）**：
   - 对于 `kimi` 等无 `--model` 旗标的 Harness，派发面板明确提示锁定生效的模型，杜绝无效传参。

---

## 2. 验收规格

- [ ] `src/adapters/live-probe.ts` 实现模型梯队分类器 `classifyModelTier` 与回执记录器 `recordModelReceipt`；
- [ ] `src/web/dispatch.ts` 派发终态时自动更新模型信度，并在 `roster()` 中暴露分级元数据；
- [ ] `src/web/server.ts` 暴露 `POST /api/models/verify` 零 Token 预检端点；
- [ ] `src/web/page.ts` 模型下拉框与提示区呈现四级信度徽章与单模型锁定提示；
- [ ] 自动化测试全部绿灯通过（404+ tests 100% PASS）。
