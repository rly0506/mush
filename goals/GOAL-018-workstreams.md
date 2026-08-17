---
goal_id: MUSH-GOAL-018
status: QUEUED（RM-004 / M5；与 p17a/p17b 并行注意文件面——本 Goal 动 dispatch/
chat/persistence 服务端与 page 聊天/流视图区，若在途则排其后）
mode: LIGHT
rm: RM-004 / M5 工作流与会话延续
executor_model_profile: deepseek-dsh（后端）+ kimi-code（前端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D28（owner grilling 确认："d"场景全要 + 机制"c"混合 + 归流"c"混合）；
  修订：D29（2026-08-17 二次 grilling，见文末修订节 v2）
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

---

## 修订 v2（2026-08-17，D29；owner 二次 grilling 定稿，与上文冲突处以本节为准）

owner 复议动因：方案本身要改——核心诉求「同任务同窗，上下文快满/注意力
下降才换窗，人类可手动选工作区和窗口」。以下五点为对上文任务定义的修订：

1. **窗口键 = 犬×Goal**（同上文自动归流），手动控制面 v1 最小化：
   派发时选流/强制新窗/新建流 + 流时间线只读；完整流管理面板（手动关流/
   合并/编辑交接）→ GP-31 暂缓，不在本 Goal。
2. **四层上下文 + 向上蒸馏**（新增，本 Goal 实作 Goal 层与窗口层机制）：
   - 项目层 = 工作区 AGENTS.md（已存在，派发提示自动附加）；
   - 路线图层 = RM 章程 + 决议摘要（头犬验收时维护，不属本 Goal 代码面）；
   - Goal 层 = 流记录（stream：交接链 + 状态）；
   - 窗口层 = harness 活会话。
   换窗 → 交接写进流；Goal 关闭 → 流蒸馏进回执/DECISIONS/RM 摘要；
   新 Goal 新窗拿「项目层+路线图层+packet」分层简报，不注入旧 Goal 原始对话。
3. **换窗两档**（替代原「缝合最大化」单一表述）：
   - 有自动压缩的犬（claude/zcode；kimi 待实测，实测并入验收）：信任
     harness 自压缩，mush 不因上下文压力强制换窗，仅 Goal 边界/手动/
     头犬质量判断时换；
   - 无压缩的犬（dsh 0.1.0）：mush 估算上下文占用（按输出字符/token 侧写），
     >75% 阈值自动换窗+写交接。dsh 缝合**降格**为两次轮换之间的窗口内
     机制，稳定前缀测试保留。
4. **HANDOFF 结构化交接**（新增）：流关闭/换窗时，提示模板强制离场犬在
   输出末尾给结构化块（做了什么/定了什么/文件在哪/下一步/未解问题），
   自动归档进流记录，同流或换犬后的新窗口自动注入；犬暴毙无终态输出时
   头犬从局部转录代写（DEF-09 场景）；owner 可补注（append-only）；
   同 harness 换模型同窗续期（--continue 类）不需交接。
5. **DoD 增补**：kimi 自动压缩能力实测结论落盘；75% 阈值换窗用真实长流
   （或模拟转录）验证触发；HANDOFF 注入后新窗第一轮能复述交接要点。
   原 DoD 的真续跑实证/前缀稳定/流视图/刷新恢复各条不变。

依据事实（设计理由，派发单同引）：跨天缓存 TTL 已死（DeepSeek 小时级），
巨窗只剩全价重发劣势；跨犬物理无法共享窗口，持久层是唯一桥梁。
