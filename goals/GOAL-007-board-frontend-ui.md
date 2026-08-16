---
goal_id: MUSH-GOAL-007
status: QUEUED（RM-002 / D22；契约先行，API v1 落盘即开工，不等 G006 实现完成）
mode: LIGHT（触发门照常生效）
rm: RM-002 / GOAL-007
executor_model_profile: kimi-code（前端，thinking high 档）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D22（2026-08-17 grilling 定稿）
---

# MUSH-GOAL-007：看板前端调度入口

## 任务

让 owner 只用这一个页面完成"选犬→写任务→选档位→选文件夹→派活→看回报→审批"。

1. **开工前置**：读 `src/web/api-contract.md`（GOAL-006 首交付物；若尚未
   落盘，以 `docs/rm-002-mobilization.md` 附录 v1 骨架为契约开发，接口联调
   留到 006 实现完成后）。
2. **派发输入框**：选犬（下拉：能力注册表在册犬只，含身份证明徽章）、任务
   文本域、effort 档位选择（low/medium/high，按犬只能力显示）、cap_usd、
   dry-run/real 切换（real 显示"需 approval 在案"提示）；提交 →
   `POST /api/dispatch`，展示返回的 dispatch_id 与状态。
3. **workspace 选择器**：消费 `GET /api/workspaces` + `POST select`；
   当前 workspace 全局高亮显示。
4. **派发跟踪**：dispatch 卡片（状态机徽章 ADMITTED/RUNNING/REPORTED/
   ACCEPTED/FAIL/BLOCKED_*），SSE 实时更新；点击展开回执摘要与事件链锚点。
5. **预算真实视图**：消费 `GET /api/budget`，替换现有静态展示（per-actor
   花费/cap/最近条目）。
6. **样式纪律**：单文件静态 HTML/JS/CSS（沿用 page.ts 生成或静态内联），
   零框架、零构建、零 CDN 外链不变；凭据字段永不渲染。

## 分批纪律

小步 TDD（服务端渲染断言沿用 tests/web-*.test.ts 模式）；path-limited
commit（含 G7-Unit 号）；每批 BATCH-NN 回报；199 tests 保持全绿；D15 验收。

## 边界

- 只写 D:\mush（限 src/web/page.ts 及其测试；不动 server 端点逻辑）；
- 零依赖/零外链；127.0.0.1 假设不变；不渲染任何凭据材料。

## DoD

- `npm test` 全绿（含新 UI 结构断言）；
- 与 fake dispatch dry-run 端到端冒烟：页面提交 → 状态徽章走完 ADMITTED→
  DRY_RUN → 回执展示（006 未就绪时以本地 mock 契约测试替代，联调批补）；
- 完成回报 `goals/receipts/GOAL-007-completion.json`（D15 语义）。
