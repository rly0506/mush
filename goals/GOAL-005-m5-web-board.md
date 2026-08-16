---
goal_id: MUSH-GOAL-005
status: QUEUED（队列自续，DECISIONS D17）
mode: LIGHT（宪法 §1 轻量档；触发门照常生效）
rm: RM-001 / M5 Web 看板最小版
executor_model_profile: 头犬派发（dsh/deepseek headless 或等价可用 harness）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: RM-001 M5 授权（D7 前端决议 + D14 北极星种子）
---

# MUSH-GOAL-005：M5 Web 看板最小版

## 任务

在 `src/core`（事件日志/状态机/预算/审批）之上构建本地 Web 看板（D7）：

1. **本地服务**（`src/web/`）：零依赖 HTTP 服务（node:http）+ 事件流推送
  （SSE，比 WebSocket 实现更轻）；**数据源只读消费事件流，不引入第二状态源**
  （D7 红线：以 `runtime/` 或内存 loop 状态为唯一事实，看板不得写）。
2. **页面**：单页静态 HTML（无框架、无构建步骤，零依赖不变）；视图最小集：
   犬队状态（adapter/capability/身份证明）、epoch/事件链（哈希链可视）、
   预算消耗、审批弹窗（approval-requests 的 WAITING 项 + 批准/否决动作）。
3. **审批动作闭环**：看板批准/否决 = 写 owner-response 文件（append-only，
   与现有 approval-requests 流程同构）——这是 D14"最终只和一个页面交流"的
   第一块拼图。
4. **安全边界**：默认绑定 127.0.0.1；不引入任何外部静态资源（CDN 字体等）；
   页面密钥红线照旧（永不显示凭据字段）。
5. **CLI 挂接**：`bin/mush` 增加 `board` 子命令（起服务 + 打开浏览器）。

## 参考

- `dsh web`（端口 3080，owner 已在用）形态参照：浏览器实时看输出/发指令——
  M5 先做"看 + 审批"，指令下发留 M5+。
- 事件 schema：`src/schema/events.ts`；审批流：`goals/receipts/approval-requests/`
  现有文件结构。

## 分批纪律（沿用惯例）

小步 TDD；path-limited commit；每批 BATCH-NN 回报；既有 183 tests 保持全绿；
push origin master 常规同步（失败不阻塞）；D15 验收语义。

## 边界（硬红线）

- 只写 `D:\mush`；`D:\意向项目` 只读；零依赖不变；
- 看板只读事件流，不写状态（审批动作除外，走 append-only owner-response）；
- 默认 127.0.0.1 不对外；对外暴露属门 4（局域网手机访问需 owner 明确开启）；
- 五触发门照常生效。

## DoD

- `npm test` 全绿（含 SSE/看板路由/审批动作的服务端测试）；
- `bin/mush board` 起服务，浏览器可见犬队/事件链/预算/审批四视图；
- 看板上批准一笔 WAITING 审批 → owner-response 文件正确落盘（集成测试级）；
- 完成回报 `goals/receipts/GOAL-005-completion.json`（D15 语义）。
