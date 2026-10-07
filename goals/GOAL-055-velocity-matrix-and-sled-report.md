# GOAL-055: 多犬协作全景战报与研发能效大屏 (Velocity Matrix & Sled Report)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；能效大屏在库（velocity-matrix.ts），专测 tests/g055-*.test.ts 通过；目标池 RM-007 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + 软件工程能效学 (DORA & SPACE)
- 优先级：中（RM-007 M4）
- 依赖：GOAL-041 (审计日志导出), GOAL-036 (Trace 瀑布)

---

## 1. 目标与价值

多 Agent 协同体系随着项目演进，需要对整体团队交付效能、成本 ROI 与协作瓶颈进行全局度量。

本目标旨在构建 **多犬协作全景战报与研发能效大屏**：
1. **研发效能度量矩阵（Velocity Matrix）**：
   - 周期内交付 Goal/Bug 数与平均完成耗时；
   - 独立 Verifier 缺陷拦截率与红蓝对抗修复轮次；
   - 每 $1 美元 Token 产出的有效代码行与单测用例数；
2. **周期性全景战报自动生成（Sled Report Generator）**：支持一键导出包含拓扑演进、战绩天梯、关键架构决策的 Markdown/HTML 完整复盘战报；
3. **看板效能大屏图表**：纯 SVG 呈现团队吞吐率走势、耗时分布与协作拓扑图。

---

## 2. 核心架构设计

### 2.1 效能度量引擎 (`src/orchestration/velocity-matrix.ts` [NEW])
- `VelocityMetrics`: `{ throughput_per_week, avg_lead_time_ms, verifier_intercept_rate, cost_efficiency_roi }`
- `generateSledReport(timeRange: { startUtc: string; endUtc: string }): string`
- `calculateVelocityMatrix(): VelocityMetrics`

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/velocity/metrics`：获取全景效能数据
- `POST /api/velocity/report`：生成并导出周期全景战报（Caller Token 鉴权）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g055-velocity-matrix-and-sled-report.test.ts`
- [ ] 验证效能指标计算公式与数据聚合正确性
- [ ] 验证战报生成与零凭据泄露安全审查
- [ ] 验证大屏 SVG 图表渲染正确，无外部 CDN 泄露
