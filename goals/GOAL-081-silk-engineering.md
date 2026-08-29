# GOAL-081: 丝滑工程——渲染竞态根治、终端面与零门槛首单 (Silk Engineering: Render-Race Fix, Terminal Surface & Zero-Config First Task)

- 状态：`AUTO_ACCEPTED`（2026-08-29 Kimi 施工完毕：键控增量补丁 + 文档级事件委托根治渲染竞态、审批卡内联聊天流、第一单零配置引导、`mush chat` 终端 REPL；g081 机检 10/10 + g076 基线 7/7 + typecheck 零错误；机检规格全绿按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：owner 体验关切（对标 codex/zcode「顺畅丝滑」）+ 头犬实测证据——SSE 快照周期性 innerHTML 全量重建导致点击被吞/定位超时（G076 视觉核验与 G078 审核两度亲历）
- 优先级：高
- 依赖：无硬依赖；**施工窗口排在 GOAL-079 收官之后**（page.ts 同战场避让）；无框架红线不变

---

## 1. 目标与价值

「丝滑」的本质不是动效（079 在做），而是**界面永远只动该动的那一块、永远响应**。当前 SSE 快照全量 `innerHTML` 重建造成三类体感伤害：点击被吞（渲染瞬间节点换掉）、列表闪烁、滚动位置跳动。本 Goal 根治渲染竞态，并把 mush 带到用户所在的地方——codex/zcode 用户住在终端，`mush chat` REPL 让他们不换工具也能用上雪橇队；审批内联让批准不打断对话主轴；第一单零配置让试用者 30 秒见到头犬干活（直接喂 GOAL-077）。

价值：体验是商业化门面的最后一层；渲染竞态根治同时是无人值守看板长期挂机的稳定性前提。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/web/page.ts` [MODIFY] — **渲染竞态根治**：SSE 快照从整段 innerHTML 重建改为键控增量更新（per-list keyed patch：按 id/diff 更新变化的卡片节点）+ 全站事件委托（document 级委托替代 per-render 绑定，节点重建不再丢监听）。零框架手写，不引库
- `src/cli.ts` [MODIFY] + `src/web/repl.ts` [NEW] — **`mush chat` 交互式 REPL**：复用 `/api/chat` + SSE（v1.13 契约），readline 会话（发送/流式渲染/中断 Ctrl+C/Ctrl+T 思维链展开）；无头命令面雏形已在
- `src/web/page.ts` [MODIFY] — **D30 派发审批卡内联聊天流**（复用 G075 计划卡组件形态：批准/否决/改后批准三键，批准即回执卡）；看板审批面板保留为聚合视图
- `src/web/server.ts` [MODIFY] + `src/web/page.ts` [MODIFY] — **第一单零配置**：首次启动（无任何已验证犬）默认挂 opencode free 通道（G070 地基）+ 引导横幅「直接发第一单，稍后再配其它犬」；探测式配置助手（失败自诊断人话指引，与 080 预检门共用文案）
- `src/web/api-contract.md` [VERIFY] — 前端重构不动任何契约；REPL 仅消费既有端点，无新端点

### 2.2 设计约束（宪法级）
- 零框架/零 CDN/零构建步骤（076 §4.2 延续）；DEF-07 转义铁律；术语人话表（076 §4.3）全站套用；prefers-reduced-motion 遵循 079 令牌。

## 3. 验收规格

- [x] 新建自动化测试 `tests/g081-silk.test.ts`（10/10）：键控更新断言（改一张卡片只动一个节点，其余节点引用不变——最小 DOM 桩实测 page.ts 内嵌 patchList 副本的 DOM 节点同一性）；事件委托断言（g081DelegateClicks 捕获相 document 委托覆盖全部卡片动作属性，渲染后无需重绑即可点击）；DEF-07 解析守卫（模板转义泄漏 + 内嵌副本无 TS 语法）
- [x] 竞态回归：模拟「快照渲染期间点击」场景（复现原缺陷的时序），点击不丢失（`scripts/g081-render-race-regression.cjs`：Playwright 可用时真实浏览器交错压测，无浏览器环境自动降级 DOM 桩 + 服务端冒烟 3/3——本机 ms-playwright 浏览器二进制未安装，桩口径已 PASS）
- [x] `mush chat` REPL 冒烟：发送 → 流式渲染（SSE EXECUTE 增量直写 stdout）→ Ctrl+C 中断当前回合（本地渲染中断，服务端派发留痕不撤）→ 会话持久化与看板一致（共用 runtime/chat/<session_id>.jsonl，/resume 续接）；不可达看板时报人话指引 exit 3（实测）
- [x] 审批内联：审批卡在聊天流可见可批（chat-approval-card 批准/否决/改后批准三键 + Prompt 预览折叠）；批后回执卡就位（原卡回填 ✅/⛔ 徽标 + 时间戳）；看板栏顶审批卡保留为聚合视图
- [x] 第一单零配置：全新 runtime 启动（无任何已验证犬）→ `GET /api/snapshot` 派生 `first_task.zero_config=true` → 引导横幅升起 → 「发第一单」一键预填 opencode 免费通道（G070 地基），仍过 D30 审批卡
- [x] g076 回归基线 7/7 不破（2026-08-29 复跑实测）；全量测试 693/693 全绿 + typecheck 零错误
- [x] 严格遵守宪法红线：零框架/零 CDN/零凭据、不动 API 契约（仅 v1.45 向后兼容新增 snapshot.first_task 只读派生信号）、施工避开 079 在途文件区（079 已 AUTO_ACCEPTED 落库，081 开工于其基线之上）

## 4. 施工留痕（2026-08-29 Kimi）

- `src/web/ui/keyed-patch.ts` [NEW]：键控包裹段 `keyedListHtml` + 计划层 `planPatch`（Node 侧纯函数）；DOM 副本以同构形态内嵌 page.ts（内联 <script> 无法 import）。
- `src/web/page.ts` [MODIFY]：`patchList`/`clearKeyed` 内嵌副本；`g081DelegateClicks` 文档级捕获相委托（任务卡五动作 + 审批 respond/toggle + 去审批 + 溢出菜单）；renderDispatches / renderTasks 泳道 / renderRailApprovals / renderRailDogs / renderEpochs / renderRecentActivity 六处 SSE 高频列表全部键控增量；审批内联三键卡（chat-approval-card + chatApprovalRespond 回执）；第一单零配置横幅（localStorage 关闭持久化）。
- `src/web/server.ts` [MODIFY]：snapshot 派生 `first_task` 信号；GOAL-082 在途 escalate 钩子接线对齐内核（传提问文本）。
- `src/core/mission-supervisor.ts` [MODIFY]： escalate 钩子类型修正（question: string）——080/082 在途缺陷修复。
- `src/web/repl.ts` [NEW] + `src/cli.ts` [MODIFY]：`mush chat` REPL（Caller-Token 协商 /api/session → /api/stream SSE → POST /api/chat 202；Ctrl+T 思维链开关、/quit、/resume、/think）。
- `src/web/api-contract.md` [MODIFY]：v1.45 扩展节（first_task 字段语义 + REPL 零新端点声明）。
- `tests/web-chat-panel.test.ts` [MODIFY]：审批直通断言随内联卡升级（chat pending approval → chat-approval-card）。
