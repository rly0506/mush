# 派发包 rm003-p14 — DeepSeek/dsh 执行 GOAL-013（犬力批）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。
与 kimi 的 rm003-p12/p13 并行（F-45 worktree 隔离）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律）→ `CONSTITUTION.md` → `docs/rm-003-conversation.md` M3
2. `goals/GOAL-013-dog-capabilities.md`
3. `src/adapters/contract.ts`（variants/model_flag 已有；本批扩 effort_levels
   与 profile）+ `src/web/dispatch.ts`（参数区）+ `runtime/capability-registry.json`

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-b -b g013`；提交落 g013 分支。
**禁改 page.ts / chat.ts / server.ts 聊天与静态资产路由**（kimi 在途）。

## 单元（严格按序）

### U1 dsh preset（GP-21）

- dispatch 增 `profile` 字段：校验 fail-closed——仅允许
  `~/.dsh/profiles/` 下实际存在的目录名（探测一次缓存；不存在=400）；
  注入 `--profile <name>` 替换合同默认；契约 v1.4 增补（可选字段）。
- 这也是 deepseek 模型切换的实操路径（owner 可建 headless-pro 等
  profile 切 flash/pro），在 BATCH 回执中说明该用法。

### U2 按模型 effort 档位（GP-22）

- 合同增 `effort_levels: string[]` + `effort_injection: {kind:'flag'|'env'|'none', name?:string}`；
- 从官方文档/CLI help 核对各 harness 真实档位并落注释（证据：help 输出
  或文档摘录记入回执）：dsh headless（无档→none+单档占位）、claude
  （思考开关/thinking 档）、codex（--config reasoning.effort 五档类）、
  kimi（thinking effort low/medium/high——本仓 config 实证）、zcode UNKNOWN；
- dispatch 校验 effort ∈ effort_levels（违反=400）；**不实现各通道注入
  逻辑**（M3+ 按通道逐个接），仅合同与校验层。

### U3 kimi 入册（GP-04 余项）

- `src/adapters/kimi.ts`：`kimi -p` T1 合同（prompt_transport=argument，
  effort 注入 none 占位）+ roster/knownContracts 注册（role=executor）；
- nonce 注册（真实有界一次）：经看板 API dispatch kimi（approval 见
  `dispatch-approvals/kimi-code.approved.json`，owner 2026-08-17 使用授权
  惯例）；证据落 dispatch-events/kimi-real-002.json；渠道异常记 finding 停。

### U4 派发重跑（GP-10 部分）

- `POST /api/dispatch/:id/rerun` → 读历史记录，克隆 prompt/adapter/
  model_id/effort/workspace/timeout（**不含** amount_usd 虚报风险字段，
  按当前默认），生成新 dispatch；契约 v1.4；仅 dry-run + real 两档照常走
  approval 门。

## 纪律与验收（DoD）

- 268+ tests 全绿（含新增：profile 校验/effort 校验/kimi 合同/rerun 端点
  各测试）；
- kimi nonce 一次真实结果落盘（PASS 或诚实 BLOCKED/FAIL）；
- 契约文档 v1.4 同步（全部向后兼容可选字段）；
- path-limited commit（G13-*）；每批 BATCH-NN 回执；D15 语义；
  转义铁律（复杂逻辑落脚本文件）。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-013-completion.json` 落盘。
