---
goal_id: MUSH-GOAL-003
status: DONE（owner 2026-08-17 一句话转正，AD-25）
mode: LIGHT（宪法 §1 轻量档；触发门照常生效）
rm: RM-001 / M3 双犬适配器（含 D21 CLI 化、D20 实测注册）
executor_model_profile: 头犬派发（dsh/deepseek headless 或等价可用 harness）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: RM-001 M3 授权（D2/D5）；**每犬首次真实有界 dispatch 按 D6 需
  owner 一句话确认后才花真钱**——不花钱部分（框架/探测/CLI）不得因此阻塞
---

# MUSH-GOAL-003：M3 双犬适配器 + CLI 化

## 任务

在 `src/core`（事件/状态机/lease/能力注册/预算，GOAL-002 已验收）之上构建适配器层。

1. **适配器框架**（`src/adapters/`）：合同 = executable + 参数 + 协议（D5）；
   T1 单发 headless + 文件落盘回报为通用底座；通道选档依据
   `docs/capability-probes/harness-landscape-2026-08-16.md`。
2. **DeepSeek 犬**（经 pi/dsh）：复用 `src/core` 的 pi-rpc
   （wire/completion/session）与 pi-adapter；nonce 身份探测（D13 fail-closed）；
   一次真实有界 dispatch 验收（**花钱，待 owner 确认**）。
3. **Claude Code 犬**：`claude -p` + stream-json 通道；nonce 身份探测；
   一次真实有界 dispatch 验收（**花钱，待 owner 确认**）。
4. **D20 实测能力注册**：cc-switch provider 目录只读枚举 + 逐 provider
   `/models` 探测（密钥仅在探测进程内临时使用，永不入库/日志/prompt）；
   UNKNOWN 诚实记录；结果填 capability record（model/强度档位字段）。
5. **D21 CLI 化**：`bin/mush` 入口 + `--workspace` 参数贯通；最小命令集
   `status` / `dispatch` / `review`；同机任意工作区可调用。
6. **预算记账接入真实 dispatch**：per-actor cap admission 事件化（GOAL-002
   budget 模块对接真实花费估算）。

## 分批纪律（沿用派发包 002 惯例）

小步 TDD；path-limited commit（信息含单元号）；每批 `goals/receipts/
BATCH-NN-completion.json` + 真实测试输出；既有 124 tests 保持全绿；
push origin master 为常规同步（失败不阻塞，本地为准）；D15 验收语义。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 绝对只读；
- 零依赖不变（确需依赖→finding 停该项）；
- cc-switch 只读（D20 边界），凭据文件不打开、不复制、不入任何输出；
- 真实 dispatch 花钱前必须已有 owner 确认记录（D6）；per-actor cap $5；
- 五触发门照常生效。

## DoD

- `npm test` 退出码 0，含适配器框架与双犬协议测试（fake/录制回放级）；
- 两犬 nonce 身份探测落盘证据（fail-closed 断言）；
- D20 探测结果入能力注册表（含 UNKNOWN 项）；D21 CLI 三命令可用（本仓
  与至少一个非 mush 工作区目录上实测 `status`）；
- 真实 dispatch 验收：若 owner 已确认则完成并留事件链；未确认则该项单列
  BLOCKED_WAITING_OWNER，其余不受阻；
- 完成回报 `goals/receipts/GOAL-003-completion.json`（D15 语义）。
