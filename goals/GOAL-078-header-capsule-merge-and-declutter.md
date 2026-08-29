# GOAL-078：胶囊合一与首屏减负（Header Capsule Merge & Declutter）

- 状态：`AUTO_ACCEPTED`
- 来源：owner 规划（2026-08-28 前端审查裁定：批准胶囊合并与三处简化）
- 优先级：中
- 依赖：GOAL-076
- 验收记录：tests/g078-header-capsule.test.ts 6/6 绿；typecheck 零错误；g076 回归基线 7/7；任务池/活动流/076 系列测试 58/58 绿；Playwright 实机验证通过（popover 开合/级联迁移/折叠回归/溢出菜单/遥测短码/SSE 默认隐藏）

---

## 1. 目标与价值

收编两个已实测通过的前端缺陷修复：侧栏收起误关对话视图（视图切换监听器误绑无 `data-view` 按钮）、泳道看板无法手动标记完成（新增 `POST /api/tasks/:id/mark-done` 端点 + 卡片按钮，解决 GOAL-075 这类在 mush 之外完成的目标无法入完成池的问题）。

完成三块 UI 收敛：头犬与工作区胶囊改为「胶囊即入口」（点击弹出级联选择 popover，信息架构从三处分散收敛为单一入口）；顶栏状态簇减负（快照时间与 SSE 常显移除/按需显示，顶栏收敛为 5 件）；对话工具栏遥测胶囊压缩为短码（📊 12%，完整遥测留 tooltip）；泳道卡片动作分层（低频动作收进「⋯」溢出菜单）。

价值：首屏注意力预算回归对话本身，头犬/工作区切换从「开抽屉找控件」降为一次点击；本 Goal 同时是对 GOAL-076「L1 配置舱收进设置面板」裁定的 owner 授权二次修订（级联提升至胶囊 popover，非回潮）。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单

- `src/web/page.ts` [MODIFY] — 全部 UI 改动主战场：header 胶囊按钮化 + 两个 popover；`#generated` 挪入设置面板；`#sse-status` 默认隐藏断线才显示；`updateContextGauge()` 短码化；`renderTasks()` 动作分层 + 溢出菜单；设置面板剪出级联控件留 hint
- `src/web/server.ts` [MODIFY · 已落地] — 新增 `POST /api/tasks/:id/mark-done` 端点
- `src/web/dispatch.ts` [MODIFY · 已落地] — 新增 `markTaskDone()`，走 `advanceTaskToStatus` 平滑跃迁，幂等留痕
- `tests/g078-header-capsule.test.ts` [NEW] — 渲染断言：胶囊按钮/popover 存在、`#generated` 不在 header、nav 选择器带 `[data-view]` 过滤、卡片含溢出菜单与标记完成按钮

### 2.2 关键接口与数据契约

- 胶囊 popover 仅迁移现有控件 DOM 挂载点：`#chat-head-select` / `#chat-head-provider` / `#chat-head-variant` / `#chat-workspace-select` 等 ID 全部保留，事件绑定与 `POST /api/workspaces/select`、`POST /api/chat` 数据流不变
- `POST /api/tasks/:id/mark-done`（无 body）：404 task not found；200 `{ ok, task }`；DONE/CANCELLED 幂等返回；append-only 写入 `runtime/tasks.jsonl` + 活动流转译
- 派发抽屉 `#dispatch-head` 保持独立（按单覆盖，076 有意分离，不动）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g078-header-capsule.test.ts` 全绿
- [ ] typecheck 零错误；`scripts/g076-board-regression-baseline.cjs` 7/7 回归基线不破
- [ ] Playwright 实测：侧栏折叠对话常驻；胶囊 popover 可换头犬/工作区；卡片溢出菜单内完成「标记完成」全链路
- [ ] 严格遵守宪法红线：零凭据泄露、零外部 CDN 依赖、Windows 路径安全
