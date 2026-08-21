# GOAL-039: 异构犬能力感知智能路由 (Smart Task Routing)

- 状态：`DONE`（2026-08-19 交付，基于 GP-07 / D1 设想；测试全绿）
- 来源：GP-07（D1 设想）
- 优先级：低
- 依赖：GOAL-032（AST 任务特征提取）、GP-35/GP-37（四级信度梯队为路由输入）

---

## 1. 目标与价值

当前犬只选派完全依赖 owner 手动决策或头犬经验性分配。随着犬队规模扩大（6+ 犬只、20+ 模型变体），手动选犬效率递减，且容易出现"大材小用"（用 opus 做格式化）或"小材大用"（用 flash-low 做复杂架构）的错配。

本目标构建 **基于任务特征与犬只能力画像的智能路由引擎**：
1. **任务特征提取**：从 prompt 与关联文件中提取任务维度标签——`coding`（编码实现）、`review`（代码审查）、`docs`（文档撰写）、`debug`（调试修复）、`architecture`（架构设计）、`test`（测试编写）；
2. **犬只能力画像**：基于历史派发数据（成功率、平均耗时、Token 效率）与模型固有特长，为每只犬建立多维能力向量；
3. **路由推荐**：匹配任务特征与犬只能力，输出推荐排序（Top-3）与理由；
4. **人类决策权保留**：路由器仅提供建议，最终选犬权归 owner（看板展示推荐徽标但不强制）。

### 预期收益
- 降低 owner 选犬的认知负担
- 提升 Token 效率（简单任务自动推荐低成本模型）
- 为后续自动调度（D8 无人值守模式）提供决策基础

---

## 2. 核心架构设计

### 2.1 任务特征分析器 (`src/orchestration/task-classifier.ts` [NEW])
```typescript
type TaskDimension = 'coding' | 'review' | 'docs' | 'debug' | 'architecture' | 'test';
interface TaskProfile {
  dimensions: Record<TaskDimension, number>; // 0~1 权重
  estimated_complexity: 'trivial' | 'moderate' | 'complex';
  file_types: string[];    // 涉及的文件类型
  context_size: number;    // 估算上下文规模
}
```
- 基于关键词匹配 + 文件类型统计的轻量分类（零 LLM 调用）
- 复杂度估算：文件数 × 依赖深度 × 变更范围

### 2.2 犬只能力画像 (`src/orchestration/dog-profile.ts` [NEW])
```typescript
interface DogCapabilityProfile {
  adapter_id: string;
  model_id: string;
  strengths: TaskDimension[];     // 擅长维度
  historical_success_rate: number;
  avg_tokens_per_task: number;
  avg_duration_ms: number;
  cost_per_task_usd: number;
  tier: 'T1' | 'T2' | 'T3' | 'T0'; // 来自四级信度
}
```
- 初始画像：基于模型家族硬编码（Claude 擅长 coding/review、Gemini 擅长 docs/architecture 等）
- 增量学习：每次派发完成后用实际指标更新画像（滑动窗口均值）
- 持久化至 `runtime/dog-profiles.json`

### 2.3 路由引擎 (`src/orchestration/router.ts` [NEW])
- `recommendDogs(taskProfile, availableDogs): RoutingRecommendation[]`
  - 计算任务-犬只匹配分数（特征向量余弦相似度 + 信度加权 + 成本惩罚）
  - 返回 Top-3 推荐（附推荐理由字符串）
  - T0_BLOCKED 犬只自动排除

### 2.4 服务端与前端
- `POST /api/route/recommend`：接收 prompt，返回推荐排序
- 派发面板犬只下拉增加 `⭐ 推荐` 标记与理由 tooltip

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g039-smart-task-routing.test.ts`
- [ ] 验证任务特征分类器对不同 prompt 的维度提取
- [ ] 验证犬只能力画像的初始化与增量更新
- [ ] 验证路由推荐排序的合理性（编码任务推荐编码强犬）
- [ ] 验证 T0_BLOCKED 犬只自动排除
- [ ] 验证前端推荐标记渲染
- [ ] API 契约升级，`npm test` 保持 100% 全绿
