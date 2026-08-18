# 派发包 rm004-p14a — Deepseek 执行 GOAL-014 M0 carve-out（后端）

你是 mush 项目的后端执行者（deepseek-dsh）。完整任务包。

## 第一步：按序读取（worktree 内）

1. `AGENTS.md` — 项目层指引（硬红线/工作约定/当前状态）
2. `goals/GOAL-014-realwork-carveout.md` — M0 章程（DoD + 边界）
3. `src/web/dispatch.ts` — 现有 dispatch 写面（理解现有校验钩子）
4. `src/web/api-contract.md` v1.9 — 现有契约（carve-out 段新增 v1.10）
5. `src/web/server.ts` — 路由注册点

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-g -b g014a`（基于当前 master b0eeb98）。
本包只做后端 carve-out 机制，前端登记 UX（kimi）后续同步批。

## 任务（详见章程 DoD）

1. **carve-out 数据模型**：`runtime/carveouts.jsonl`（append-only）记录：
   `carveout_id / owner_grant_utc / task_ref / paths[]（绝对路径）/ 
   expires_at / status(ACTIVE|EXPIRED|REVOKED)`；同时刻最多 1 份 ACTIVE；
   `.agent-bridge/` 整树任意仓永久 deny，carve-out 不可覆盖。
2. **owner 授权通道**：
   - `POST /api/carveout/grant`（loopback only）—— 创建 ACTIVE carve-out，
     要求一次性 token（文件 `.mush/carveout-token`，权限 0600，每次 grant 旋转）；
   - `POST /api/carveout/revoke`（loopback + token）—— 置 REVOKED；
   - `GET /api/carveout/active` —— 返回当前 ACTIVE 或空（前端顶部条带用）。
3. **dispatch 写面校验（声明式）**：
   - dispatch 派发时可选携带 `carveout_id` + `cwd`（cwd 须在 carve-out 白名单根下）；
   - 携带 carveout_id 时，dispatch 记录里记 carveout_id + 白名单快照（事件链留痕）；
   - 不做运行时文件写拦截（留给 GP-14）；事后头犬 diff 审核犬产物 vs 白名单。
4. **契约 v1.10**：api-contract.md 升 v1.10，新增 carve-out grant/revoke/active + 
   dispatch 携带 carveout_id/cwd 语义。
5. **测试 ≥6**：未授权写路径拒绝场景（事后 diff 审核路径超范围标记红线）/
   .agent-bridge 路径永久 deny / ACTIVE 范围内放行 / 过期失效 / 撤销生效 / 
   多切片拒绝（同时刻仅 1 份 ACTIVE）/ token 旋转校验。

## 纪律与验收

- 359+ tests 全绿（新增 ≥6；web-page-parse 不涉及本批后端，但别破）；
- path-limited commit（G14A-*）；
- 批次回执 BATCH-48-ds（避免与 021A 的 46-ds、021B 的 47-kimi 冲突）；
- DEF-07 模板正则双写（carve-out 路径匹配正则要双反斜杠）；
- D30 审批段不改；M0 只做机制，不动意向项目任何文件；
- 意向项目路径用配置项或运行时探测（不硬编码绝对路径）；
- D15 机检全绿后停 owner 显式接受；终止：DoD 全满足 + 
   `goals/receipts/GOAL-014A-completion.json` 落盘。

## 关键提示

- M0 是 M1 旗舰的安全底座——M1 要在意向项目仓内工作，必须先有 ACTIVE carve-out；
- 声明式校验（事后 diff 审核）是 M0 的务实选择，运行时强拦截留给 GP-14 隔离区；
- owner 授权通道的 token 机制是最小握手，防止本机任意进程调 grant API；
- 前端登记 UX（kimi）会消费 `GET /api/carveout/active` 渲染顶部条带，后端 API 要稳定。
