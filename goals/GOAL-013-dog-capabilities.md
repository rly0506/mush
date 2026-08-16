---
goal_id: MUSH-GOAL-013
status: AUTO_ACCEPTED（D15，2026-08-17；kimi 经头犬复核转 READY，AD-30）
mode: LIGHT
rm: RM-003 / M3 犬力批
executor_model_profile: deepseek-dsh（后端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D24（A+B 组合）
---

# MUSH-GOAL-013：犬力批——preset / effort 档位 / kimi 入册

## 任务（详见 docs/rm-003-conversation.md M3）

1. **dsh preset**（GP-21）：dispatch 增 `profile` 字段（校验：仅允许
   ~/.dsh/profiles 下存在者，fail-closed）+ 注入 --profile；UI 预设下拉；
2. **按模型 effort 档**（GP-22）：AdapterContract 增 `effort_levels` +
   `effort_injection`（flag/env/none）；从官方文档核对各 harness 真实档位
   （GPT 五档、claude thinking 开关、dsh N/A 等），替换硬编码
   LOW/HIGH/XHIGH；UI 按犬渲染；
3. **kimi 入册**（GP-04 余项）：src/adapters/kimi.ts（`kimi -p` T1）+
   nonce 注册（预授权沿用 D22 惯例：一次有界）。

## 边界

只写 D:\mush（F-45 worktree）；零依赖；kimi 凭据自理（cc-switch/botcf，
adapter 只调 executable）；255+ tests 保持全绿。
