# 派发包 009 — DeepSeek/dsh 执行 GP-03（P3 持久化批）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的
完整任务包。与 kimi 的 GP-02 并行，文件面不相交（你限持久化三件套 + server
装配段，不动 page.ts / workspaces 段）。自主会话适用。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md`（§2 证据纪律=本 Goal 的验收规格）→
   `docs/goal-pool.md`（GP-03）
2. `src/web/dispatch.ts`（records Map / ledger / EventLog 用法）、
   `src/web/server.ts`（内存 EventLog 装配）、`src/core/event-log.ts`、
   `src/core/budget.ts`
3. `docs/review-2026-08-17-midpoint.md` §一a（缺口定义）

## 任务（持久化三件套）

1. **派发记录持久化**：DispatchRecord 落盘 `runtime/dispatches/`（每 dispatch
   一个 JSON，append-only：EXECUTE/REPORT/REVIEW 事件增量追加）；server 启动
   时回放加载（recent() 跨重启可用）；
2. **事件链持久化 + 台账哈希锚点**：内存 EventLog 每次 append 同步落
   `runtime/event-log.jsonl`（含 prev_sha256 链）；预算台账 JSONL 每行增加
   `sha256` 与 `prev_sha256` 字段（链式，宪法 §2 审计链可重建）；
3. **单实例锁（F-42）**：server 启动时 `runtime/board.lock`（PID+时间戳）；
   已存活实例则拒绝启动（exit 3 + 明确报错）；退出时释放（含 SIGINT 处理）；
   陈锁检测（PID 不存在则接管并记录）。

## 工作纪律（惯例）

小步 TDD；239 tests 保持全绿；path-limited commit（G-P3-* 号）；每批
BATCH-NN 回报；D15 验收语义；push 常规同步（失败不阻塞）。

## 边界（硬红线）

- 只写 `D:\mush`（runtime/ 已 gitignore）；零依赖；
- append-only 纪律：持久化文件不得改写历史行（测试断言：回放加载后哈希链
  连续性校验通过）；
- 与 GP-02 文件面不相交：不动 page.ts、不动 workspaces 相关端点；
- per-actor cap $5；五触发门照常。

## 终止条件

DoD：239+ 全绿（含：重启回放测试——落盘后新建 pipeline/server 实例能读回
records 与链式台账且链校验通过；双实例锁测试）；脚本化冒烟（起服→派发
dry-run→杀进程→重启→snapshot.dispatches 仍在）；`goals/receipts/
BATCH-NN-completion.json` + `GP-03-completion.json` 落盘。
