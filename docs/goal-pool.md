# mush 目标池（standing pool）

机制（D23，学自 dashi-taskboard 的 backlog 形态）：头犬维护，owner 随时增删；
队列自续（D17）从池中按优先级取材立项；每项带来源与依赖。状态：`idea`（候选）
→ `queued`（已立项）→ `active`（执行中）→ `done` / `dropped`（理由留痕）。

## 池

| ID | 标题 | 来源 | 优先 | 状态 | 依赖 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| GP-01 | RM-002 收官：意向项目首个真实任务 | D22 | 高 | queued | P1✅ P2 | 任务内容 owner 指定（开放槽） |
| GP-02 | P2 前端批：F-40 自由输入/新建 workspace + F-39 显示归一 | owner 复盘 | 高 | done（AD-21，2026-08-17） | — | kimi |
| GP-03 | P3 持久化批：记录/事件链落盘 + 台账哈希锚点 + 单实例锁（F-42） | 复盘 §一a | 高 | done（AD-23，2026-08-17；DEF-05 回放聚合小缺陷随 GP-10） | — | deepseek；宪法 §2 审计链补全 |
| GP-04 | P4 补编批：kimi adapter 入册 + flaky 竞态修复 + 会话续跑（dsh --resume / claude --continue 接管线） | 复盘 §一b/e | 中 | idea | GP-03 | kimi 犬入册后看板可派 kimi |
| GP-05 | 预算实测化：per-dispatch 真实成本回传（申报制→计量制），对齐 cc-switch usage 表 | 复盘 §一d | 中 | idea | — | 治理语义修复 |
| GP-06 | 审核深化：REVIEW 从 exit 机检升级为 diff 级审核（学 todos.dev Change review：GitHub 风格逐文件 diff） | 复盘 §一c + todos.dev | 中 | idea | GP-03 | AI 互审（todos.dev）可挂此处 |
| GP-07 | 随时插话：dispatch 运行中消息排队注入（todos.dev Steer mid-run；dsh web 已有同款） | todos.dev | 中 | idea | GP-04 | 需通道支持（T1 单发改可交互或经 web 通道） |
| GP-08 | 对话倒回：checkpoint/rewind（todos.dev Rewind；犬侧 = worktree+session 还原；mush 侧 = 事件链截断重放） | todos.dev | 中 | idea | GP-03, GP-06 | 高价值高风险，需专门 grilling |
| GP-09 | 结构化提问卡：dispatch 中犬发起带选项提问，看板点选回填（todos.dev Structured questions） | todos.dev | 中 | idea | GP-07 | 对应黄金参照 user-approval/ask-user 经验 |
| GP-10 | 运行历史/重跑：dispatch 一键重跑与回执复用（todos.dev Run history） | todos.dev | 低 | idea | GP-03 | 记录持久化后自然延伸 |
| GP-11 | 用量透明深化：按模型/按派发费用拆分视图（todos.dev Transparent usage） | todos.dev | 低 | idea | GP-05 | 现有预算视图的深化 |
| GP-12 | 技能库：SKILL.md 共享 + GitHub 导入 + 犬默认技能（todos.dev Skills library；对应 D12 M4 技能路由表欠账） | todos.dev + D12 | 低 | idea | — | 用户全局技能目录已在，缺路由/携带机制 |
| GP-13 | 任务 DAG：goal 间依赖图替代线性队列（todos.dev Layered execution + dashi-taskboard 流转） | todos.dev + dashi | 低 | idea | GP-03 | 现靠"文件面不相交"君子协定 |
| GP-14 | 隔离区 quarantine：可疑犬产物先隔离再裁决（agent-bridge 经验） | agent-bridge | 中 | idea | GP-03 | 安全审查关注项 |
| GP-15 | 进程就绪门真实化：dispatch-gates 的 PID/ready 文件（agent-bridge） | agent-bridge | 低 | idea | — | 语义模型已够用，真实化在长任务场景 |
| GP-16 | 四种提及 /#~&：看板输入框引用技能/任务/工作区/犬（todos.dev Four mentions） | todos.dev | 低 | idea | GP-02, GP-12 | 前端批后自然延伸 |
| GP-17 | 语音输入/截图标注（todos.dev，PWA 场景） | todos.dev | 低 | idea | 门4（对外/移动访问） | 对外暴露未开，暂缓 |
| GP-18 | 通知按需送达：收件箱留痕 + 推送策略（todos.dev Notifications） | todos.dev | 低 | idea | GP-03 | 审批等待时可提醒 owner |
| GP-19 | codex/opencode nonce 补跑（REGISTERED-UNVERIFIED → VERIFIED） | G008 遗留 | 中 | idea | 普通环境（非沙箱） | 机会性：任何非沙箱会话顺手做 |
| GP-20 | 定时调度开关评估（D8）：若有站得住的 recurring 需求再议（todos.dev Scheduled reruns） | todos.dev + D8 | 低 | idea | owner 明确需求 | 默认保持关 |

## dashi-taskboard 直接可学（已吸收进池）

- **backlog 目标池** → 本文件机制；
- **自动认领** → 队列自续（D17 已有）+ 池状态机（本文件）；
- **任务-会话关联** → GP-04 会话续跑（dispatch_id ↔ 犬 session_id 绑定记录）；
- **worktree 协作** → GP-08 倒回的基石（每任务隔离 worktree，倒回=删 worktree）。

## todos.dev 14 项能力 × mush 现状速查

| todos.dev 能力 | mush 现状 | 差距 → 池项 |
| --- | --- | --- |
| AI 互审 | role-swap 骨架 + 浅 REVIEW | GP-06 |
| 随时插话 | 无（T1 单发） | GP-07 |
| 对话倒回 | 无（append-only 不可逆） | GP-08 |
| 结构化提问 | 审批卡有；提问卡无 | GP-09 |
| 语音输入 | 无 | GP-17 |
| 截图标注 | 无 | GP-17 |
| 四种提及 | 无 | GP-16 |
| 技能库 | 用户全局目录（无路由） | GP-12 |
| 变更审核 | exit 机检 | GP-06 |
| 方案版本 | 派发包静态文件 | GP-08/GP-10 |
| 用量透明 | 预算视图（申报制） | GP-05/GP-11 |
| 运行历史 | 内存 records | GP-03/GP-10 |
| 操作留痕 | append-only 回执/AD 日志 ✅ | 保持 |
| 通知 | 无 | GP-18 |

## 2026-08-17 增补（owner 试用反馈 GP-21..24）

| ID | 标题 | 来源 | 优先 | 状态 | 依赖 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| GP-21 | dsh preset 切换：dispatch 暴露 profile 字段（--profile 注入），UI 预设下拉；模型切换可经 per-model profile 实现（owner 建 ~/.dsh/profiles/*，F-G9-02 的实操解） | owner Q2 | 中 | idea | — | deepseek 后端 + kimi UI |
| GP-22 | effort 档位按模型适配：合同声明 effort_levels + 注入方式（flag/env），从各 harness 官方文档核对（GPT 5 档等），UI 按犬渲染 | owner Q3 | 中 | idea | — | 替换硬编码 LOW/HIGH/XHIGH |
| GP-23 | 前端美化：运行中犬只动效 logo（CSS 动画 + 内联 SVG，零外链红线内）；整体视觉升级 | owner Q4 | 中 | idea | — | kimi |
| GP-24 | 意向项目登记 UX：冻结区拒绝改为"警示+owner 确认 carve-out"（整树只读默认，owner 圈定范围开放），替代一刀切前端拒绝 | owner Q1 | 中 | idea | GP-14 | 头犬 API 登记已可用的正式化 |
