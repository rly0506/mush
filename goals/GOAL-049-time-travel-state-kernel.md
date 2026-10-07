# GOAL-049: 会话与代码时空状态树与因果时间旅行快照 (Time-Travel State Kernel)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；时空状态树在库（time-travel.ts），专测 tests/g049-*.test.ts 通过；目标池 RM-006 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + RM-006 路线图
- 优先级：高（RM-006 M2）
- 依赖：GOAL-035 (Diff 采集与回滚), GOAL-033 (工作流四态)

---

## 1. 目标与价值

多 Agent 协同重构或探索性编码时，用户常担心代码被改乱且难以追溯到某个特定中间状态。

本目标旨在构建 **时空状态树与时间旅行快照内核（Time-Travel Kernel）**：
1. **轻量级微快照（Micro-Snapshots）**：在每次派发执行前后自动记录极简状态差分包（Git Tree Hash + 会话节点 + 事件链锚点）；
2. **因果分支状态树（Causality Tree）**：在看板直观展示类似 Git 分支图的因果决策演化树；
3. **一键时间旅行（Time-Travel Undo/Redo）**：支持一键回溯至任意历史节点，瞬时恢复当时的代码与会话上下文；
4. **平行分支探索（Parallel Reality）**：支持从任意历史节点 Fork 出新分支进行替代方案实验，并在分支间自由切换。

---

## 2. 核心架构设计

### 2.1 时空状态机内核 (`src/orchestration/time-travel.ts` [NEW])
- `StateNode`: `{ node_id, parent_id, timestamp_utc, git_tree_hash, session_snapshot, event_hash }`
- `createSnapshot(workspaceRoot: string, reason: string): Promise<StateNode>`
- `travelToNode(nodeId: string): Promise<{ ok: boolean; restored_files: number }>`
- 持久化至 `runtime/time-travel/nodes.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/time-travel/tree`：获取因果状态分支树
- `POST /api/time-travel/revert`：执行时间旅行回滚（Caller Token 鉴权）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g049-time-travel-state-kernel.test.ts`
- [ ] 验证微快照创建、因果树挂载与多分支分叉
- [ ] 验证时光倒流代码与会话状态精确还原
- [ ] 验证越界保护与只读区冻结铁律
