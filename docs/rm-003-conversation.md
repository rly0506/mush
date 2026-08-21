# RM-003：对话化与体验（Conversation & Polish）

状态：`DONE`（2026-08-19 owner 明确授权收官转正；基线 439 tests 全绿；D44）
授权依据：DECISIONS.md D24 + D14 北极星。

## 目标

**你只和头犬说话。** 看板长出对话面板：头犬（真犬，跑在 D:\mush）接收你的
自然语言指令，自主调度执行犬、审核回报、把触发门弹回页面；同时补齐手感
（通知、动效、档位、预设、kimi 入册）。

## 里程碑

### M1 头犬核心（GOAL-011，deepseek 后端）

- **会话续跑**（GP-04 核心）：dispatch 记录 dsh `--resume <session>` /
  claude `--continue` 的 session_id，多轮派发延续上下文——头犬对话的前提；
- **head-dog 适配器**：`head-dog` 入册（角色字段 head），工作区 D:\mush，
  系统章程注入（宪法摘要 + 派发/审核/门语义）；它可调用 `mush dispatch`
  派活给执行犬（同预算/审批门约束）；
- **聊天 API**：`POST /api/chat {message}` → 头犬 dispatch（带会话续跑）；
  对话持久化 `runtime/chat/*.jsonl`；`GET /api/chat/history`；
- **角色注册**（GP-26）：capability record 增 role 字段（head/executor）；
- **DEF-10**（GP-27）：派发默认工作区启动时恢复持久化选择。

### M2 对话面板与体验（GOAL-012，kimi 前端）

- **聊天面板**：消息流（你 ↔ 头犬）、头犬派活/审核动作的结构化卡片内嵌、
  触发门审批弹窗直通；页头常驻"当前头犬"标识 + roster 角色列（GP-26 UI 侧）；
- **完成通知**（GP-18）：派发终态 toast + 浏览器 Notification（可开关）；
- **动效 logo**（GP-23）：运行中犬只的 CSS 动画标识（内联 SVG，零外链）；
  整体视觉升级；
- 消费 M1 聊天契约（契约先行，同 RM-002 模式）。

### M3 犬力批（GOAL-013，deepseek 后端）

- **dsh preset**（GP-21）：dispatch 增 `profile` 字段 + UI 预设下拉
  （也是模型切换的实操路径，owner 可建 `~/.dsh/profiles/headless-pro` 等）；
- **按模型 effort 档**（GP-22）：合同声明 effort_levels + 注入方式
  （flag/env），从各 harness 官方文档核对（GPT 五档等），替换硬编码三档；
- **kimi 入册**（GP-04 余项）：kimi-code 适配器 + nonce 注册。

## 执行拓扑（F-45 规则强制）

并行批次一律 per-dog worktree（`runtime/worktrees/<dog>`），完成后头犬合并。
M1+M2 契约先行并行；M3 随后。

## DoD（RM 级）

- owner 在看板对话面板完成一次真实多轮对话：下指令 → 头犬自主派活 →
  执行犬完成 → 头犬审核回报 → owner 验收（全程不经 CLI/提示词穿梭）；
- 至少一次触发门在对话流中弹出并被 owner 应答；
- 五+1 犬在册（+kimi）且角色可见；完成通知/动效/档位/预设可用；
- 五触发门零违反；黄金参照零改动。

## 边界

不动：GP-05 预算计量、GP-14 quarantine、GP-08 倒回（留 C 方向后议）；
对外暴露（门 4）、无人值守（D8）维持关闭。
