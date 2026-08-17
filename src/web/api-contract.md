# mush Board API 契约 v1

- 状态：`v1.6`（2026-08-17 定稿 v1；v1.1 GOAL-007B；v1.2 GP-02；v1.3 GOAL-011 聊天节；v1.3.1 GOAL-012B chat 参数化+reply；v1.4 GOAL-013 profile/effort 合同/rerun **及** GOAL-013L 静态品牌资产路由；v1.5 GOAL-017A 适配器 CRUD/头犬解耦/budget caps/计数；v1.6 GOAL-018 work-stream/真续跑/换窗/HANDOFF/流 API——本文件为权威源）
- 宿主：`src/web/`（node:http，零依赖）；默认只绑 `127.0.0.1`（对外暴露 = 触发门 4，不实现）
- 序列化：JSON（UTF-8，LF 结尾）；SSE 用 `text/event-stream`，帧格式 `data: <json>\n\n`
- 错误约定：失败响应一律 `{ "ok": false, "error": "<human-readable>" }`
- 版本演进：v1 字段**只能向后兼容新增**；删除/改义/改型 = 破坏性变更，需头犬批准并同步 GOAL-007

### v1.8 逐单审批（GP-32 / D30，2026-08-17；v1.7 号段留给在途任务池包 p19a）

- **废除常设放行**：`<adapter>.approved.json` 不再参与 real 派发放行（D30）；
- real 派发无令牌 → `BLOCKED_WAITING_OWNER` + **自动生成审批请求文件**
  `goals/receipts/approval-requests/dispatch-<id>.json`（kind=dispatch，含
  犬只/effort/timeout/workspace/cap/已花/完整 prompt 报备）；回放时对缺
  失请求文件的旧被拦卡自动补建；
- `POST /api/approvals/respond` 对派发类请求联动：
  - `APPROVED` → 写单次令牌（`runtime/approval-tokens/`，**读即焚**）+
    自动 `rerun(approved_via)`；原单折算 `SUPERSEDED`，新派发为执行单；
  - `REJECTED` → 原单折算 `REJECTED`；
- 新增终态 `REJECTED` / `SUPERSEDED`（TERMINAL 集合与前端状态图同步）；
- 快照 `approvals[]` 条目对派发类请求新增 `dispatch` 报备块
  （prompt 服务端截 1200 字）；前端：审批弹窗渲染报备面板，被拦派发卡
  带「去审批」按钮；
- **owner 亲启通道**：ChatService 内部调用携带 `originOwner`（owner 敲字
  即批准，不设卡）；公开 `POST /api/dispatch` 不接受该语义，代理发起的
  real 派发一律停卡。

### v1.5 向后兼容扩展（GOAL-017A，2026-08-17）

- 新增适配器注册表 CRUD：
  - `GET /api/adapters`：合并视图（base + 用户覆盖 + origin 标记 + verified）；
  - `POST /api/adapters`：基于基础模板（dsh/claude/codex/kimi/opencode/zcode）
    创建或覆盖用户适配器；模板外字段 fail-closed；
  - `DELETE /api/adapters/:id`：软删（`removed:true`，roster 隐藏，历史派发不受影响）。
- roster / knownContracts 读合并层；roster 条目新增 `verified: boolean`。
- 头犬解耦：`POST /api/chat` 的 `adapter_id` 放开为**任意 roster 在册且
  verified 的 harness**（registry `verified:true` 或合同白名单
  deepseek-dsh/claude-code/kimi-code/zcode/head-dog）；codex 因 F-50 保持
  UNVERIFIED，接口层拒绝并返回原因；`head-dog` 继续可用（deepseek 别名）。
- 新增 `runtime/budget-caps.json`：per-actor cap（初始默认 5）；
  `GET /api/budget/caps`、`PUT /api/budget/caps/:actor`；改动追加台账一行
  `kind=CAP_CHANGE` 留痕。
- `GET /api/budget` 的每个 actor 新增 `admission_count`（含 dry-run）；
  `spent_usd` 语义明确：仅 real 且 `amount_usd > 0` 计入；dry-run 只进 count。

### v1.6 向后兼容扩展（GOAL-018，2026-08-17）

- 新增 work-stream 模型：`runtime/streams.jsonl`（append-only）；
  `POST /api/dispatch` 新增可选 `stream_id` / `goal_id` / `new_stream`；
  默认自动归流（窗口键 = 犬×Goal）；`new_stream:true` 强制新开。
- 同流真续跑：kimi `-r`、claude `--resume`、zcode `--resume` 自动携带上次
  session_id；codex 因 F-50 跳过。
- 适配器合同新增 `context_management`（`auto-compact` / `none` / `unknown`）；
  dsh 无压缩档按 >75% 估算阈值自动换窗；dsh 窗口内 prompt 使用固定章程头 +
  流历史 + 新指令尾。
- HANDOFF：换窗/关流时提示模板；终态输出含 `HANDOFF-BEGIN…HANDOFF-END`
  自动解析归档；同流新窗/换犬新窗自动注入最近交接块；外部可经
  `POST /api/streams/:id/handoff` 补写。
- 新增流 API：`GET /api/streams`（列表+统计）、`GET /api/streams/:id`
  （时间线含交接块）、`POST /api/streams/:id/handoff`（外部交接兜底）。
- 派发 prompt 自动附加工作区 `AGENTS.md`（项目层简报，超长截断）。


### v1.4 向后兼容扩展（GOAL-013，2026-08-17）

- `POST /api/dispatch` 新增可选 `profile` 字段：dsh preset 名，仅允许
  `~/.dsh/profiles/<name>` 实际存在的目录；校验 fail-closed（不存在/越界=400），
  注入 `--profile <name>` 替换合同默认；
- 适配器合同新增 `effort_levels`（该通道真实 effort 档位）与 `effort_injection`
  （`{kind:'flag'|'env'|'none', name?}`）。`POST /api/dispatch` 的 `effort` 必须
  属于所选合同的 `effort_levels`（旧三档仅作为未声明合同的兼容回退）；
- 新增端点 `POST /api/dispatch/:id/rerun`：读历史记录，克隆
  prompt/adapter/model_id/effort/workspace/timeout（不含 `amount_usd` 虚报风险
  字段，按当前默认），生成新 dispatch；`real` 可经 body 覆盖，仍走既有 approval 门；
- `GET /api/dispatch/:id` 的 `dispatch` 新增可选 `request` 快照字段
  （rerun 数据源；旧记录缺省无此字段）。
- 新增静态品牌资产路由 `GET /assets/brands/:name.svg`（GOAL-013L）。

### v1.3 向后兼容扩展（GOAL-011，2026-08-17）

- 新增聊天 API：`POST /api/chat`、`GET /api/chat/history`；
- roster 条目新增 `role: "head" | "executor"`。

### v1.2 向后兼容扩展（GP-02，2026-08-17）

- 新增端点 `POST /api/workspaces/create`：body `{path}`（必须绝对路径）→
  `mkdirSync(recursive)` + 记入 known-workspaces + `201 { ok, workspace: WorkspaceInfo }`；
  已存在 `409`，非绝对路径/空 path `400`；不提供 git init；
- `GET /api/workspaces` 条目路径统一为 `path.resolve` 归一形态并去重（F-39：
  同路径正/反斜杠双条目消除）。

### v1.1 向后兼容扩展（GOAL-007B，2026-08-17）

- `GET /api/dispatch/:id` 的 `dispatch` 新增 `stdout_tail` / `stderr_tail`：
  `{ text: string, truncated: boolean } | null`（REPORT 前为 null；stdout 末 2048 字符、stderr 末 256 字符，超长截断并 `truncated: true`；只读补充字段，不改管线语义）；
- `GET /api/workspaces` 的条目新增 `selected: boolean`（当前选中 workspace 标记，缺省 false）。

## 端点总览

| 方法/路径 | 作用 | v1 状态 |
| --- | --- | --- |
| `GET /` | 看板页面（HTML） | 既有 |
| `GET /api/snapshot` | 只读快照（事件链/审批/最近派发） | 既有，v1 扩展 dispatches |
| `POST /api/events` | 追加 bridge 事件（schema v2 校验） | 既有 |
| `GET /api/stream` | SSE：事件、审批、派发生命周期 | 既有，v1 新增 dispatch 类型 |
| `POST /api/approvals/respond` | owner 审批应答（append-only） | 既有 |
| `POST /api/dispatch` | **新**：派发（dry-run 默认 / real 走 approval） | v1 |
| `POST /api/dispatch/:id/rerun` | **新**：克隆历史派发并重跑 | v1.4 |
| `GET /api/dispatch/:id` | **新**：派发状态与事件 | v1 |
| `GET /api/workspaces` | **新**：workspace 列表/校验 | v1 |
| `POST /api/workspaces/select` | **新**：持久化当前 workspace | v1 |
| `POST /api/workspaces/create` | **新**：登记新 workspace | v1.2 |
| `GET /api/budget` | **新**：USD 台账投影 | v1 |
| `GET /api/budget/caps` | **新**：per-actor cap 表 | v1.5 |
| `PUT /api/budget/caps/:actor` | **新**：更新 per-actor cap（留痕） | v1.5 |
| `GET /api/adapters` | **新**：适配器合并视图 | v1.5 |
| `POST /api/adapters` | **新**：创建/覆盖用户适配器 | v1.5 |
| `DELETE /api/adapters/:id` | **新**：软删适配器 | v1.5 |
| `GET /api/streams` | **新**：work-stream 列表+统计 | v1.6 |
| `GET /api/streams/:id` | **新**：单流时间线（含交接块） | v1.6 |
| `POST /api/streams/:id/handoff` | **新**：外部补写 HANDOFF 交接 | v1.6 |
| `GET /assets/brands/:name.svg` | **新**：品牌图标静态资产 | v1.4 |

## POST /api/dispatch

请求：

```json
{
  "adapter_id": "fake-t1 | deepseek-dsh | claude-code | zcode | codex | opencode | kimi-code | <user-adapter>",
  "prompt": "string (1..64000)",
  "workspace": "string? (缺省=已选 workspace 或服务 cwd)",
  "effort": "string?（缺省 LOW；必须属于所选合同 effort_levels；未声明合同回退 LOW|HIGH|XHIGH）",
  "profile": "string?（v1.4：dsh preset 目录名；仅 ~/.dsh/profiles 下存在者）",
  "model_id": "string?（G009：必须属于所选合同 variants）",
  "stream_id": "string?（v1.6：指定 work-stream；缺省按犬×Goal 自动归流）",
  "goal_id": "string?（v1.6：Goal 关联；窗口键组成部分）",
  "new_stream": "boolean?（v1.6：true 强制新开流）",
  "cap_usd": "number?（缺省=该 actor 的 budget-caps 值或 5；>0）",
  "amount_usd": "number?（缺省 0=估算后记账）",
  "real": "boolean?（缺省 false=dry-run）"
}
```

响应（按状态码）：

- `202`：已受理（dry-run 或 real 已执行/后台执行）
  `{ "ok": true, "dispatch_id": "<32hex>", "status": "ADMITTED | DRY_RUN | BLOCKED_WAITING_OWNER", "admission": { "decision": "ADMITTED|DENIED", "remaining_usd": number } }`
- `400`：schema fail-closed（字段缺失/类型错/adapter 未知/workspace 不存在或越界/
  profile 不存在/effort 不在合同档位）
- `402`：超预算门（admission DENIED；事件仍入台账）
- `500`：runner 内部错误（回执已落盘，status FAIL）

## POST /api/dispatch/:id/rerun（v1.4）

请求 body 可选：

```json
{
  "real": "boolean?（缺省=原派发的 real；仍走 approval 门）",
  "cap_usd": "number?（缺省=原派发 cap_usd）"
}
```

- 语义：读取历史派发记录中的 `request` 快照，克隆
  `prompt/adapter_id/model_id/effort/workspace/timeout_s/profile`，生成新派发；
  `amount_usd` 不克隆（按当前默认 0 记账）；
- 响应与 `POST /api/dispatch` 相同（202/400/402/500）；原派发不存在 → `404`；
  旧记录无 `request` 快照 → `400`。

## GET /api/streams（v1.6）

`{ "ok": true, "streams": [ { "stream_id", "key", "title", "goal_id"?, "adapter_id", "status", "created_at_utc", "updated_at_utc", "events": [...], "handoffs": [...] } ] }`
- 每流含派发事件、会话链、上下文估算、交接块；排序按创建时间。

## GET /api/streams/:id（v1.6）

`{ "ok": true, "stream": WorkStream }`
- 时间线含 `events[]` 与 `handoffs[]`；不存在 → `404`。

## POST /api/streams/:id/handoff（v1.6）

请求 `{ "done"?, "decided"?, "files"?, "next"?, "open_issues"? }`
- 语义：头犬/owner 在犬暴毙无终态时外部补写 HANDOFF；append-only 归档并哈希锚点；
- 响应 `201`：`{ "ok": true, "handoff": HandoffBlock }`；流不存在 → `404`。


## GET /api/dispatch/:id

`{ "ok": true, "dispatch": { "dispatch_id", "status", "adapter_id", "receipt_path", "events": [ {kind, at_utc, payload} ], "stdout_tail"?, "stderr_tail"?, "request"? } }`
不存在 → `404`。（`stdout_tail`/`stderr_tail` 为 v1.1 新增；`request` 为 v1.4 新增。）

## GET /api/adapters（v1.5）

`{ "ok": true, "adapters": [ { "adapter_id", "protocol", "expected_provider", "expected_model_id", "role", "origin": "base|user|user-override", "verified": boolean, "template"?, "variants"?, "model_flag"?, "effort_levels"?, "effort_injection"? } ] }`
- 合并视图 = 基础合同 + 用户覆盖（`runtime/adapters.json`）；软删条目不出现；
- `fake-t1` 不进生产视图（与 roster 同规则）。

## POST /api/adapters（v1.5）

请求：

```json
{
  "template": "dsh | claude | codex | kimi | opencode | zcode",
  "adapter_id": "string (^[A-Za-z0-9._-]+$)",
  "params": {
    "profile": "string?（仅 dsh）",
    "model_id": "string?（claude/codex/kimi/opencode/zcode）"
  }
}
```

- 创建/覆盖用户适配器；模板外字段 fail-closed → `400`；
- 响应 `201`：`{ "ok": true, "adapter": AdapterView }`。

## DELETE /api/adapters/:id（v1.5）

- 软删：写 `removed:true`，roster 隐藏，历史派发不受影响；
- 成功 `200`：`{ "ok": true, "adapter_id": id, "removed": true }`；
- 不存在/已软删 → `404`。

## GET /api/workspaces

`{ "ok": true, "workspaces": [ { "path", "is_git": bool, "mush_managed": bool, "selected": bool } ] }`
- 输入为最近用过的候选列表（持久化文件 + 内建默认）；不存在/不可读目录直接不入列表。
- 路径穿越（`..` 逃逸候选根）fail-closed，不返回。
- `selected` 为 v1.1 新增（当前选中项 true，其余 false）。

## POST /api/workspaces/select

请求 `{ "path": "/abs/path" }` → `201 { "ok": true, "selected": path }`
- 路径必须存在且为目录；否则 `400`。
- 持久化到 `<workspace>/.mush/workspace.json`（BOM-free JSON；写入前目录校验）。

## POST /api/workspaces/create（v1.2）

请求 `{ "path": "D:/abs/path" }`（必须绝对路径）→ `201 { "ok": true, "workspace": WorkspaceInfo }`
- 目录不存在时 `mkdirSync(recursive)` 创建并记入 known-workspaces（登记 = 入 F-41 白名单）；
- 已存在 → `409`；非绝对路径/空 path → `400`；不提供 git init；
- 意向项目子树的前端提示层（黄金参照冻结区）在 page.ts；后端硬拦截属 GP-14。

## GET /api/budget

`{ "ok": true, "actors": [ { "actor_id", "spent_usd", "cap_usd", "admission_count", "entries": [ {at_utc, decision, amount_usd, remaining_usd, meta} ] } ] }`
- 投影源：`runtime/budget-ledger.jsonl`（append-only，每行一条 admission/spend 事件，
  与 `src/core/budget.ts` UsdBudgetLedger 同构）；
- `cap_usd` 来自 `runtime/budget-caps.json`，缺省 5；
- `spent_usd` 仅统计 real 且 `amount_usd > 0` 的 ADMITTED 事件；dry-run 只进
  `admission_count`，不计 spent；
- `admission_count` 含 dry-run 与 real 的 admission 事件（不含 `CAP_CHANGE` 留痕）。

## GET /api/budget/caps（v1.5）

`{ "ok": true, "caps": { "<actor>": number } }`
- 缺省未落盘的 actor 按 5 计，不在此表。

## PUT /api/budget/caps/:actor（v1.5）

请求 `{ "cap_usd": number }` → `200 { "ok": true, "actor_id": actor, "cap_usd": number }`
- `cap_usd` 必须 >0；改动持久化到 `runtime/budget-caps.json`，并追加台账一行
  `kind=CAP_CHANGE` 留痕。

## GET /api/snapshot（v1 扩展）

既有字段不变，新增 `"dispatches": [ 最近 20 条 {dispatch_id, adapter_id, status, at_utc, receipt_path} ]`。

## SSE 事件类型（`GET /api/stream`）

| kind | payload | 触发 |
| --- | --- | --- |
| `event` | bridge event entry（sequence/sha256/event） | POST /api/events |
| `approval` | {request_file, decision} | owner 应答 |
| `dispatch` | {dispatch_id, phase, status, adapter_id, receipt_path?, error?} | 派发生命周期 |
| `loop` | {run_id, sequence, from, to, sha256} | loop 状态机迁移（G006 接线后） |

`dispatch` 生命周期 phase 顺序：`ADMISSION → EXECUTE → REPORT → REVIEW`；终态
status ∈ `DRY_RUN | ADMITTED | BLOCKED_WAITING_OWNER | BLOCKED_ENV | FAIL | PASS`。

## 聊天 API（v1.3，GOAL-011 M1 新增；v1.3.1 见下；v1.5 头犬解耦）

### POST /api/chat

请求（v1.3.1 + v1.5）：`{ "message": "string (1..64000)", "resume": "session_id?",
"adapter_id": "string?", "effort": "string?" }`
- 语义：把 message 作为 owner 消息派发给头犬（章程注入 + 会话续跑）；
  聊天即真实执行（head-dog approval 在案，D6）；
- v1.3.1（GOAL-012B，向后兼容新增，两字段可选）：
  - `adapter_id`：头犬选择，缺省 `head-dog`；**v1.5 起为任意 roster 在册且
    verified 的 harness**（registry `verified:true` 或合同白名单）；
    `head-dog` 继续可用；codex 因 F-50 保持 UNVERIFIED，接口拒绝并返回原因；
  - `effort`：思维档位，缺省按所选合同的 effort_levels 取 HIGH（若支持）否则
    该合同首档；非法档位 `400`；
- 响应 `200`（v1.3.1 修正为同步语义：回复随响应返回，前端直渲气泡；
  原 v1.3 的 202+SSE 回填语义废弃，history 拉取保留为对账路径）：
  `{ "ok": true, "session_id", "role": "head", "dispatch_id", "status", "reply" }`
  （`reply` = 头犬回复文本，来自既有 head turn 落盘内容）；
- `400`：message 为空/超长、adapter_id 非 verified、effort 非法；`resume` 指向
  未知会话按新会话处理（创建新文件）。
- 持久化：`runtime/chat/<session_id>.jsonl`，每行一条 `{role:"user"|"head",
  text, at_utc, dispatch_id?}`，append-only。

### GET /api/chat/history?session=<id>&limit=<n>

`{ "ok": true, "turns": [ {role, text, at_utc, dispatch_id?} ] }`
- 缺 session → `400`；缺文件 → `200` + 空 `turns`；limit 缺省 50、负值按 1。

### roster role / verified 字段（v1.3 / v1.5）

`GET /api/snapshot` 及 roster 消费点的犬只条目新增 `"role": "head" | "executor"`
（v1.3）与 `"verified": boolean`（v1.5）；`head-dog` 为唯一 role=head，但
verified 的 executor 也可经聊天层任头犬（角色与 harness 解耦）。

### roster effort 字段（v1.4）

roster 条目新增 `effort_levels?: string[]` 与 `effort_injection?:
{kind: 'flag'|'env'|'none', name?}`，供 UI 按犬渲染档位。

## 静态品牌资产（v1.4，GOAL-013L / rm003-p13 新增）

### GET /assets/brands/:name.svg

- 语义：看板自供品牌图标（Simple Icons CC0，仓内 `assets/brands/`），页面犬只
  标识兜底链的官方图标来源；零外部请求，127.0.0.1 假设不变；
- 响应 `200`：`content-type: image/svg+xml; charset=utf-8` +
  `cache-control: public, max-age=300`（短缓存），body 为 SVG 原文；
- `404`（fail-closed，一律 `{ok:false,error}`）：文件不存在、`name` 非纯文件名
  （`^[A-Za-z0-9_-]+\.svg$` 之外，含 `..`/子路径/非 .svg 后缀一律拒绝）、
  `path.resolve` 前缀复核逃逸白名单目录；
- 前端消费约定（page.ts）：映射表 `deepseek-dsh→deepseek / claude-code→claude /
  kimi→kimi / opencode→opencode / head-dog→deepseek`；`<img>` `onerror` 静默回退
  手绘内联 SVG（codex/zcode 直接手绘）；资产内 `fill=currentColor`，容器 `color`
  继承实现主题化。

## 实现与契约一致性

- `src/web/api-contract.md` 为本文件；实现改动必须同步本文件（同 commit）。
- 契约测试：对每个 v1 端点至少一条 fake 路径测试（含错误码分支）。
