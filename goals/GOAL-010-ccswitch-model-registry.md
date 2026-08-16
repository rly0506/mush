---
goal_id: MUSH-GOAL-010
status: QUEUED（与 GOAL-007-B 并行；文件面不相交）
mode: LIGHT（触发门照常生效）
rm: RM-002 / D20 完整落地
executor_model_profile: deepseek-dsh（后端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: owner 2026-08-17 对话批准（"可以"）
---

# MUSH-GOAL-010：D20 实测能力注册 — cc-switch 全量模型枚举

## 任务

把能力注册表的模型清单从合同静态声明升级为**实测枚举**（owner 2026-08-17
反馈："模型变体…没有通过 curl 或者 cc-switch 显现全部可调用模型"）。

1. **cc-switch 只读探测器**（`src/adapters/ccswitch-probe.ts`）：
   - 读 `~/.cc-switch/cc-switch.db`（SQLite，node:sqlite，readOnly: true）；
   - 枚举 `providers`（app_type/name/category/is_current）与模型能力线索
     （`proxy_request_logs.request_model` 近期实调模型、`model_pricing` 价格表）；
   - **凭据红线**：只 SELECT 非凭据列（providers.settings_config 可能含密钥，
     **不读取该列**或仅提取 base_url 类非敏感字段——宁可少要，不可多取）；
     探测器输出永不包含 key/token。
2. **注册表落盘**：`runtime/capability-registry.json`（adapter_id → 实测模型
   清单 + 来源标记 cc-switch/contract + 探测时间戳）；写入 mush 仓库 runtime/
   （gitignore 已覆盖）。
3. **合同变体动态化**：`knownContracts()` 的 deepseek/claude 变体列表从注册表
   合成（注册表缺失时回退静态声明，fail-closed 不猜测）；roster API 因此自动
   带全量变体（前端 006 包已确认能渲染长列表）。
4. **nonce 一致性**：枚举出的模型仅是"可调用候选"，**身份仍以 nonce 实测为准**
   （D13）；注册表条目标注 verified: true/false。
5. **测试**：fake DB fixture（tests/ 内造小型 SQLite 或抽象层 fake）覆盖
   枚举/合成/回退/密钥列不读取（断言 SELECT 列白名单）。

## 边界

- 只写 D:\mush（runtime/ 产物除外均在仓内）；**不写 ~/.cc-switch 任何字节**；
- 零依赖（node:sqlite 原生）；密钥列不读、不存、不输出（宪法 §3）；
- 与 GOAL-007-B（kimi 前端）文件面不相交：本 Goal 限 src/adapters/
  ccswitch-probe.ts、src/web/dispatch.ts 的 knownContracts 合成段、测试；
  **不改 page.ts**。
- per-actor cap $5；五触发门照常。

## DoD

- `npm test` 全绿（含密钥列白名单断言）；
- 真实探测一次：`runtime/capability-registry.json` 生成且含 cc-switch 实测
  模型（脱敏核验：grep 无 sk-/token 类字符串）；
- roster API 返回的变体列表来自注册表；缺注册表时回退静态；
- 完成回报 `goals/receipts/GOAL-010-completion.json`（D15 语义）。
