---
goal_id: MUSH-GOAL-014
- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；M0 carve-out 机制在库（runtime/carveouts.jsonl + owner 授权通道），专测 tests/g014a-*.test.ts 当前全量通过；目标池 GP-13/GP-14 已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
mode: LIGHT
rm: RM-004 / M0
executor_model_profile: deepseek-dsh（后端写面校验）+ kimi-code（前端登记 UX，可选同步批）
per_actor_budget_usd: 5
created: 2026-08-18
owner_decision: D25（RM-004 立项）；2026-08-18 owner 授权 M0 开始
depends_on: GP-14（隔离区 quarantine，可后置——M0 先做 carve-out 核心机制，隔离区作为可疑产物裁决的后续增强）
source: docs/goal-pool.md GP-24 + docs/rm-004-realwork-streaming.md M0 段
---

# MUSH-GOAL-014 / M0：意向项目 carve-out（安全前置）

## 背景

意向项目 `D:\意向项目` 是冻结的黄金参照（agent-bridge），AGENTS 硬红线规定整树只读。
RM-004 M1 旗舰任务要在意向项目动真实文件（RM-055-RF-A 修复），必须先有 carve-out
机制把"整树只读"细化为"默认只读 + owner 圈定可写范围"。**M0 是 M1 的安全底座。**

## DoD

1. **carve-out 数据模型**：在 `runtime/` 或 `.mush/` 下维护一份"当前激活 carve-out"
   记录（append-only，带 owner 授权时间 + 任务切片描述 + 路径白名单 + 过期时间）；
   - 字段：`carveout_id / owner_grant_utc / task_ref（goal+packet） / paths[] /
     expires_at / status（ACTIVE|EXPIRED|REVOKED）`；
   - `.agent-bridge/` 整树**永久 deny**，不可被任何 carve-out 覆盖（黄金参照底线）；
   - 同一时刻最多一份 ACTIVE carve-out（单切片授权语义，对齐"一次人类授权一个切片"）。
2. **dispatch 写面校验收紧**（声明式 + 事后 diff 审核，非运行时拦截）：
   - dispatch 派发时携带 `carveout_id`，犬的 `cwd` 设为 carve-out 指定的工作根
     （mush 仓内 worktree **或** 仓外路径——M1 旗舰要在意向项目 `D:/意向项目` 仓内工作，
     carve-out 白名单用绝对路径声明，如 `D:/意向项目/backend/cli.py`）；
   - `.agent-bridge/` 整树（任意仓）**永久 deny**，carve-out 不可覆盖；
   - 犬产出后头犬做 diff 审核：犬产物文件路径 vs carve-out 白名单，超范围 = 红线违反
     （记入事件链，触发宪法 §2 审计）；
   - 运行时强拦截（hook 犬的文件系统写）留给 GP-14 隔离区后续增强。
3. **owner 授权通道**：新增 `POST /api/carveout/grant`（仅 loopback，需 owner
   显式触发；建议加最小握手——调用者须携带一个本机生成的一次性 token，token
   文件存 `.mush/carveout-token`，权限 0600，每次 grant 旋转）；收回 `POST /api/carveout/revoke`。
4. **前端登记 UX（kimi，可同步批）**：意向项目登记从"一刀切拒绝"改为
   "警示（红底黄字说明黄金参照风险）+ owner 确认 carve-out 圈定范围"流程；
   活跃 carve-out 在看板顶部条带显示（路径+任务+剩余有效），过期自动消失。
5. **测试**：359+ tests 全绿（新增 ≥6：未授权写拒/黄金参照拒/范围内放行/
   过期失效/撤销生效/多切片拒绝）；脚本化冒烟（真实路径写面校验）。
6. **契约**：api-contract.md v1.10（carve-out grant/revoke + 写面校验语义）。

## 边界

- F-45 worktree；零依赖；禁改审批段（GP-32 面）；五触发门照常；
- 不修改 `D:\意向项目` 任何文件（M0 只做**机制**，不动意向项目内容——
  真实写文件是 M1 的事，且必须先有 ACTIVE carve-out）；
- 意向项目路径用运行时探测（不硬编码绝对路径，`[Environment]::GetFolderPath`
  或配置项——避免不同机器路径差异）。

## 派发提示词（owner 投喂 deepseek）

见 `docs/dispatch/rm004-p14a-deepseek-carveout.md`（M0 后端：carve-out 数据模型 + 写面校验 + owner 授权通道 + 测试 + 契约 v1.10）。前端登记 UX（kimi）等 021B 完成后同步批。
