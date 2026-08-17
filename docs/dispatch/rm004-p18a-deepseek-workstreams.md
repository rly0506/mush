# 派发包 rm004-p18a — DeepSeek 执行 GOAL-018 后端（会话连续性 v2，D29 修订版）

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。完整任务包。
**本单为 D29 修订后的 v2 版**：设计要点以 `goals/GOAL-018-workstreams.md`
文末「修订 v2」节为准，与其上文冲突处一律以修订节为准。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律）→ `CONSTITUTION.md` → `goals/GOAL-018-workstreams.md`
   （**必读文末修订 v2 节**）
2. `src/web/dispatch.ts`（G011 的 resume_flag/session_id 机制区）、
   `src/adapters/kimi.ts`/`claude.ts`/`zcode.ts`/`head-dog.ts`、
   `src/web/persistence.ts`
3. 证据参考：`goals/receipts/dispatch-events/kimi-real-003.json`（kimi
   输出含 "To resume this session: kimi -r session_xxx" 形态）

## F-45 工作方式

`git worktree add runtime/worktrees/deepseek-d -b g018a`；若 p17a 在途，
基于其分支之上建（先后端串行，避免 dispatch.ts 大面积冲突）——以头犬
现场指示为准。禁改 page.ts。

## 单元（严格按序）

1. **U1 work-stream 模型**：`runtime/streams.jsonl`（append-only：stream_id、
   title、goal 关联、created、status）；dispatch 增 `stream_id` 可选字段；
   **默认自动归流，窗口键 = 犬×Goal**（同 goal_id 且同 adapter 无显式流则
   归其活动流；换犬或换 Goal 自然新开；无 goal 时独立流）+
   `new_stream:true` 强制新开；契约 v1.6；
2. **U2 真续跑注入**：kimi（-r / --resume）、claude（--continue）、
   zcode（--resume）session 解析与同流携带；codex 若 F-50 未解锁则
   跳过并在合同注释注明；
3. **U3 换窗两档策略**：adapter 合同增 `context_management` 字段
   （`'auto-compact'`（claude/zcode）| `'none'`（dsh；kimi 标
   `'unknown'` 待实测））；
   - auto-compact 档：mush **不**因上下文压力强制换窗；
   - none 档：mush 维护同流累计上下文估算（prompt+输出字符→token 侧写，
     估算系数写常量并注明是估算），**>75% 阈值自动换窗**（关旧窗走 U4
     交接流程，新派发开新 session）；
   - dsh 缝合**降格**为两次轮换之间的窗口内机制：同流 dsh 派发
     prompt = 固定章程头 + 追加式流历史 + 新指令尾（结构常量写死）；
4. **U4 HANDOFF 结构化交接**：
   - 提示模板：流将关闭/换窗的派发，prompt 尾部注入指令，要求输出
     `HANDOFF-BEGIN`…`HANDOFF-END` 块（五节：做了什么/定了什么/文件在
     哪/下一步/未解问题）；
   - 解析归档：终态输出含该块则解析入流记录（append-only + 哈希锚点）；
   - 注入：同流新窗口（含换犬后的新窗）首条 prompt 自动携带最近交接块；
   - 兜底入口：犬暴毙无终态（INTERRUPTED）时流记录留 handoff 空位，
     头犬可外部写入（提供最小 API 或文件面），注入逻辑同上；
   - 同 harness 换模型同窗续期不需交接（U2 路径自然覆盖）；
5. **U5 分层简报注入（项目层）**：派发 prompt 头部自动附加工作区
   `AGENTS.md`（存在则读取，超长截断规则写明）——四层上下文的项目层
   落地；Goal 层=流记录（U1/U4 已覆盖）；路线图层为头犬流程面不入代码；
6. **U6 dsh web 只读探测**：读 dsh-web bundle 源码（~/.dsh/profiles/
   node_modules/@deepseek-ai/dsh-web* 等）枚举路由，判定可否"向既有
   会话程序化发消息"；报告落 goals/receipts/dsh-web-api-probe.md
   （只探测不接管线）；
7. **U7 流 API**：GET /api/streams（列表+每流统计：派发数/会话链/
   上下文估算占用/交接计数）、GET /api/streams/:id（时间线含交接块）。

## 纪律与验收

294+ tests 全绿；新增断言至少覆盖：streams 归流（犬×Goal 键）/真续跑
注入/前缀稳定性（同流两次 dsh prompt 前 256 字节哈希一致）/**75% 阈值
触发换窗**/**HANDOFF 解析-归档-注入回路**/AGENTS.md 项目层注入；
path-limited commit（G18A-*）；每批 BATCH-NN 回执；D15 语义；转义铁律。
DoD 详见 Goal 文件（含修订 v2 节增补：kimi 压缩实测与长流触发验证中，
kimi 实测由头犬验收时真实会话进行，你只需保证 `unknown` 档不误触发换窗）。
终止：DoD 全满足 + GOAL-018A-completion.json 落盘。
