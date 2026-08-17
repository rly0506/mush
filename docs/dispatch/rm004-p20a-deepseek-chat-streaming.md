# 派发包 rm004-p20a — DeepSeek 执行 GOAL-021 后端（聊天流式）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md` → `goals/GOAL-021-chat-streaming.md`
2. `src/web/chat.ts`、`src/web/server.ts`（SSE /api/stream 既有实现）、
   `src/adapters/t1-runner.ts`（ChildProcessLike 的 onStdout 钩子）

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-f -b g021a`（基于当前 master）。
禁改 page.ts 与 dispatch.ts/server.ts 的 approval 段。

## 单元（严格按序）

1. **U1 chat 异步化**：POST /api/chat 202 即返 {dispatch_id, session_id}；
   回复落盘后经事件广播；会话 JSONL 语义不变；
2. **U2 SSE chat 帧**：chat 阶段事件进 /api/stream（ADMITTED/EXECUTE/
   HEARTBEAT（耗时）/REPORT 含回复全文）；
3. **U3 t1 流式回调**：runner 增量 stdout 钩子（injectable 测试），
   dispatch/chat 挂接为 EXECUTE 增量事件（节流：≥200ms 或 512B 合帧）；
4. **U4 契约 v1.9** 同步 api-contract.md。

## 纪律与验收

342+ tests 全绿（新增≥5：202 语义/事件序列/流式回调/节流/JSONL 完整）；
path-limited commit（G21A-*）；批次回执 BATCH-NN（-ds 后缀，从 46 起）；
D15 语义；转义铁律。终止：DoD 全满足 + GOAL-021A-completion.json 落盘。
