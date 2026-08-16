# 派发包 rm003-p13 — Kimi 执行：官方品牌图标接线（owner 需求 2026-08-17）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
前置：可与 rm003-p12（g012b）串行或在其后基于其合并结果开工。

## 第一步：按序读取

1. `AGENTS.md` → `assets/brands/README.md`（资产清单与兜底链约定）
2. `src/web/page.ts`（现手绘 logo 体系，BATCH-38）+ `src/web/server.ts`
   （静态路由区）+ `src/web/api-contract.md`

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-c -b g013-logo`；提交落该分支。

## 任务

1. **静态资产路由**（server，授权唯一后端小改）：`GET /assets/brands/:name.svg`
   ——仅白名单目录内、`.svg` 后缀、拒绝路径穿越；`content-type:
   image/svg+xml` + 短缓存头；契约文档补一节。
2. **官方图标接线**（page.ts）：犬只标识渲染改为兜底链——
   `assets/brands/<adapter 映射名>.svg` 存在 → `<img>`（class 控制尺寸、
   `color` 继承实现 currentColor 主题化）；否则现手绘内联 SVG。
   映射：deepseek-dsh→deepseek / claude-code→claude / kimi→kimi /
   opencode→opencode / head-dog→deepseek（头犬徽章同源）/ codex、zcode
   →手绘兜底。
3. **动效升级（owner 2026-08-17 增补：运行时必须"跳动/抖动"让人一眼看出
   谁在工作）**：动画分三态，作用于图标容器（img 与手绘同待遇）：
   - **working**：小跳/抖动循环（建议 keyframes hop：translateY 弹跳 +
     轻微 squash 缩放，~1.1-1.3s 循环，ease-in-out）+ 现有辉光呼吸叠加
     ——犬在跑的意象，极夜主题下不可刺眼（幅度 ≤6px）；
   - **idle**：静止（仅悬停微反馈）；
   - **terminal-flash**：终态到达时一次 settle 动画（落定感，PASS 绿闪/
     FAIL 红闪一次即停）。
   应用位置：roster 行（该犬有非终态 dispatch 时 working）、派发卡
   （RUNNING 时）、聊天"思考中"指示器（与 p12-D2 的呼吸点合并为
   跳动头犬徽章）、页头当前头犬徽章（处理中时）。
   prefers-reduced-motion 媒体查询降级为辉光呼吸（无位移）。
4. **加载失败兜底**：`<img>` onerror 静默回退手绘（不留破图）。

## 纪律与验收（DoD）

- 268+ tests 全绿（含新增：资产路由 200/404/穿越拒绝测试）；
- 脚本化冒烟：GET /assets/brands/deepseek.svg 200 且 svg 头；页面渲染
  断言含 img 引用与手绘兜底共存路径；
- path-limited commit（G13L-*）；每批 BATCH-NN 回执；D15 语义；
  模板正则双写；除上述路由外零后端改动。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-013L-completion.json` 落盘。
