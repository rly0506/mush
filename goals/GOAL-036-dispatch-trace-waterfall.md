# GOAL-036: Langfuse 式派发 Trace 步骤树与耗时瀑布 (Dispatch Trace Waterfall)

- 状态：`DONE`（2026-08-19 交付，基于 D38-L2；测试全绿）
- 来源：D38 信息披露架构·透镜二
- 优先级：中
- 依赖：GOAL-035（Diff 数据可嵌入 Trace 节点）

---

## 1. 目标与价值

当前派发执行过程是「黑盒」——owner 只能看到最终的 PASS/FAIL 结果与原始 stdout/stderr 文本墙，无法快速定位耗时瓶颈、理解执行路径或复盘失败根因。

本目标借鉴 [Langfuse](https://langfuse.com) 的 Trace 可视化理念，构建 **单次派发的执行步骤树与耗时瀑布图**：
1. **步骤树 (Step Tree)**：将派发生命周期拆解为可视化阶段节点——`QUEUE → CARVEOUT_CHECK → PROMPT_ASSEMBLE → EXECUTE → VERIFY → RECEIPT`，每个节点标注耗时、状态与摘要；
2. **耗时瀑布图 (Waterfall)**：水平时间轴上以甘特条展示各阶段并行/串行关系与占比；
3. **上下文膨胀曲线**：展示 Token 输入/输出在各阶段的累积趋势（利用 usage-scanner 已有的 token 统计能力）；
4. **节点下钻**：点击任意步骤节点展开详情抽屉（输入 prompt 片段、stdout 摘录、错误信息等）。

### 预期收益
- 从"看结果"升级为"看过程"，大幅提升派发失败的诊断效率
- 耗时瀑布直观暴露慢环节（如 Carve-out 校验、模型推理、Verifier 审判各占多少时间）
- 为后续自动性能优化提供数据基础

---

## 2. 核心架构设计

### 2.1 Trace 数据模型 (`src/orchestration/trace.ts` [NEW])
```typescript
interface DispatchTrace {
  dispatch_id: string;
  steps: TraceStep[];
  total_duration_ms: number;
  token_curve: TokenCurvePoint[];
}
interface TraceStep {
  step_id: string;
  name: string; // 'carveout_check' | 'prompt_assemble' | 'execute' | 'verify' | ...
  status: 'ok' | 'error' | 'skipped';
  start_ms: number;   // 相对派发开始的偏移
  duration_ms: number;
  summary?: string;
  detail?: string;     // 下钻用（stdout 片段、错误信息）
  children?: TraceStep[]; // 支持嵌套（如 execute 内含 stream chunks）
}
```

### 2.2 Trace 采集（`src/web/dispatch.ts` 增强）
- 在现有派发管线关键节点插入 `traceStep()` 打点调用
- 打点数据随 Receipt 一同持久化至 `runtime/traces/<dispatch_id>.json`
- SSE 事件流中增加 `trace_step` 帧类型（实时推送给前端）

### 2.3 服务端接口 (`src/web/server.ts`)
- `GET /api/dispatch/:id/trace`：返回完整 Trace 数据

### 2.4 前端渲染 (`src/web/page.ts`)
- 派发详情卡增加「⏱️ 执行追踪」Tab
- 步骤树：纵向缩进列表，状态图标（✅/❌/⏭️）+ 耗时标签
- 瀑布图：CSS 水平甘特条（基于 `start_ms` 和 `duration_ms` 计算 `left`/`width`）
- Token 曲线：轻量 SVG 折线图（纯内联，零外部库）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g036-dispatch-trace-waterfall.test.ts`
- [ ] 验证 Trace 数据模型序列化/反序列化
- [ ] 验证派发管线各关键节点的打点采集完整性
- [ ] 验证 `GET /api/dispatch/:id/trace` 端点鉴权与响应契约
- [ ] 验证前端步骤树与瀑布图渲染正确
- [ ] 验证 SSE 实时 trace_step 帧推送
- [ ] API 契约升级，`npm test` 保持 100% 全绿
