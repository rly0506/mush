# RM-002：活用化与扩编（Mobilization）

状态：`DONE`（2026-08-17 owner 收官。G006-G010+GP-01..03 全链完成：看板调度入口+扩编+持久化+意向项目首战 RF-C 诊断 PASS。验收链 AD-17..24）
授权依据：DECISIONS.md D22（含 D5/D7/D14/D20/D21 既有授权的延续）。

## 目标

把 RM-001 交付的自举系统变成 owner 的日常工具：**看板成为唯一调度入口**——
选犬、写任务、选档位、选工作文件夹、看实时事件流、审批，全部在一个页面完成；
验证于试验田，收官于意向项目顶替（PS 黄金参照退役）。同时扩编犬队至六犬
四通道家族。

## 里程碑（G006–G009，并行拓扑）

### GOAL-006 看板服务端与派发管线（deepseek 后端）

- `POST /api/dispatch`：真派发管线（选犬→合同→预算 admission 门→执行→回执
  →事件化）；dry-run/real 两档，real 走 approval 记录核验；
- workspace API（列出/校验/选择持久化）；USD 台账落盘（append-only）；
- loop 事件流接线（loop 生命周期事件 → SSE 推送）；
- **首交付物：API 契约 v1**（本文件附录为骨架，GOAL-007 依赖它并行开工）。

### GOAL-007 看板前端调度入口（kimi 前端，thinking high）

- 派发输入框（选犬/写任务/选档位/选 workspace）、workspace 选择器；
- 预算真实数据视图（消费 006 台账 API）；SSE 实时刷新（事件链 + 派发生命周期）；
- 零框架/零构建/零外链不变。

### GOAL-008 犬队扩编三连（deepseek 后端，与 006 并行）

- codex 适配器（`codex exec` T1 起步）+ nonce 注册（**一揽子预授权**，D22）；
- opencode 适配器（T1 起步，ACP/HTTP 备选）+ nonce 注册（同上）；
- zcode headless 修复尝试（F-30：--json 参数/EPERM/SQLite readonly 三关；
  3 次环境失败即停，保持交互式可用即不算阻塞）；
- 两者凭据：cc-switch 第三方 profile 注入，进程内使用，永不入库。

### GOAL-009 试验田验证与意向项目收官（头犬 zcode 编排）

- 建 `D:\mush-playground`（轻量真实结构），经看板派发真实小任务走完整 loop；
- 通过后在**意向项目**完成第一个真实小任务收官（任务内容 owner 届时指定，
  D22 开放槽）；黄金参照文件仍然只读（冻结区不碰）。

## Definition of Done（RM 级）

- G006–G009 全部 AUTO_ACCEPTED/DONE；
- owner 实际操作看板完成一次"选犬→派活→看回报→验收"全流程（真实任务，
  非测试 fixture）；
- 六犬在册（deepseek/claude/kimi/zcode/codex/opencode），扩编犬均有 nonce 实证
  （zcode headless 若 3×环境失败则记录 UNKNOWN 并交互式注册兜底）；
- 意向项目收官任务完成且事件链可回放；
- 五触发门全程零违反；黄金参照 diff=0。

## 边界

- 不做：gemini 接入、记忆层、成员直连、看板对外暴露（门 4）、公开发布（D21-c）；
- 零依赖不变；只写 D:\mush 与 D:\mush-playground（G009 前建场）与意向项目的
  收官任务指定文件（届时 owner 圈定范围后写）；
- codex/opencode 真实 dispatch：一揽子预授权（每犬一次有界 + cap $5/goal），
  渠道异常按纪律记 finding 停，不烧第二次。

## 附录：API 契约 v1 骨架（G006 定稿、G007 消费）

```
POST /api/dispatch        {adapter_id, prompt, workspace?, effort?, cap_usd?, real?}
                          → 202 {dispatch_id, status: ADMITTED|DRY_RUN|BLOCKED_WAITING_OWNER}
                          → 400 schema fail-closed；402 超预算门
GET  /api/dispatch/:id    → {dispatch_id, status, receipt_path, events[]}
GET  /api/workspaces      → [{path, is_git, mush_managed}]
GET  /api/budget          → {actors: [{actor_id, spent_usd, cap_usd, entries[]}]}
GET  /api/snapshot        （既有，扩展 dispatches 最近 N 条）
GET  /api/stream          （既有 SSE，新增 dispatch lifecycle 事件类型）
POST /api/approvals/respond（既有，不变）
```
契约演进规则：G006 可向后兼容扩展，不得破坏 v1 字段；破坏性变更需头犬批准
并同步 G007。
