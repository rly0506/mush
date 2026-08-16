---
goal_id: MUSH-GOAL-018
status: QUEUED（RM-004 / M5；与 p17a/p17b 并行注意文件面——本 Goal 动 dispatch/
chat/persistence 服务端与 page 聊天/流视图区，若在途则排其后）
mode: LIGHT
rm: RM-004 / M5 工作流与会话延续
executor_model_profile: deepseek-dsh（后端）+ kimi-code（前端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D28（owner grilling 确认："d"场景全要 + 机制"c"混合 + 归流"c"混合）
---

# MUSH-GOAL-018：工作流与会话延续（work-stream）

## 任务

### 后端（deepseek，包 rm004-p18a）

1. **work-stream 模型**：`runtime/streams.jsonl`（append-only：stream_id、
   title、goal 关联、created）；dispatch 增 `stream_id` 可选字段；**默认
   自动归流**（同 goal_id 无显式流则归其活动流；无 goal 时独立流）+
   `new_stream:true` 强制新开；
2. **真续跑通道**：session_id 从输出解析入库（kimi 的 "To resume this
   session: kimi -r session_xxx"、claude/zcode 各自形态）已 G011 有机制
   ——接通 kimi/claude/zcode/codex（codex 通道 F-50 未解锁则跳过）的
   resume 注入，同流后续派发自动携带；
3. **dsh 稳定前缀缝合**：同流 dsh 派发 prompt 结构固定
   （章程头 + 流历史追加 + 新指令尾），最大化前缀缓存；
4. **dsh web API 只读探测**：枚举 localhost:3080 端点/路由（读
   dsh-web bundle 源码即可），判定"向既有会话发消息"是否可编程驱动；
   可行则出后续提案（本 Goal 只探测+报告，不接管线）；
5. **流 API**：GET /api/streams（列表+每流统计：派发数/会话链/缓存命中
   侧写挂 cc-switch 数据留接口）、GET /api/streams/:id（时间线）。

### 前端（kimi，包 rm004-p18b）

1. **流视图**：新"工作流"标签——流卡片（标题/关联 Goal/派发链时间线/
   会话链标记：真续跑🟢缝合🟡）；
2. **派发表单**：工作流下拉（自动归流说明 + "新开流"按钮）；
3. **缺陷修复（owner 2026-08-17）**：看板刷新恢复头犬会话显示——
   localStorage 记当前 session_id + 加载时 GET history 重渲染 + 会话
   选择器（多会话切换）。

## DoD

- 同流 kimi/claude/zcode 派发真续跑实证（第二轮引用第一轮内容）；
- dsh 同流派发前缀稳定（哈希对比 prompt 头部）+ cache_read 前后数据留档；
- 流视图完整；刷新后会话恢复；294+ tests 全绿；
- dsh web 探测报告落盘（可行/不可行 + 证据）。

## 边界

F-45 worktree；零依赖；pi 复活另立池项不在本 Goal；五触发门照常。
