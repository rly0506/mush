# 派发包 007 — DeepSeek/dsh 执行 MUSH-GOAL-010（cc-switch 全量模型注册）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的
完整任务包。与 kimi 的 GOAL-007-B（前端）并行，注意文件面不相交（见边界）。
自主会话适用：无人应答，按包推进，疑问记 findings。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md`（§3 密钥红线重点）→ `DECISIONS.md` D20/D22
2. `goals/GOAL-010-ccswitch-model-registry.md` — 你的 Goal（任务/DoD/边界）
3. `src/web/dispatch.ts`（knownContracts/roster 段）— 变体动态化的接入点
4. 参考：头犬 2026-08-17 的只读探测实录（AD-13 附带）——cc-switch DB 表结构：
   providers(id/app_type/name/category/is_current/settings_config…)、
   proxy_request_logs(request_model/…)、model_pricing(model_id/…)；
   node:sqlite DatabaseSync readOnly 用法已在本仓验证过。

## 关键红线（本 Goal 特有）

- **绝不读取 providers.settings_config 中的密钥列**——SELECT 列白名单硬编码；
  测试断言白名单。宁可功能少，不可碰密钥。
- 只读 `~/.cc-switch/`；任何写操作=立即停止。
- 输出文件（runtime/capability-registry.json）落盘后自查：不得含 sk-/token/
  api_key 字样。

## 工作纪律（惯例）

小步 TDD；223+ tests 保持全绿；path-limited commit（G10-* 号）；每批
BATCH-NN 回报 + 真实测试输出；D15 验收语义；push origin master 常规同步
（失败不阻塞）。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-010-completion.json` 落盘 / 预算逼近 /
仅剩 finding 阻塞项。
