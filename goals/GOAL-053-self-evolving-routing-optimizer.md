# GOAL-053: 战绩反馈闭环与自适应路由权重自进化 (Self-Evolving Routing Optimizer)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；自适应路由在库（route-optimizer.ts），专测 tests/g053-*.test.ts 通过；目标池 RM-007 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + 自适应优化算法
- 优先级：中（RM-007 M2）
- 依赖：GOAL-052 (ELO 引擎), GOAL-039 (智能路由)

---

## 1. 目标与价值

静态配置的路由规则无法随着模型版本迭代与本地特定项目风格自动优化。

本目标旨在构建 **实战反馈自进化路由优化器**：
1. **实战结果闭环自动标记**：人类的单次审批通过/打回、单文件回滚、测试通过率等信号自动转化为胜负训练样本；
2. **在线梯度自适应权重调优**：根据最近实战表现，动态自适应更新各领域的推荐权重（不再依赖预设硬编码）；
3. **帕累托最优派发求解**：在设定的单任务预算上限（Cap USD）下，自动求解预期正确率最高的最优组合。

---

## 2. 核心架构设计

### 2.1 自进化路由优化内核 (`src/orchestration/route-optimizer.ts` [NEW])
- `TaskOutcomeFeedback`: `{ task_id, domain, adapter_id, human_accepted, test_passed, cost_usd }`
- `recordTaskFeedback(feedback: TaskOutcomeFeedback): void`
- `getOptimizedRoutingWeights(domain: string): Record<string, number>`
- 持久化至 `runtime/routing/weights.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/routing/feedback`：提交实战反馈（Caller Token 鉴权）
- `GET /api/routing/weights`：获取当前自进化权重矩阵

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g053-self-evolving-routing-optimizer.test.ts`
- [ ] 验证反馈样本记录与在线权重自适应调整算法
- [ ] 验证冷启动平滑衰减与防过拟合保护
- [ ] 验证端点鉴权与状态持久化
