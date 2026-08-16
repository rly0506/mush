# 派发包 rm003-p12 — Kimi 执行 GOAL-012B：聊天体验四缺陷修复（owner 实操反馈）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
背景：owner 已与头犬真实对话，回报四缺陷。头犬已代码级确诊（下附根因）。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/DEF-07）→ `goals/GOAL-012-chat-panel-polish.md`
2. `src/web/page.ts`（聊天面板 send handler 约 L905-931；SSE 段约 L660+；
   dispatch 卡片点击约 L625-627）+ `src/web/chat.ts` + `src/web/server.ts`
   聊天路由段 + `src/web/api-contract.md` v1.3

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-b -b g012b`；提交落 g012b；
禁止动 master。

## 确诊缺陷（逐项修复）

### D1 无法选头犬/思维强度（owner 报告①）
- 根因：`chat.ts post()` 硬编码 `adapter_id:'head-dog'` 与 `effort:'HIGH'`；
  UI 无选择控件。
- 修复：① 后端（授权小改 A）：`post()` 接受 `{adapter_id?, effort?}`，
  adapter_id 校验"roster 中 role=head"（fail-closed），缺省 head-dog；
  effort 传 LOW/HIGH/XHIGH；② 前端：聊天区头部加两个下拉——头犬选择
  （数据源 roster.role==='head'）与 effort 档位（G013 落地按模型档前先用
  通用三档），随消息提交。
- 契约 v1.3.1 同步（向后兼容：两字段可选）。

### D2 对话慢且零反馈（owner 报告②）
- 根因：POST 同步等全程（最长 300s）；pending 仅禁用发送键。
- 修复（纯前端 + 既有 SSE）：① 发送后立即渲染"头犬思考中…"气泡
  （三点呼吸动画 + 已耗时秒表，风格沿用极夜主题）；② 头犬回复到达
  （见 D3）后替换该占位气泡；③ 输入框保持可编辑（排队下一条，
  Shift+Enter 语义不变）。

### D3 回复进了派发卡不进气泡（owner 报告③，核心）
- 根因：**后端同步返回 200，面板按 202+dispatch_id+SSE 回填写的**——
  状态码语义错位，回复永远不渲染进气泡。
- 修复：① 后端（授权小改 B）：`POST /api/chat` 响应体增加
  `reply`（头犬回复文本，来自既有 head turn）与 `status`；保持同步语义
  （异步化留 M3+，不在本包）；② 前端：响应到达即用 `reply` 渲染头犬
  气泡（SSE 后的 history 刷新保留为对账路径）。

### D4 卡片文字无法选中（owner 报告④）
- 根因：整卡 click 即 toggle，选字也被折叠。
- 修复（两道）：① toggle 处理器首行检查
  `window.getSelection().toString()` 非空则直接 return；② `.detail`
  区域 `user-select:text; cursor:auto`，折叠热区收缩到卡片头部行
  （徽章/ID 行），detail 内点击不冒泡触发 toggle。

## 后端授权边界（仅此两处，超出记 finding 停）

- A：`chat.ts post()` 参数化（D1）；
- B：server 聊天路由响应体加 `reply/status`（D3）。
其余一律前端（page.ts）+ 契约文档 + 测试。

## 纪律与验收（DoD）

- 268 tests 保持全绿（含 web-page-parse 每批必过）+ 新增：D1 参数校验
  测试、D4 选择保护逻辑（可 jsdom-free 结构断言）、D3 响应字段契约测试；
- 脚本化冒烟（真实执行记入回执）：选 head-dog+effort → 发送 → 气泡内
  出现"思考中"占位与秒表 → 终态头犬**气泡**含回复文本；卡片 detail
  内尝试选字（模拟 getSelection 非空）不触发折叠；
- path-limited commit（G12B-*）；每批 BATCH-NN 回执；D15 语义；
  模板正则双写；零外链。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-012B-completion.json` 落盘。
