---
goal_id: MUSH-GOAL-012
status: QUEUED（RM-003 / M2；契约先行，M1 聊天契约落盘即开工）
mode: LIGHT
rm: RM-003 / M2 对话面板与体验
executor_model_profile: kimi-code（前端，thinking high）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D24（A+B 组合）
---

# MUSH-GOAL-012：对话面板与体验

## 任务（详见 docs/rm-003-conversation.md M2）

1. **聊天面板**：消息流（owner ↔ 头犬）、头犬结构化动作卡（派发/审核）
   内嵌对话流、触发门审批弹窗直通、页头"当前头犬"标识、roster 角色列；
2. **完成通知**（GP-18）：派发终态 toast + 浏览器 Notification API（设置
   开关，默认开 toast / Notification 需用户授权）；
3. **动效 logo**（GP-23）：运行中犬只 CSS 动画标识（内联 SVG 手绘各家族
   标识：DeepSeek 鲸鱼蓝/Claude 橙/GPT 绿/GLM 紫/Kimi 月亮等意象化处理，
   零外链）+ 整体视觉升级——**设计准则：owner 全局 skill
   `frontend-design`（主）+ `design-taste-frontend`（次，取适用部分）**，
   派发包 011 有加载说明与产出要求；
4. 消费 M1 聊天契约（runtime 落盘的 api-contract 增补节；未落盘前按
   charter 描述以 mock 开发，联调批补）。

## 边界

只写 D:\mush（F-45：runtime/worktrees/kimi/ 工作）；限 page.ts + 测试 +
契约文档；零框架/零构建/零外链；127.0.0.1 不变；凭据永不渲染；
255 tests 保持全绿。DEF-07 教训：模板字符串内正则双写 + 页面脚本必须过
vm.Script 解析测试。DoD/纪律见派发包 011。
