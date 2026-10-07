# GOAL-045: SOP 工序流水线与工件自动接力工作台 (Assembly Pipeline Studio)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；SOP 流水线在库（src/orchestration/pipeline-engine.ts），专测 tests/g045-*.test.ts 通过；目标池 RM-005 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + RM-005 路线图
- 优先级：高（RM-005 M2）
- 依赖：GOAL-043 (协作总线), GOAL-044 (辩论工作台), GOAL-033 (工作流与 Handoff)

---

## 1. 目标与价值

大型软件工程任务若一次性下发容易导致模型发散、漏解边界或代码失控。

本目标旨在构建 **SOP 工序流水线与工件自动流转工作台**：
1. **五阶段标准工序卡片链**：
   `[1. 需求规格 (Spec)] ➔ [2. 架构拓扑 (Arch)] ➔ [3. 编码实现 (Code)] ➔ [4. 单元测试 (Test)] ➔ [5. 安全审计 (Audit)]`；
2. **工件（Artifacts）跨犬无损流转**：前序犬输出的规格说明与接口契约自动装配为下一阶段的输入上下文，免除人工搬运；
3. **阶段质量门禁与断点调试**：每个阶段支持设定验收标准（如测试全绿/无安全违规），支持人工暂停、修改工件或分支重跑；
4. **横向泳道可视化工作台**：顶部导航提供「工序流水」独立视图，展示各阶段执行犬头像、产出物抽屉与进度甘特卡片。

---

## 2. 核心架构设计

### 2.1 流水线执行引擎 (`src/orchestration/pipeline-engine.ts` [NEW])
- `PipelineStage`: `{ stage_name, assigned_dog, status, input_artifact, output_artifact, gate_passed }`
- `executePipelineStage(pipelineId: string, stageIndex: number): Promise<StageResult>`
- `advancePipeline(pipelineId: string): Promise<PipelineStatus>`
- 持久化至 `runtime/pipelines/<pipeline_id>.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/pipelines`：创建并启动流水线派发（Caller Token 鉴权）
- `GET /api/pipelines` & `GET /api/pipelines/:id`：查询流水线状态与工件树
- `POST /api/pipelines/:id/stage/:stage_id/approve`：阶段门禁人工放行

### 2.3 前端横向流水线视图 (`src/web/ui/views/pipeline-view.ts`)
- 横向 5 阶段工步卡片链渲染
- 工件查看与内联 Markdown/Diff 抽屉

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g045-assembly-pipeline-studio.test.ts`
- [ ] 验证 5 阶段流水线工件无损自动传递与状态流转
- [ ] 验证阶段门禁拦截与人工放行逻辑
- [ ] 验证端点鉴权与 `runtime/pipelines/` 持久化正确性
- [ ] 验证前端横向流水线 HTML/CSS 渲染正确，无外部资源依赖
