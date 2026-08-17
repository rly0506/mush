/**
 * mush Web 看板（GOAL-005 U3 + GOAL-007 + GOAL-012）— 单页静态 HTML。
 * 无框架、无构建、无 CDN 外链；视图：对话（聊天面板+动作卡+审批直通）/
 * 调度（派发+workspace+跟踪）/ 犬队状态（roster 角色列+动效 logo）/
 * epoch 事件链 / 预算消耗（GET /api/budget 真实数据）/ 审批弹窗。
 * 契约：src/web/api-contract.md v1（v1.3 聊天节先行落盘，联调批补）。
 * 密钥红线：永不渲染凭据材料。
 *
 * 设计母题（GOAL-012）：「极夜雪橇队」——极夜蓝黑雪原 + 极光青辉 +
 * 琥珀营地火；CSS 变量令牌化；动效 logo 为内联手绘 SVG（各模型家族
 * 意象：DeepSeek 鲸 / Claude 日冕 / OpenAI 花结 / GLM 星 / Kimi 新月）。
 */

export function renderBoardPage(): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mush 看板 · 雪橇队指挥台</title>
<style>
  :root {
    color-scheme: light;
    /* 设计令牌：雪原营地母题（GOAL-020，frontend-design 准则；极夜→雪原白昼，D33） */
    --bg: #eef1f5;
    --panel: #ffffff;
    --panel-hi: #f6f8fa;
    --line: #e3e8ee;
    --ink: #1d2733;
    --ink-dim: #5a6675;
    --ink-faint: #9aa5b1;
    --accent: #0e9f8f;        /* 极光青（压暗保亮色底对比度）：雪原白昼主题 */
    --accent-deep: #bfe3de;
    --ember: #c07a1f;         /* 营地火琥珀：营地灯与篝火 */
    --ember-tint: #fdf3e3;    /* 审批 tinted 浅琥珀底（dashi 收编式） */
    --danger: #d24a3e;
    --ok: #2e9e5b;
    --info: #4a7fb8;
    --whale: #4d9fe8;         /* DeepSeek 鲸蓝 */
    --sun: #e8975a;           /* Claude 日冕橙 */
    --knot: #6fd3a5;          /* OpenAI 花结绿 */
    /* GOAL-017B #4：各家族官方品牌主色（owner 2026-08-17 指定） */
    --brand-deepseek: #4D6BFE;
    --brand-claude: #D97757;
    --brand-kimi: #7C5CFF;
    --brand-glm: #4E7AC7;
    --brand-opencode: #F6BF67;
    --brand-codex: #8a9cb0;   /* codex 手绘灰兜底 */
    --star: #a98ae8;          /* GLM 星紫 */
    --moon: #8fb7d8;          /* Kimi 新月银蓝 */
    --font-body: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    --font-mono: Consolas, "Courier New", monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--font-body); background: var(--bg); color: var(--ink); }
  header {
    padding: 14px 22px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    background: linear-gradient(180deg, #ffffff 0%, var(--bg) 100%);
  }
  header .brand { display: flex; align-items: center; gap: 10px; }
  header .brand svg { display: block; }
  header h1 { font-size: 15px; margin: 0; letter-spacing: 3px; font-weight: 600; color: var(--ink); }
  header .meta { font-size: 12px; color: var(--ink-dim); }
  #workspace-current {
    font-size: 12px; color: var(--ember); border: 1px solid var(--ember);
    border-radius: 10px; padding: 1px 10px;
  }
  #head-dog-badge {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--accent);
    border: 1px solid var(--accent-deep); background: #eafaf7;
    border-radius: 10px; padding: 3px 11px 3px 5px;
  }
  #head-dog-badge .logo-slot { display: inline-flex; width: 20px; height: 20px; }
  #head-dog-badge .logo-slot svg, #head-dog-badge .logo-slot img { width: 20px; height: 20px; }
  /* GOAL-020 B3：审批收编卡（dashi 收编式，琥珀 tint，常态零红色储备） */
  .rail-appr-card { background: var(--ember-tint); border: 1px solid var(--ember); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; font-size: 12px; }
  .rail-appr-head { display: flex; align-items: center; gap: 8px; }
  .ember-badge { color: var(--ember); border-color: var(--ember); background: transparent; }
  .rail-appr-goal-inline { font-weight: 600; color: var(--ink); font-size: 12px; }
  .rail-appr-body { margin-top: 6px; border-top: 1px dashed var(--ember); padding-top: 6px; }
  .rail-appr-row { padding: 2px 0; color: var(--ink-dim); }
  .rail-appr-label { display: inline-block; min-width: 76px; color: var(--ink-faint); font-size: 11px; }
  .rail-appr-goal { font-weight: 600; color: var(--ink); font-size: 13px; }
  .rail-appr-prompt { white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow: auto; border: 1px solid var(--line); padding: 6px; border-radius: 4px; margin: 4px 0 0; background: var(--panel); }
  .rail-appr-actions { display: flex; gap: 6px; margin-top: 8px; }
  .rail-appr-actions .act { padding: 3px 12px; font-size: 12px; }
  /* GOAL-020 B5：任务池三泳道（dashi 范式入位新骨架） */
  .task-board { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .task-lane { background: var(--panel-hi); border: 1px solid var(--line); border-radius: 8px; padding: 10px; min-height: 200px; }
  .task-lane h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--ink-dim); letter-spacing: 1px; }
  .lane-todo h3 { color: #7a5cc0; }
  .lane-doing h3 { color: var(--info); }
  .lane-done h3 { color: var(--ok); }
  .task-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; font-size: 13px; }
  .task-card .task-title { font-weight: 600; color: var(--ink); margin-bottom: 4px; }
  .task-card .task-meta { font-size: 12px; color: var(--ink-faint); display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .task-card .task-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .task-card .task-actions .act { padding: 2px 10px; font-size: 11px; }
  .badge.prio-高 { color: var(--danger); border-color: var(--danger); }
  .badge.prio-中 { color: var(--ember); border-color: var(--ember); }
  .badge.prio-低 { color: var(--ink-faint); border-color: var(--ink-faint); }
  .badge.BLOCKED { color: var(--ember); border-color: var(--ember); }
  /* GOAL-018B：工作流视图 + 交接块样式 */
  .stream-card { cursor: pointer; }
  .stream-card:hover { border-color: var(--accent-deep); }
  .stream-timeline { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
  .stream-entry { font-size: 12px; padding: 3px 0; }
  .handoff-block { background: var(--panel-hi); border: 1px solid var(--accent-deep); border-radius: 8px; padding: 8px 12px; margin: 6px 0; }
  .handoff-title { font-size: 12px; color: var(--accent); margin-bottom: 4px; }
  .handoff-section { font-size: 12px; margin: 4px 0; }
  .handoff-label { color: var(--ink-dim); font-size: 11px; }
  .handoff-text { white-space: pre-wrap; word-break: break-word; }
  #chat-head-select option.unverified { color: var(--ink-faint); }
  .badge.unverified { color: var(--ink-faint); border-color: var(--ink-faint); font-size: 10px; }
  /* GOAL-017B #1：犬只管理（添加/移除） */
  .roster-manage { margin-bottom: 12px; display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .roster-manage label { font-size: 12px; color: var(--ink-dim); display: block; margin-bottom: 4px; }
  .roster-manage select, .roster-manage input { width: auto; padding: 6px 10px; font-size: 12px; }
  button.act.remove { color: var(--danger); border-color: var(--danger); padding: 2px 10px; font-size: 11px; }
  /* GOAL-017B #6：预算 cap 行内编辑 */
  .cap-input { width: 72px; padding: 2px 6px; font-size: 12px; display: inline-block; }
  .cap-edit-msg { font-size: 11px; margin-left: 6px; }
  nav { display: flex; gap: 4px; padding: 10px 22px 0; }
  nav button {
    background: var(--panel); color: var(--ink-dim); border: 1px solid var(--line);
    border-bottom: none; padding: 8px 18px; cursor: pointer; font-size: 13px;
    border-radius: 6px 6px 0 0; font-family: inherit;
  }
  nav button.active { background: var(--panel); color: var(--ink); border-color: var(--accent-deep); box-shadow: inset 0 2px 0 var(--accent); }
  main { padding: 18px 22px; border-top: 1px solid var(--line); max-width: 1280px; }
  section.view { display: none; }
  section.view.active { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--ink-dim); font-weight: 600; }
  code, .mono { font-family: var(--font-mono); font-size: 12px; color: #3d7a72; }
  .hash { color: var(--info); word-break: break-all; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; border: 1px solid; }
  .badge.WAITING { color: var(--ember); border-color: var(--ember); }
  .badge.APPROVED { color: var(--ok); border-color: var(--ok); }
  .badge.REJECTED { color: var(--danger); border-color: var(--danger); }
  .badge.ADMITTED { color: var(--info); border-color: var(--info); }
  .badge.DRY_RUN { color: var(--ok); border-color: var(--ok); }
  .badge.PASS { color: var(--ok); border-color: var(--ok); }
  .badge.RUNNING { color: var(--info); border-color: var(--info); }
  .badge.RUNNING::before { content: '●'; display: inline-block; margin-right: 4px; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  .elapsed { font-size: 11px; color: var(--ink-dim); margin-left: 6px; }
  .badge.BLOCKED_WAITING_OWNER, .badge.BLOCKED_ENV { color: var(--ember); border-color: var(--ember); }
  .badge.REJECTED { color: #e05252; border-color: #e05252; }
  .badge.SUPERSEDED { color: #8a94a6; border-color: #8a94a6; }
  .badge.FAIL { color: var(--danger); border-color: var(--danger); }
  .badge.ok { color: var(--ok); border-color: var(--ok); }
  .badge.broken { color: var(--danger); border-color: var(--danger); }
  .badge.role-head { color: var(--accent); border-color: var(--accent); }
  .badge.role-executor { color: var(--ink-dim); border-color: var(--ink-faint); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card h3 { margin: 0 0 8px; font-size: 13px; color: var(--ink-dim); font-weight: 600; }
  .empty { color: var(--ink-faint); font-size: 13px; padding: 24px 0; text-align: center; }
  #sse-status { font-size: 11px; }
  #sse-status.live { color: var(--ok); }
  #sse-status.down { color: var(--danger); }
  form#dispatch-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
  form#dispatch-form label { font-size: 12px; color: var(--ink-dim); display: block; margin-bottom: 4px; }
  form#dispatch-form .full { grid-column: 1 / -1; }
  select, input[type=number], input[type=text], textarea {
    width: 100%; background: #ffffff; color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit;
  }
  textarea { min-height: 90px; resize: vertical; }
  .hint { font-size: 11px; color: var(--ink-faint); margin-top: 4px; }
  #real-hint { color: var(--ember); display: none; }
  button.primary {
    background: #eafaf7; color: var(--accent); border: 1px solid var(--accent);
    border-radius: 6px; padding: 9px 22px; font-size: 13px; cursor: pointer; font-family: inherit;
  }
  button.primary:disabled { opacity: 0.45; cursor: default; }
  .dispatch-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; font-size: 13px; }
  .dispatch-card .head-row { cursor: pointer; }
  .dispatch-card:hover { border-color: var(--accent-deep); }
  .dispatch-card .detail { display: none; margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; user-select: text; cursor: auto; }
  .dispatch-card.open .detail { display: block; }
  dialog { background: var(--panel-hi); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 20px; max-width: 560px; width: 90%; }
  dialog::backdrop { background: rgba(0,0,0,.65); }
  dialog h2 { font-size: 15px; margin: 0 0 12px; }
  dialog dl { font-size: 13px; }
  dialog dt { color: var(--ink-dim); margin-top: 8px; }
  dialog dd { margin: 2px 0 0; word-break: break-all; }
  dialog .actions { margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end; }
  button.act { padding: 8px 18px; border-radius: 6px; border: 1px solid; cursor: pointer; font-size: 13px; background: transparent; font-family: inherit; }
  button.act.approve { color: var(--ok); border-color: var(--ok); }
  button.act.reject { color: var(--danger); border-color: var(--danger); }
  button.act.cancel { color: var(--ink-dim); border-color: var(--line); }
  /* 通知栈（GP-18）：多条 toast 叠放，终态成功/失败分色 */
  #toast-stack { position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 99; }
  .toast { padding: 10px 16px; border-radius: 6px; font-size: 13px; max-width: 420px; animation: toast-in .18s ease-out; }
  .toast.ok { background: #e8f6ee; color: var(--ok); border: 1px solid var(--ok); }
  .toast.err { background: #fbeae8; color: var(--danger); border: 1px solid var(--danger); }
  @keyframes toast-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
  .bar { height: 8px; background: #e3e8ee; border-radius: 4px; overflow: hidden; min-width: 120px; }
  .bar > div { height: 100%; background: var(--ok); }
  .bar.hot > div { background: var(--danger); }
  /* ---------- GOAL-012：聊天面板（对话视图 = 北极星界面） ---------- */
  #view-chat { display: none; }
  /* GOAL-020 B2：单屏指挥台 —— 对话主区 + 右侧犬队栏（星型结构视觉化） */
  #view-chat.active.deck { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; height: calc(100vh - 130px); min-height: 420px; }
  #view-chat .deck-main { display: flex; flex-direction: column; min-width: 0; }
  #view-chat .deck-main #chat-stream { flex: 1; }
  .deck-rail { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
  .rail-block { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .rail-title { margin: 0 0 8px; font-size: 12px; color: var(--ink-dim); font-weight: 600; letter-spacing: 1px; }
  .rail-dog-card { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid var(--line); font-size: 12px; }
  .rail-dog-card:last-child { border-bottom: none; }
  .rail-dog-card .rail-dog-name { font-weight: 600; color: var(--ink); }
  .rail-dog-card .rail-dog-note { color: var(--ink-dim); font-size: 11px; margin-left: auto; text-align: right; }
  nav button.drawer-tab { font-size: 12px; padding: 6px 12px; color: var(--ink-faint); }
  nav button.drawer-tab.active { color: var(--ink); }
  .chat-toolbar { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; font-size: 12px; color: var(--ink-dim); flex-wrap: wrap; }
  .chat-toolbar label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  #chat-stream {
    flex: 1; overflow-y: auto; background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
  }
  .chat-row { display: flex; gap: 10px; max-width: 88%; }
  /* GOAL-020 B4 签名元素：头犬品牌色描边大徽章（28px），owner 侧素色爪印 */
  .chat-row .avatar { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
  .chat-row .avatar svg, .chat-row .avatar img { width: 30px; height: 30px; }
  .chat-row.head .avatar .dog-logo svg, .chat-row.head .avatar .dog-logo img { width: 28px; height: 28px; }
  .chat-row.head .avatar .dog-logo { border: 2px solid currentColor; border-radius: 50%; padding: 2px; }
  /* B4 排版阶梯：对话正文 15px/1.7（读起来是「对话」不是「日志」） */
  .chat-row .bubble {
    background: var(--panel-hi); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 14px; font-size: 15px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
  }
  .chat-row.head .bubble { font-weight: 600; color: var(--ink); background: var(--panel); }
  .chat-row .who { font-size: 12px; color: var(--ink-faint); margin-bottom: 3px; }
  .chat-row.user { align-self: flex-end; flex-direction: row-reverse; }
  .chat-row.user .bubble { background: #eafaf7; border-color: var(--accent-deep); }
  .chat-row.user .who { text-align: right; color: var(--accent); }
  .chat-row.head .who { color: var(--ember); }
  .chat-action-card {
    align-self: stretch; margin-left: 40px; background: var(--panel-hi); border: 1px dashed var(--accent-deep);
    border-radius: 8px; padding: 8px 12px; font-size: 12px; color: var(--ink-dim);
  }
  .chat-action-card .mono { color: var(--info); }
  #chat-composer { display: flex; gap: 10px; padding-top: 12px; }
  #chat-input { flex: 1; min-height: 44px; max-height: 160px; }
  #chat-send { flex: none; align-self: flex-end; }
  /* D2（GOAL-012B）：思考中占位气泡 —— 三点呼吸动画（极夜主题令牌） */
  .thinking-bubble { min-width: 72px; }
  .thinking-dots { display: inline-flex; gap: 5px; padding: 4px 2px; }
  .thinking-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: think-dot 1.2s ease-in-out infinite; }
  .thinking-dots i:nth-child(2) { animation-delay: .18s; }
  .thinking-dots i:nth-child(3) { animation-delay: .36s; }
  @keyframes think-dot { 0%, 100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
  .thinking-elapsed { color: var(--ink-dim); }
  /* ---------- GOAL-012 + GOAL-013L：犬只标识（官方品牌 img 优先，手绘 SVG 兜底）与三态动效 ---------- */
  .dog-logo { display: inline-flex; vertical-align: middle; }
  .dog-logo svg, .dog-logo img { width: 22px; height: 22px; display: block; }
  /* GOAL-017B #4：常态品牌色着色；运行态 = 边缘 drop-shadow 辉光（品牌色）+ 跳动。
     品牌色由内联 style --dog-brand 注入（官方主色表），辉光读变量。 */
  .dog-logo.working svg, .dog-logo.working img { animation: logo-hop 1.2s ease-in-out infinite, logo-glow 1.4s ease-in-out infinite; transform-origin: 50% 80%; }
  @keyframes logo-hop {
    0%, 100% { transform: translateY(0) scale(1, 1); }
    35% { transform: translateY(-5px) scale(0.96, 1.05); }
    60% { transform: translateY(0) scale(1.04, 0.94); }
    80% { transform: translateY(-2px) scale(0.99, 1.02); }
  }
  @keyframes logo-glow {
    0%, 100% { filter: drop-shadow(0 0 1px var(--dog-brand, currentColor)); }
    50% { filter: drop-shadow(0 0 5px var(--dog-brand, currentColor)); }
  }
  /* terminal-flash：终态到达时一次落定闪（PASS 绿 / FAIL 红），一次即停 */
  .dog-logo.terminal-flash.flash-pass svg, .dog-logo.terminal-flash.flash-pass img { animation: logo-settle-flash 0.7s ease-out 1; --flash-color: #5fd08a; }
  .dog-logo.terminal-flash.flash-fail svg, .dog-logo.terminal-flash.flash-fail img { animation: logo-settle-flash 0.7s ease-out 1; --flash-color: #f0665a; }
  @keyframes logo-settle-flash {
    0% { transform: translateY(-6px) scale(1.06); filter: drop-shadow(0 0 8px var(--flash-color)); }
    55% { transform: translateY(1px) scale(0.97); filter: drop-shadow(0 0 5px var(--flash-color)); }
    100% { transform: none; filter: none; }
  }
  /* idle：静止，仅悬停微反馈 */
  .dog-logo:not(.working):hover svg, .dog-logo:not(.working):hover img { transform: translateY(-1px); }
  @media (prefers-reduced-motion: reduce) {
    /* 降级为辉光呼吸（无位移） */
    .dog-logo.working svg, .dog-logo.working img { animation: logo-glow 1.4s ease-in-out infinite; }
    .dog-logo.terminal-flash svg, .dog-logo.terminal-flash img { animation: logo-glow 0.7s ease-out 1; }
    .badge.RUNNING::before, .toast, .thinking-dots i { animation: none; }
  }
</style>
</head>
<body>
<header>
  <span class="brand">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 18h20" stroke="#62d8c9" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M4 18c0-2 1.5-3 3-3" stroke="#62d8c9" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="9" cy="12" r="2.2" stroke="#e8a94c" stroke-width="1.4"/>
      <circle cx="14" cy="12" r="2.2" stroke="#8fb7d8" stroke-width="1.4"/>
      <circle cx="19" cy="12" r="2.2" stroke="#a98ae8" stroke-width="1.4"/>
      <path d="M8 10l-3-4M13 10l-1-5M18 10l2-4" stroke="#8a9cb0" stroke-width="1.1" stroke-linecap="round"/>
    </svg>
    <h1>mush · 雪橇队指挥台</h1>
  </span>
  <span id="head-dog-badge" title="当前头犬（role: head）"><span class="logo-slot" id="head-dog-logo"></span><span id="head-dog-name">当前头犬：…</span></span>
  <span id="workspace-current" title="当前 workspace">…</span>
  <span class="meta" id="generated"></span>
  <span class="meta" id="sse-status">SSE 连接中…</span>
</header>
<nav>
  <button data-view="chat" class="active">对话</button>
  <button data-view="tasks">任务池</button>
  <button data-view="dispatch" class="drawer-tab">调度</button>
  <button data-view="streams" class="drawer-tab">工作流</button>
  <button data-view="dogs" class="drawer-tab">犬队状态</button>
  <button data-view="epochs" class="drawer-tab">事件链</button>
  <button data-view="budget" class="drawer-tab">预算消耗</button>
  <button data-view="approvals" class="drawer-tab">审批 <span id="waiting-count"></span></button>
</nav>
<main>
  <section id="view-chat" class="view active deck">
    <div class="deck-main">
    <div class="chat-toolbar">
      <span>你只和头犬说话 —— 它自主派活、审核回报，触发门会弹回这里。</span>
      <label>头犬 <select id="chat-head-select" style="width:auto;padding:3px 8px;font-size:12px"></select></label>
      <label id="chat-head-variant-wrap" style="display:none">模型 <select id="chat-head-variant" style="width:auto;padding:3px 8px;font-size:12px"></select></label>
      <label>思维 <select id="chat-effort" style="width:auto;padding:3px 8px;font-size:12px">
        <option>LOW</option>
        <option selected>HIGH</option>
        <option>XHIGH</option>
      </select></label>
      <label>会话 <select id="chat-session-select" style="width:auto;padding:3px 8px;font-size:12px"><option value="">（新会话）</option></select></label>
      <span class="mono" id="chat-session-label"></span>
      <label><input type="checkbox" id="notify-toggle"> 浏览器通知（派发终态，需授权）</label>
      <button class="act cancel" id="chat-new-session" type="button" style="padding:3px 10px;font-size:12px">新会话</button>
    </div>
    <div id="chat-stream"><div class="empty">向头犬下达第一条指令，开始对话。</div></div>
    <div id="chat-composer">
      <textarea id="chat-input" maxlength="64000" placeholder="写给头犬的指令…（Enter 发送，Shift+Enter 换行）"></textarea>
      <button class="primary" id="chat-send">发送</button>
    </div>
    </div>
    <aside class="deck-rail" id="deck-rail">
      <div id="rail-approvals"></div>
      <div class="rail-block">
        <h3 class="rail-title">犬队</h3>
        <div id="rail-dogs"></div>
      </div>
      <div class="rail-block">
        <h3 class="rail-title">预算</h3>
        <div id="rail-budget"></div>
      </div>
    </aside>
  </section>
  <section id="view-tasks" class="view">
    <div class="hint" style="margin-bottom:8px">任务池（dashi 式三泳道；v1.7 契约未落盘处 mock 消费，联调批补真）。</div>
    <div class="task-board">
      <div class="task-lane lane-todo"><h3>待办</h3><div class="lane-body" id="lane-todo"></div></div>
      <div class="task-lane lane-doing"><h3>进行中</h3><div class="lane-body" id="lane-doing"></div></div>
      <div class="task-lane lane-done"><h3>完成</h3><div class="lane-body" id="lane-done"></div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h3>新建任务卡</h3>
      <form id="task-create-form" style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
        <div><label for="task-title" style="font-size:12px;color:var(--ink-dim);display:block;margin-bottom:4px">标题</label>
          <input type="text" id="task-title" placeholder="任务标题"></div>
        <div><label for="task-priority" style="font-size:12px;color:var(--ink-dim);display:block;margin-bottom:4px">优先级</label>
          <select id="task-priority"><option>高</option><option selected>中</option><option>低</option></select></div>
        <div><label for="task-source" style="font-size:12px;color:var(--ink-dim);display:block;margin-bottom:4px">来源</label>
          <input type="text" id="task-source" placeholder="GP-XX 或 manual" value="manual"></div>
        <button type="submit" class="primary" id="btn-task-create">建卡</button>
      </form>
      <div style="margin-top:8px"><label for="task-detail" style="font-size:12px;color:var(--ink-dim);display:block;margin-bottom:4px">详情（可选）</label>
        <textarea id="task-detail" maxlength="8000" placeholder="任务详情…" style="min-height:56px"></textarea></div>
    </div>
  </section>
  <section id="view-dispatch" class="view">
    <div class="card">
      <h3>派发任务</h3>
      <form id="dispatch-form">
        <div>
          <label for="dispatch-adapter">犬只（在册，身份证明）</label>
          <select id="dispatch-adapter"></select>
        </div>
        <div id="dispatch-model-wrap" style="display:none">
          <label for="dispatch-model">模型变体</label>
          <select id="dispatch-model"></select>
          <div class="hint">变体 = 身份期望（合同声明），非实时能力清单。</div>
        </div>
        <div>
          <label for="workspace-select">workspace</label>
          <select id="workspace-select"></select>
          <div style="display:flex;gap:6px;margin-top:6px">
            <input type="text" id="workspace-register-path" placeholder="登记新路径，如 D:\\mush-playground" style="flex:1;font-family:Consolas,monospace;font-size:12px">
            <button type="button" class="act approve" id="btn-workspace-register">登记</button>
          </div>
        </div>
        <div class="full">
          <label for="dispatch-prompt">任务</label>
          <textarea id="dispatch-prompt" maxlength="64000" placeholder="写给犬的任务…"></textarea>
        </div>
        <div>
          <label for="dispatch-stream">工作流（v1.6，可选）</label>
          <select id="dispatch-stream"><option value="">（自动归流：同犬×Goal 归活动流）</option></select>
          <div style="display:flex;gap:10px;margin-top:6px;font-size:12px;color:var(--ink-dim);align-items:center;flex-wrap:wrap">
            <label style="margin:0"><input type="checkbox" id="dispatch-new-stream"> 新开流</label>
            <label style="margin:0"><input type="checkbox" id="dispatch-new-window"> 强制新窗（同流不复用当前窗口/session）</label>
          </div>
        </div>
        <div>
          <label for="dispatch-effort">effort 档位（D20）</label>
          <select id="dispatch-effort">
            <option>LOW</option>
            <option>HIGH</option>
            <option>XHIGH</option>
          </select>
        </div>
        <div>
          <label for="dispatch-cap">cap_usd（per-actor 上限）</label>
          <input type="number" id="dispatch-cap" min="0.01" step="0.01" value="5">
        </div>
        <div>
          <label><input type="checkbox" id="dispatch-real"> real（真实执行，花钱）</label>
          <div class="hint" id="real-hint">real 模式需 approval 在案（D6），否则 BLOCKED_WAITING_OWNER。</div>
        </div>
        <div style="align-self:end"><button type="submit" class="primary" id="btn-dispatch">派发</button></div>
      </form>
      <div class="hint" id="dispatch-result"></div>
    </div>
    <h3 style="font-size:13px;color:var(--ink-dim)">派发跟踪</h3>
    <div id="dispatch-list"><div class="empty">暂无派发记录</div></div>
  </section>
  <section id="view-dogs" class="view"><div class="roster-manage" id="roster-manage"></div><div id="dogs-table"></div></section>
  <section id="view-streams" class="view"><div class="hint" style="margin-bottom:8px">工作流只读视图（流管理面板属 GP-31）。窗口键 = 犬×Goal；交接块随流记录归档。</div><div id="streams-list"><div class="empty">暂无工作流（v1.6 流 API 落盘后自动出现）</div></div></section>
  <section id="view-epochs" class="view"></section>
  <section id="view-budget" class="view"></section>
  <section id="view-approvals" class="view"></section>
</main>
<div id="approval-dialog" style="display:none">
  <dl id="approval-detail"></dl>
  <button class="act cancel" id="btn-cancel" type="button">取消</button>
  <button class="act reject" id="btn-reject" type="button">否决</button>
  <button class="act approve" id="btn-approve" type="button">批准</button>
</div>
<dialog id="workspace-create-dialog">
  <h2>新建 workspace</h2>
  <p style="font-size:13px">目录不存在，是否新建并登记？</p>
  <p class="mono" id="workspace-create-path" style="word-break:break-all"></p>
  <p class="hint" style="color:var(--ember)">登记后此目录将对犬队开放写入。</p>
  <div class="actions">
    <button class="act cancel" id="btn-create-cancel">取消</button>
    <button class="act approve" id="btn-create-confirm">新建并登记</button>
  </div>
</dialog>
<div id="toast-stack"></div>
<script>
(function () {
  'use strict';
  var snapshot = null;
  var budget = null;
  var workspaces = [];
  var currentApproval = null;
  var trackedDispatches = [];

  // 时间显示本地化（存储仍为 UTC；owner 2026-08-17 反馈：20 点显示 12:xx Z 造成误读）。
  function fmtTime(iso) {
    if (!iso) return '';
    var t = new Date(iso);
    if (isNaN(t.getTime())) return String(iso);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return (t.getMonth() + 1) + '-' + p2(t.getDate()) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds());
  }

  function escTime(iso) { return esc(fmtTime(iso)); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function shortHash(hash) { return hash ? esc(hash.slice(0, 12)) + '…' : '—'; }

  /* ---------- GOAL-012 / GP-18：通知栈（toast 默认开；Notification 需授权开关） ---------- */
  var notifyPref = { toast: true, browser: false };
  try {
    var saved = JSON.parse(localStorage.getItem('mush.notify') || 'null');
    if (saved && typeof saved === 'object') {
      notifyPref.toast = saved.toast !== false;
      notifyPref.browser = saved.browser === true;
    }
  } catch (e) { /* 损坏偏好按默认 */ }

  function saveNotifyPref() {
    try { localStorage.setItem('mush.notify', JSON.stringify(notifyPref)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function toast(message, ok) {
    if (!notifyPref.toast) return;
    var stack = document.getElementById('toast-stack');
    var el = document.createElement('div');
    el.className = 'toast ' + (ok ? 'ok' : 'err');
    el.textContent = message;
    stack.appendChild(el);
    while (stack.children.length > 4) stack.removeChild(stack.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
  }

  // 派发终态浏览器通知：仅在用户显式开启且授权后触发；页面可见时不打扰。
  function notifyTerminal(status, adapterId) {
    if (!notifyPref.browser) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    var good = status === 'PASS' || status === 'DRY_RUN';
    try {
      new Notification(good ? 'mush：派发完成' : 'mush：派发终态', {
        body: status + '（' + adapterId + '）'
      });
    } catch (e) { /* 某些环境构造受限，静默 */ }
  }

  function getJson(url) {
    return fetch(url).then(function (res) { return res.json(); });
  }
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, body: data }; });
    });
  }

  /* ---------- GOAL-012 / GP-23 + GOAL-017B #4：犬只标识（官方品牌 img 优先，手绘兜底；品牌官方主色） ---------- */
  // family 供 CSS currentColor 配色；品牌色 = owner 2026-08-17 指定官方主色表。
  var FAMILY_COLORS = { whale: '#4D6BFE', sun: '#D97757', knot: '#8a9cb0', star: '#4E7AC7', moon: '#7C5CFF', paw: '#8a9cb0' };
  // GOAL-017B：品牌色按 brand（官方主色）；opencode 官方主色表（owner 指定值）。
  var BRAND_COLORS = { deepseek: '#4D6BFE', claude: '#D97757', kimi: '#7C5CFF', glm: '#4E7AC7', opencode: '#F6BF67', codex: '#8a9cb0' };

  function detectFamily(text) {
    var t = String(text || '').toLowerCase();
    if (t.indexOf('deepseek') >= 0) return 'whale';
    if (t.indexOf('claude') >= 0 || t.indexOf('anthropic') >= 0) return 'sun';
    if (t.indexOf('kimi') >= 0 || t.indexOf('moonshot') >= 0) return 'moon';
    if (t.indexOf('glm') >= 0 || t.indexOf('zhipu') >= 0 || t.indexOf('zcode') >= 0) return 'star';
    if (t.indexOf('codex') >= 0 || t.indexOf('opencode') >= 0 || t.indexOf('gpt') >= 0 || t.indexOf('openai') >= 0) return 'knot';
    return 'paw';
  }

  var LOGO_SHAPES = {
    whale: '<path d="M3 14c3-6 9-8 13-6 3 1.4 4.6 3.4 5 6-2.5 2.6-6 4-10 3.4-4-.6-6.8-1.8-8-3.4z" fill="currentColor"/>' +
      '<path d="M18 8l2-3 1 4" fill="currentColor"/><circle cx="8.2" cy="12.4" r="0.9" fill="#0a0f16"/>',
    sun: '<circle cx="12" cy="12" r="4.6" fill="currentColor"/>' +
      '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></g>',
    knot: '<g fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<circle cx="12" cy="6.5" r="3.4"/><circle cx="16.8" cy="14.5" r="3.4"/><circle cx="7.2" cy="14.5" r="3.4"/></g>',
    star: '<path d="M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2-7.2-2.3 7.2-2.3z" fill="currentColor"/>',
    moon: '<path d="M14.5 3a9 9 0 1 0 6.5 15.2A10.5 10.5 0 0 1 14.5 3z" fill="currentColor"/>',
    paw: '<circle cx="12" cy="14.5" r="4.2" fill="currentColor"/>' +
      '<circle cx="6.5" cy="9.5" r="1.9" fill="currentColor"/><circle cx="10.2" cy="6.8" r="1.9" fill="currentColor"/>' +
      '<circle cx="13.8" cy="6.8" r="1.9" fill="currentColor"/><circle cx="17.5" cy="9.5" r="1.9" fill="currentColor"/>'
  };

  // GOAL-013L：官方品牌图标兜底链 —— adapter → assets/brands/<name>.svg 存在即用
  // 官方 <img>（currentColor 主题化由资产内 fill=currentColor + 容器 color 继承）；
  // 加载失败（onerror）静默回退手绘内联 SVG，不留破图；codex/zcode 直接手绘。
  // 将来新增官方图标只需把 SVG 丢进 assets/brands/（如 openai.svg → codex 自动切换）。
  var BRAND_MAP = {
    'deepseek-dsh': 'deepseek',
    'claude-code': 'claude',
    'kimi': 'kimi',
    'opencode': 'opencode',
    'head-dog': 'deepseek' // 头犬徽章与 deepseek 通道同源
  };

  function brandAssetFor(hint) {
    var t = String(hint || '').toLowerCase();
    // 先按 adapter 全名精确映射（词边界防 deepseek-dsh-x 之类误配），再按包含回退。
    var ids = Object.keys(BRAND_MAP);
    for (var i = 0; i < ids.length; i += 1) {
      if (new RegExp('(^|[^a-z0-9])' + ids[i].replace(/-/g, '\\-') + '([^a-z0-9]|$)').test(t)) return BRAND_MAP[ids[i]];
    }
    if (t.indexOf('deepseek') >= 0) return 'deepseek';
    if (t.indexOf('claude') >= 0) return 'claude';
    if (t.indexOf('kimi') >= 0 || t.indexOf('moonshot') >= 0) return 'kimi';
    if (t.indexOf('opencode') >= 0) return 'opencode';
    return null;
  }

  // dogLogo(hint, state)：state ∈ 'idle' | 'working' | 'flash-pass' | 'flash-fail'
  // （兼容旧布尔：true → working）。三态动效作用于容器内图标（img 与手绘同待遇）。
  // GOAL-017B #4：着色用官方品牌主色（BRAND_COLORS）；--dog-brand 注入供辉光读取。
  function dogLogo(hint, state) {
    var mode = state === true ? 'working' : (state || 'idle');
    var family = detectFamily(hint);
    var brand = brandAssetFor(hint);
    var color = brand !== null && BRAND_COLORS[brand] ? BRAND_COLORS[brand] : FAMILY_COLORS[family];
    var cls = 'dog-logo';
    if (mode === 'working') cls += ' working';
    if (mode === 'flash-pass' || mode === 'flash-fail') cls += ' terminal-flash ' + mode;
    var inner;
    if (brand !== null) {
      inner = '<img src="/assets/brands/' + brand + '.svg" alt="' + esc(brand) + '" ' +
        'onerror="this.onerror=null;var s=document.createElement(&quot;span&quot;);s.innerHTML=this.getAttribute(&quot;data-fallback&quot;);this.parentNode.replaceChild(s.firstChild,this);" ' +
        'data-fallback="' + esc('<svg viewBox="0 0 24 24" aria-hidden="true">' + LOGO_SHAPES[family] + '</svg>') + '">';
    } else {
      inner = '<svg viewBox="0 0 24 24" aria-hidden="true">' + LOGO_SHAPES[family] + '</svg>';
    }
    return '<span class="' + cls + '" style="color:' + color + ';--dog-brand:' + color + '" title="' + esc(family) + '">' + inner + '</span>';
  }

  /* ---------- GOAL-017B #2：头犬级联选择（harness → 模型变体两级） ----------
     数据：roster verified 项 × variants；UNVERIFIED 项灰显 + 原因徽标（F-50 等）。
     p17a 契约 v1.5 未落盘前按 mock 字段（verified/verify_reason/variants）开发，
     缺省视为 verified（向后兼容 v1.3 roster），联调批补真字段。 */
  var HEAD_WHITELIST = { 'head-dog': 1, 'deepseek-dsh': 1, 'claude-code': 1, 'kimi-code': 1, 'kimi': 1, 'zcode': 1 };

  function headCandidates() {
    var roster = (snapshot && snapshot.roster) || [];
    var heads = roster.filter(function (r) { return r.role === 'head' || HEAD_WHITELIST[r.adapter_id] === 1; });
    if (heads.length === 0) heads = [{ adapter_id: 'head-dog', expected_model_id: '', verified: true }];
    return heads;
  }

  function isVerifiedEntry(r) {
    // mock 语义：verified 字段缺省 true；verified===false 时灰显并附原因徽标。
    return r.verified !== false;
  }

  function unverifiedReason(r) {
    return r.verify_reason || r.unverified_reason || '通道未实证（UNVERIFIED）';
  }

  function renderHeadCascade() {
    var sel = document.getElementById('chat-head-select');
    if (!sel) return;
    var heads = headCandidates();
    var prev = sel.value;
    sel.innerHTML = heads.map(function (r) {
      var ok = isVerifiedEntry(r);
      var label = esc(r.adapter_id) + (ok ? '' : '（' + esc(unverifiedReason(r)) + '）');
      return '<option value="' + esc(r.adapter_id) + '"' + (ok ? '' : ' disabled class="unverified"') + '>' + label + '</option>';
    }).join('');
    if (prev && heads.some(function (r) { return r.adapter_id === prev && isVerifiedEntry(r); })) {
      sel.value = prev;
    } else {
      var firstOk = heads.filter(function (r) { return isVerifiedEntry(r); })[0];
      if (firstOk) sel.value = firstOk.adapter_id;
    }
    renderHeadVariantOptions();
  }

  function renderHeadVariantOptions() {
    var sel = document.getElementById('chat-head-select');
    var varSel = document.getElementById('chat-head-variant');
    if (!sel || !varSel) return;
    var heads = headCandidates();
    var current = heads.filter(function (r) { return r.adapter_id === sel.value; })[0] || null;
    var variants = (current && current.variants) || [];
    var wrap = document.getElementById('chat-head-variant-wrap');
    if (variants.length === 0) {
      wrap.style.display = 'none';
      varSel.innerHTML = '';
    } else {
      wrap.style.display = '';
      varSel.innerHTML = '<option value="">（默认模型）</option>' + variants.map(function (v) {
        return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
      }).join('');
    }
    renderHeadDogBadge();
  }

  /* ---------- 当前头犬标识（GOAL-017B #3：徽章链 = 所选 harness 官方图标 + 模型名，随选择联动） ---------- */
  var headFlashUntil = 0;

  function headBadgeState() {
    if (chatPending) return 'working';
    return 'idle';
  }

  function renderHeadDogBadge() {
    var nameEl = document.getElementById('head-dog-name');
    var logoEl = document.getElementById('head-dog-logo');
    if (!nameEl || !logoEl) return;
    var sel = document.getElementById('chat-head-select');
    var varSel = document.getElementById('chat-head-variant');
    var heads = headCandidates();
    var adapterId = sel && sel.value ? sel.value : (heads[0] ? heads[0].adapter_id : 'head-dog');
    var current = heads.filter(function (r) { return r.adapter_id === adapterId; })[0] || null;
    var model = varSel && varSel.value ? varSel.value : (current ? current.expected_model_id || '' : '');
    nameEl.textContent = '当前头犬：' + adapterId + (model ? ' · ' + model : '');
    logoEl.innerHTML = dogLogo(adapterId + ' ' + model, headBadgeState());
  }

  /* ---------- 犬只下拉（G009 修复：取 roster 注册名册；无活动时也应有犬可选） ---------- */
  function renderAdapterOptions() {
    var select = document.getElementById('dispatch-adapter');
    var roster = (snapshot && snapshot.roster) || [];
    if (roster.length > 0) {
      select.innerHTML = roster.map(function (r) {
        var badge = esc(r.expected_provider) + ' / ' + esc(r.expected_model_id);
        return '<option value="' + esc(r.adapter_id) + '" data-variants="' + esc((r.variants || []).join(',')) + '">' + esc(r.adapter_id) + '（' + badge + '）</option>';
      }).join('');
      renderModelOptions();
      return;
    }
    var actors = (snapshot && snapshot.actors) || [];
    if (actors.length === 0) {
      select.innerHTML = '<option value="">（无在册犬只）</option>';
      return;
    }
    select.innerHTML = actors.map(function (a) {
      var badge = esc(a.provider) + ' / ' + esc(a.model_id);
      return '<option value="' + esc(a.actor_instance_id) + '">' + esc(a.actor_instance_id) + '（' + badge + '）</option>';
    }).join('');
  }

  /* ---------- G009：模型变体下拉（合同 variants；无变体通道隐藏） ---------- */
  function renderModelOptions() {
    var wrap = document.getElementById('dispatch-model-wrap');
    var select = document.getElementById('dispatch-model');
    var adapterSelect = document.getElementById('dispatch-adapter');
    var opt = adapterSelect && adapterSelect.options[adapterSelect.selectedIndex];
    var variants = (opt && opt.getAttribute('data-variants') || '').split(',').filter(Boolean);
    if (variants.length === 0) { wrap.style.display = 'none'; select.innerHTML = ''; return; }
    wrap.style.display = '';
    select.innerHTML = variants.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }

  /* ---------- workspace 选择器（G7B-D1：歧义空项改为明确文案；selected 联动 header） ---------- */
  function renderWorkspaces() {
    var select = document.getElementById('workspace-select');
    if (workspaces.length === 0) {
      select.innerHTML = '<option value="">（未选择，默认服务目录）</option>';
      return;
    }
    var hasSelected = workspaces.some(function (w) { return w.selected; });
    select.innerHTML = workspaces.map(function (w) {
      var displayPath = normalizeDisplayPath(w.path);
      var tags = [];
      if (w.is_git) tags.push('git');
      if (w.mush_managed) tags.push('mush');
      if (w.selected) tags.push('当前');
      return '<option value="' + esc(w.path) + '"' + (w.selected ? ' selected' : '') + '>' +
        esc(displayPath) + (tags.length ? ' [' + tags.join(', ') + ']' : '') + '</option>';
    }).join('');
    if (!hasSelected) {
      select.insertAdjacentHTML('afterbegin', '<option value="" selected>（未选择，默认服务目录）</option>');
    }
    var current = workspaces.filter(function (w) { return w.selected; })[0];
    document.getElementById('workspace-current').textContent = current ? normalizeDisplayPath(current.path) : 'workspace: 服务 cwd';
  }

  /* ---------- 派发提交 ---------- */
  function submitDispatch(event) {
    event.preventDefault();
    var adapterId = document.getElementById('dispatch-adapter').value;
    var prompt = document.getElementById('dispatch-prompt').value.trim();
    var effort = document.getElementById('dispatch-effort').value;
    var capUsd = Number(document.getElementById('dispatch-cap').value);
    var real = document.getElementById('dispatch-real').checked;
    var workspace = document.getElementById('workspace-select').value;
    if (!adapterId) { toast('请选择犬只', false); return; }
    if (!prompt) { toast('任务不能为空', false); return; }
    var body = { adapter_id: adapterId, prompt: prompt, effort: effort, cap_usd: capUsd, real: real };
    if (workspace) body.workspace = workspace;
    // GOAL-018B #2：工作流控制面（v1.6 mock）——显式选流 / 新开流 / 强制新窗。
    var streamSel = document.getElementById('dispatch-stream');
    if (streamSel && streamSel.value) body.stream_id = streamSel.value;
    if (document.getElementById('dispatch-new-stream').checked) body.new_stream = true;
    if (document.getElementById('dispatch-new-window').checked) body.new_window = true;
    // GOAL-020 B5：任务卡派发预填携带 task_id（v1.7 回链）。
    var taskIdAttr = document.getElementById('dispatch-form').getAttribute('data-task-id');
    if (taskIdAttr) body.task_id = taskIdAttr;
    var modelSel = document.getElementById('dispatch-model');
    if (modelSel && modelSel.value) body.model_id = modelSel.value;
    postJson('/api/dispatch', body).then(function (result) {
      var data = result.body;
      if (result.status === 202 && data.ok) {
        // G7B-D2：响应到达即有 dispatch_id，卡片即时可见；生命周期靠 SSE upsert 刷新。
        trackDispatch(data.dispatch_id, adapterId, data.status);
        toast('派发已受理：' + data.status + ' ' + (data.dispatch_id || ''), true);
        document.getElementById('dispatch-result').textContent =
          'dispatch_id=' + data.dispatch_id + ' status=' + data.status;
        refresh();
      } else if (result.status === 402) {
        toast('超预算门（DENIED）：' + (data.error || ''), false);
      } else {
        toast('派发失败：' + (data.error || result.status), false);
      }
    }).catch(function (error) { toast('派发失败：' + error, false); });
  }

  /* ---------- 派发跟踪卡片（G7B-D2：upsert 更新 + 已耗时计时 + 完成 toast） ---------- */
  var TERMINAL_STATUSES = { DRY_RUN: 1, PASS: 1, FAIL: 1, BLOCKED_WAITING_OWNER: 1, BLOCKED_ENV: 1, TIMEOUT: 1, INTERRUPTED: 1, REJECTED: 1, SUPERSEDED: 1 };
  // GOAL-013L：终态落定闪登记 —— adapter_id → 最近一次新到终态 status
  // （渲染消费一次后清除，下一次同犬新终态再闪）。
  var flashRegistry = {};

  function trackDispatch(dispatchId, adapterId, status) {
    if (!dispatchId) return;
    var existing = null;
    for (var i = 0; i < trackedDispatches.length; i += 1) {
      if (trackedDispatches[i].dispatch_id === dispatchId) { existing = trackedDispatches[i]; break; }
    }
    if (existing !== null) {
      // upsert：SSE 后续帧（EXECUTE/REPORT/PASS）必须刷新既有卡片。
      var wasTerminal = TERMINAL_STATUSES[existing.status] === 1;
      existing.status = status;
      delete detailCache[dispatchId]; // DEF-08：状态变化 → 详情缓存失效
      existing.at_utc = new Date().toISOString();
      if (!wasTerminal && TERMINAL_STATUSES[status] === 1) {
        flashRegistry[adapterId] = status; // 终态闪一次（roster 行）
        flashRegistry[dispatchId] = status; // 派发卡头行图标同步落定闪
        headFlashUntil = Date.now() + 1200; // 页头头犬徽章同步落定闪
        toast('完成：' + status + '（' + adapterId + '）', status === 'PASS' || status === 'DRY_RUN');
        notifyTerminal(status, adapterId); // GP-18：浏览器通知（开关+授权+后台三条件）
        chatActionFor(dispatchId, adapterId, status); // GOAL-012：终态回填会话动作卡
      }
      renderDispatches();
      renderDogs();
      renderHeadDogBadge();
      return;
    }
    trackedDispatches.unshift({
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      status: status,
      at_utc: new Date().toISOString(),
      started_ms: Date.now(),
    });
    trackedDispatches = trackedDispatches.slice(0, 20);
    renderDispatches();
  }

  function elapsedText(d) {
    if (!d.started_ms) return '';
    var seconds = Math.max(0, Math.round((Date.now() - d.started_ms) / 1000));
    return seconds + 's';
  }

  // DEF-08：展开态与详情缓存——每秒计时器/SSE 会全量重渲染 dispatch 列表，
  // 展开的卡片与已加载的详情必须跨渲染保持（否则"点开即被抹平"）。
  var openDetails = {};
  var detailCache = {};

  function buildDetailHtml(data) {
    var d = data.dispatch;
    var events = (d.events || []).map(function (ev) {
      return '<tr><td>' + esc(ev.phase || ev.kind || '') + '</td><td>' + esc(ev.status || '') + '</td><td class="mono">' + escTime(ev.at_utc || '') + '</td></tr>';
    }).join('');
    var stdoutBlock = '';
    if (d.stdout_tail && d.stdout_tail.text) {
      stdoutBlock = '<dt style="color:var(--ink-dim)">任务输出（末段' + (d.stdout_tail.truncated ? '，已截断' : '') + '）</dt>' +
        '<dd><pre class="mono" style="white-space:pre-wrap;max-height:200px;overflow:auto;margin:4px 0">' + esc(d.stdout_tail.text) + '</pre></dd>';
    }
    if (d.stderr_tail && d.stderr_tail.text) {
      stdoutBlock += '<dt style="color:var(--ink-dim)">stderr（末段' + (d.stderr_tail.truncated ? '，已截断' : '') + '）</dt>' +
        '<dd><pre class="mono" style="white-space:pre-wrap;max-height:120px;overflow:auto;margin:4px 0">' + esc(d.stderr_tail.text) + '</pre></dd>';
    }
    return '<dl style="margin:0">' +
      '<dt style="color:var(--ink-dim)">状态</dt><dd><span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span></dd>' +
      '<dt style="color:var(--ink-dim)">回执锚点</dt><dd class="mono hash">' + esc(d.receipt_path || '（未落盘）') + '</dd>' + stdoutBlock + '</dl>' +
      (events ? '<table><tbody>' + events + '</tbody></table>' : '');
  }

  function applyDetail(id) {
    var card = document.querySelector('.dispatch-card[data-dispatch="' + id + '"]');
    if (!card) return;
    card.classList.add('open');
    var detail = card.querySelector('.detail');
    if (detail && detailCache[id]) detail.innerHTML = detailCache[id];
  }

  function loadDetail(id) {
    getJson('/api/dispatch/' + encodeURIComponent(id)).then(function (data) {
      detailCache[id] = data.ok && data.dispatch
        ? buildDetailHtml(data)
        : '<span class="hash">' + esc((data && data.error) || '无详情') + '</span>';
      if (openDetails[id]) applyDetail(id);
    }).catch(function (error) {
      detailCache[id] = '加载失败：' + esc(String(error));
      if (openDetails[id]) applyDetail(id);
    });
  }

  function renderDispatches() {
    var el = document.getElementById('dispatch-list');
    var fromSnapshot = (snapshot && snapshot.dispatches) || [];
    var known = {};
    fromSnapshot.forEach(function (d) { known[d.dispatch_id] = d; });
    trackedDispatches.forEach(function (d) { if (!known[d.dispatch_id]) known[d.dispatch_id] = d; });
    var list = Object.keys(known).map(function (id) { return known[id]; });
    if (list.length === 0) { el.innerHTML = '<div class="empty">暂无派发记录</div>'; return; }
    el.innerHTML = list.map(function (d) {
      var elapsed = elapsedText(d);
      var cardRunning = isRunningStatus(d.status);
      // GOAL-013L：派发卡头行嵌入犬只图标——RUNNING 时 working 跳动，新到终态落定闪一次。
      var cardFlash = !cardRunning && flashRegistry[d.dispatch_id] === d.status
        ? 'flash-' + (d.status === 'PASS' || d.status === 'DRY_RUN' ? 'pass' : 'fail') : 'idle';
      return '<div class="dispatch-card' + (openDetails[d.dispatch_id] ? ' open' : '') + '" data-dispatch="' + esc(d.dispatch_id) + '">' +
        '<div class="head-row">' +
        dogLogo(d.adapter_id || '', cardRunning ? 'working' : cardFlash) + ' ' +
        '<span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span> ' +
        '<span class="mono">' + esc(String(d.dispatch_id).slice(0, 12)) + '…</span> ' +
        esc(d.adapter_id || '') + ' <span class="meta">' + escTime(d.at_utc || '') + '</span>' +
        (elapsed ? '<span class="elapsed">' + elapsed + '</span>' : '') +
        // GP-32（D30）：被拦卡直达审批视图（弹窗与批准/否决按钮在那里）。
        (d.status === 'BLOCKED_WAITING_OWNER'
          ? ' <button class="act approve" data-goto-approvals type="button" style="padding:1px 10px;font-size:11px">去审批</button>'
          : '') +
        '</div>' +
        '<div class="detail">' + (detailCache[d.dispatch_id] || '加载中…') + '</div></div>';
    }).join('');
    // D4（GOAL-012B）：折叠热区收缩到头部行；detail 内点击不冒泡、文字可选中。
    el.querySelectorAll('.dispatch-card .head-row').forEach(function (headRow) {
      headRow.addEventListener('click', function () { toggleDispatchDetail(headRow.parentNode); });
    });
    // GP-32：去审批按钮切到审批视图（不冒泡，避免触发卡片折叠）。
    el.querySelectorAll('button[data-goto-approvals]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var nav = document.querySelector('button[data-view="approvals"]');
        if (nav) nav.click();
      });
    });
    el.querySelectorAll('.dispatch-card .detail').forEach(function (detail) {
      detail.addEventListener('click', function (event) { event.stopPropagation(); });
    });
    // 展开但无缓存的（如刚重渲染）：异步补载。
    Object.keys(openDetails).forEach(function (id) {
      if (!detailCache[id] && known[id]) loadDetail(id);
    });
  }

  function toggleDispatchDetail(card) {
    // D4（GOAL-012B）：用户正在选中文字时不折叠（选字拖拽也会触发 click）。
    var selection = typeof window.getSelection === 'function' ? String(window.getSelection()) : '';
    if (selection !== '') return;
    // DEF-08：展开态走注册表（跨重渲染保持），详情走缓存（状态变化失效）。
    var dispatchId = card.getAttribute('data-dispatch');
    if (openDetails[dispatchId]) {
      delete openDetails[dispatchId];
      card.classList.remove('open');
      return;
    }
    openDetails[dispatchId] = true;
    card.classList.add('open');
    if (detailCache[dispatchId]) {
      var detail = card.querySelector('.detail');
      if (detail) detail.innerHTML = detailCache[dispatchId];
    } else {
      loadDetail(dispatchId);
    }
  }

  /* ---------- 犬队状态（G009 回退 roster；G7B-D3 行聚合；GOAL-012 角色列 + 动效 logo） ---------- */
  function latestDispatchPerAdapter() {
    var latest = {};
    var dispatches = (snapshot && snapshot.dispatches) || [];
    dispatches.forEach(function (d) {
      if (!latest[d.adapter_id] || String(d.at_utc || '') > String(latest[d.adapter_id].at_utc || '')) {
        latest[d.adapter_id] = d;
      }
    });
    trackedDispatches.forEach(function (d) {
      if (!latest[d.adapter_id] || String(d.at_utc || '') > String(latest[d.adapter_id].at_utc || '')) {
        latest[d.adapter_id] = d;
      }
    });
    return latest;
  }

  function isRunningStatus(status) { return TERMINAL_STATUSES[status] !== 1 && status !== undefined; }

  /* ---------- GOAL-017B #1：犬只管理（契约 v1.5 mock：p17a 未落盘前按描述开发） ---------- */
  var ADAPTER_TEMPLATES = ['dsh', 'claude', 'codex', 'kimi', 'opencode', 'zcode'];

  function renderRosterManage() {
    var el = document.getElementById('roster-manage');
    if (!el) return;
    el.innerHTML = '<div><label for="adapter-template">基础模板</label>' +
      '<select id="adapter-template">' + ADAPTER_TEMPLATES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="adapter-new-id">命名（adapter_id）</label>' +
      '<input type="text" id="adapter-new-id" placeholder="如 zcode-2"></div>' +
      '<button class="act approve" id="btn-adapter-add" type="button">添加犬只</button>';
    document.getElementById('btn-adapter-add').addEventListener('click', addAdapter);
  }

  function addAdapter() {
    var template = document.getElementById('adapter-template').value;
    var id = document.getElementById('adapter-new-id').value.trim();
    if (!id) { toast('请给新犬命名（adapter_id）', false); return; }
    postJson('/api/adapters', { template: template, adapter_id: id }).then(function (result) {
      if (result.status === 201 && result.body && result.body.ok) {
        toast('已添加犬只：' + id, true);
        document.getElementById('adapter-new-id').value = '';
        refresh(); // roster 即时刷新
      } else {
        toast('添加失败：' + ((result.body && result.body.error) || result.status), false);
      }
    }).catch(function (error) { toast('添加失败：' + error, false); });
  }

  function removeAdapter(adapterId) {
    // 软删语义说明：roster 隐藏，历史派发/台账不受影响（append-only）。
    if (!window.confirm('移除犬只 ' + adapterId + '？\\n软删：roster 隐藏，历史派发记录与预算台账保留（append-only 不改写）。')) return;
    fetch('/api/adapters/' + encodeURIComponent(adapterId), { method: 'DELETE' }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, body: data }; });
    }).then(function (result) {
      if (result.status === 200 && result.body && result.body.ok) {
        toast('已移除（软删）：' + adapterId, true);
        refresh();
      } else {
        toast('移除失败：' + ((result.body && result.body.error) || result.status), false);
      }
    }).catch(function (error) { toast('移除失败：' + error, false); });
  }

  function renderDogs() {
    var el = document.getElementById('dogs-table');
    var actors = snapshot.actors;
    var dispatches = snapshot.dispatches || [];
    var latest = latestDispatchPerAdapter();
    renderRosterManage(); // GOAL-017B #1：管理条（模板+命名+添加）
    function dispatchStats(adapterId) {
      var count = 0;
      var last = latest[adapterId] || null;
      for (var i = 0; i < dispatches.length; i += 1) {
        if (dispatches[i].adapter_id === adapterId) count += 1;
      }
      return { count: count, latest: last };
    }
    if (actors.length === 0) {
      var roster = snapshot.roster || [];
      if (roster.length === 0) { el.innerHTML = '<div class="empty">暂无在册犬只</div>'; return; }
      var rr = roster.map(function (r) {
        var stats = dispatchStats(r.adapter_id);
        var running = stats.latest ? isRunningStatus(stats.latest.status) : false;
        // GOAL-013L 三态：working（非终态）/ terminal-flash（本批新到终态）/ idle
        var logoState = running ? 'working'
          : (stats.latest && flashRegistry[r.adapter_id] === stats.latest.status ? 'flash-' + (stats.latest.status === 'PASS' || stats.latest.status === 'DRY_RUN' ? 'pass' : 'fail') : 'idle');
        var role = r.role || 'executor'; // v1.3 role 字段；未升级后端缺省 executor
        var roleBadge = role === 'head'
          ? '<span class="badge role-head">head 头犬</span>'
          : '<span class="badge role-executor">executor</span>';
        if (!isVerifiedEntry(r)) roleBadge += ' <span class="badge unverified">' + esc(unverifiedReason(r)) + '</span>';
        var activity = stats.count === 0
          ? '（未活动，注册在册）'
          : stats.count + ' 次 · <span class="badge ' + esc(stats.latest.status) + '">' + esc(stats.latest.status) + '</span> <span class="mono">' + escTime(stats.latest.at_utc || '') + '</span>';
        return '<tr><td class="mono">' + dogLogo(r.adapter_id + ' ' + (r.expected_model_id || ''), logoState) + ' ' + esc(r.adapter_id) + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td>' + esc(r.expected_provider) + '</td><td>' + esc(r.expected_model_id) + '</td>' +
          '<td class="mono">' + esc((r.variants || []).join(' | ')) + '</td>' +
          '<td>' + activity + '</td>' +
          '<td><button class="act remove" data-remove="' + esc(r.adapter_id) + '" type="button">移除</button></td></tr>';
      }).join('');
      el.innerHTML = '<table><thead><tr><th>犬（合同）</th><th>角色</th><th>provider</th><th>model</th><th>变体</th><th>最近派发</th><th>管理</th></tr></thead><tbody>' + rr + '</tbody></table>';
      el.querySelectorAll('button[data-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () { removeAdapter(btn.getAttribute('data-remove')); });
      });
      return;
    }
    var rows = actors.map(function (a) {
      var last = latest[a.actor_instance_id] || null;
      var running = last ? isRunningStatus(last.status) : false;
      var logoState = running ? 'working'
        : (last && flashRegistry[a.actor_instance_id] === last.status ? 'flash-' + (last.status === 'PASS' || last.status === 'DRY_RUN' ? 'pass' : 'fail') : 'idle');
      var role = a.role || 'executor';
      var roleBadge = role === 'head'
        ? '<span class="badge role-head">head 头犬</span>'
        : '<span class="badge role-executor">' + esc(role) + '</span>';
      return '<tr><td class="mono">' + dogLogo(a.actor_instance_id + ' ' + (a.model_id || ''), logoState) + ' ' + esc(a.actor_instance_id) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + esc(a.provider) + '</td><td>' + esc(a.model_id) + '</td>' +
        '<td class="mono">' + shortHash(a.capability_id) + '</td>' +
        '<td>' + a.event_count + '</td><td>' + esc(a.last_event_type) + '</td></tr>';
    }).join('');
    el.innerHTML = '<table><thead><tr><th>犬（实例）</th><th>角色</th><th>provider</th><th>model</th><th>capability</th><th>事件数</th><th>最近事件</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="hint">（实例投影视图：管理操作在合同名册视图进行）</div>';
  }

  /* ---------- 事件链（G009：无 epoch 链时回退显示派发生命周期记录） ---------- */
  function renderEpochs() {
    var el = document.getElementById('view-epochs');
    if (snapshot.epochs.length === 0) {
      var dispatches = snapshot.dispatches || [];
      if (dispatches.length === 0) { el.innerHTML = '<div class="empty">暂无 epoch 事件链（无派发记录；派发后此处显示其生命周期）</div>'; return; }
      var dr = dispatches.map(function (d) {
        return '<tr><td class="mono">' + esc(d.dispatch_id.slice(0, 12)) + '</td>' +
          '<td>' + esc(d.adapter_id) + '</td>' +
          '<td><span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span></td>' +
          '<td class="mono">' + escTime(d.at_utc || '') + '</td></tr>';
      }).join('');
      el.innerHTML = '<div class="hint">（无 epoch 链时显示派发生命周期记录）</div>' +
        '<table><thead><tr><th>dispatch</th><th>犬</th><th>状态</th><th>最近时间</th></tr></thead><tbody>' + dr + '</tbody></table>';
      return;
    }
    el.innerHTML = snapshot.epochs.map(function (epoch) {
      var chainBadge = epoch.chain_verified
        ? '<span class="badge ok">链校验通过</span>'
        : '<span class="badge broken">链断裂</span>';
      var rows = epoch.events.map(function (ev) {
        return '<tr><td>' + ev.sequence + '</td><td>' + esc(ev.event_type) + '</td>' +
          '<td class="mono">' + esc(ev.actor_instance_id) + '</td><td>' + esc(ev.phase) + '</td>' +
          '<td>' + esc(ev.summary || '') + '</td>' +
          '<td class="hash">' + shortHash(ev.sha256) + '</td>' +
          '<td class="hash">' + (ev.previous_sha256 ? shortHash(ev.previous_sha256) : 'genesis') + '</td>' +
          '<td class="mono">' + escTime(ev.created_at_utc) + '</td></tr>';
      }).join('');
      return '<div class="card"><h3>run ' + esc(epoch.run_id) + ' · epoch ' + epoch.assignment_epoch +
        ' · ' + epoch.event_count + ' 事件 ' + chainBadge +
        ' <span class="hash">head ' + shortHash(epoch.chain_head) + '</span></h3>' +
        '<table><thead><tr><th>#</th><th>类型</th><th>actor</th><th>phase</th><th>摘要</th><th>sha256</th><th>前锚</th><th>时间</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>';
    }).join('');
  }

  /* ---------- 预算真实视图（GET /api/budget；GOAL-017B #6：计数 + cap 行内编辑） ---------- */
  function renderBudget() {
    var el = document.getElementById('view-budget');
    if (!budget || !budget.actors || budget.actors.length === 0) {
      el.innerHTML = '<div class="empty">暂无预算台账记录（USD 台账随 dispatch admission 产生）</div>';
      return;
    }
    el.innerHTML = budget.actors.map(function (actor) {
      var cap = actor.cap_usd || 0;
      var spent = actor.spent_usd || 0;
      // GOAL-017B #6：admission 计数（v1.5 字段；缺省按 entries 长度回退）。
      var admissionCount = actor.admission_count !== undefined ? actor.admission_count : (actor.entries || []).length;
      var pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
      var entries = (actor.entries || []).slice(-5).reverse().map(function (entry) {
        return '<tr><td class="mono">' + escTime(entry.at_utc) + '</td><td>' + esc(entry.decision) + '</td>' +
          '<td>$' + Number(entry.amount_usd).toFixed(4) + '</td><td>$' + Number(entry.remaining_usd).toFixed(4) + '</td></tr>';
      }).join('');
      return '<div class="card"><h3>' + dogLogo(actor.actor_id, false) + ' ' + esc(actor.actor_id) +
        ' <span class="badge">' + admissionCount + ' 次 admission</span></h3>' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div class="bar' + (pct > 80 ? ' hot' : '') + '"><div style="width:' + pct + '%"></div></div>' +
        '<span class="mono">$' + spent.toFixed(4) + ' / $' + cap.toFixed(2) + '（' + pct.toFixed(0) + '%）</span>' +
        '<span class="cap-editor">cap $<input type="number" class="cap-input" min="0.01" step="0.01" value="' + cap.toFixed(2) + '" data-cap-actor="' + esc(actor.actor_id) + '">' +
        '<button class="act approve" data-cap-save="' + esc(actor.actor_id) + '" type="button" style="padding:2px 10px;font-size:11px">保存</button>' +
        '<span class="cap-edit-msg" data-cap-msg="' + esc(actor.actor_id) + '"></span></span></div>' +
        (entries ? '<table style="margin-top:8px"><thead><tr><th>时间</th><th>决策</th><th>金额</th><th>余额</th></tr></thead><tbody>' + entries + '</tbody></table>' : '') +
        '</div>';
    }).join('');
    // GOAL-017B #6：cap 行内编辑 → PUT /api/budget/caps/:actor（契约 v1.5 mock）
    el.querySelectorAll('button[data-cap-save]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var actorId = btn.getAttribute('data-cap-save');
        var input = el.querySelector('input[data-cap-actor="' + actorId + '"]');
        var msg = el.querySelector('span[data-cap-msg="' + actorId + '"]');
        var value = Number(input.value);
        if (!isFinite(value) || value <= 0) { msg.textContent = 'cap 必须 > 0'; msg.style.color = 'var(--danger)'; return; }
        fetch('/api/budget/caps/' + encodeURIComponent(actorId), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cap_usd: value })
        }).then(function (res) { return res.json().then(function (data) { return { status: res.status, body: data }; }); })
          .then(function (result) {
            if ((result.status === 200 || result.status === 201) && result.body && result.body.ok) {
              msg.textContent = '已保存';
              msg.style.color = 'var(--ok)';
              toast('cap 已更新：' + actorId + ' → $' + value.toFixed(2), true);
              loadBudget();
            } else {
              msg.textContent = '失败：' + ((result.body && result.body.error) || result.status);
              msg.style.color = 'var(--danger)';
            }
          }).catch(function (error) {
            msg.textContent = '失败：' + error;
            msg.style.color = 'var(--danger)';
          });
      });
    });
  }

  /* ---------- 审批 ---------- */
  /* ---------- GOAL-020 B3：审批收编（dashi 式：栏顶常驻卡，琥珀 tint，模态废除） ---------- */
  // D33 附加条件：报备信息（犬只×强度/超时/工作区/预算已花与 cap/完整 prompt 预览）
  // 内联可展开保留；目标行（goal_id）显著显示。弹窗废除但信息不得缩水。
  var openRailApprovals = {};

  function approvalReportHtml(a) {
    var d = a.dispatch || {};
    var rows =
      '<div class="rail-appr-row"><span class="rail-appr-label">goal 行</span><span class="rail-appr-goal">' + esc(d.goal_id || a.goal_id || '（未关联 Goal）') + '</span></div>' +
      '<div class="rail-appr-row"><span class="rail-appr-label">门</span>' + esc(a.gate) + '</div>' +
      '<div class="rail-appr-row"><span class="rail-appr-label">犬只 × 强度</span><span class="mono">' + esc((d.adapter_id || a.actor_id || '') + (d.effort ? ' × ' + d.effort : '')) + '</span></div>' +
      (d.timeout_s !== undefined || d.workspace !== undefined
        ? '<div class="rail-appr-row"><span class="rail-appr-label">超时 / 工作区</span><span class="mono">' + esc((d.timeout_s || 0) + 's / ' + (d.workspace || '')) + '</span></div>' : '') +
      (d.actor_spent_usd !== undefined || d.cap_usd !== undefined
        ? '<div class="rail-appr-row"><span class="rail-appr-label">预算</span><span class="mono">已花 $' + (d.actor_spent_usd == null ? '?' : d.actor_spent_usd.toFixed(4)) + ' / cap $' + (d.cap_usd == null ? '?' : d.cap_usd) + '</span></div>' : '') +
      '<div class="rail-appr-row"><span class="rail-appr-label">事由</span>' + esc(a.reason || '') + '</div>' +
      (d.prompt_preview !== undefined
        ? '<div class="rail-appr-row"><span class="rail-appr-label">Prompt 预览</span><pre class="mono rail-appr-prompt">' + esc(d.prompt_preview || '(空)') + '</pre></div>' : '') +
      '<div class="rail-appr-row"><span class="rail-appr-label">请求时间</span><span class="mono">' + escTime(a.requested_at_utc) + '</span></div>';
    return rows;
  }

  function renderRailApprovals() {
    var el = document.getElementById('rail-approvals');
    if (!el || !snapshot) return;
    var waiting = snapshot.approvals.filter(function (a) { return a.status === 'WAITING'; });
    if (waiting.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = waiting.map(function (a, i) {
      var key = a.request_file;
      var open = openRailApprovals[key] === true;
      return '<div class="rail-appr-card" data-appr="' + esc(key) + '">' +
        '<div class="rail-appr-head">' +
        '<span class="badge ember-badge">⛔ 审批 ' + (i + 1) + '/' + waiting.length + '</span>' +
        '<span class="rail-appr-goal-inline">' + esc((a.dispatch && a.dispatch.goal_id) || a.goal_id || a.gate) + '</span></div>' +
        '<div class="rail-appr-body" style="display:' + (open ? 'block' : 'none') + '">' + approvalReportHtml(a) + '</div>' +
        '<div class="rail-appr-actions">' +
        '<button class="act approve" data-respond="APPROVED" data-file="' + esc(key) + '" type="button">批准</button>' +
        '<button class="act reject" data-respond="REJECTED" data-file="' + esc(key) + '" type="button">否决</button>' +
        '<button class="act cancel" data-toggle-appr="' + esc(key) + '" type="button">' + (open ? '收起' : '详情') + '</button>' +
        '</div></div>';
    }).join('');
    el.querySelectorAll('button[data-respond]').forEach(function (btn) {
      btn.addEventListener('click', function () { respondTo(btn.getAttribute('data-file'), btn.getAttribute('data-respond')); });
    });
    el.querySelectorAll('button[data-toggle-appr]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-toggle-appr');
        if (openRailApprovals[key]) delete openRailApprovals[key]; else openRailApprovals[key] = true;
        renderRailApprovals();
      });
    });
  }

  function respondTo(requestFile, decision) {
    postJson('/api/approvals/respond', { request_file: requestFile, decision: decision })
      .then(function (result) {
        if (result.status === 201) {
          toast('已' + (decision === 'APPROVED' ? '批准' : '否决') + '：' + requestFile, true);
          refresh();
        } else {
          toast('应答失败：' + (result.body.error || result.status), false);
        }
      }).catch(function (error) { toast('应答失败：' + error, false); });
  }

  function renderApprovals() {
    var el = document.getElementById('view-approvals');
    var waiting = snapshot.approvals.filter(function (a) { return a.status === 'WAITING'; });
    document.getElementById('waiting-count').textContent = waiting.length > 0 ? '(' + waiting.length + ')' : '';
    if (snapshot.approvals.length === 0) { el.innerHTML = '<div class="empty">暂无审批请求</div>'; return; }
    var rows = snapshot.approvals.map(function (a, index) {
      var action = a.status === 'WAITING'
        ? '<button class="act approve" data-approval="' + index + '">处理</button>'
        : escTime(a.response ? a.response.responded_at_utc : '');
      return '<tr><td class="mono">' + esc(a.request_file) + '</td><td>' + esc(a.gate) + '</td>' +
        '<td class="mono">' + esc(a.actor_id) + '</td><td>' + esc(a.reason || '') + '</td>' +
        '<td><span class="badge ' + a.status + '">' + a.status + '</span></td><td>' + action + '</td></tr>';
    }).join('');
    el.innerHTML = '<table><thead><tr><th>请求文件</th><th>门</th><th>actor</th><th>事由</th><th>状态</th><th>动作/应答时间</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
    el.querySelectorAll('button[data-approval]').forEach(function (btn) {
      btn.addEventListener('click', function () { openDialog(snapshot.approvals[Number(btn.getAttribute('data-approval'))]); });
    });
  }

  function openDialog(approval) {
    // GOAL-020 B3：模态废除——「处理」改为栏顶卡展开 + 滚动到指挥台。
    currentApproval = approval;
    openRailApprovals[approval.request_file] = true;
    renderRailApprovals();
    var chatBtn = document.querySelector('button[data-view="chat"]');
    if (chatBtn) chatBtn.click();
    var dl = document.getElementById('approval-detail');
    var html = '<dt>请求文件</dt><dd class="mono">' + esc(approval.request_file) + '</dd>' +
      '<dt>门</dt><dd>' + esc(approval.gate) + '</dd>' +
      '<dt>actor</dt><dd class="mono">' + esc(approval.actor_id) + '</dd>' +
      '<dt>事由</dt><dd>' + esc(approval.reason || '') + '</dd>' +
      '<dt>请求时间</dt><dd class="mono">' + escTime(approval.requested_at_utc) + '</dd>';
    // GP-32（D30）：派发类请求的审批者报备面板——犬只/强度/超时/工作区/预算/完整 prompt 预览。
    if (approval.dispatch) {
      var d = approval.dispatch;
      html += '<dt>派发号</dt><dd class="mono">' + esc(d.dispatch_id.slice(0, 8)) + '</dd>' +
        '<dt>目标</dt><dd class="mono">' + esc(d.goal_id || '（未关联 Goal）') + '</dd>' +
        '<dt>犬只 × 强度</dt><dd class="mono">' + esc(d.adapter_id + ' × ' + d.effort) + '</dd>' +
        '<dt>超时 / 工作区</dt><dd class="mono">' + esc((d.timeout_s || 0) + 's / ' + (d.workspace || '')) + '</dd>' +
        '<dt>预算</dt><dd class="mono">已花 $' + (d.actor_spent_usd == null ? '?' : d.actor_spent_usd.toFixed(4)) +
        ' / cap $' + (d.cap_usd == null ? '?' : d.cap_usd) + '</dd>' +
        '<dt>Prompt 预览</dt><dd class="mono" style="white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;border:1px solid var(--line);padding:6px;border-radius:4px">' + esc(d.prompt_preview || '(空)') + '</dd>';
    }
    dl.innerHTML = html; // 兼容：drawer 详情视图仍写该 dl（DOM 保留作历史查看）
  }

  function respond(decision) {
    if (!currentApproval) return;
    respondTo(currentApproval.request_file, decision);
  }

  /* ---------- GOAL-012 + GOAL-018B #3：聊天面板（v1.3 契约）与会话恢复 ---------- */
  // GOAL-018B：localStorage 持久化当前 session_id——刷新页面不丢对话显示。
  var chatSessionId = null;
  try {
    var savedSession = localStorage.getItem('mush.chat.session');
    if (savedSession && savedSession.trim() !== '') chatSessionId = savedSession.trim();
  } catch (e) { /* 隐私模式忽略 */ }
  var chatTurnCount = 0;
  var chatPending = false;
  var chatActionSeen = {};       // dispatch_id → 已回填终态（去重）
  var chatPromptedApprovals = {}; // request_file → 已自动弹窗（去重，触发门直通）

  function saveChatSession() {
    try {
      if (chatSessionId) localStorage.setItem('mush.chat.session', chatSessionId);
      else localStorage.removeItem('mush.chat.session');
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function chatStreamEl() { return document.getElementById('chat-stream'); }

  function chatClearEmpty() {
    var el = chatStreamEl();
    var empty = el.querySelector('.empty');
    if (empty) el.removeChild(empty);
  }

  function chatScrollBottom() {
    var el = chatStreamEl();
    el.scrollTop = el.scrollHeight;
  }

  function appendChatRow(role, text, atUtc, dispatchId) {
    chatClearEmpty();
    var row = document.createElement('div');
    row.className = 'chat-row ' + role;
    var isUser = role === 'user';
    var who = (isUser ? '你' : '头犬') + (atUtc ? ' · ' + fmtTime(atUtc) : '');
    var avatar = isUser
      ? '<span class="avatar">' + dogLogo('paw', false) + '</span>'
      : '<span class="avatar">' + dogLogo('head-dog kimi moon', chatPending) + '</span>';
    row.innerHTML = avatar + '<div><div class="who">' + esc(who) + '</div>' +
      '<div class="bubble">' + esc(text) + '</div>' +
      (dispatchId ? '<div class="hint mono">dispatch ' + esc(String(dispatchId).slice(0, 12)) + '…</div>' : '') +
      '</div>';
    chatStreamEl().appendChild(row);
    chatTurnCount += 1;
    chatScrollBottom();
  }

  // 头犬动作卡：结构化派发/审核记录内嵌对话流（去重；幂等 upsert）。
  function chatActionFor(dispatchId, adapterId, status) {
    if (!dispatchId || chatActionSeen[dispatchId]) return;
    chatActionSeen[dispatchId] = true;
    chatClearEmpty();
    var card = document.createElement('div');
    card.className = 'chat-action-card';
    card.innerHTML = dogLogo(adapterId || '', false) + ' 头犬动作 · 派发 <span class="mono">' +
      esc(String(dispatchId).slice(0, 12)) + '…</span> → ' + esc(adapterId || '') +
      ' · <span class="badge ' + esc(status) + '">' + esc(status) + '</span>' +
      ' <span class="mono">' + escTime(new Date().toISOString()) + '</span>';
    chatStreamEl().appendChild(card);
    chatScrollBottom();
  }

  // 触发门审批直通：WAITING 审批出现时，聊天流嵌入提示并自动弹一次审批窗（幂等）。
  function chatPromptApprovals() {
    if (!snapshot || !snapshot.approvals) return;
    snapshot.approvals.forEach(function (a) {
      if (a.status !== 'WAITING' || chatPromptedApprovals[a.request_file]) return;
      chatPromptedApprovals[a.request_file] = true;
      chatClearEmpty();
      var note = document.createElement('div');
      note.className = 'chat-action-card';
      note.innerHTML = '⛔ chat pending approval：触发门 <b>' + esc(a.gate) + '</b> 等待应答（' +
        esc(a.actor_id || '') + '）——已弹出审批窗，也可在「审批」页处理。';
      chatStreamEl().appendChild(note);
      chatScrollBottom();
      renderRailApprovals(); // GOAL-020 B3：栏顶常驻卡即第一现场，不再弹模态
    });
  }

  function setChatPending(pending) {
    chatPending = pending;
    // D2（GOAL-012B）：发送期间输入框保持可编辑（排队下一条），仅按钮态变化。
    document.getElementById('chat-send').textContent = pending ? '发送中…' : '发送';
    renderHeadDogBadge(); // GOAL-013L：页头徽章处理中 working 跳动
  }

  /* ---------- D2：思考中占位气泡（三点呼吸动画 + 已耗时秒表） ---------- */
  var thinkingRow = null;
  var thinkingTimer = null;

  function showThinking() {
    removeThinking();
    chatClearEmpty();
    var row = document.createElement('div');
    row.className = 'chat-row head chat-thinking';
    row.innerHTML = '<span class="avatar">' + dogLogo('head-dog kimi moon', true) + '</span>' +
      '<div><div class="who">头犬 · 思考中… <span class="mono thinking-elapsed">0s</span></div>' +
      '<div class="bubble thinking-bubble"><span class="thinking-dots"><i></i><i></i><i></i></span></div></div>';
    chatStreamEl().appendChild(row);
    chatScrollBottom();
    var started = Date.now();
    thinkingRow = row;
    thinkingTimer = setInterval(function () {
      var el = row.querySelector('.thinking-elapsed');
      if (el) el.textContent = Math.max(0, Math.round((Date.now() - started) / 1000)) + 's';
    }, 1000);
  }

  function removeThinking() {
    if (thinkingTimer !== null) { clearInterval(thinkingTimer); thinkingTimer = null; }
    if (thinkingRow !== null) {
      if (thinkingRow.parentNode) thinkingRow.parentNode.removeChild(thinkingRow);
      thinkingRow = null;
    }
  }

  function sendChat() {
    var input = document.getElementById('chat-input');
    var message = input.value.trim();
    if (!message || chatPending) return;
    input.value = '';
    appendChatRow('user', message, new Date().toISOString());
    setChatPending(true);
    showThinking(); // D2：立即反馈，不等网络
    // D1/D2（GOAL-012B/017B）：头犬 harness + 模型变体 + effort 档位随消息提交
    // （v1.3.1 可选字段，缺省后端 head-dog/HIGH；变体 v1.5 model_id 透传）。
    var headSel = document.getElementById('chat-head-select');
    var effortSel = document.getElementById('chat-effort');
    var variantSel = document.getElementById('chat-head-variant');
    var payload = { message: message, resume: chatSessionId };
    if (headSel && headSel.value) payload.adapter_id = headSel.value;
    if (variantSel && variantSel.value) payload.model_id = variantSel.value;
    if (effortSel && effortSel.value) payload.effort = effortSel.value;
    postJson('/api/chat', payload).then(function (result) {
      var data = result.body || {};
      if (result.status === 200 && data.ok) {
        chatSessionId = data.session_id || chatSessionId;
        registerSessionId(chatSessionId); // GOAL-018B #3：会话注册表（选择器数据源）
        saveChatSession();
        renderSessionSelector();
        document.getElementById('chat-session-label').textContent = chatSessionId ? 'session ' + String(chatSessionId).slice(0, 8) : '';
        // D3：v1.3.1 同步语义——响应体 reply 即头犬回复，替换占位气泡直渲。
        removeThinking();
        appendChatRow('head', typeof data.reply === 'string' && data.reply !== '' ? data.reply : '（空回复）', new Date().toISOString(), data.dispatch_id);
        if (data.dispatch_id) trackDispatch(data.dispatch_id, payload.adapter_id || 'head-dog', data.status || 'ADMITTED');
        refresh();
      } else if (result.status === 404 || result.status === 400) {
        removeThinking();
        appendChatRow('head', '（消息未受理：' + esc(data.error || result.status) + '）', new Date().toISOString());
      } else {
        removeThinking();
        toast('发送失败：' + (data.error || result.status), false);
      }
    }).catch(function (error) {
      removeThinking();
      appendChatRow('head', '（聊天 API 暂不可达：' + esc(String(error)) + '）', new Date().toISOString());
    }).then(function () { setChatPending(false); });
  }

  // 头犬 dispatch 到达 REPORT/REVIEW 后，拉取会话历史补齐头犬回复（权威源 = runtime/chat/*.jsonl）。
  function chatRefreshHistory() {
    if (!chatSessionId) return;
    getJson('/api/chat/history?session=' + encodeURIComponent(chatSessionId) + '&limit=50').then(function (data) {
      if (!data || !data.ok || !Array.isArray(data.turns)) return;
      if (data.turns.length <= chatTurnCount) return;
      var el = chatStreamEl();
      el.innerHTML = '';
      chatTurnCount = 0;
      var keepActions = Object.keys(chatActionSeen);
      data.turns.forEach(function (turn) { appendChatRow(turn.role === 'user' ? 'user' : 'head', turn.text, turn.at_utc, turn.dispatch_id); });
      // 历史重渲染后保留动作卡语义：已见 dispatch 卡片不重复追加（chatActionSeen 已在）。
      void keepActions;
    }).catch(function () { /* 静默：下一帧 SSE 再试 */ });
  }

  /* ---------- GOAL-018B #3：会话选择器 + 刷新恢复 ---------- */
  // 会话列表来源：chatSessionIds 注册表（localStorage 累积，本机 owner 单用户场景足够；
  // 后端枚举 API 属 p18a v1.6 面，落盘后联调批可换数据源）。
  function knownSessionIds() {
    try {
      var raw = JSON.parse(localStorage.getItem('mush.chat.sessions') || '[]');
      return Array.isArray(raw) ? raw.filter(function (s) { return typeof s === 'string' && s !== ''; }) : [];
    } catch (e) { return []; }
  }

  function registerSessionId(id) {
    if (!id) return;
    var ids = knownSessionIds();
    if (ids.indexOf(id) < 0) {
      ids.unshift(id);
      try { localStorage.setItem('mush.chat.sessions', JSON.stringify(ids.slice(0, 20))); } catch (e) { /* ignore */ }
    }
  }

  function renderSessionSelector() {
    var sel = document.getElementById('chat-session-select');
    if (!sel) return;
    var ids = knownSessionIds();
    if (chatSessionId && ids.indexOf(chatSessionId) < 0) ids.unshift(chatSessionId);
    sel.innerHTML = '<option value="">（新会话）</option>' + ids.map(function (id) {
      return '<option value="' + esc(id) + '"' + (id === chatSessionId ? ' selected' : '') + '>session ' + esc(id.slice(0, 8)) + '</option>';
    }).join('');
  }

  function switchChatSession(sessionId) {
    chatSessionId = sessionId || null;
    chatTurnCount = 0;
    chatActionSeen = {};
    saveChatSession();
    document.getElementById('chat-session-label').textContent = chatSessionId ? 'session ' + String(chatSessionId).slice(0, 8) : '';
    if (!chatSessionId) {
      chatStreamEl().innerHTML = '<div class="empty">新会话已开始。向头犬下达指令。</div>';
      renderSessionSelector();
      return;
    }
    chatStreamEl().innerHTML = '<div class="empty">恢复会话中…</div>';
    // 完整历史重渲染（不限于增量）：刷新/切换都走这条权威路径。
    getJson('/api/chat/history?session=' + encodeURIComponent(chatSessionId) + '&limit=50').then(function (data) {
      var el = chatStreamEl();
      if (!data || !data.ok || !Array.isArray(data.turns) || data.turns.length === 0) {
        el.innerHTML = '<div class="empty">该会话暂无记录（或 M1 前会话文件缺失）。</div>';
      } else {
        el.innerHTML = '';
        chatTurnCount = 0;
        data.turns.forEach(function (turn) { appendChatRow(turn.role === 'user' ? 'user' : 'head', turn.text, turn.at_utc, turn.dispatch_id); });
      }
      renderSessionSelector();
    }).catch(function () {
      chatStreamEl().innerHTML = '<div class="empty">会话历史暂不可达。</div>';
      renderSessionSelector();
    });
  }

  function chatNewSession() {
    switchChatSession(null);
  }

  /* ---------- 汇总刷新 ---------- */
  /* ---------- GOAL-020 B5：任务池三泳道（v1.7 契约 mock：p19a 未落盘按描述消费） ---------- */
  var tasksData = null;

  var TASK_LANES = {
    todo: ['IDEA', 'READY'],
    doing: ['QUEUED', 'IN_FLIGHT'],
    done: ['DONE', 'CANCELLED']
  };
  // 状态机白名单（与 GOAL-019 后端约定一致；非法迁移按钮不渲染）
  var TASK_TRANSITIONS = {
    IDEA: ['READY', 'CANCELLED'],
    READY: ['QUEUED', 'CANCELLED'],
    QUEUED: ['IN_FLIGHT', 'CANCELLED'],
    IN_FLIGHT: ['DONE', 'BLOCKED', 'CANCELLED'],
    BLOCKED: ['IN_FLIGHT', 'CANCELLED'],
    DONE: [],
    CANCELLED: []
  };

  function laneOf(status) {
    if (TASK_LANES.todo.indexOf(status) >= 0) return 'todo';
    if (TASK_LANES.doing.indexOf(status) >= 0) return 'doing';
    return 'done';
  }

  function loadTasks() {
    return getJson('/api/tasks').then(function (data) {
      if (data && data.ok && Array.isArray(data.tasks)) tasksData = data.tasks;
      renderTasks();
    }).catch(function () { renderTasks(); });
  }

  function renderTasks() {
    var lanes = { todo: [], doing: [], done: [] };
    (tasksData || []).forEach(function (t) { lanes[laneOf(t.status)].push(t); });
    ['todo', 'doing', 'done'].forEach(function (lane) {
      var el = document.getElementById('lane-' + lane);
      if (!el) return;
      var list = lanes[lane];
      var blockedCount = (tasksData || []).filter(function (t) { return t.status === 'BLOCKED'; }).length;
      var blockedBadge = lane === 'doing' && blockedCount > 0
        ? '<div class="hint" style="margin-bottom:6px"><span class="badge BLOCKED">BLOCKED ' + blockedCount + '</span></div>' : '';
      if (list.length === 0) {
        el.innerHTML = blockedBadge + '<div class="empty" style="padding:12px 0;font-size:12px">（空）</div>';
        return;
      }
      el.innerHTML = blockedBadge + list.map(function (t) {
        var transitions = (TASK_TRANSITIONS[t.status] || []);
        var btns = transitions.map(function (next) {
          return '<button class="act cancel" data-task-move="' + esc(t.task_id) + '" data-to="' + esc(next) + '" type="button">→ ' + esc(next) + '</button>';
        }).join('');
        var dispatchBtn = t.status === 'READY' || t.status === 'QUEUED'
          ? '<button class="act approve" data-task-dispatch="' + esc(t.task_id) + '" type="button">派发</button>' : '';
        return '<div class="task-card">' +
          '<div class="task-title">' + esc(t.title) + '</div>' +
          '<div class="task-meta"><span class="badge prio-' + esc(t.priority || '中') + '">' + esc(t.priority || '中') + '</span>' +
          '<span>' + esc(t.source || 'manual') + '</span>' +
          '<span>派发链 ' + ((t.dispatch_ids || []).length) + '</span></div>' +
          '<div class="task-actions">' + btns + dispatchBtn + '</div></div>';
      }).join('');
      el.querySelectorAll('button[data-task-move]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          postJson('/api/tasks/' + encodeURIComponent(btn.getAttribute('data-task-move')) + '/transition',
            { status: btn.getAttribute('data-to') }).then(function (result) {
            if (result.body && result.body.ok) { loadTasks(); }
            else { toast('迁移失败：' + ((result.body && result.body.error) || result.status), false); }
          }).catch(function (error) { toast('迁移失败：' + error, false); });
        });
      });
      el.querySelectorAll('button[data-task-dispatch]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var taskId = btn.getAttribute('data-task-dispatch');
          var task = (tasksData || []).filter(function (t) { return t.task_id === taskId; })[0];
          // 「派发」按钮预填派发表单携带 task_id（v1.7 字段随提交）。
          var dispatchBtn = document.querySelector('button[data-view="dispatch"]');
          if (dispatchBtn) dispatchBtn.click();
          document.getElementById('dispatch-prompt').value = task ? (task.title + (task.detail ? '\\n\\n' + task.detail : '')) : '';
          document.getElementById('dispatch-form').setAttribute('data-task-id', taskId);
          toast('已预填派发表单（task_id=' + taskId + '）', true);
        });
      });
    });
  }

  document.getElementById('task-create-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var title = document.getElementById('task-title').value.trim();
    if (!title) { toast('标题不能为空', false); return; }
    postJson('/api/tasks', {
      title: title,
      detail: document.getElementById('task-detail').value.trim() || undefined,
      priority: document.getElementById('task-priority').value,
      source: document.getElementById('task-source').value.trim() || 'manual'
    }).then(function (result) {
      if (result.status === 201 && result.body && result.body.ok) {
        toast('任务卡已建：' + title, true);
        document.getElementById('task-title').value = '';
        document.getElementById('task-detail').value = '';
        loadTasks();
      } else {
        toast('建卡失败：' + ((result.body && result.body.error) || result.status), false);
      }
    }).catch(function (error) { toast('建卡失败：' + error, false); });
  });

  /* ---------- GOAL-020 B2：右侧犬队栏（每犬一卡：徽标+状态+最近回报摘要） ---------- */
  function renderRailDogs() {
    var el = document.getElementById('rail-dogs');
    if (!el || !snapshot) return;
    var roster = snapshot.roster || [];
    var latest = latestDispatchPerAdapter();
    if (roster.length === 0) { el.innerHTML = '<div class="empty" style="padding:8px 0">暂无在册犬只</div>'; return; }
    el.innerHTML = roster.map(function (r) {
      var last = latest[r.adapter_id] || null;
      var running = last ? isRunningStatus(last.status) : false;
      var logoState = running ? 'working' : 'idle';
      var note = last ? esc(last.status) + ' · ' + escTime(last.at_utc || '') : '未活动';
      var noteStyle = running ? ' style="color:var(--ok);font-weight:600"' : '';
      return '<div class="rail-dog-card">' + dogLogo(r.adapter_id + ' ' + (r.expected_model_id || ''), logoState) +
        '<span class="rail-dog-name">' + esc(r.adapter_id) + '</span>' +
        '<span class="rail-dog-note"' + noteStyle + '>' + note + '</span></div>';
    }).join('');
  }

  /* ---------- GOAL-020 B2：预算迷你条（栏内摘要，详情仍走预算抽屉） ---------- */
  function renderRailBudget() {
    var el = document.getElementById('rail-budget');
    if (!el) return;
    if (!budget || !budget.actors || budget.actors.length === 0) {
      el.innerHTML = '<div class="empty" style="padding:8px 0">暂无台账</div>';
      return;
    }
    el.innerHTML = budget.actors.slice(0, 6).map(function (actor) {
      var cap = actor.cap_usd || 0;
      var spent = actor.spent_usd || 0;
      var pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
      return '<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-dim)">' +
        '<span>' + esc(actor.actor_id) + '</span><span class="mono">$' + spent.toFixed(2) + '/$' + cap.toFixed(0) + '</span></div>' +
        '<div class="bar' + (pct > 80 ? ' hot' : '') + '" style="min-width:0"><div style="width:' + pct + '%"></div></div></div>';
    }).join('');
  }

  function renderAll() {
    if (!snapshot) return;
    document.getElementById('generated').textContent = '快照 ' + escTime(snapshot.generated_at_utc) + '（本地时间）';
    renderHeadCascade(); // GOAL-017B #2/#3：级联选择 + 徽章链（内含 renderHeadDogBadge）
    renderAdapterOptions();
    renderDispatches();
    renderDogs();
    renderEpochs();
    renderBudget();
    renderApprovals();
    renderRailApprovals();
    renderRailDogs();
    renderRailBudget();
    chatPromptApprovals();
  }

  function refresh() {
    return getJson('/api/snapshot').then(function (data) {
      snapshot = data;
      renderAll();
    });
  }

  /* ---------- 事件绑定 ---------- */
  document.querySelectorAll('nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('section.view').forEach(function (s) { s.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('view-' + btn.getAttribute('data-view')).classList.add('active');
    });
  });
  document.getElementById('dispatch-form').addEventListener('submit', submitDispatch);
  document.getElementById('dispatch-adapter').addEventListener('change', renderModelOptions);
  document.getElementById('dispatch-real').addEventListener('change', function () {
    document.getElementById('real-hint').style.display = this.checked ? 'block' : 'none';
  });
  document.getElementById('workspace-select').addEventListener('change', function () {
    var selected = this.value;
    if (!selected) return;
    postJson('/api/workspaces/select', { path: selected }).then(function (result) {
      if (result.status === 201) { toast('workspace 已切换：' + selected, true); loadWorkspaces(); }
      else { toast('workspace 切换失败：' + (result.body.error || result.status), false); }
    }).catch(function (error) { toast('workspace 切换失败：' + error, false); });
  });

  /* ---------- GP-02（F-40）：workspace 自主登记 ---------- */
  var pendingCreatePath = null;

  function normalizeDisplayPath(p) {
    // F-39：展示统一反斜杠形态（与后端 path.resolve 归一对齐）。
    // 注意：本函数在模板字符串内，反斜杠会被模板层吃一层——源码必须双写。
    return String(p || '').replace(/\\//g, '\\\\');
  }

  function isFrozenSubtree(p) {
    // 纵深防御提示层：意向项目（黄金参照冻结区）子树前端直接拒绝；
    // 后端硬拦截属 GP-14 范围。统一归一后做前缀判断（大小写不敏感）。
    var norm = normalizeDisplayPath(p).replace(/\\\\+$/, '').toLowerCase();
    return /^[a-z]:\\\\意向项目(\\\\|$)/.test(norm);
  }

  function registerWorkspace(rawPath) {
    var input = String(rawPath || '').trim();
    if (!input) { toast('请输入 workspace 路径', false); return; }
    if (isFrozenSubtree(input)) {
      toast('拒绝登记：意向项目子树是黄金参照冻结区（只读）', false);
      return;
    }
    postJson('/api/workspaces/select', { path: input }).then(function (result) {
      if (result.status === 201) {
        toast('已登记并选中：' + normalizeDisplayPath(input), true);
        document.getElementById('workspace-register-path').value = '';
        loadWorkspaces();
        return;
      }
      var message = result.body && result.body.error ? String(result.body.error) : '';
      if (result.status === 400 && /does not exist/i.test(message)) {
        pendingCreatePath = input;
        document.getElementById('workspace-create-path').textContent = normalizeDisplayPath(input);
        document.getElementById('workspace-create-dialog').showModal();
        return;
      }
      toast('登记失败：' + (message || result.status), false);
    }).catch(function (error) { toast('登记失败：' + error, false); });
  }

  document.getElementById('btn-workspace-register').addEventListener('click', function () {
    registerWorkspace(document.getElementById('workspace-register-path').value);
  });
  document.getElementById('workspace-register-path').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); registerWorkspace(this.value); }
  });
  document.getElementById('btn-create-cancel').addEventListener('click', function () {
    pendingCreatePath = null;
    document.getElementById('workspace-create-dialog').close();
  });
  document.getElementById('btn-create-confirm').addEventListener('click', function () {
    var target = pendingCreatePath;
    document.getElementById('workspace-create-dialog').close();
    pendingCreatePath = null;
    if (!target) return;
    postJson('/api/workspaces/create', { path: target }).then(function (result) {
      if (result.status === 201) {
        toast('已新建并登记：' + normalizeDisplayPath(target), true);
        document.getElementById('workspace-register-path').value = '';
        // 建完即选中（登记 = 可派发白名单成员）
        postJson('/api/workspaces/select', { path: target }).then(function () { loadWorkspaces(); });
        return;
      }
      toast('新建失败：' + ((result.body && result.body.error) || result.status), false);
    }).catch(function (error) { toast('新建失败：' + error, false); });
  });
  document.getElementById('btn-approve').addEventListener('click', function () { respond('APPROVED'); });
  document.getElementById('btn-reject').addEventListener('click', function () { respond('REJECTED'); });
  document.getElementById('btn-cancel').addEventListener('click', function () {
    currentApproval = null; // GOAL-020 B3：无模态可关，仅清态
  });

  /* ---------- GOAL-012：聊天面板事件绑定 + 通知开关 ---------- */
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendChat(); }
  });
  document.getElementById('chat-new-session').addEventListener('click', chatNewSession);
  // GOAL-018B #3：会话选择器切换/新建。
  document.getElementById('chat-session-select').addEventListener('change', function () {
    switchChatSession(this.value);
  });
  // GOAL-017B #2/#3：级联选择联动（harness 切换 → 变体重算 + 徽章链刷新）。
  document.getElementById('chat-head-select').addEventListener('change', renderHeadVariantOptions);
  document.getElementById('chat-head-variant').addEventListener('change', renderHeadDogBadge);
  var notifyToggle = document.getElementById('notify-toggle');
  notifyToggle.checked = notifyPref.browser;
  notifyToggle.addEventListener('change', function () {
    if (!this.checked) {
      notifyPref.browser = false;
      saveNotifyPref();
      toast('浏览器通知已关闭（toast 保留）', true);
      return;
    }
    if (typeof Notification === 'undefined') {
      this.checked = false;
      toast('此浏览器不支持 Notification API', false);
      return;
    }
    if (Notification.permission === 'granted') {
      notifyPref.browser = true;
      saveNotifyPref();
      toast('浏览器通知已开启', true);
      return;
    }
    if (Notification.permission === 'denied') {
      this.checked = false;
      toast('通知权限被浏览器拒绝：请在站点设置中放行', false);
      return;
    }
    var toggle = this;
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        notifyPref.browser = true;
        saveNotifyPref();
        toast('浏览器通知已开启', true);
      } else {
        toggle.checked = false;
        toast('未获通知授权，保持关闭', false);
      }
    });
  });

  // G7B-D2：RUNNING 卡片已耗时每秒刷新（本地时钟，无需后端）。
  setInterval(function () {
    var hasRunning = trackedDispatches.some(function (d) { return !TERMINAL_STATUSES[d.status]; });
    if (hasRunning) { renderDispatches(); renderDogs(); }
  }, 1000);

  function loadWorkspaces() {
    return getJson('/api/workspaces').then(function (data) {
      if (data.ok && Array.isArray(data.workspaces)) workspaces = data.workspaces;
      renderWorkspaces();
    }).catch(function () { renderWorkspaces(); });
  }

  /* ---------- GOAL-018B #1：工作流只读视图（契约 v1.6 mock：p18a 未落盘按描述开发） ---------- */
  var streamsData = null;
  var streamTimelineCache = {};
  var openStreams = {};

  function loadStreams() {
    return getJson('/api/streams').then(function (data) {
      if (data && data.ok && Array.isArray(data.streams)) streamsData = data.streams;
      renderStreams();
    }).catch(function () { renderStreams(); });
  }

  // HANDOFF 五节卡片式渲染（D29 修订 v2 #4；契约 v1.6 实字段：open_issues，联调批对齐）。
  // 暴毙代写（head_written）标注头犬署名——外部补写（POST handoff）亦视为代写。
  function renderHandoffBlock(handoff) {
    if (!handoff) return '';
    var sections = [
      ['做了什么', handoff.done],
      ['定了什么', handoff.decided],
      ['文件在哪', handoff.files],
      ['下一步', handoff.next],
      ['未解问题', handoff.open_issues || handoff.open]
    ];
    var rows = sections.map(function (pair) {
      if (!pair[1]) return '';
      return '<div class="handoff-section"><div class="handoff-label">' + pair[0] + '</div>' +
        '<div class="handoff-text">' + esc(pair[1]) + '</div></div>';
    }).join('');
    var badge = handoff.head_written
      ? ' <span class="badge unverified">暴毙代写 · 头犬署名</span>'
      : ' <span class="badge ok">犬亲笔交接</span>';
    return '<div class="handoff-block"><div class="handoff-title">HANDOFF 交接' + badge +
      (handoff.at_utc ? ' <span class="mono">' + escTime(handoff.at_utc) + '</span>' : '') + '</div>' + rows + '</div>';
  }

  function renderStreams() {
    var el = document.getElementById('streams-list');
    if (!el) return;
    // GOAL-018B #2：派发表单工作流下拉与流列表同源（自动归流为缺省文案）。
    var streamSel = document.getElementById('dispatch-stream');
    if (streamSel) {
      var prevStream = streamSel.value;
      streamSel.innerHTML = '<option value="">（自动归流：同犬×Goal 归活动流）</option>' +
        (streamsData || []).map(function (s) {
          return '<option value="' + esc(s.stream_id) + '"' + (s.stream_id === prevStream ? ' selected' : '') + '>' +
            esc(s.title || s.stream_id) + (s.goal_id ? ' [' + esc(s.goal_id) + ']' : '') + '</option>';
        }).join('');
    }
    if (!streamsData || streamsData.length === 0) {
      el.innerHTML = '<div class="empty">暂无工作流（v1.6 流 API 落盘后自动出现；mock 消费中）</div>';
      return;
    }
    el.innerHTML = streamsData.map(function (s) {
      // v1.6 实形：events[] + handoffs[]（统计现场计算；s.stats mock 回退保留）。
      var events = s.events || [];
      var handoffs = s.handoffs || [];
      var stats = s.stats || {};
      var dispatchCount = stats.dispatch_count !== undefined ? stats.dispatch_count : events.length;
      var sessionCount = stats.session_count !== undefined ? stats.session_count
        : events.map(function (e) { return e.session_id; }).filter(function (id, i, arr) { return id && arr.indexOf(id) === i; }).length;
      var handoffCount = stats.handoff_count !== undefined ? stats.handoff_count : handoffs.length;
      var ctxPct = typeof stats.context_pct === 'number' ? Math.min(100, stats.context_pct)
        : (events.length > 0 && typeof events[events.length - 1].context_estimate === 'number'
          ? Math.min(100, Math.round(events[events.length - 1].context_estimate * 100)) : null);
      var open = openStreams[s.stream_id] === true;
      return '<div class="card stream-card" data-stream="' + esc(s.stream_id) + '">' +
        '<h3>' + esc(s.title || s.stream_id) +
        (s.goal_id ? ' <span class="badge">' + esc(s.goal_id) + '</span>' : '') +
        ' <span class="badge ' + (s.status === 'active' ? 'RUNNING' : 'ok') + '">' + esc(s.status || 'active') + '</span></h3>' +
        '<div class="mono" style="font-size:12px;color:var(--ink-dim)">' +
        '派发 ' + dispatchCount + ' · 会话链 ' + sessionCount +
        (ctxPct !== null ? ' · 上下文估算 <span class="' + (ctxPct > 75 ? 'hash' : '') + '">' + ctxPct + '%</span>' : '') +
        ' · 交接 ' + handoffCount + '</div>' +
        '<div class="stream-timeline" style="display:' + (open ? 'block' : 'none') + '">' +
        (streamTimelineCache[s.stream_id] || '加载中…') + '</div></div>';
    }).join('');
    el.querySelectorAll('.stream-card').forEach(function (card) {
      card.addEventListener('click', function () { toggleStreamTimeline(card); });
    });
  }

  function streamLinkMarker(entry) {
    // 会话链标记（显式 link 字段优先；v1.6 实形走 toggleStreamTimeline 内
    // session_id 比较推断——真续跑🟢同 session / 缝合·换窗🟡同流不同 session）。
    if (entry.link === 'resumed' || entry.resumed === true) return '<span title="真续跑">🟢</span>';
    if (entry.link === 'stitched' || entry.stitched === true) return '<span title="缝合">🟡</span>';
    return '';
  }
  void streamLinkMarker;

  function toggleStreamTimeline(card) {
    var streamId = card.getAttribute('data-stream');
    if (openStreams[streamId]) {
      delete openStreams[streamId];
      renderStreams();
      return;
    }
    openStreams[streamId] = true;
    renderStreams();
    if (streamTimelineCache[streamId]) return;
    getJson('/api/streams/' + encodeURIComponent(streamId)).then(function (data) {
      if (!data || !data.ok || !data.stream) {
        streamTimelineCache[streamId] = '<span class="hash">无时间线数据</span>';
      } else {
        // v1.6 实形：events[] 与 handoffs[] 分列——合并为单时间线（按 at_utc 排序）。
        var s = data.stream;
        var entries = (s.events || []).map(function (e) { return { kind: 'dispatch', at_utc: e.at_utc, event: e }; })
          .concat((s.handoffs || []).map(function (h) { return { kind: 'handoff', at_utc: h.at_utc, handoff: h }; }));
        entries.sort(function (a, b) { return String(a.at_utc || '') < String(b.at_utc || '') ? -1 : 1; });
        var lastSessionId = null;
        streamTimelineCache[streamId] = entries.map(function (entry) {
          if (entry.kind === 'handoff') return renderHandoffBlock(entry.handoff);
          var ev = entry.event;
          // 会话链标记：同 session_id 复用 = 真续跑🟢；同流不同 session（有前窗）= 缝合/换窗🟡。
          var marker = '';
          if (ev.session_id) {
            if (lastSessionId !== null && ev.session_id === lastSessionId) marker = '<span title="真续跑">🟢</span>';
            else if (lastSessionId !== null) marker = '<span title="缝合/换窗">🟡</span>';
            lastSessionId = ev.session_id;
          }
          return '<div class="stream-entry">' + marker + ' ' +
            '<span class="mono">' + esc(String(ev.dispatch_id || '').slice(0, 12)) + '…</span> ' +
            esc(ev.adapter_id || '') + ' <span class="mono">' + escTime(ev.at_utc || '') + '</span>' +
            (ev.context_estimate ? ' <span class="hint">ctx≈' + Math.round(ev.context_estimate * 100) + '%</span>' : '') + '</div>';
        }).join('') || '<span class="hash">（空时间线）</span>';
      }
      renderStreams();
    }).catch(function () {
      streamTimelineCache[streamId] = '<span class="hash">时间线加载失败</span>';
      renderStreams();
    });
  }

  function loadBudget() {
    return getJson('/api/budget').then(function (data) {
      if (data.ok) budget = data;
      renderBudget();
      renderRailBudget(); // GOAL-020 B2：栏内迷你条同步刷新
    }).catch(function () { renderBudget(); renderRailBudget(); });
  }

  refresh().then(function () {
    loadWorkspaces();
    loadBudget();
    loadStreams();
    loadTasks(); // GOAL-020 B5：任务池（v1.7 mock）
    // GOAL-018B #3：页面加载即恢复上次会话（localStorage session_id → GET history 全量重渲染）。
    if (chatSessionId) switchChatSession(chatSessionId); else renderSessionSelector();
    var status = document.getElementById('sse-status');
    var source = new EventSource('/api/stream');
    source.onopen = function () { status.textContent = 'SSE 实时'; status.className = 'live'; };
    source.onerror = function () { status.textContent = 'SSE 断开（重连中）'; status.className = 'down'; };
    source.onmessage = function (msg) {
      var payload = null;
      try { payload = JSON.parse(msg.data); } catch (e) { payload = null; }
      if (payload && payload.kind === 'dispatch') {
        trackDispatch(payload.dispatch_id, payload.adapter_id, payload.status);
        loadBudget();
        // 头犬派发进入 REPORT/REVIEW 后，头犬回复已落盘 runtime/chat —— 拉历史补齐气泡。
        if (payload.adapter_id === 'head-dog' && (payload.phase === 'REPORT' || payload.phase === 'REVIEW')) {
          chatRefreshHistory();
        }
      }
      refresh();
    };
  });
})();
</script>
</body>
</html>
`;
}
