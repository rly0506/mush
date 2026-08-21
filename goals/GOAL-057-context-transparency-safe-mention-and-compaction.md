# GOAL-057: 上下文基线透明化、@-mention 门禁与结构化不变式压缩 (Context Transparency, Safe @-Mention & Structured Compaction)

- 状态：`DONE`
- 来源：owner 深度探讨与规划 (RM-008 M2)
- 优先级：高
- 依赖：GOAL-021, GOAL-024, GOAL-056


---

## 1. 目标与价值

在长线与多轮 Agent 交互中，上下文污染（如成千上万行测试日志、大文件硬内联）会导致模型注意力涣散（大海捞针效应衰减）并打碎服务端 Prompt Cache。

本 Goal 旨在落实严格的**上下文卫生纪律与保护机制**：
1. **@-mention 语法与安全大小门禁**：对话与派发支持 `@path/to/file`；$\le 300$ 行直接内联（省 1 轮工具往返），$> 300$ 行自动拦截并转为行号切片指引（杜绝大文件在后续多轮被重复计费）；
2. **Pass-Quiet / Fail-Rich 输出管道**：自动化测试成功时仅输出 1 行摘要，失败时提取关键断言与倒数 50 行精简堆栈；
3. **实时上下文用量胶囊（Context Gauge）**：对话工坊顶部直观呈现系统/工具/历史 Token 分布；
4. **结构化不变式压缩（Compact）**：提供一键压缩操作，按严格 Schema 提炼决策、文件哈希与待办，极大降低会话冷启动成本。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/orchestrator/distiller.ts` [NEW] — 结构化不变式状态压缩器（Structured Invariant Compactor）
- `src/web/page.ts` [MODIFY] — 输入框 `@file` 快捷语法与 300 行拦截、顶部 Context Gauge 胶囊、Compact 按钮
- `src/web/server.ts` [MODIFY] — 提供 `POST /api/chat/compact` 与 `GET /api/chat/context-gauge` 端点
- `tests/g057-context-hygiene-compaction.test.ts` [NEW] — 上下文门禁、日志精简与压缩单测

### 2.2 关键接口与数据契约
```typescript
export interface ContextGaugeInfo {
  total_tokens: number;
  max_context_tokens: number;
  system_tokens: number;
  tools_tokens: number;
  history_tokens: number;
  cache_hit_ratio: number;
}
```

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g057-context-hygiene-compaction.test.ts`
- [ ] 验证 `@file` 语法解析与 300 行门禁拦截（大文件禁止硬内联）
- [ ] 验证 Pass-Quiet（成功 1 行）与 Fail-Rich（失败富集）过滤管道
- [ ] 验证 Context Gauge 计算与结构化 Compact 输出格式正确性
- [ ] 严格遵守宪法红线：零凭据泄露、零外部 CDN 依赖、纯本地原生实现
