# GOAL-035: 派发结果 Git Diff 视觉审查器 (Dispatch Diff Viewer)

- 状态：`DONE`（2026-08-19 交付，基于 GP-11 / D38；测试全绿）
- 来源：GP-11（D1 设想）、D38 信息披露架构
- 优先级：中
- 依赖：无（现有基础设施已足够）

---

## 1. 目标与价值

犬只执行任务后会修改工作区文件，但 owner 目前只能通过外部终端 `git diff` 或 IDE 查看变更内容，**审查路径断裂**——需要离开看板切换上下文。

本目标旨在构建 **看板内联 Git Diff 视觉审查器**：
1. **变更捕获**：派发完成后自动采集工作区 `git diff`（staged + unstaged），记录为结构化变更集；
2. **内联 Diff 渲染**：在派发详情卡/活动时间线中直接展示红绿高亮的代码差异视图（类 GitHub PR 式 unified diff）；
3. **安全审查辅助**：高亮标记敏感文件修改（如 `CONSTITUTION.md`、`DECISIONS.md`、配置文件），辅助 owner 快速判断是否存在越权修改；
4. **一键回滚入口**：提供 `git checkout -- <file>` 粒度的单文件撤销操作（需确认弹窗）。

### 预期收益
- 消除审查切屏成本，owner 在看板即可完成 90% 的代码审阅工作
- 敏感文件高亮降低越权修改漏检风险
- 与活动时间线自然融合（"🐕 claude-code 修改了 3 个文件 → 展开查看 diff"）

---

## 2. 核心架构设计

### 2.1 变更采集层 (`src/orchestration/diff-collector.ts` [NEW])
- `captureWorkspaceDiff(workspaceRoot: string): DiffResult`
  - 调用 `git diff --unified=3 --no-color` + `git diff --cached` 采集变更
  - 解析 unified diff 格式为结构化 `FileDiff[]`（文件路径、增删行数、diff hunks）
  - 对 `runtime/`、`node_modules/` 等非业务目录自动折叠
- `classifyDiffSensitivity(filePath: string): 'critical' | 'normal' | 'generated'`
  - 标记 `CONSTITUTION.md`、`DECISIONS.md`、`goals/`、密钥相关路径为 `critical`
  - 标记 `runtime/`、生成产物为 `generated`

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/dispatch/:id/diff`：返回指定派发的变更集
- `POST /api/dispatch/:id/revert`：单文件回滚（Caller Token 鉴权 + 确认弹窗）

### 2.3 前端渲染 (`src/web/page.ts`)
- 派发详情卡增加「📝 代码变更」折叠区
- Unified Diff 渲染器（纯 CSS 红绿高亮，零外部依赖）
- 敏感文件 `⚠️` 标记与置顶排序
- 活动时间线中变更摘要卡片（"修改 3 文件 / +42 -18 行"）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g035-dispatch-diff-viewer.test.ts`
- [ ] 验证 `captureWorkspaceDiff` 正确解析 git diff 输出
- [ ] 验证敏感文件分类与高亮逻辑
- [ ] 验证 `GET /api/dispatch/:id/diff` 端点鉴权与响应契约
- [ ] 验证前端 Diff HTML 渲染正确且零外链/零敏感词
- [ ] 验证单文件回滚操作的安全确认流程
- [ ] API 契约升级，`npm test` 保持 100% 全绿
