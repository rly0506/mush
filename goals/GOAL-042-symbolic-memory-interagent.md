# GOAL-042: 符号化记忆与跨犬直连协作协议 (Symbolic Memory & Inter-Agent Protocol)

- 状态：`DONE`（2026-08-19 交付，基于 Phase C1/C2 奠基路线；测试全绿）
- 来源：Phase C1（符号化记忆）+ Phase C2（成员直连协作）——源自奠基路线提案
- 优先级：低
- 依赖：GOAL-038（蒸馏引擎为记忆基础设施）、GOAL-037（直连控制台为通信基础设施）

---

## 1. 目标与价值

随着 mush 犬队规模与任务复杂度增长，两个核心瓶颈将逐步凸显：
- **记忆瓶颈**：当前蒸馏记忆（GOAL-038）为线性文本块，无法高效检索与关联——当记忆量达到数十个 session 后，全文搜索效率急剧下降
- **通信瓶颈**：所有犬只间协作必须经父级（头犬）中转，高频协作场景（如"编码犬完成 → 测试犬立即消费"）的延迟过高

本目标为**远期架构演进**，分两个子系统：

### C1: 符号化记忆图谱 (Symbolic Agent Memory)
借鉴 TencentDB-Agent-Memory 架构，将大容量线性蒸馏记忆升级为 **结构化符号图谱**：
1. **符号节点**：每个记忆单元为一个节点（`MemoryNode`），带有语义标签（决策/约束/文件变更/API 契约变更/测试结果）；
2. **关系边**：节点间通过语义关系连接（`depends_on`、`supersedes`、`caused_by`、`relates_to`）；
3. **检索接口**：支持按标签、时间窗口、关联文件路径的多维检索（替代全文搜索）；
4. **压缩与归档**：老旧节点按衰减策略自动降级为摘要节点（保留关系边，丢弃详情）。

### C2: 跨犬直连协作协议 (Inter-Agent Direct Protocol)
评估并实现无头犬中转的点对点协作：
1. **产物传递协议**：上游犬（如编码犬）完成后，其输出产物（代码 diff、生成文件清单）自动推送给下游犬（如测试犬），无需经头犬二次编排；
2. **协作拓扑声明**：在任务定义中声明犬只间的依赖图（DAG），调度器按拓扑顺序自动触发；
3. **消息格式标准化**：定义犬只间通信的标准消息格式（`AgentMessage`），包含 sender、receiver、payload_type、payload；
4. **安全约束**：直连协作仍受 carve-out 与审批卡约束，不绕过安全门控。

### 预期收益
- 符号图谱：从 O(n) 全文搜索到 O(log n) 图检索，记忆可扩展性量级提升
- 直连协作：消除头犬中转延迟，高频流水线场景效率提升 50%+
- 为自主团队协作（D8 无人值守模式）奠定最后一块基石

---

## 2. 核心架构设计

### 2.1 符号记忆图谱 (`src/orchestration/symbolic-memory.ts` [NEW])
```typescript
interface MemoryNode {
  node_id: string;
  type: 'decision' | 'constraint' | 'file_change' | 'api_change' | 'test_result' | 'summary';
  content: string;
  tags: string[];
  source_session_id: string;
  created_at_utc: string;
  decay_level: 0 | 1 | 2 | 3; // 0=鲜活 → 3=归档摘要
}
interface MemoryEdge {
  from: string; // node_id
  to: string;
  relation: 'depends_on' | 'supersedes' | 'caused_by' | 'relates_to';
}
interface SymbolicMemoryGraph {
  nodes: Map<string, MemoryNode>;
  edges: MemoryEdge[];
}
```
- 持久化至 `runtime/memory-graph.json`
- `queryByTags(tags, limit)`: 按标签检索
- `queryByFile(filePath)`: 按关联文件检索
- `decayOldNodes(threshold)`: 按时间衰减降级

### 2.2 跨犬协作协议 (`src/orchestration/inter-agent.ts` [NEW])
```typescript
interface AgentMessage {
  message_id: string;
  sender: string;      // adapter_id
  receiver: string;    // adapter_id
  payload_type: 'artifact' | 'status' | 'request';
  payload: unknown;
  timestamp_utc: string;
}
interface CollaborationDAG {
  task_id: string;
  stages: DAGStage[];  // 拓扑排序的阶段
}
interface DAGStage {
  stage_id: string;
  adapter_id: string;
  depends_on: string[]; // 前置 stage_id
  auto_trigger: boolean;
}
```
- 消息队列：`runtime/agent-mailbox/<adapter_id>.jsonl`（append-only）
- 调度器：DAG 拓扑排序 → 前置全部完成后自动触发下游

### 2.3 服务端接口
- `GET /api/memory/graph`：查看记忆图谱
- `GET /api/memory/search`：多维检索
- `POST /api/collaboration/plan`：创建协作 DAG
- `GET /api/collaboration/:task_id/status`：查看协作进度

### 附录：Phase C3 状态内核对比
> Phase C3（对比业界轻量状态循环引擎如 loopx 与 mush epoch 哈希链）属于纯调研性质，不产出可执行代码。建议在 GOAL-042 实施过程中作为参照调研融入架构决策，不单独立项。

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g042-symbolic-memory-interagent.test.ts`
- [ ] 验证记忆图谱 CRUD（节点创建、边连接、标签/文件检索）
- [ ] 验证衰减降级策略
- [ ] 验证跨犬消息投递与 DAG 拓扑触发
- [ ] 验证安全约束（carve-out + 审批卡在直连模式下仍生效）
- [ ] API 契约升级，`npm test` 保持 100% 全绿
