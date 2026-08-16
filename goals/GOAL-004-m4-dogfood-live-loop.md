---
goal_id: MUSH-GOAL-004
status: DONE（owner 2026-08-17 一句话转正，AD-25）
mode: LIGHT（宪法 §1 轻量档；触发门照常生效）
rm: RM-001 / M4 dogfood 首个 live loop
executor_model_profile: 头犬 mush 自身（编排）；执行犬 Claude Code（对调实验时
  DeepSeek 任执行犬）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: RM-001 M4 授权（D4 dogfood 自举 + D6 半自动流程 + 随附默认分工）；
  首任务一句话确认待 owner（见下）
---

# MUSH-GOAL-004：M4 dogfood 首个 live loop

## 前置条件（owner 侧动作，非 mush 可自理）

- **DeepSeek 犬可用**：目标环境有 `DEEPSEEK_API_KEY`（GOAL-003 实测 MISSING_CREDENTIAL）；
- **Claude 犬可用**：目标环境 claude 已 `/login`（GOAL-003 实测未登录）。

两者均为凭据操作（门 5），mush 不代做。任一就绪后：先重跑 GOAL-003 的
真实 dispatch 闭环（approval 已在仓，无需再确认），再进本 Goal。

## 任务

1. **live loop 首任务**：RM-001 给了两个候选——(a) M5 看板开发启动，(b) M3 剩余
   适配器接入（zcode 预探测已就绪，docs/capability-probes/）。按 D6 需 owner
   一句话选定首任务；未选定时，**不花钱的准备工作**（loop 骨架、事件链、审核
   门测试）先行不阻塞。
2. **半自动调度全流程首次真实走通**：扫描→推荐→owner 一句话确认→loop
   （派发→执行→回报→头犬机检审核→验收）→完整事件链留痕。
3. **nonce 实测身份覆盖**：真跑通的犬以 dispatch nonce 实测 `model_id`
   （GOAL-003 的配置级 model_id 仅为占位，需运行时证明）。
4. **头犬/执行犬对调一次**（跨模型路由首验，D5/随附默认项）。
5. 触发门在轻量模式下被真实触发并正确弹审批至少一次（RM DoD 要求；预算门
   最容易自然触发——如需人为构造小额预算场景，先写测试再真实触发）。

## 分批纪律（沿用 002/003 惯例）

小步 TDD；path-limited commit；每批 BATCH-NN 回报；既有 158 tests 保持全绿；
push origin master 常规同步（失败不阻塞）；D15 验收语义。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 只读；零依赖不变；
- 不碰凭据（门 5：缺 DEEPSEEK_API_KEY / claude 未登录一律记 BLOCKED_ENV，
  不代登录、不代设密钥）；
- per-actor cap $5；真实花钱动作前核对 approval 记录在案；
- 五触发门照常生效。

## DoD

- 一次完整 live loop 闭环（派发→执行→回报→审核→验收）事件链可回放；
- 两犬（或对调后配置）nonce 实测身份在案；
- 对调实验完成并留事件链；
- 至少一次真实触发门弹审批记录；
- 完成回报 `goals/receipts/GOAL-004-completion.json`（D15 语义）。
