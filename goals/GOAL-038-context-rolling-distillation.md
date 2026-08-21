# GOAL-038: 多轮长上下文滚动蒸馏与记忆持久化 (Context Rolling Distillation)

- 状态：`DONE`（2026-08-19 交付，基于 GP-04 / D18 预研；测试全绿）
- 来源：GP-04（D18 长会话上下文管理）
- 优先级：中
- 依赖：GOAL-032（AST 上下文装配器为基础设施）

---

## 1. 目标与价值

犬队在长线多轮任务中，会话上下文持续膨胀直至触达模型上下文窗口上限（如 Claude 200K、Gemini 1M），导致：
- **硬截断风险**：超限后丢失关键早期决策与约束
- **Token 浪费**：大量重复的中间推理过程占据预算
- **跨会话遗忘**：新会话无法继承前序会话的关键认知

本目标构建 **多轮长上下文滚动蒸馏与记忆持久化引擎**：
1. **阈值监测**：实时追踪会话 token 使用率，在达到 70%/85%/95% 阈值时触发预警；
2. **滚动蒸馏**：调用轻量模型（如 `gemini-3.7-flash-low`）自动提取当前会话的关键决策、约束、文件变更与待办事项，压缩为高密度摘要块；
3. **持久记忆存储**：蒸馏产物持久化至 `runtime/memory/<session_id>.json`，结构化存储（决策链、文件快照引用、关键约束）；
4. **跨会话注入**：新会话启动时自动检索关联记忆块，注入为前置上下文（与 GOAL-032 上下文装配器协同）。

### 预期收益
- 将有效上下文窗口从单次会话 200K 扩展到理论无限（通过记忆链）
- Token 预算节省预估 40~60%（去除冗余中间推理）
- 跨会话认知连续性——犬只"记住"之前做了什么

---

## 2. 核心架构设计

### 2.1 上下文监测器 (`src/orchestration/context-monitor.ts` [NEW])
```typescript
interface ContextUsageStatus {
  session_id: string;
  current_tokens: number;
  max_tokens: number;
  usage_pct: number;
  alert_level: 'normal' | 'warning' | 'critical' | 'overflow';
}
```
- 从 SSE 事件流中实时累积 token 统计
- 在 70%/85%/95% 阈值触发 `context_pressure` 事件

### 2.2 蒸馏引擎 (`src/orchestration/distiller.ts` [NEW])
- `distillSession(transcript: Message[], budget: number): DistilledMemory`
  - 输入：会话 transcript（全量消息）
  - 输出：结构化记忆块
    ```typescript
    interface DistilledMemory {
      session_id: string;
      distilled_at_utc: string;
      decisions: string[];       // 已作决策
      constraints: string[];     // 活跃约束
      files_touched: string[];   // 触达文件清单
      pending_actions: string[]; // 未竟事项
      summary_markdown: string;  // 人可读摘要
      token_count: number;       // 蒸馏产物 token 估算
    }
    ```
  - 蒸馏策略：保留所有显式决策点 + 最近 N 轮完整对话 + 文件变更摘要，丢弃中间推理链
- 持久化至 `runtime/memory/<session_id>.json`

### 2.3 记忆检索与注入 (`src/orchestration/memory-loader.ts` [NEW])
- `loadRelevantMemories(taskContext): DistilledMemory[]`
  - 按工作流 ID、文件路径交集、时间窗口检索关联记忆
- 与 GOAL-032 `assembleContext()` 集成，在上下文包中增加 `## 历史记忆` 段落

### 2.4 服务端接口
- `GET /api/memory/:session_id`：查看蒸馏记忆
- `POST /api/memory/distill`：手动触发蒸馏
- `GET /api/context/pressure`：查询当前上下文压力

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g038-context-distillation.test.ts`
- [ ] 验证阈值监测在 70%/85%/95% 正确触发
- [ ] 验证蒸馏引擎从 transcript 中提取结构化记忆
- [ ] 验证记忆持久化与跨会话检索注入
- [ ] 验证与 GOAL-032 上下文装配器的集成
- [ ] API 契约升级，`npm test` 保持 100% 全绿
