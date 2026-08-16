# 派发包 005 — Kimi 执行 MUSH-GOAL-007（看板前端调度入口）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。本文件是你的完整任务包。
自主会话适用：无人应答，按包推进，疑问记 findings。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md`（轻量档 + 五触发门）
2. `docs/rm-002-mobilization.md` — 路线图 + **API 契约 v1 骨架（附录）**
3. `goals/GOAL-007-board-frontend-ui.md` — 你的 Goal
4. `src/web/page.ts` + `tests/web-board-page.test.ts` — GOAL-005 交付的现有
   页面与其测试模式（你的工作基座）
5. `src/web/api-contract.md` — 若已存在（deepseek 的 GOAL-006 首交付物），
   以它为契约；**不存在则按 rm-002 附录骨架开发**，mock 契约测试，联调批补。

## 你的交付物（详见 GOAL-007）

1. 派发输入框：选犬（在册犬只下拉 + 身份徽章）/任务文本域/effort 档位/
   cap_usd/dry-run|real 切换 → `POST /api/dispatch`；
2. workspace 选择器（GET workspaces + POST select，当前项全局高亮）；
3. dispatch 跟踪卡片（状态徽章 + SSE 实时更新 + 回执/事件链锚点展开）；
4. 预算真实视图（`GET /api/budget`，替换静态展示）。

## 工作纪律

- 小步 TDD（页面结构断言沿用现有 web 测试模式）；199 tests 保持全绿；
- path-limited commit（G7-* 号）；commit 前 `git diff --cached --check`；
- 每批 BATCH-NN 回报 + 真实测试输出；D15 验收语义；
- push origin master 常规同步，失败不阻塞。

## 样式与安全纪律（红线）

- 单文件静态 HTML/JS/CSS，零框架、零构建、零 CDN 外链；
- 只绑 127.0.0.1 假设不变；页面**永不渲染任何凭据材料**；
- 只写 `D:\mush`（限 `src/web/page.ts` 及其测试；不动 server 端点逻辑）；
- 零依赖；per-actor cap $5；五触发门照常。

## 终止条件

GOAL-007 DoD 全部满足 + `goals/receipts/GOAL-007-completion.json` 落盘 /
预算逼近 / 仅剩 finding 阻塞项（如契约联调依赖 GOAL-006 未完成，则交付 mock
级 + 联调批计划，诚实记录状态）。
