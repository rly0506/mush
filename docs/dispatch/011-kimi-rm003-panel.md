# 派发包 011 — Kimi 执行 MUSH-GOAL-012（对话面板与体验）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。

## 第一步：按序读取

1. `AGENTS.md`（**Windows 转义铁律与 DEF-07 教训重点**：模板字符串内
   正则/反斜杠双写；渲染产物必须过 vm.Script 解析测试）→ `CONSTITUTION.md`
2. `docs/rm-003-conversation.md`（M2 = 你的 Goal）→ `goals/GOAL-012-chat-panel-polish.md`
3. `src/web/page.ts`（现状）+ `tests/web-page-parse.test.ts`（解析回归，
   你的每批必须保持绿）
4. 聊天契约：worktree 分支 g011 的 `src/web/api-contract.md` 增补节
   （未落盘则按 charter mock 开发，联调批补）

## F-45 工作方式（强制，新）

`git worktree add runtime/worktrees/kimi -b g012`；全部提交落 g012 分支；
禁止动 master 工作树。与 deepseek（GOAL-011）并行隔离。

## 设计准则（owner 指定 2026-08-17：美化必须经这两个 skill 约束）

**开工前必读**（只读，作为设计约束内化）：

1. `C:\Users\任锂帅\.agents\skills\frontend-design\SKILL.md` — **主准则**：
   独特、有意图的视觉设计（不做模板脸；有立场的配色/字体/布局选择）；
2. `C:\Users\任锂帅\.agents\skills\design-taste-frontend\SKILL.md` — **次准则**
   （anti-slop）：其自我范围注明"非 dashboard"，规则均为上下文相关——
   **只取适用部分**（预检清单、避免廉价模式等）。

产出要求：看板要有不可错认的视觉身份（雪橇队/多犬协同的主题可作设计
母题）；动效 logo 与整体风格统一；在 BATCH 回执中说明设计取向与两 skill
的具体影响（哪条规则被采纳/为何舍弃）。

## 交付物

聊天面板（消息流/动作卡/审批直通/当前头犬标识/角色列）+ 完成通知
（toast + Notification API 开关）+ 运行中犬只动效 logo（内联 SVG，
各模型家族意象化，CSS 动画）+ 视觉升级。详见 Goal 文件。

## 纪律与边界（惯例 + 前端特有）

小步 TDD；255 tests 全绿（含 web-page-parse 每批必过）；path-limited
commit（G12-* 号）；每批 BATCH-NN 回报；D15 验收语义；零框架/零构建/
零外链；127.0.0.1 假设不变；凭据永不渲染；模板内正则双写。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-012-completion.json` 落盘。
