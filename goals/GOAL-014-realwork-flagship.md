---
goal_id: MUSH-GOAL-014 / M1
status: QUEUED（待 owner 切片定义旗舰任务范围；2026-08-18 owner 授权）
mode: LIGHT
rm: RM-004 / M1 实战运营
executor_model_profile: deepseek-dsh（旗舰执行）+ 头犬 zcode（diff 级审核 + 编排）
per_actor_budget_usd: 10（旗舰任务可能多轮，预算放宽）
created: 2026-08-18
owner_decision: D25 + 2026-08-18 授权
depends_on: M0 carve-out 必须先落地（否则写不进意向项目）
source: docs/rm-004-realwork-streaming.md M1 段
---

# MUSH-GOAL-014 / M1：实战运营（意向项目旗舰任务）

## 背景

M1 是 mush "干真活" 的里程碑：意向项目真实产品任务经池全程流转。
首旗舰是意向项目 **RM-055-RF-A**（回环探活传输修复，已有 RF-C 诊断报告铺路）。
按对方治理"一次人类授权一个切片"，范围 owner 圈定。

## 前置

- **M0 carve-out 已落地**（否则 dispatch 写面会拒绝意向项目路径）；
- owner 明确首旗舰切片范围（哪些文件/目录可写、修复目标、验收标准）；
- 头犬 diff 级审核能力就位（衔接 GP-06，至少 exit 机检 + 关键路径人工 diff）。

## DoD

1. 旗舰任务切片由 owner 在派发提示词里显式圈定（路径白名单 + 修复目标 +
   验收口径），头犬据此建 ACTIVE carve-out 记录；
2. **至少 2 个真实任务**交付（首旗舰 RM-055-RF-A + 至少 1 个后续），
   每个任务：看板指派 → deepseek 执行 → 头犬 diff 审核 → owner 验收 →
   事件链留痕（dispatch_id ↔ carveout_id ↔ 提交哈希）；
3. 事件链可回放（任一任务从指派到验收的完整轨迹可查）；
4. 红线零违反（carve-out 范围外写一律被拒并记入事件链）；
5. 头犬审核产出：每个任务一份 diff 级审核意见（含红线/契约/证据纪律核查），
   衔接 GP-06 升级路径。

## owner 需提供（切片定义，M1 启动前）

- 首旗舰 RM-055-RF-A 的**具体路径白名单**（哪些文件可写）；
- 修复目标与验收口径（什么算修好）；
- 是否允许 deepseek 直接 push 到意向项目分支，还是产出 patch 由 owner 手动应用；
- 后续第 2 个任务的方向（可选，M1 进行中再定）。

## 派发提示词

`docs/dispatch/rm004-m1a-deepseek-flagship.md`（已就位，M0 落地 + owner 创建 ACTIVE carve-out 后派发）。

## 切片定义（owner 2026-08-18 确认）

- **白名单**：`D:/意向项目/backend/cli.py` + `D:/意向项目/backend/tests/test_coverage_observation_cli.py`（2 文件；`test_rss_collector.py` 仅验证，如需修改再扩）
- **执行策略**：deepseek 在意向项目仓内 `rf-a` 分支工作，产 `git format-patch` 交 owner 手动应用，不直接 push 意向项目
- **carve-out 时效**：24h
- **验收**：计划 §3 四个 checkbox + Exit 条件 + pytest 全绿

## 备注

M1 是 RM-004 的核心价值证明（mush 能干真活）。carve-out 是安全底座，
diff 级审核是质量底座，事件链留痕是合规底座。三者齐备才算 M1 收官。
