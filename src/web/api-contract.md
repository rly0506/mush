# mush Board API 契约 v1

- 状态：`v1.3.1`（2026-08-17 定稿 v1；GOAL-007B 追加 v1.1；GP-02 追加 v1.2；
  GOAL-011 追加 v1.3 聊天节——M1 已合并 master，本文件即为权威源；
  GOAL-012B 追加 v1.3.1：chat 可选 adapter_id/effort + 200 同步 reply 语义）
- 宿主：`src/web/`（node:http，零依赖）；默认只绑 `127.0.0.1`（对外暴露 = 触发门 4，不实现）
- 序列化：JSON（UTF-8，LF 结尾）；SSE 用 `text/event-stream`，帧格式 `data: <json>\n\n`
- 错误约定：失败响应一律 `{ "ok": false, "error": "<human-readable>" }`
- 版本演进：v1 字段**只能向后兼容新增**；删除/改义/改型 = 破坏性变更，需头犬批准并同步 GOAL-007

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
| `GET /api/dispatch/:id` | **新**：派发状态与事件 | v1 |
| `GET /api/workspaces` | **新**：workspace 列表/校验 | v1 |
| `POST /api/workspaces/select` | **新**：持久化当前 workspace | v1 |
| `GET /api/budget` | **新**：USD 台账投影 | v1 |

## POST /api/dispatch

请求：

```json
{
  "adapter_id": "fake-t1 | deepseek-dsh | claude-code | zcode | codex | opencode",
  "prompt": "string (1..64000)",
  "workspace": "string? (缺省=已选 workspace 或服务 cwd)",
  "effort": "LOW | HIGH | XHIGH?（缺省 LOW；D20 档位）",
  "cap_usd": "number?（缺省 5；>0）",
  "amount_usd": "number?（缺省 0=估算后记账）",
  "real": "boolean?（缺省 false=dry-run）"
}
```

响应（按状态码）：

- `202`：已受理（dry-run 或 real 已执行/后台执行）
  `{ "ok": true, "dispatch_id": "<32hex>", "status": "ADMITTED | DRY_RUN | BLOCKED_WAITING_OWNER", "admission": { "decision": "ADMITTED|DENIED", "remaining_usd": number } }`
- `400`：schema fail-closed（字段缺失/类型错/adapter 未知/workspace 不存在或越界）
- `402`：超预算门（admission DENIED；事件仍入台账）
- `500`：runner 内部错误（回执已落盘，status FAIL）

## GET /api/dispatch/:id

`{ "ok": true, "dispatch": { "dispatch_id", "status", "adapter_id", "receipt_path", "events": [ {kind, at_utc, payload} ], "stdout_tail"?, "stderr_tail"? } }`
不存在 → `404`。（`stdout_tail`/`stderr_tail` 为 v1.1 新增，见文首扩展说明。）

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

`{ "ok": true, "actors": [ { "actor_id", "spent_usd", "cap_usd", "entries": [ {at_utc, decision, amount_usd, remaining_usd, meta} ] } ] }`
- 投影源：`runtime/budget-ledger.jsonl`（append-only，每行一条 admission/spend 事件，
  与 `src/core/budget.ts` UsdBudgetLedger 同构）。

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

## 聊天 API（v1.3，GOAL-011 M1 新增；v1.3.1 见下）

### POST /api/chat

请求（v1.3.1）：`{ "message": "string (1..64000)", "resume": "session_id?",
"adapter_id": "string?", "effort": "LOW|HIGH|XHIGH?" }`
- 语义：把 message 作为 owner 消息派发给头犬（章程注入 + 会话续跑）；
  聊天即真实执行（head-dog approval 在案，D6）；
- v1.3.1（GOAL-012B，向后兼容新增，两字段可选）：
  - `adapter_id`：头犬选择，缺省 `head-dog`；**仅 roster 中 role=head 的犬
    合法**，executor/未知一律 `400`（fail-closed）；
  - `effort`：思维档位，缺省 `HIGH`；非法档位 `400`；
- 响应 `200`（v1.3.1 修正为同步语义：回复随响应返回，前端直渲气泡；
  原 v1.3 的 202+SSE 回填语义废弃，history 拉取保留为对账路径）：
  `{ "ok": true, "session_id", "role": "head", "dispatch_id", "status", "reply" }`
  （`reply` = 头犬回复文本，来自既有 head turn 落盘内容）；
- `400`：message 为空/超长、adapter_id 非 head、effort 非法；`resume` 指向
  未知会话按新会话处理（创建新文件）。
- 持久化：`runtime/chat/<session_id>.jsonl`，每行一条 `{role:"user"|"head",
  text, at_utc, dispatch_id?}`，append-only。

### GET /api/chat/history?session=<id>&limit=<n>

`{ "ok": true, "turns": [ {role, text, at_utc, dispatch_id?} ] }`
- 缺 session → `400`；缺文件 → `200` + 空 `turns`；limit 缺省 50、负值按 1。

### roster role 字段（v1.3）

`GET /api/snapshot` 及 roster 消费点的犬只条目新增 `"role": "head" | "executor"`；
`head-dog` 为唯一 head，其余为 executor。

## 实现与契约一致性

- `src/web/api-contract.md` 为本文件；实现改动必须同步本文件（同 commit）。
- 契约测试：对每个 v1 端点至少一条 fake 路径测试（含错误码分支）。
