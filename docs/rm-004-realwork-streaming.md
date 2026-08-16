# RM-004：实战与流式（Real Work & Streaming）

状态：`QUEUED`（2026-08-17 立项 D25；**启动前置 = RM-003 收官**：
p12/p13/p14 合并 + owner 复验聊天 + 一次真实弹审批应答）
授权依据：DECISIONS.md D25（owner 选型 A+B 流式组合）。

## 目标

**mush 开始干真活。** 以意向项目真实产品任务为主轴（首个旗舰：RM-055-RF-A
传输路径修复，已有 RF-C 诊断报告铺路）；并行把头犬对话升级为异步流式
（发送即返回 + 阶段事件流 + 打字机渲染）。

## 里程碑

### M0 安全前置（GOAL-014 前半，deepseek）

- **GP-24 工作区 carve-out**：意向项目整树默认只读，owner 圈定可写范围
  （任务级白名单，黄金参照 .agent-bridge/ 永久 deny）；dispatch 写面
  校验收紧到圈定范围。实战运营的写权限安全底座。

### M1 实战运营（GOAL-014，deepseek + 头犬编排）

- 旗舰任务：意向项目 **RM-055-RF-A**（回环探活传输修复；按对方治理
  "一次人类授权一个切片"，范围 owner 圈定）；
- 运营闭环：经看板/聊天指派 → 执行 → 头犬审核（diff 级）→ owner 验收
  → 事件链留痕；至少 **2 个真实任务**交付；
- 头犬审核深化衔接 GP-06（REVIEW 从 exit 机检到产出审阅，量力起步）。

### M2 流式体验（GOAL-015，deepseek 后端 + kimi 前端）

- `POST /api/chat` 异步化：202 + dispatch_id 即返；SSE chat 帧（阶段事件
  EXECUTE/心跳耗时/REPORT）；
- t1-runner 流式回调（stdout 增量透传，dsh 末段输出也能打字机渐显）；
- 前端：思考动画升级为阶段事件流 + 打字机渲染；契约 v1.5。

## DoD（RM 级）

- 意向项目 ≥2 真实任务交付且验收（事件链可回放，红线零违反）；
- carve-out 生效（未圈定路径写入被拒，测试+实战双证）；
- 聊天异步流式可用（发送即反馈，阶段实时，回复打字机呈现）；
- 五触发门零违反；黄金参照零改动。

## 边界

不动：GP-14 quarantine、GP-08 倒回（C 方向留 RM-005+ 议）；对外暴露
（门 4）与无人值守（D8）维持关闭；意向项目侧治理（人类授权切片制）
原样尊重。

### M3 任务池（GOAL-016，deepseek 后端 + kimi 前端；owner 2026-08-17 增补）

对标 dashi-taskboard 的任务板能力，取代 markdown 版目标池：

- **数据模型**：task{id, title, detail, priority, status
  （backlog→queued→active→done|dropped，留痕式流转）, assignee（犬）,
  tags, linked_dispatch_ids[], created_by, timestamps}；
  持久化 `runtime/tasks.jsonl`（append-only，哈希锚点同台账纪律）；
- **API**：GET /api/tasks（过滤/排序）、POST /api/tasks、
  PATCH /api/tasks/:id（status/assignee；状态机校验 fail-closed）；
  派发记录自动回链（dispatch 完成 → linked_dispatch_ids 追加）；
- **看板 UI**：新"任务池"标签——三泳道（待办/进行中/已完成）+ 卡片
  （优先级色边、认领犬徽章、关联派发数徽标）；建任务/流转/认领操作；
  头犬聊天可建任务（章程增补一句）；
- **迁移**：docs/goal-pool.md 现存 GP 项一次性导入（脚本，原文件转为
  归档只读）；
- **自动认领（dashi 签名特性，二期）**：队列自续从池中取材
  （status=queued + 优先级排序）——本里程碑先留接口与数据基础。

DoD：池 CRUD+流转测试全绿；GP 项导入完整可核；看板三泳道可用；
至少 1 个真实任务经池全程流转（与 M1 实战联动）。

### M4 调度自由与预算面板（GOAL-017，owner 复验六项 2026-08-17 增补）

- **#1 犬只注册表 CRUD**：适配器合同持久化（runtime/adapters.json，
  叠加在 baseContracts 上）；看板 UI 增删犬只（选基础 harness 模板 +
  命名 + 通道参数）；roster 实时反映；
- **#2 头犬即角色（role 与 harness 解耦）**：任何在册且 VERIFIED 的
  harness 皆可任头犬——选择级联：**harness → 模型变体**（数据源能力
  注册表）；章程注入在聊天层叠加；codex 因 F-50 暂不可选（诚实标记）；
- **#3 徽章链随选**：聊天徽章 = 当前头犬 harness+模型（含官方图标）；
- **#4 品牌色 + 运行边缘辉光**：各家族品牌主色（DeepSeek #4D6BFE、
  Claude 橙、Kimi 紫、GLM 紫、OpenAI 黑绿等）常态显示；运行态 =
  边缘 drop-shadow 辉光 + 跳动（owner 指定形态）；
- **#6 预算面板活化**：计数实时（SSE 已有，接刷新）；per-actor cap
  可编辑并持久化（runtime/budget-caps.json，改动留痕）；
- （#5 真实审批流 owner 已跑通 ✅，RM-003 DoD 落袋）。
