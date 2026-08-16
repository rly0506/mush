# 派发包 rm004-p17a — DeepSeek/dsh 执行 GOAL-017A（调度自由·后端）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。
与 kimi 的 rm004-p17b 并行（F-45 worktree）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律）→ `CONSTITUTION.md` → `docs/rm-004-realwork-streaming.md` M4
2. `src/web/dispatch.ts`（knownContracts/roster/chat 参数区）、
   `src/adapters/zcode.ts`、`runtime/capability-registry.json`
3. 证据：`goals/receipts/dispatch-events/zcode-real-002.json`（headless PASS）、
   `codex-real-002.json`（F-50 FAIL）

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-c -b g017a`；提交落该分支。
**禁改 page.ts**（kimi 在途）。

## 单元（严格按序）

### U1 适配器注册表 CRUD

- `runtime/adapters.json`（schema v1）：用户级合同覆盖层，叠加在
  baseContracts 之上（同 adapter_id 覆盖，新增 id 追加）；
- API：`GET /api/adapters`（合并视图=base+override+标记 origin）、
  `POST /api/adapters`（选基础模板 dsh/claude/codex/kimi/opencode/zcode
  + adapter_id + 可选通道参数；模板外字段 fail-closed）、
  `DELETE /api/adapters/:id`（软删：`"removed":true`，roster 隐藏，
  历史派发不受影响）；
- roster/knownContracts 读合并层。

### U2 头犬即角色（role 与 harness 解耦）

- `chat.post` 的 `adapter_id` 放开为**任意 roster 在册且 verified 的
  harness**（registry `verified:true` 或合同白名单：deepseek-dsh/
  claude-code/kimi-code/zcode）；头犬语义 = 章程注入叠加，不限于
  `head-dog` 专属适配器（保留兼容：head-dog 继续可用=deepseek 别名）；
- **codex 因 F-50 保持 UNVERIFIED，禁入头犬名单**（接口层拒绝+原因返回）；
- zcode 合同修正（据 zcode-real-002 实证）：去掉 `--json`（0.16.3 无效）
  与 `--max-turns`（与位置参数冲突），prompt_transport=argument 裸传；
  registry 中 zcode 标 verified:true（证据路径写入）。

### U3 预算 cap 持久化

- `runtime/budget-caps.json`：per-actor cap（初始默认 5）；
- `GET /api/budget/caps`、`PUT /api/budget/caps/:actor`（数值>0 校验；
  改动追加台账一行 kind=CAP_CHANGE 留痕）；budgetProjection 读它。

### U4 预算计数语义

- projection 每Actor 增 `admission_count`（含 dry-run）与 `entries`
  最近 N 条已存在——补齐 `spent_usd` 语义注释（仅 real 且 amount>0
  计入 spent；dry-run 只进 count），SSE dispatch 帧已推 → 前端可实时。

## 纪律与验收（DoD）

- 294+ tests 全绿（新增：adapters CRUD 合并/覆盖/软删、chat 任意
  verified harness + codex 拒绝、zcode 合同、caps PUT/留痕、projection
  计数）；
- 契约 v1.5 同步（全向后兼容）；
- path-limited commit（G17A-*）；每批 BATCH-NN 回执；D15 语义；转义铁律。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-017A-completion.json` 落盘。
