# GOAL-033: 完整 Workstream 工作流生命周期控制面与交接编辑器 (Full Workstream Lifecycle & Handoff Editor)

- 状态：`DONE`（2026-08-19 交付，基于 GP-31 / D29；全量 437 tests 全绿）
- 依据：`CONSTITUTION.md`（证据纪律）、`DECISIONS.md` 与 API 契约演进。

---

## 1. 目标与价值

随着多犬多任务协作的深入，长线工程演进往往跨越多轮派发与多次犬只轮换。当前 `Workstream`（会话工作流）仅具备基础标识，缺乏生命周期状态机与跨犬交接棒机制。

本目标旨在建立 **完整的 Workstream 生命周期控制面与 Handoff 交接上下文编辑器**：
1. **工作流四态生命周期**：`ACTIVE`（进行中）、`PAUSED`（已挂起）、`ARCHIVED`（已归档）、`MERGED`（已合流）；
2. **结构化交接上下文块 (Handoff Block)**：
   - 记录已敲定决策（`decisions_made`）、改动文件（`files_touched`）、下一阶段行动（`next_actions`）与 Markdown 交接摘要；
3. **工作流控制面 API**：
   - 创建流、列表查询、详情查询、状态更新、交接块编辑；
   - 支持从已有工作流派生分支流（`Fork Stream`，自动继承父流交接上下文）；
4. **看板前端与契约演进**：
   - 契约升级至 **`v1.17`**；
   - 零 Token 消耗、100% 纯本地工程与持久化。

---

## 2. 核心架构设计

### 1. 数据模型与存储引擎 (`src/web/workstreams.ts`)
- `WorkstreamRecord`:
  - `stream_id`: string;
  - `title`: string;
  - `description`: string;
  - `status`: `'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'MERGED'`;
  - `parent_stream_id`?: string;
  - `created_at_utc`: string;
  - `updated_at_utc`: string;
  - `handoff_block`?: {
      decisions_made: string[];
      files_touched: string[];
      next_actions: string[];
      handoff_markdown: string;
      updated_at_utc: string;
    };
- 持久化路径：`<runtimeRoot>/workstreams.jsonl`（append-only 状态记录）。

### 2. 服务端路由 (`src/web/server.ts`)
- `GET /api/streams`
- `POST /api/streams`
- `GET /api/streams/:id`
- `PATCH /api/streams/:id`
- `POST /api/streams/:id/fork`

---

## 3. 验收规格

- [ ] 新建自动化测试 [`tests/g033-workstream-lifecycle-handoff.test.ts`](file:///D:/mush/tests/g033-workstream-lifecycle-handoff.test.ts)；
- [ ] 验证流的四态流转（ACTIVE/PAUSED/ARCHIVED/MERGED）；
- [ ] 验证 Handoff Block 结构化保存与读取；
- [ ] 验证 Fork Stream 继承父流交接上下文；
- [ ] API 契约升级至 **`v1.17`**，全量 `npm test` 保持 100% 绿灯。
