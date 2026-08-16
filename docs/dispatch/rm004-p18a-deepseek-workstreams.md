# 派发包 rm004-p18a — DeepSeek 执行 GOAL-018 后端（工作流与会话延续）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律）→ `CONSTITUTION.md` → `goals/GOAL-018-workstreams.md`
2. `src/web/dispatch.ts`（G011 的 resume_flag/session_id 机制区）、
   `src/adapters/kimi.ts`/`claude.ts`/`zcode.ts`、`src/web/persistence.ts`
3. 证据参考：`goals/receipts/dispatch-events/kimi-real-003.json`（kimi
   输出含 "To resume this session: kimi -r session_xxx" 形态）

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-d -b g018a`；若 p17a 在途，
基于其分支之上建（先后端串行，避免 dispatch.ts 大面积冲突）——以头犬
现场指示为准。禁改 page.ts。

## 单元（严格按序）

1. **U1 work-stream 模型**（streams.jsonl + dispatch.stream_id + 自动归流
   + new_stream 强制开；契约 v1.6）；
2. **U2 真续跑注入**：kimi（-r / --resume）、claude（--continue）、
   zcode（--resume）session 解析与同流携带；codex 若 F-50 未解锁则
   跳过并在合同注释注明；
3. **U3 dsh 稳定前缀缝合**：同流 dsh 派发 prompt = 固定章程头 + 追加式
   流历史 + 新指令尾（结构常量写死，禁止每次变体）；
4. **U4 dsh web 只读探测**：读 dsh-web bundle 源码（~/.dsh/profiles/
   node_modules/@deepseek-ai/dsh-web* 等）枚举路由，判定可否"向既有
   会话程序化发消息"；报告落 goals/receipts/dsh-web-api-probe.md
   （只探测不接管线）；
5. **U5 流 API**（GET /api/streams、GET /api/streams/:id，含每流统计）。

## 纪律与验收

294+ tests 全绿（streams 归流/真续跑注入/前缀稳定性断言：同流两次
dsh prompt 前 256 字节哈希一致）；path-limited commit（G18A-*）；
每批 BATCH-NN 回执；D15 语义；转义铁律。
DoD 详见 Goal 文件。终止：DoD 全满足 + GOAL-018A-completion.json 落盘。
