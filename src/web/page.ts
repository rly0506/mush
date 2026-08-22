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

import { getCollaborationStyles } from './ui/styles.ts';
import { renderCollaborationModeCapsulesHtml } from './ui/views/chat-bar.ts';
import { renderDebateArenaHtml } from './ui/views/debate-view.ts';
import { renderPipelineStudioHtml } from './ui/views/pipeline-view.ts';
import { renderRedBlueStudioHtml } from './ui/views/red-blue-view.ts';
import { renderBountyMarketHtml } from './ui/views/bounty-view.ts';
import { renderSkillsFederationHtml } from './ui/views/skills-view.ts';
import { renderTimeTravelHtml } from './ui/views/time-travel-view.ts';
import { renderBlackboardHtml } from './ui/views/blackboard-view.ts';
import { renderLiquidSquadsHtml } from './ui/views/squads-view.ts';
import { renderEloRankingsHtml } from './ui/views/elo-view.ts';
import { renderSelfEvolvingRoutingHtml } from './ui/views/routing-view.ts';
import { renderVelocityMatrixHtml } from './ui/views/velocity-view.ts';
import { getCollaborationClientScript } from './ui/client-scripts.ts';

export function renderBoardPage(callerToken?: string): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="mush-caller-auth" content="${typeof callerToken === 'string' ? callerToken.replace(/"/g, '&quot;') : ''}">
<title>mush 看板 · 雪橇队指挥台</title>
<style>
${getCollaborationStyles()}
  :root {
    color-scheme: light;
    /* Claude Code 暖陶土纸面设计系统 (Claude Warm Terracotta & Paper Theme - D68) */
    --bg: #f8f6f2;             /* Claude 经典温润暖纸色底，柔和护眼 */
    --panel: #ffffff;          /* 纯净暖白卡片 */
    --panel-hi: #f0ebe1;       /* 暖灰阶梯与悬停高亮 */
    --panel-subtle: #fbf9f6;   /* 柔和次级底色 */
    --line: #e3ddd3;           /* 温暖细腻陶土边框线 */
    --line-subtle: #ede8df;
    --ink: #2b2823;            /* 柔暖深浓缩咖啡黑主文字 */
    --ink-dim: #6e675f;        /* 温暖陶土中灰副文本 */
    --ink-faint: #9c9488;      /* 辅助浅灰 */
    --accent: #cc6b49;         /* Claude 标志性暖陶土橙 (Warm Terracotta) */
    --accent-deep: #a84e30;
    --accent-light: rgba(204, 107, 73, 0.12);
    --ember: #cc6b49;          /* 暖陶土强调色 */
    --ember-tint: #faede7;     /* 柔和暖陶土 tint 底色 */
    --danger: #c94a38;         /* 柔和朱砂红 */
    --ok: #2e8555;             /* 柔和林木绿 */
    --ok-tint: rgba(46, 133, 85, 0.12);
    --info: #3b82f6;           /* 柔和晴空蓝 */
    --whale: #4d9fe8;          /* DeepSeek 鲸蓝 */
    --sun: #e8975a;            /* Claude 日冕橙 */
    --knot: #6fd3a5;           /* OpenAI 花结绿 */
    /* GOAL-017B #4：各家族官方品牌主色（owner 2026-08-17 指定） */
    --brand-deepseek: #4D6BFE;
    --brand-claude: #D97757;
    --brand-kimi: #7C5CFF;
    --brand-glm: #4E7AC7;
    --brand-opencode: #F6BF67;
    --brand-codex: #8a9cb0;   /* codex 手绘灰兜底 */
    --brand-agy: #1A73E8;     /* Antigravity / Gemini 蓝 */
    --star: #a98ae8;          /* GLM 星紫 */
    --moon: #8fb7d8;          /* Kimi 新月银蓝 */
    --spark: #1A73E8;         /* AGY / Gemini 星火蓝 */
    --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --font-mono: Consolas, "Courier New", monospace;
    /* 雪原白昼基线对照 (GOAL-020): --bg: #eef1f5; --panel: #ffffff; --ink: #1d2733; --ink-dim: #5a6675; --ink-faint: #9aa5b1; --accent: #0e9f8f; --ember: #c07a1f; --ember-tint: #fdf3e3; color-scheme: light; */
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
    font-size: 12px; color: var(--ember); border: 1px solid var(--line);
    background: var(--panel-hi); border-radius: 6px; padding: 2px 10px;
  }
  #head-dog-badge {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--ink);
    border: 1px solid var(--line); background: var(--panel-hi);
    border-radius: 6px; padding: 3px 11px 3px 5px;
  }
  #head-dog-badge .logo-slot { display: inline-flex; width: 20px; height: 20px; }
  #head-dog-badge .logo-slot svg, #head-dog-badge .logo-slot img { width: 20px; height: 20px; }
  /* GOAL-020 B3：审批收编卡（dashi 收编式，琥珀 tint，常态零红色储备） */
  .rail-appr-card { background: var(--ember-tint); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; font-size: 12px; }
  .rail-appr-head { display: flex; align-items: center; gap: 8px; }
  .ember-badge { color: var(--ember); border-color: var(--ember); background: transparent; }
  .rail-appr-goal-inline { font-weight: 600; color: var(--ink); font-size: 12px; }
  .rail-appr-body { margin-top: 6px; border-top: 1px dashed var(--line); padding-top: 6px; }
  .rail-appr-row { padding: 2px 0; color: var(--ink-dim); }
  .rail-appr-label { display: inline-block; min-width: 76px; color: var(--ink-faint); font-size: 11px; }
  .rail-appr-goal { font-weight: 600; color: var(--ink); font-size: 13px; }
  .rail-appr-prompt { white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow: auto; border: 1px solid var(--line); padding: 6px; border-radius: 4px; margin: 4px 0 0; background: var(--panel-subtle); color: var(--ink); }
  .rail-appr-actions { display: flex; gap: 6px; margin-top: 8px; }
  .rail-appr-actions .act { padding: 3px 12px; font-size: 12px; }
  /* GOAL-020 B5：任务池三泳道（dashi 范式入位新骨架） */
  .task-board { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .task-lane { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-height: 200px; }
  .lane-body { max-height: 60vh; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent;
    border-bottom: 1px solid var(--line); }
  .task-lane h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--ink-dim); letter-spacing: 1px; }
  .lane-todo h3 { color: #a78bfa; }
  .lane-doing h3 { color: var(--info); }
  .lane-done h3 { color: var(--ok); }
  .task-card { background: var(--panel-hi); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 13px; transition: border-color 0.15s ease; }
  .task-card:hover { border-color: var(--accent); }
  .task-card .task-title { font-weight: 600; color: var(--ink); margin-bottom: 4px; }
  .task-card .task-meta { font-size: 12px; color: var(--ink-faint); display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .task-card .task-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .task-card .task-actions .act { padding: 2px 10px; font-size: 11px; }
  .badge.prio-高 { color: var(--danger); border-color: var(--danger); }
  .badge.prio-中 { color: var(--ember); border-color: var(--ember); }
  .badge.prio-低 { color: var(--ink-faint); border-color: var(--ink-faint); }
  .badge.BLOCKED { color: var(--ember); border-color: var(--ember); }
  /* GOAL-022：人话原则（D36）——序号/Goal 聚簇角标/批量派发条 */
  .task-seq { color: var(--ink-faint); font-size: 12px; font-weight: 400; }
  .badge.goal-cluster { color: var(--accent); border-color: var(--accent-deep); background: var(--ember-tint); font-size: 10px; }
  .task-select { margin-right: 6px; vertical-align: middle; width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }
  .task-batch-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed var(--line); }
  .task-batch-bar .hint { color: var(--ink-dim); }
  /* GOAL-024：任务视图切换与思维导图 / DAG 路径图 */
  .tasks-view-switch { display: inline-flex; gap: 4px; background: var(--panel-hi); padding: 3px; border-radius: 6px; border: 1px solid var(--line); }
  .view-switch-btn { background: transparent; border: none; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; color: var(--ink-dim); cursor: pointer; transition: all 0.15s ease; }
  .view-switch-btn:hover { color: var(--ink); }
  .view-switch-btn.active { background: var(--panel); color: var(--ink); border: 1px solid var(--line); font-weight: 600; }
  /* GOAL-024 & D68: 全景路线图与思维导图拓扑系统 (Column-Tree DAG Mindmap) */
  .dag-viewport { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 14px; overflow-x: auto; min-height: 480px; position: relative; }
  .dag-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; padding: 8px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; flex-wrap: wrap; }
  .dag-zoom-controls { display: inline-flex; align-items: center; gap: 6px; }
  .dag-zoom-btn { padding: 3px 9px; font-size: 11px; background: var(--panel-hi); border: 1px solid var(--line); border-radius: 5px; color: var(--ink); cursor: pointer; transition: all 0.15s ease; }
  .dag-zoom-btn:hover { border-color: var(--accent); color: var(--accent); }
  .dag-legend { display: inline-flex; align-items: center; gap: 12px; font-size: 11px; color: var(--ink-dim); flex-wrap: wrap; }
  .dag-legend-item { display: inline-flex; align-items: center; gap: 4px; }
  .dag-tree-canvas { display: flex; gap: 18px; min-width: max-content; padding-bottom: 24px; transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top left; }
  .dag-column-group { display: flex; flex-direction: column; align-items: center; width: 230px; flex-shrink: 0; position: relative; }
  .dag-milestone-header { width: 100%; background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 8px; padding: 10px 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); position: relative; transition: all 0.15s ease; box-sizing: border-box; }
  .dag-milestone-header:hover { border-color: var(--accent); box-shadow: 0 4px 12px rgba(204,107,73,0.12); }
  .dag-milestone-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
  .dag-milestone-title { font-size: 12px; font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 6px; }
  .dag-milestone-progress { font-size: 10px; font-weight: 600; color: var(--ok); background: var(--ok-tint); padding: 1px 6px; border-radius: 10px; }
  .dag-milestone-desc { font-size: 11px; color: var(--ink-dim); line-height: 1.35; }
  .dag-column-spine { display: flex; flex-direction: column; align-items: center; width: 100%; margin-top: 8px; position: relative; box-sizing: border-box; }
  .dag-spine-connector { width: 2px; height: 12px; background: var(--line); position: relative; margin: 1px 0; }
  .dag-spine-connector::after { content: ''; position: absolute; bottom: 0; left: -3px; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid var(--line); }
  .dag-card-node { width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; cursor: pointer; transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.02); position: relative; user-select: none; box-sizing: border-box; }
  .dag-card-node:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 14px rgba(204,107,73,0.18); }
  .dag-card-node:active { transform: translateY(0); }
  .dag-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 4px; }
  .dag-card-id { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
  .dag-card-title { font-size: 11.5px; font-weight: 600; color: var(--ink); line-height: 1.35; margin-bottom: 4px; }
  .dag-card-footer { display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: var(--ink-dim); border-top: 1px dashed var(--line); padding-top: 4px; margin-top: 4px; }
  .dag-card-seq { font-family: var(--font-mono); color: var(--ink-faint); }
  .dag-card-dep { color: var(--ember); font-size: 10px; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-mono); }
  .dag-layer-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 600; }
  .dag-layer-badge.layer-fe { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
  .dag-layer-badge.layer-be { background: rgba(139, 92, 246, 0.12); color: #8b5cf6; }
  .dag-layer-badge.layer-gate { background: rgba(204, 107, 73, 0.12); color: var(--accent); }
  .dag-layer-badge.layer-harness { background: rgba(201, 74, 56, 0.12); color: #c94a38; }
  .dag-layer-badge.layer-fs { background: rgba(46, 133, 85, 0.12); color: #2e8555; }
  .dag-canvas { display: flex; flex-direction: column; gap: 16px; width: 100%; }
  .dag-node.node-done, .dag-card-node.node-done { border-color: var(--ok); }
  .dag-node.node-inflight, .dag-card-node.node-inflight { border-color: var(--info); }
  .dag-node.node-ready, .dag-card-node.node-ready { border-color: var(--line); }
  .dag-node.node-blocked, .dag-card-node.node-blocked { border-color: var(--danger); }
  .dag-stream-card { box-sizing: border-box; }



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
  /* ---------- GOAL-021B & GOAL-029：异步聊天流式与 Thinking 思考链展开 ---------- */
  .chat-stage { color: var(--ink-dim); }
  .chat-row.head.chat-streaming .chat-stage { color: var(--accent); }
  .chat-row.head.chat-failed .chat-stage { color: var(--danger); }
  .chat-row.head.chat-streaming .bubble { border-color: var(--accent-deep); }
  .typewriter-text::after { content: '▍'; color: var(--accent); animation: think-dot 1s ease-in-out infinite; }
  .chat-row.head.chat-failed .bubble { background: #fbeae8; border-color: var(--danger); font-weight: 400; }
  button.chat-retry { margin-top: 6px; padding: 3px 12px; font-size: 12px; }
  /* GOAL-029: Thinking 思考链可折叠气泡 */
  .thinking-collapsible {
    margin-bottom: 8px; border: 1px dashed var(--line); border-radius: 6px;
    background: rgba(140, 160, 180, 0.08); font-size: 13px; color: var(--ink-dim);
  }
  .thinking-summary {
    cursor: pointer; padding: 6px 10px; font-weight: 500; user-select: none;
    display: flex; align-items: center; gap: 6px; outline: none;
  }
  .thinking-summary:hover { color: var(--accent); }
  .thinking-content {
    padding: 8px 12px; border-top: 1px dashed var(--line); font-size: 12px;
    line-height: 1.6; color: var(--ink-dim); max-height: 240px; overflow-y: auto;
    white-space: pre-wrap; font-family: Consolas, monospace;
  }
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
  /* ---------- GOAL-023: 任务卡活动时间线与三透镜抽屉 (D38) ---------- */
  .task-card { cursor: pointer; transition: border-color .15s, box-shadow .15s; }
  .task-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
  .task-drawer-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 90;
    display: flex; justify-content: flex-end; animation: drawer-fade-in .15s ease-out;
  }
  .task-drawer {
    width: 480px; max-width: 90vw; height: 100vh; background: var(--panel-hi); border-left: 1px solid var(--line);
    display: flex; flex-direction: column; box-shadow: -4px 0 20px rgba(0,0,0,0.1); animation: drawer-slide-in .2s ease-out;
  }
  @keyframes drawer-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes drawer-slide-in { from { transform: translateX(100%); } to { transform: none; } }
  .task-drawer-header { padding: 16px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
  .task-drawer-title-row { display: flex; align-items: flex-start; gap: 10px; }
  .task-drawer-title-row h2 { margin: 0; font-size: 16px; flex: 1; font-weight: 600; line-height: 1.4; color: var(--ink); }
  .drawer-close-btn { background: transparent; border: none; font-size: 18px; cursor: pointer; color: var(--ink-dim); padding: 0 4px; }
  .drawer-close-btn:hover { color: var(--ink); }
  .task-drawer-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; }
  .lenses-bar {
    display: flex; gap: 8px; padding: 10px 20px; background: var(--bg); border-bottom: 1px solid var(--line);
  }
  .lens-btn {
    flex: 1; padding: 6px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--panel); color: var(--ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-family: inherit;
  }
  .lens-btn:hover { border-color: var(--accent); color: var(--accent-deep); background: #eafaf7; }
  .task-drawer-body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 18px; }
  .task-drawer-section h3 { margin: 0 0 10px; font-size: 13px; color: var(--ink-dim); font-weight: 600; letter-spacing: 0.5px; }
  .activity-timeline { display: flex; flex-direction: column; position: relative; padding-left: 20px; }
  .activity-timeline::before { content: ''; position: absolute; left: 7px; top: 8px; bottom: 8px; width: 2px; background: var(--line); }
  .timeline-node { position: relative; padding-bottom: 16px; font-size: 13px; }
  .timeline-node:last-child { padding-bottom: 0; }
  .timeline-dot {
    position: absolute; left: -20px; top: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--panel); border: 2px solid var(--ink-dim); display: flex; align-items: center; justify-content: center;
  }
  .timeline-dot svg, .timeline-dot img { width: 12px; height: 12px; }
  .timeline-header { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-faint); margin-bottom: 3px; }
  .timeline-body { color: var(--ink); line-height: 1.5; }
  .timeline-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
  .context-links { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .context-link-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
  /* 最近活动流组件 */
  .recent-activity-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
  .recent-activity-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--ink-dim); }
  .recent-activity-stream { display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; }
  .activity-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; border: 1px solid transparent; }
  .activity-item:hover { background: var(--panel-hi); border-color: var(--line); }
  .activity-item .activity-time { font-size: 11px; color: var(--ink-faint); margin-left: auto; }

  /* 图像附件与预览条样式 */
  .chat-image-previews { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; padding: 4px 0; }
  .chat-image-item { position: relative; display: inline-flex; align-items: center; background: var(--panel-hi); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; font-size: 11px; color: var(--ink); }
  .chat-image-item img { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; margin-right: 6px; border: 1px solid var(--line); }
  .chat-image-item .img-remove { margin-left: 6px; cursor: pointer; color: var(--danger); font-weight: bold; background: none; border: none; padding: 0 2px; font-size: 13px; line-height: 1; }
  .chat-img-thumb { max-width: 260px; max-height: 200px; border-radius: 6px; border: 1px solid var(--line); margin-top: 8px; display: block; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; background: #fff; }
  .chat-img-thumb:hover { transform: scale(1.02); box-shadow: 0 4px 14px rgba(0,0,0,0.15); }
  /* 犬只头像手型与交互反馈 */
  .dog-avatar, .avatar, #head-dog-badge, .rail-dog-card .dog-logo, .chat-action-card .dog-logo, .roster-avatar { cursor: pointer; transition: transform 0.15s ease, filter 0.15s ease; }
  .dog-avatar:hover, .avatar:hover, #head-dog-badge:hover, .rail-dog-card:hover .dog-logo { transform: scale(1.12); filter: drop-shadow(0 2px 6px rgba(0,0,0,0.2)); }


  /* 工作区目录树选择器样式 */
  #workspace-tree-dialog {
    width: 600px; max-width: 92vw; border: 1px solid var(--line); border-radius: 8px;
    padding: 0; background: var(--panel); box-shadow: 0 12px 36px rgba(0,0,0,0.2);
  }
  #workspace-tree-dialog::backdrop { background: rgba(0,0,0,0.45); }
  .ws-tree-header { padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; background: var(--bg); }
  .ws-tree-body { padding: 14px 18px; max-height: 400px; overflow-y: auto; }
  .ws-drives-bar { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .ws-drive-btn { padding: 3px 10px; font-size: 12px; border-radius: 4px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
  .ws-drive-btn:hover { background: #eafaf7; border-color: var(--accent); color: var(--accent-deep); }
  .ws-path-bar { display: flex; gap: 6px; align-items: center; margin-bottom: 12px; }
  .ws-dir-list { display: flex; flex-direction: column; gap: 2px; }
  .ws-dir-item { padding: 6px 10px; border-radius: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--ink); border: 1px solid transparent; }
  .ws-dir-item:hover { background: var(--panel-hi); border-color: var(--line); }
  .ws-dir-item.selected { background: #eafaf7; border-color: var(--accent); color: var(--accent-deep); font-weight: 500; }
  .ws-tree-footer { padding: 12px 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; background: var(--bg); }

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
  <button data-view="chat" class="active">💬 对话工坊</button>
  <button data-view="tasks">📋 任务池</button>
  <button data-view="dispatch" class="drawer-tab">🚀 调度</button>
  <button data-view="streams" class="drawer-tab">🌊 工作流</button>
  <button data-view="dogs" class="drawer-tab">🐕 犬队与天梯</button>
  <button data-view="velocity" class="drawer-tab">📈 效能大屏</button>
  <button data-view="epochs" class="drawer-tab">📜 事件链</button>
  <button data-view="budget" class="drawer-tab">💰 预算消耗</button>
  <button data-view="carveouts" class="drawer-tab" style="display:none">写面白名单</button>
  <button data-view="approvals" class="drawer-tab">🛡️ 审批 <span id="waiting-count"></span></button>
</nav>
<main>
  <section id="view-chat" class="view active deck">
    <div class="deck-main">
    <div class="chat-toolbar">
      <span>你只和头犬说话 —— 它自主派活、审核回报，触发门会弹回这里。</span>
      <span id="chat-context-gauge" class="badge mono" style="background:rgba(217,119,6,0.1);color:#d97706;border:1px solid rgba(217,119,6,0.25);padding:2px 8px;border-radius:12px;font-size:11px;cursor:help" title="实时模型运作遥测与上下文监控">📊 上下文: 0.6k / 200k (0.3%) | ⚡ 缓存: 0% | 💰 $0.000</span>
      <label style="display:inline-flex;align-items:center;gap:4px">📁 工作区 <select id="chat-workspace-select" style="width:auto;max-width:160px;padding:3px 8px;font-size:12px"></select><button class="act" id="chat-workspace-browse-btn" type="button" style="padding:2px 6px;font-size:11px;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)" title="调起系统文件管理器选取本地文件夹">📁 浏览</button><button class="act" id="chat-workspace-tree-btn" type="button" style="padding:2px 6px;font-size:11px;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)" title="打开网页目录树选择器">🗂️ 目录树</button></label>
      <label>头犬 <select id="chat-head-select" style="width:auto;padding:3px 8px;font-size:12px"></select></label>
      <label id="chat-head-provider-wrap" style="display:none">Provider <select id="chat-head-provider" style="width:auto;padding:3px 8px;font-size:12px"></select></label>
      <label id="chat-head-variant-wrap" style="display:none">模型 <select id="chat-head-variant" style="width:auto;padding:3px 8px;font-size:12px"></select></label>
      <button class="act" id="chat-probe-btn" type="button" style="padding:2px 8px;font-size:12px;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)" title="实测探测当前 Provider 模型">⚡ 探测</button>
      <label>思维 <select id="chat-effort" style="width:auto;padding:3px 8px;font-size:12px">
        <option>LOW</option>
        <option selected>HIGH</option>
        <option>XHIGH</option>
      </select></label>


      <label>会话 <select id="chat-session-select" style="width:auto;padding:3px 8px;font-size:12px"><option value="">（新会话）</option></select></label>
      <span class="mono" id="chat-session-label"></span>
      <label><input type="checkbox" id="notify-toggle"> 浏览器通知</label>
      <button class="act" id="chat-compact-btn" type="button" style="padding:3px 10px;font-size:12px;background:rgba(16,185,129,0.1);color:#059669;border:1px solid rgba(16,185,129,0.3)" title="提取结构化会话不变式并压缩上下文">📦 状态压缩</button>
      <button class="act cancel" id="chat-new-session" type="button" style="padding:3px 10px;font-size:12px">新会话</button>
    </div>
    <div id="chat-stream"><div class="empty">向头犬下达第一条指令，开始对话。</div></div>
    <div id="chat-composer" style="display:flex;flex-direction:column;gap:6px">
      <div id="chat-image-previews" class="chat-image-previews" style="display:none"></div>
      <div style="display:flex;gap:10px;align-items:flex-end">
        <textarea id="chat-input" maxlength="64000" placeholder="写给头犬的指令… 支持 @path/to/file 装载，支持 Ctrl+V 粘贴截图与拖拽图片，Enter 发送，Shift+Enter 换行" style="flex:1"></textarea>
        <div style="display:flex;flex-direction:column;gap:6px">
          <input type="file" id="chat-file-input" accept="image/*" multiple style="display:none">
          <button type="button" class="act" id="chat-attach-btn" title="添加图片附件（支持 Ctrl+V 粘贴截图与拖拽图片）" style="padding:6px 10px;font-size:12px;white-space:nowrap;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)">🖼️ 图片</button>
          <button class="primary" id="chat-send" style="padding:8px 16px;font-size:13px">发送</button>
        </div>
      </div>
    </div>

    ${renderCollaborationModeCapsulesHtml()}
    </div>
    <aside class="deck-rail" id="deck-rail">
      <div id="rail-approvals"></div>
      <div class="rail-block">
        <h3 class="rail-title">最近活动</h3>
        <div id="rail-activity" class="recent-activity-stream"><div class="empty" style="padding:8px 0;font-size:11px">暂无活动</div></div>
      </div>
      <div class="rail-block">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 class="rail-title" style="margin:0">犬队</h3>
          <button class="act" id="rail-probe-all" type="button" style="padding:2px 6px;font-size:10px;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)" title="一键实测探测全队模型">🔍 实测探测</button>
        </div>
        <div id="rail-dogs"></div>
      </div>
      <div class="rail-block">
        <h3 class="rail-title">预算</h3>
        <div id="rail-budget"></div>
      </div>
    </aside>
  </section>
  <section id="view-tasks" class="view">
    <div class="recent-activity-panel" id="task-recent-activity">
      <div class="recent-activity-header">
        <span>最近活动（实时事件转译 · D38）</span>
        <span class="hint">点击条目直达任务卡时间线</span>
      </div>
      <div class="recent-activity-stream" id="recent-activity-stream"><div class="empty" style="padding:6px 0;font-size:12px">暂无活动</div></div>
    <div class="tasks-header-bar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="tasks-view-switch" style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="view-switch-btn active" id="btn-tasks-board" onclick="switchTasksView('board')">📋 泳道看板</button>
        <button type="button" class="view-switch-btn" id="btn-tasks-dag" onclick="switchTasksView('dag')">🗺️ 路径导图</button>
        <button type="button" class="act" id="btn-tasks-refresh" style="padding:4px 10px;font-size:12px;display:inline-flex;align-items:center;gap:4px;background:var(--panel-hi);border:1px solid var(--line);border-radius:6px;cursor:pointer;color:var(--ink);" title="即刻刷新任务池与路径导图数据">🔄 刷新</button>
        <span id="tasks-refresh-status" style="font-size:11px;color:var(--ink-faint);"></span>
      </div>
      <div style="font-size:12px;color:var(--ink-dim)">已完成 🟢 / 进行中 🔵 / 待办 ⚪ / 受阻 🔴</div>
    </div>
    <div id="tasks-board-container" class="task-board">

      <div class="task-lane lane-todo"><h3>待办</h3><div class="lane-body" id="lane-todo"></div></div>
      <div class="task-lane lane-doing"><h3>进行中</h3><div class="lane-body" id="lane-doing"></div></div>
      <div class="task-lane lane-done"><h3>完成</h3><div class="lane-body" id="lane-done"></div></div>
    </div>
    <div id="tasks-dag-container" class="dag-viewport" style="display:none">
      <div id="tasks-dag-canvas" class="dag-canvas"></div>
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
        <div id="dispatch-provider-wrap" style="display:none">
          <label for="dispatch-provider">Provider 服务商/代理</label>
          <select id="dispatch-provider"></select>
        </div>
        <div id="dispatch-model-wrap" style="display:none">
          <label for="dispatch-model">模型变体</label>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="dispatch-model" style="flex:1"></select>
            <button class="act" id="dispatch-probe-btn" type="button" style="padding:5px 10px;font-size:12px;white-space:nowrap;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)" title="实测探测所选 Provider 可用模型">⚡ 探测</button>
          </div>
          <div class="hint" id="dispatch-probe-hint">变体 = 身份期望（合同声明），非实时能力清单。</div>
        </div>

        <div>
          <label for="workspace-select">workspace（工作区）</label>
          <select id="workspace-select"></select>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <input type="text" id="workspace-register-path" placeholder="登记新路径，如 D:\\my-project" style="flex:1;min-width:180px;font-family:Consolas,monospace;font-size:12px">
            <button type="button" class="act" id="btn-workspace-browse-native" title="调起系统文件管理器选取本地文件夹">📁 浏览电脑文件夹</button>
            <button type="button" class="act" id="btn-workspace-tree" title="打开网页目录树选择器">🗂️ 目录树</button>
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
          <label for="dispatch-topology">组织架构模式 (GOAL-028)</label>
          <select id="dispatch-topology">
            <option value="HIERARCHICAL">🌲 雪橇领航制 (Hierarchical - 默认)</option>
            <option value="PIPELINE_SOP">⛓️ 工序流水线制 (Pipeline SOP)</option>
            <option value="COMMITTEE_DEBATE">⚖️ 对席陪审辩论制 (Committee Debate)</option>
            <option value="BOUNTY_MARKET">🏷️ 悬赏竞标市场制 (Bounty Market)</option>
          </select>
        </div>
        <div>
          <label for="dispatch-verifier">独立验证犬 (LLM Verifier，可选)</label>
          <select id="dispatch-verifier">
            <option value="">（不指定，由头犬统一初审）</option>
          </select>
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
  <section id="view-carveouts" class="view">
    <div class="card">
      <h3>Carve-out 声明式写面白名单工作台</h3>
      <p class="hint">限定犬只写操作仅在已声明的相对路径切片内执行（RM-004 M0 / D31 防御）。</p>
      <div id="carveout-active-wrap" style="margin: 12px 0;"></div>
      <form id="form-grant-carveout" style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-top:12px;">
        <div class="full"><label>授权相对目录（多路径以英文逗号分隔）<input type="text" id="co-input-paths" placeholder="src/web, tests" required></label></div>
        <div><label>时效时长<select id="co-select-duration"><option value="15">15 分钟</option><option value="60" selected>1 小时</option><option value="1440">24 小时</option></select></label></div>
        <div><label>关联任务 (Task Ref)<input type="text" id="co-input-task" placeholder="GOAL-034" required></label></div>
        <div class="full"><label>授权原因 (Reason)<input type="text" id="co-input-reason" placeholder="Implementing UI components" required></label></div>
        <div class="full" style="display:flex;justify-content:flex-end;"><button type="submit" class="primary" id="btn-submit-carveout">签发 Carve-out 白名单</button></div>
      </form>
    </div>
    <h3 style="font-size:13px;color:var(--ink-dim)">切片历史与留痕</h3>
    <div id="carveouts-history-list"><div class="empty">暂无切片记录</div></div>
  </section>
  <section id="view-approvals" class="view"></section>
  <div id="task-drawer-overlay" class="task-drawer-overlay" style="display:none">
    <div class="task-drawer" id="task-drawer">
      <div class="task-drawer-header">
        <div class="task-drawer-title-row">
          <span id="drawer-task-seq" class="task-seq">#1</span>
          <h2 id="drawer-task-title">任务标题</h2>
          <button id="btn-close-task-drawer" class="drawer-close-btn" type="button" title="关闭 (Esc)">✕</button>
        </div>
        <div class="task-drawer-meta" id="drawer-task-meta"></div>
      </div>
      <div class="lenses-bar" id="task-lenses-bar">
        <button type="button" class="lens-btn" id="btn-lens-trace" title="查看该任务派发步骤与执行详情">🔍 执行 Trace</button>
        <button type="button" class="lens-btn" id="btn-lens-chat" title="向头犬或指定犬发起续话">🐕 犬只直连</button>
        <button type="button" class="lens-btn" id="btn-lens-budget" title="查看任务台账与用量">💰 花费下钻</button>
      </div>
      <div class="task-drawer-body">
        <div class="task-drawer-section">
          <h3>活动时间线</h3>
          <div class="activity-timeline" id="task-activity-timeline"><div class="empty" style="padding:10px 0;font-size:12px">暂无活动记录</div></div>
        </div>
        <div class="task-drawer-section">
          <h3>关联信息</h3>
          <div id="task-context-links" class="context-links"></div>
        </div>
      </div>
    </div>
  </div>
  ${renderDebateArenaHtml()}
  ${renderPipelineStudioHtml()}
  ${renderRedBlueStudioHtml()}
  ${renderBountyMarketHtml()}
  ${renderSkillsFederationHtml()}
  ${renderTimeTravelHtml()}
  ${renderBlackboardHtml()}
  ${renderLiquidSquadsHtml()}
  ${renderEloRankingsHtml()}
  ${renderSelfEvolvingRoutingHtml()}
  ${renderVelocityMatrixHtml()}
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
<div id="child-dog-drawer" class="drawer-overlay" style="display:none;position:fixed;top:0;right:0;width:440px;height:100%;background:#ffffff;box-shadow:-4px 0 20px rgba(0,0,0,0.1);z-index:999;border-left:1px solid var(--line);flex-direction:column">
  <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;background:var(--bg)">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="font-weight:600;font-size:13px;color:var(--ink)" id="child-dog-drawer-title">🐶 工犬专属终端</div>
      <select id="child-dog-select" style="width:auto;padding:2px 6px;font-size:12px;border:1px solid var(--line);border-radius:4px;background:#fff"></select>
    </div>
    <button id="child-dog-drawer-close" class="act cancel" style="padding:2px 8px;font-size:13px;border-radius:4px" title="关闭终端">✕</button>
  </div>
  <div id="child-dog-drawer-meta" style="padding:8px 14px;background:var(--panel-hi);border-bottom:1px solid var(--line);font-size:11px;color:var(--ink-dim)"></div>
  <div id="child-dog-drawer-logs" style="flex:1;overflow-y:auto;padding:12px;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;background:#faf8f5;line-height:1.6"></div>
  <div style="padding:10px 14px;border-top:1px solid var(--line);display:flex;gap:8px;background:#ffffff">
    <input type="text" id="child-dog-drawer-input" placeholder="直接向该工犬下达追加指令…" style="flex:1;padding:6px 10px;font-size:12px;border:1px solid var(--line);border-radius:6px">
    <button class="primary" id="child-dog-drawer-send" style="padding:6px 14px;font-size:12px">发送</button>
  </div>
</div>

<dialog id="workspace-tree-dialog">
  <div class="ws-tree-header">
    <div style="font-weight:600;font-size:14px;color:var(--ink)">🗂️ 选择本地工作区目录</div>
    <button type="button" class="act cancel" id="ws-tree-close" style="padding:2px 8px;font-size:13px">✕</button>
  </div>
  <div class="ws-tree-body">
    <div class="ws-drives-bar" id="ws-drives-container"></div>
    <div class="ws-path-bar">
      <button type="button" class="act" id="ws-tree-up-btn" style="padding:4px 8px;font-size:12px">⬆ 返回上级</button>
      <input type="text" id="ws-tree-path-input" style="flex:1;font-family:Consolas,monospace;font-size:12px;padding:4px 8px" placeholder="当前路径…">
      <button type="button" class="act" id="ws-tree-go-btn" style="padding:4px 10px;font-size:12px">跳转</button>
    </div>
    <div class="ws-dir-list" id="ws-dir-list-container">
      <div class="empty" style="padding:20px 0">正在加载本地目录…</div>
    </div>
  </div>
  <div class="ws-tree-footer">
    <div style="font-size:12px;color:var(--ink-dim);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:10px" id="ws-tree-selected-label">当前未选择</div>
    <div style="display:flex;gap:8px">
      <button type="button" class="act cancel" id="ws-tree-cancel-btn">取消</button>
      <button type="button" class="act approve" id="ws-tree-confirm-btn">选择此文件夹并登记为工作区</button>
    </div>
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

  function getCallerAuth() {
    var meta = document.querySelector('meta[name="mush-caller-auth"]');
    return meta ? (meta.getAttribute('content') || '') : '';
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    var authVal = getCallerAuth();
    if (authVal) headers['x-mush-caller-auth'] = authVal;
    opts.headers = headers;
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, body: data }; });
    });
  }

  function getJson(url) {
    return fetch(url).then(function (res) { return res.json(); });
  }

  function postJson(url, body) {
    return fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function patchJson(url, body) {
    return fetchJson(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function putJson(url, body) {
    return fetchJson(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function deleteJson(url) {
    return fetchJson(url, { method: 'DELETE' });
  }

  /* ---------- GOAL-012 / GP-23 + GOAL-017B #4：犬只标识（官方品牌 img 优先，手绘兜底；品牌官方主色） ---------- */
  // family 供 CSS currentColor 配色；品牌色 = owner 2026-08-17 指定官方主色表。
  var FAMILY_COLORS = { whale: '#4D6BFE', sun: '#D97757', knot: '#8a9cb0', star: '#4E7AC7', moon: '#7C5CFF', spark: '#1A73E8', paw: '#8a9cb0' };
  // GOAL-017B：品牌色按 brand（官方主色）；opencode 官方主色表（owner 指定值）。
  var BRAND_COLORS = { deepseek: '#4D6BFE', claude: '#D97757', kimi: '#7C5CFF', glm: '#4E7AC7', opencode: '#F6BF67', codex: '#8a9cb0', agy: '#1A73E8' };

  function detectFamily(text) {
    var t = String(text || '').toLowerCase();
    if (t.indexOf('deepseek') >= 0) return 'whale';
    if (t.indexOf('claude') >= 0 || t.indexOf('anthropic') >= 0) return 'sun';
    if (t.indexOf('kimi') >= 0 || t.indexOf('moonshot') >= 0) return 'moon';
    if (t.indexOf('glm') >= 0 || t.indexOf('zhipu') >= 0 || t.indexOf('zcode') >= 0) return 'star';
    if (t.indexOf('agy') >= 0 || t.indexOf('antigravity') >= 0 || t.indexOf('gemini') >= 0 || t.indexOf('google') >= 0) return 'spark';
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
    spark: '<path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2z" fill="currentColor"/>',
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
    'agy': 'agy',
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
    if (t.indexOf('agy') >= 0 || t.indexOf('antigravity') >= 0) return 'agy';
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
  var HEAD_WHITELIST = { 'deepseek-dsh': 1, 'claude-code': 1, 'kimi-code': 1, 'kimi': 1, 'zcode': 1, 'agy': 1, 'codex': 1, 'opencode': 1 };

  function headCandidates() {
    var roster = (snapshot && snapshot.roster) || [];
    var heads = roster.filter(function (r) {
      return (r.role === 'head' || HEAD_WHITELIST[r.adapter_id] === 1) && r.adapter_id !== 'head-dog' && r.adapter_id !== 'fake-t1' && !r.adapter_id.startsWith('agy-');
    });
    if (heads.length === 0) heads = [{ adapter_id: 'claude-code', expected_model_id: '', verified: true }];
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
    renderHeadProviderOptions();
  }

  function renderHeadProviderOptions() {
    var sel = document.getElementById('chat-head-select');
    var provWrap = document.getElementById('chat-head-provider-wrap');
    var provSel = document.getElementById('chat-head-provider');
    if (!sel || !provSel || !provWrap) return;
    var heads = headCandidates();
    var current = heads.filter(function (r) { return r.adapter_id === sel.value; })[0] || null;
    var providers = (current && current.providers) || [];
    if (providers.length === 0) {
      provWrap.style.display = 'none';
      provSel.innerHTML = '';
    } else {
      provWrap.style.display = '';
      var prev = provSel.value;
      provSel.innerHTML = providers.map(function (p) {
        var prefix = p.is_current ? '★ ' : '🏢 ';
        var currentTag = p.is_current ? ' [当前激活]' : '';
        return '<option value="' + esc(p.id) + '"' + (p.is_current ? ' data-current="1"' : '') + '>' + prefix + esc(p.name) + currentTag + '</option>';
      }).join('');
      if (prev && providers.some(function (p) { return p.id === prev; })) {
        provSel.value = prev;
      } else {
        var activeP = providers.filter(function (p) { return p.is_current; })[0] || providers[0];
        if (activeP) provSel.value = activeP.id;
      }
    }
    renderHeadVariantOptions();
  }

  function renderHeadVariantOptions() {
    var sel = document.getElementById('chat-head-select');
    var provSel = document.getElementById('chat-head-provider');
    var varSel = document.getElementById('chat-head-variant');
    if (!sel || !varSel) return;
    var heads = headCandidates();
    var current = heads.filter(function (r) { return r.adapter_id === sel.value; })[0] || null;
    var providers = (current && current.providers) || [];
    var selectedProvId = provSel && provSel.value ? provSel.value : '';
    var activeProvider = providers.filter(function (p) { return p.id === selectedProvId; })[0] || providers[0] || null;

    var providerModels = (activeProvider && activeProvider.models) || ((current && current.variants) || []);
    var liveModels = (current && current.live_models) || [];
    var tiers = (current && current.model_tiers) || {};
    var defaultModel = (activeProvider && activeProvider.default_model) || (current && (current.default_model_id || current.expected_model_id)) || '';
    var allModels = [...new Set(providerModels.length > 0 ? providerModels : liveModels)];
    var wrap = document.getElementById('chat-head-variant-wrap');
    if (allModels.length === 0) {
      wrap.style.display = 'none';
      varSel.innerHTML = '';
    } else {
      wrap.style.display = '';
      var html = '<option value="">（默认模型' + (defaultModel ? ' · ' + esc(defaultModel) : '') + '）</option>';
      allModels.forEach(function (v) {
        var tier = tiers[v] || (liveModels.indexOf(v) >= 0 ? 'T2_CONFIGURED' : 'T3_CATALOG');
        var label = esc(v);
        if (tier === 'T1_VERIFIED') label = '🟢 [实测通过] ' + esc(v);
        else if (tier === 'T2_CONFIGURED') label = '🟡 [配置就绪] ' + esc(v);
        else if (tier === 'T0_BLOCKED' || (current && current.supports_model_flag === false && v !== defaultModel)) label = '🔴 [受阻/无通道] ' + esc(v);
        else label = '⚪ [目录声明] ' + esc(v);
        html += '<option value="' + esc(v) + '">' + label + '</option>';
      });
      varSel.innerHTML = html;
    }
    renderHeadDogBadge();
    var currentModel = (varSel && varSel.value) ? varSel.value : defaultModel;
    renderDynamicThinkingOptions(currentModel);
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
    var adapterId = sel && sel.value ? sel.value : (heads[0] ? heads[0].adapter_id : 'claude-code');
    var current = heads.filter(function (r) { return r.adapter_id === adapterId; })[0] || null;
    var model = varSel && varSel.value ? varSel.value : (current ? current.expected_model_id || '' : '');
    nameEl.textContent = '当前头犬：' + adapterId + (model ? ' · ' + model : '');
    logoEl.innerHTML = dogLogo(adapterId + ' ' + model, headBadgeState());
    renderDynamicThinkingOptions(model);
  }

  /* ---------- 犬只下拉（G009 修复：取 roster 注册名册；GOAL-025/026：四级信度绑定） ---------- */
  function renderAdapterOptions() {
    var select = document.getElementById('dispatch-adapter');
    var roster = ((snapshot && snapshot.roster) || []).filter(function (r) {
      return r.adapter_id !== 'head-dog' && r.adapter_id !== 'fake-t1' && !r.adapter_id.startsWith('agy-');
    });
    if (roster.length > 0) {
      select.innerHTML = roster.map(function (r) {
        var statusIcon = r.probe_status === 'ONLINE' ? '🟢 ' : (r.probe_status === 'QUOTA_EXHAUSTED' ? '🔴 ' : '');
        var badge = esc(r.expected_provider) + ' / ' + esc(r.actual_model_id || r.expected_model_id);
        var liveModelsStr = (r.live_models || []).join(',');
        var tiersJson = JSON.stringify(r.model_tiers || {});
        var providersJson = JSON.stringify(r.providers || []);
        var supportsFlag = r.supports_model_flag !== false ? '1' : '0';
        var defaultModel = esc(r.default_model_id || r.expected_model_id || '');
        return '<option value="' + esc(r.adapter_id) + '" data-variants="' + esc((r.variants || []).join(',')) + '" data-live-models="' + esc(liveModelsStr) + '" data-probe-status="' + esc(r.probe_status || '') + '" data-model-tiers="' + esc(tiersJson) + '" data-providers="' + esc(providersJson) + '" data-supports-flag="' + supportsFlag + '" data-default-model="' + defaultModel + '">' + statusIcon + esc(r.adapter_id) + '（' + badge + '）</option>';
      }).join('');
      renderDispatchProviderOptions();

      // GOAL-028: 独立 Verifier 下拉（排除当前选中的生成犬）
      var verifierSelect = document.getElementById('dispatch-verifier');
      if (verifierSelect) {
        var curAdapter = select.value;
        var vOpts = ['<option value="">（不指定，由头犬统一初审）</option>'];
        roster.forEach(function (r) {
          if (r.adapter_id !== curAdapter) {
            vOpts.push('<option value="' + esc(r.adapter_id) + '">🛡️ 独立审判: ' + esc(r.adapter_id) + '</option>');
          }
        });
        verifierSelect.innerHTML = vOpts.join('');
      }
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

  /* ---------- G009 & GOAL-026：Provider 与模型变体下拉（Harness -> Provider -> Model 三层联动） ---------- */
  function renderDispatchProviderOptions() {
    var select = document.getElementById('dispatch-adapter');
    var provWrap = document.getElementById('dispatch-provider-wrap');
    var provSel = document.getElementById('dispatch-provider');
    var opt = select && select.options[select.selectedIndex];
    if (!opt || !provWrap || !provSel) return;
    var providersRaw = opt.getAttribute('data-providers') || '[]';
    var providers = [];
    try { providers = JSON.parse(providersRaw); } catch(e) {}
    if (providers.length === 0) {
      provWrap.style.display = 'none';
      provSel.innerHTML = '';
    } else {
      provWrap.style.display = '';
      var prev = provSel.value;
      provSel.innerHTML = providers.map(function (p) {
        var prefix = p.is_current ? '★ ' : '🏢 ';
        var currentTag = p.is_current ? ' [当前激活]' : '';
        return '<option value="' + esc(p.id) + '" data-models="' + esc((p.models || []).join(',')) + '" data-default-model="' + esc(p.default_model || '') + '">' + prefix + esc(p.name) + currentTag + '</option>';
      }).join('');
      if (prev && providers.some(function (p) { return p.id === prev; })) {
        provSel.value = prev;
      } else {
        var activeP = providers.filter(function (p) { return p.is_current; })[0] || providers[0];
        if (activeP) provSel.value = activeP.id;
      }
    }
    renderModelOptions();
  }

  function renderModelOptions() {
    var wrap = document.getElementById('dispatch-model-wrap');
    var select = document.getElementById('dispatch-model');
    var adapterSelect = document.getElementById('dispatch-adapter');
    var provSel = document.getElementById('dispatch-provider');
    var opt = adapterSelect && adapterSelect.options[adapterSelect.selectedIndex];
    var provOpt = provSel && provSel.options[provSel.selectedIndex];

    var liveModels = (opt && opt.getAttribute('data-live-models') || '').split(',').filter(Boolean);
    var variants = (opt && opt.getAttribute('data-variants') || '').split(',').filter(Boolean);
    var probeStatus = opt && opt.getAttribute('data-probe-status') || '';
    var supportsFlag = opt && opt.getAttribute('data-supports-flag') !== '0';
    var defaultModel = (provOpt && provOpt.getAttribute('data-default-model')) || (opt && opt.getAttribute('data-default-model')) || '';
    var providerModels = (provOpt && provOpt.getAttribute('data-models') || '').split(',').filter(Boolean);

    var tiersRaw = opt && opt.getAttribute('data-model-tiers') || '{}';
    var tiers = {};
    try { tiers = JSON.parse(tiersRaw); } catch(e) {}

    var allModels = [...new Set(providerModels.length > 0 ? providerModels : (liveModels.length > 0 ? liveModels : variants))];
    if (allModels.length === 0) { wrap.style.display = 'none'; select.innerHTML = ''; return; }
    wrap.style.display = '';

    var html = '<option value="">（默认模型' + (defaultModel ? ' · ' + esc(defaultModel) : '') + '）</option>';
    allModels.forEach(function (v) {
      var tier = tiers[v] || (liveModels.indexOf(v) >= 0 ? 'T2_CONFIGURED' : 'T3_CATALOG');
      var label = esc(v);
      if (tier === 'T1_VERIFIED') label = '🟢 [实测通过] ' + esc(v);
      else if (tier === 'T2_CONFIGURED') label = '🟡 [配置就绪] ' + esc(v);
      else if (tier === 'T0_BLOCKED' || (!supportsFlag && v !== defaultModel)) label = '🔴 [受阻/无通道] ' + esc(v);
      else label = '⚪ [目录声明] ' + esc(v);
      html += '<option value="' + esc(v) + '">' + label + '</option>';
    });
    select.innerHTML = html;

    var hint = document.getElementById('dispatch-probe-hint');
    if (hint) {
      if (!supportsFlag) {
        hint.innerHTML = '<span style="color:#d97706">⚠️ 该犬不支持命令行传参切换模型，当前固定使用配置的 default_model（' + esc(defaultModel) + '）执行。</span>';
      } else if (probeStatus === 'ONLINE') {
        hint.innerHTML = '<span style="color:#047857">🟢 实测在线（当前 Provider 可用模型数: ' + allModels.length + '）</span>';
      } else {
        hint.textContent = '变体 = 身份期望（合同声明），可点击「⚡ 探测」获取实测列表。';
      }
    }

    var chosenModel = select.value || defaultModel || (allModels[0] || '');
    renderDynamicThinkingOptions(chosenModel);
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
    renderChatWorkspaceOptions();
  }

  function renderChatWorkspaceOptions() {
    var sel = document.getElementById('chat-workspace-select');
    if (!sel) return;
    if (workspaces.length === 0) {
      sel.innerHTML = '<option value="">（默认服务目录）</option>';
      return;
    }
    sel.innerHTML = workspaces.map(function (w) {
      var displayPath = normalizeDisplayPath(w.path);
      var shortName = displayPath.split(/[\\\\/]/).filter(Boolean).pop() || displayPath;
      return '<option value="' + esc(w.path) + '"' + (w.selected ? ' selected' : '') + '>' +
        esc(shortName) + '</option>';
    }).join('');
  }

  function updateChatWorkspace(targetPath) {
    if (!targetPath) return;
    postJson('/api/workspaces/select', { path: targetPath }).then(function (result) {
      if (result.status === 201) {
        toast('工作区已切换为: ' + normalizeDisplayPath(targetPath), true);
        refresh();
      } else {
        toast('工作区切换失败', false);
      }
    }).catch(function (e) { toast('工作区切换失败: ' + e, false); });
  }

  function renderDynamicThinkingOptions(modelId) {
    var effortSel = document.getElementById('chat-effort');
    var dispatchEffortSel = document.getElementById('dispatch-effort');
    if (!effortSel && !dispatchEffortSel) return;
    var m = (modelId || '').toLowerCase();
    var options = [];
    if (m.includes('claude-3-7') || m.includes('opus') || m.includes('fable') || m.includes('sonnet-4') || m.includes('thinking')) {
      options = [
        { label: '关闭 (0k)', value: '0' },
        { label: '低 (2k)', value: '2048' },
        { label: '中 (8k)', value: '8192', selected: true },
        { label: '高 (16k)', value: '16384' },
        { label: '极限 (64k)', value: '65536' },
      ];
    } else if (m.includes('o1') || m.includes('o3') || m.includes('o4') || m.includes('gpt-5') || m.includes('codex')) {
      options = [
        { label: '极简 (minimal)', value: 'minimal' },
        { label: '低 (low)', value: 'low' },
        { label: '中 (medium)', value: 'medium', selected: true },
        { label: '高 (high)', value: 'high' },
        { label: '极限 (max)', value: 'max' },
      ];
    } else if (m.includes('r1') || m.includes('reasoner') || m.includes('deepseek-r')) {
      options = [
        { label: '深度思考 (Deep Think)', value: 'on', selected: true },
        { label: '快速响应 (Fast)', value: 'off' },
      ];
    } else {
      options = [
        { label: 'LOW', value: 'LOW' },
        { label: 'HIGH', value: 'HIGH', selected: true },
        { label: 'XHIGH', value: 'XHIGH' },
      ];
    }

    var html = options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');

    if (effortSel) effortSel.innerHTML = html;
    if (dispatchEffortSel) dispatchEffortSel.innerHTML = html;
  }

  var currentChildSessionId = null;

  function openChildDogDrawer(dogName, sessionId, title) {
    var drawer = document.getElementById('child-dog-drawer');
    if (!drawer) return;
    drawer.style.display = 'flex';
    currentChildSessionId = sessionId || ('csess_' + (dogName || 'worker'));
    document.getElementById('child-dog-drawer-title').textContent = '🐶 工犬专属终端: ' + (dogName || '工犬');
    document.getElementById('child-dog-drawer-meta').textContent = 'Session: ' + currentChildSessionId + (title ? ' · ' + title : '');
    var logsEl = document.getElementById('child-dog-drawer-logs');
    logsEl.textContent = '正在连接工犬终端并获取实时日志…\\n';

    getJson('/api/child-sessions').then(function (data) {
      if (data && data.ok && Array.isArray(data.sessions)) {
        var sess = data.sessions.find(function (s) { return s.session_id === currentChildSessionId || s.dog === dogName; });
        if (sess) {
          logsEl.textContent = '=== 工犬 ' + sess.dog + ' 活跃会话 ===\\n' +
            '工作区: ' + sess.workspace + '\\n' +
            '交互轮次: ' + sess.turn_count + '\\n' +
            '创建时间: ' + fmtTime(sess.created_at) + '\\n\\n' +
            '已准备就绪，支持通过底部输入框直接追加指令。';
          return;
        }
      }
      logsEl.textContent += '【会话就绪】输入指令直接与工犬交互。';
    }).catch(function () {
      logsEl.textContent = '【终端就绪】输入指令直接与工犬交互。';
    });
  }

  function closeChildDogDrawer() {
    var drawer = document.getElementById('child-dog-drawer');
    if (drawer) drawer.style.display = 'none';
  }

  function sendChildDogMessage() {
    var input = document.getElementById('child-dog-drawer-input');
    var prompt = input ? input.value.trim() : '';
    if (!prompt) return;
    var logsEl = document.getElementById('child-dog-drawer-logs');
    logsEl.textContent += '\\n\\n[人类 ➔ 工犬]: ' + prompt + '\\n[工犬正在执行中…]';
    input.value = '';
    postJson('/api/child-sessions/chat', { session_id: currentChildSessionId || 'csess_worker', prompt: prompt }).then(function (res) {
      var data = res.body || {};
      if (data.ok && data.reply) {
        logsEl.textContent += '\\n' + data.reply;
        toast('工犬已收到指令', true);
      } else {
        logsEl.textContent += '\\n❌ 失败: ' + (data.error || '执行异常');
      }
    }).catch(function (e) {
      logsEl.textContent += '\\n❌ 网络异常: ' + e;
    });
  }

  /* ---------- 多模态图片上传、拖拽与粘贴管理 ---------- */
  var pendingAttachments = [];
  function renderAttachmentPreviews() {
    var container = document.getElementById('chat-image-previews');
    if (!container) return;
    if (pendingAttachments.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = pendingAttachments.map(function (att, idx) {
      return '<div class="chat-img-thumb-wrap" style="position:relative;display:inline-block;margin-right:8px;margin-bottom:6px">' +
        '<img class="chat-img-thumb" src="' + esc(att.data) + '" alt="' + esc(att.name) + '" style="max-height:60px;max-width:80px;border-radius:4px;border:1px solid var(--line)" />' +
        '<button class="chat-img-remove-btn" data-idx="' + idx + '" type="button" style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1">✕</button>' +
        '</div>';
    }).join('');
    container.querySelectorAll('.chat-img-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-idx'));
        if (Number.isFinite(idx)) {
          pendingAttachments.splice(idx, 1);
          renderAttachmentPreviews();
        }
      });
    });
  }

  function handleFileSelection(files) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(function (file) {
      if (!file.type.startsWith('image/')) {
        toast('仅支持上传图片附件', false);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast('单张图片大小不能超过 10MB', false);
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        pendingAttachments.push({
          name: file.name,
          type: file.type,
          data: e.target.result,
        });
        renderAttachmentPreviews();
        toast('已添加图片附件: ' + file.name, true);
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- 本地工作区文件夹浏览与选择器 ---------- */
  function triggerNativeFolderPicker(targetInputId) {
    toast('正在调起系统文件管理器，请在弹窗中选择文件夹…', true);
    postJson('/api/workspaces/browse-native', {}).then(function (res) {
      var data = res.body || {};
      if (data.ok && data.path) {
        var input = document.getElementById(targetInputId || 'workspace-register-path');
        if (input) input.value = data.path;
        if (Array.isArray(data.workspaces)) {
          workspaces = data.workspaces;
          renderWorkspaces();
        }
        toast('已成功选取并登记工作区: ' + data.path, true);
        refresh();
      } else if (data.cancelled) {
        toast('已取消文件夹选择', false);
      } else if (data.error) {
        toast('调起系统弹窗失败: ' + data.error + '，可使用【目录树】在网页中选取', false);
        openWorkspaceTreeDialog(targetInputId);
      }
    }).catch(function (e) {
      toast('调起失败: ' + e + '，为您打开网页目录树选择器', false);
      openWorkspaceTreeDialog(targetInputId);
    });
  }

  var currentWsTreePath = '';
  var currentWsTreeSelected = '';
  var targetWsInputId = 'workspace-register-path';

  function loadWorkspaceTreePath(targetPath) {
    var container = document.getElementById('ws-dir-list-container');
    if (!container) return;
    container.innerHTML = '<div class="empty" style="padding:20px 0">正在加载本地目录…</div>';
    var url = '/api/workspaces/fs-tree' + (targetPath ? '?path=' + encodeURIComponent(targetPath) : '');
    getJson(url).then(function (data) {
      if (!data || !data.ok) {
        container.innerHTML = '<div class="empty" style="color:var(--danger)">加载失败: ' + esc((data && data.error) || '未知错误') + '</div>';
        return;
      }

      // Render drives if root
      var drivesContainer = document.getElementById('ws-drives-container');
      if (drivesContainer && Array.isArray(data.drives)) {
        drivesContainer.innerHTML = '<strong>磁盘驱动器:</strong> ' + data.drives.map(function (d) {
          return '<button type="button" class="ws-drive-btn" data-drive-path="' + esc(d.path) + '">' + esc(d.name) + '</button>';
        }).join('');
        drivesContainer.querySelectorAll('button[data-drive-path]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            loadWorkspaceTreePath(btn.getAttribute('data-drive-path'));
          });
        });
      }

      currentWsTreePath = data.currentPath || '';
      currentWsTreeSelected = currentWsTreePath;
      var pathInput = document.getElementById('ws-tree-path-input');
      if (pathInput) pathInput.value = currentWsTreePath;
      var label = document.getElementById('ws-tree-selected-label');
      if (label) label.textContent = '当前所在: ' + (currentWsTreePath || '根目录');

      var dirs = data.directories || [];
      if (dirs.length === 0) {
        container.innerHTML = '<div class="empty" style="padding:20px 0">（该目录下暂无子文件夹，可直接选择当前文件夹）</div>';
        return;
      }

      container.innerHTML = dirs.map(function (d) {
        return '<div class="ws-dir-item" data-dir-path="' + esc(d.path) + '">' +
          '<span style="font-size:16px">📁</span>' +
          '<span style="flex:1">' + esc(d.name) + '</span>' +
          '<span class="mono" style="font-size:11px;color:var(--ink-faint)">' + esc(d.path) + '</span>' +
          '</div>';
      }).join('');

      container.querySelectorAll('.ws-dir-item').forEach(function (item) {
        item.addEventListener('click', function () {
          container.querySelectorAll('.ws-dir-item').forEach(function (i) { i.classList.remove('selected'); });
          item.classList.add('selected');
          currentWsTreeSelected = item.getAttribute('data-dir-path');
          if (label) label.textContent = '已选中: ' + currentWsTreeSelected;
        });
        item.addEventListener('dblclick', function () {
          loadWorkspaceTreePath(item.getAttribute('data-dir-path'));
        });
      });
    }).catch(function (err) {
      container.innerHTML = '<div class="empty" style="color:var(--danger)">网络请求异常: ' + esc(String(err)) + '</div>';
    });
  }

  function openWorkspaceTreeDialog(inputId) {
    targetWsInputId = inputId || 'workspace-register-path';
    var dialog = document.getElementById('workspace-tree-dialog');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.style.display = 'block';

    // Start from current workspace or drive root
    var defaultPath = workspaces.length > 0 ? (workspaces.find(function(w){return w.selected;}) || workspaces[0]).path : '';
    loadWorkspaceTreePath(defaultPath);
  }

  function closeWorkspaceTreeDialog() {
    var dialog = document.getElementById('workspace-tree-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.style.display = 'none';
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
    var topologySel = document.getElementById('dispatch-topology');
    if (topologySel && topologySel.value) body.topology_mode = topologySel.value;
    var verifierSel = document.getElementById('dispatch-verifier');
    if (verifierSel && verifierSel.value) body.verifier_dog = verifierSel.value;
    postJson('/api/dispatch', body).then(function (result) {
      var data = result.body;
      if (result.status === 202 && data.ok) {
        // G7B-D2：响应到达即有 dispatch_id，卡片即时可见；生命周期靠 SSE upsert 刷新。
        trackDispatch(data.dispatch_id, adapterId, data.status);
        toast('派发已受理：' + data.status + ' ' + (data.dispatch_id || ''), true);
        advanceDispatchQueue(); // GOAL-022：批量派发逐单推进
        document.getElementById('dispatch-result').textContent =
          'dispatch_id=' + data.dispatch_id + ' status=' + data.status;
        document.getElementById('dispatch-form').removeAttribute('data-task-id');
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

  /* ---------- GOAL-017B #1 & GOAL-025：犬只管理与实测探测 ---------- */
  var ADAPTER_TEMPLATES = ['dsh', 'claude', 'codex', 'kimi', 'opencode', 'zcode', 'pi', 'agy'];

  function toggleHarnessDoctor() {
    var box = document.getElementById('harness-doctor-box');
    if (!box) return;
    if (box.style.display !== 'none') {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    box.innerHTML = '<div style="color:var(--ink-dim)">正在诊断系统中已安装的各大 Agent / Harness 状态…</div>';
    getJson('/api/harness/doctor').then(function (data) {
      if (!data || !data.ok || !Array.isArray(data.harnesses)) {
        box.innerHTML = '<div style="color:var(--ember)">诊断服务不可达</div>';
        return;
      }
      var rows = data.harnesses.map(function (h) {
        var statusBadge = h.status === 'READY'
          ? '<span class="badge" style="background:rgba(16,185,129,0.15);color:#047857">🟢 已就绪</span>'
          : (h.status === 'CONFIG_MISSING' ? '<span class="badge" style="background:rgba(217,119,6,0.15);color:#b45309">🟡 未配Key</span>' : '<span class="badge" style="background:rgba(107,114,128,0.15);color:#4b5563">⚪ 未安装</span>');
        var provDisplay = h.activeProvider ? '<span class="badge" style="background:rgba(59,130,246,0.15);color:#2563eb">★ ' + esc(h.activeProvider) + '</span>' : '<span style="color:var(--ink-dim)">默认/未配置</span>';
        var pathDisplay = h.cliPath ? '<span class="mono" style="font-size:11px;color:var(--ink-dim)">' + esc(h.cliPath) + '</span>' : '<span style="color:var(--ink-dim)">未发现可执行文件</span>';
        return '<tr>' +
          '<td style="font-weight:600">' + esc(h.name) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + provDisplay + '</td>' +
          '<td>' + pathDisplay + '</td>' +
          '<td><code style="font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">' + esc(h.installCmd) + '</code></td>' +
          '<td><code style="font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">' + esc(h.updateCmd) + '</code></td>' +
          '</tr>';
      }).join('');
      box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<h4 style="margin:0;font-size:13px;color:var(--ink)">🏥 跨 Harness 状态诊断与配置/安装工具箱</h4>' +
        '<button class="act cancel" id="btn-close-doctor" type="button" style="padding:2px 8px;font-size:11px">关闭</button>' +
        '</div>' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
        '<thead><tr style="text-align:left;border-bottom:1px solid var(--line)">' +
        '<th style="padding:6px">Harness</th><th style="padding:6px">状态</th><th style="padding:6px">当前 Provider</th><th style="padding:6px">CLI 路径</th><th style="padding:6px">安装指令</th><th style="padding:6px">更新指令</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
      var closeBtn = document.getElementById('btn-close-doctor');
      if (closeBtn) closeBtn.addEventListener('click', function () { box.style.display = 'none'; });
    }).catch(function (e) {
      box.innerHTML = '<div style="color:var(--ember)">诊断异常：' + esc(e) + '</div>';
    });
  }

  function renderRosterManage() {
    var el = document.getElementById('roster-manage');
    if (!el) return;
    el.innerHTML = '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;width:100%">' +
      '<button class="act" id="btn-harness-doctor" type="button" style="padding:6px 12px;font-size:12px;background:rgba(59,130,246,0.1);color:#2563eb;border:1px solid rgba(59,130,246,0.3)">🏥 犬队医生与安装指引</button>' +
      '<div><label for="adapter-template">基础模板</label>' +
      '<select id="adapter-template">' + ADAPTER_TEMPLATES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="adapter-new-id">命名（adapter_id）</label>' +
      '<input type="text" id="adapter-new-id" placeholder="如 my-claude"></div>' +
      '<button class="act approve" id="btn-adapter-add" type="button">＋ 添加犬只</button>' +
      '<button class="act" id="btn-models-probe" type="button" style="background:var(--panel-hi);border:1px solid var(--line);color:var(--ink);margin-left:auto">🔍 实测探测</button>' +
      '</div>' +
      '<div id="harness-doctor-box" style="display:none;width:100%;margin-top:12px;padding:12px 16px;background:var(--panel-hi);border:1px solid var(--line);border-radius:8px"></div>';
    document.getElementById('btn-harness-doctor').addEventListener('click', toggleHarnessDoctor);
    document.getElementById('btn-adapter-add').addEventListener('click', addAdapter);
    document.getElementById('btn-models-probe').addEventListener('click', triggerLiveProbe);
  }

  function triggerLiveProbe() {
    var btn = document.getElementById('btn-models-probe');
    if (btn) btn.textContent = '⏳ 探测中...';
    postJson('/api/models/probe', {}).then(function (res) {
      if (res.status === 200 && res.body && res.body.ok) {
        toast('实测探测完成，已回填最新可用模型', true);
        refresh();
      } else {
        toast('探测失败：' + ((res.body && res.body.error) || res.status), false);
      }
    }).catch(function (err) {
      toast('探测异常：' + err, false);
    }).finally(function () {
      if (btn) btn.textContent = '🔍 实测探测';
    });
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
    deleteJson('/api/adapters/' + encodeURIComponent(adapterId)).then(function (result) {
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
    renderRosterManage(); // GOAL-017B #1：管理条（模板+命名+添加+探测）
    function dispatchStats(adapterId) {
      var count = 0;
      var last = latest[adapterId] || null;
      for (var i = 0; i < dispatches.length; i += 1) {
        if (dispatches[i].adapter_id === adapterId) count += 1;
      }
      return { count: count, latest: last };
    }
    if (actors.length === 0) {
      var roster = (snapshot.roster || []).filter(function (r) {
        return r.adapter_id !== 'head-dog' && r.adapter_id !== 'fake-t1' && !r.adapter_id.startsWith('agy-');
      });
      if (roster.length === 0) { el.innerHTML = '<div class="empty">暂无在册犬只</div>'; return; }

      var cardsHtml = roster.map(function (r) {
        var stats = dispatchStats(r.adapter_id);
        var running = stats.latest ? isRunningStatus(stats.latest.status) : false;
        var logoState = running ? 'working'
          : (stats.latest && flashRegistry[r.adapter_id] === stats.latest.status ? 'flash-' + (stats.latest.status === 'PASS' || stats.latest.status === 'DRY_RUN' ? 'pass' : 'fail') : 'idle');
        var role = r.role || 'executor';
        var roleBadge = role === 'head'
          ? '<span class="badge role-head">head 头犬</span>'
          : '<span class="badge role-executor">executor</span>';
        if (!isVerifiedEntry(r)) roleBadge += ' <span class="badge unverified">' + esc(unverifiedReason(r)) + '</span>';
        if (r.probe_status === 'ONLINE') {
          roleBadge += ' <span class="badge" style="background:rgba(16,185,129,0.15);color:#047857">🟢 实测在线</span>';
        } else if (r.probe_status === 'QUOTA_EXHAUSTED') {
          roleBadge += ' <span class="badge" style="background:rgba(239,68,68,0.15);color:#b91c1c">🔴 额度耗尽</span>';
        }

        var activity = stats.count === 0
          ? '（未活动，注册在册）'
          : '最近派发：' + stats.count + ' 次 · <span class="badge ' + esc(stats.latest.status) + '">' + esc(stats.latest.status) + '</span> <span class="mono">' + escTime(stats.latest.at_utc || '') + '</span>';


        // Providers rendering (Tier 2 & 3)
        var providersList = r.providers && r.providers.length > 0
          ? r.providers
          : [{ id: 'default', name: r.expected_provider || '默认渠道', is_current: true, models: r.variants || [r.expected_model_id], default_model: r.expected_model_id }];

        var providersHtml = providersList.map(function (p) {
          var pTag = p.is_current
            ? '<span class="provider-tag-active">★ 当前激活</span>'
            : '<span class="provider-tag-backup">备用渠道</span>';

          var modelsHtml = (p.models || []).map(function (m) {
            var isLive = (r.live_models || []).includes(m);
            var badgeCls = isLive ? 'model-tree-badge verified' : 'model-tree-badge';
            var liveIcon = isLive ? '🟢' : '⚪';
            // Thinking spec hint
            var specHint = '';
            var mLower = m.toLowerCase();
            if (mLower.includes('claude') || mLower.includes('opus') || mLower.includes('sonnet')) {
              specHint = '<span class="thinking-spec-tag">Thinking: 2k~128k</span>';
            } else if (mLower.includes('gemini') || mLower.includes('flash')) {
              specHint = '<span class="thinking-spec-tag">Level: High/Med/Low</span>';
            } else if (mLower.includes('o1') || mLower.includes('o3') || mLower.includes('gpt-5') || mLower.includes('codex') || mLower.includes('oss')) {
              specHint = '<span class="thinking-spec-tag">Effort: 5-Tier</span>';
            } else if (mLower.includes('r1') || mLower.includes('reasoner')) {
              specHint = '<span class="thinking-spec-tag">Deep Think: on/off</span>';
            }
            return '<div class="' + badgeCls + '"><span>' + liveIcon + ' ' + esc(m) + '</span> ' + specHint + '</div>';
          }).join('');

          return '<div class="provider-card-item ' + (p.is_current ? 'active-provider' : '') + '">' +
            '<div class="provider-header-row">' +
              '<div style="display:flex;align-items:center;gap:8px"><span>🏢 ' + esc(p.name) + '</span> ' + pTag + '</div>' +
              '<button class="act" data-probe-prov="' + esc(r.adapter_id) + '" data-prov-id="' + esc(p.id) + '" type="button" style="font-size:11px;padding:2px 8px" title="定向探测该 Provider">⚡ 探测 Provider</button>' +
            '</div>' +
            '<div class="model-tree-list">' + modelsHtml + '</div>' +
          '</div>';
        }).join('');

        return '<div class="harness-tree-card">' +
          '<div class="harness-tree-header">' +
            '<div class="harness-title-wrap">' +
              dogLogo(r.adapter_id + ' ' + (r.expected_model_id || ''), logoState) +
              '<span>' + esc(r.adapter_id) + '</span>' +
              roleBadge +
            '</div>' +
            '<div class="harness-meta-wrap">' +
              '<span style="font-size:12px;color:var(--ink-dim)">' + activity + '</span>' +
              '<button class="act" data-probe="' + esc(r.adapter_id) + '" type="button" title="探测此 Harness 全部模型">⚡ 探测全部</button>' +
              '<button class="act remove" data-remove="' + esc(r.adapter_id) + '" type="button">移除</button>' +
            '</div>' +
          '</div>' +
          '<div class="harness-providers-body">' + providersHtml + '</div>' +
        '</div>';
      }).join('');

      el.innerHTML = '<div class="harness-tree-container">' + cardsHtml + '</div>';

      el.querySelectorAll('button[data-probe]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-probe');
          btn.textContent = '⏳';
          postJson('/api/models/probe', { adapter_id: id }).then(function (res) {
            if (res.status === 200 && res.body && res.body.ok) {
              toast(id + ' 实测探测已完成', true);
              refresh();
            } else {
              toast(id + ' 探测失败', false);
            }
          }).catch(function (err) {
            toast(id + ' 探测异常: ' + err, false);
          }).finally(function () {
            btn.textContent = '⚡ 探测全部';
          });
        });
      });

      el.querySelectorAll('button[data-probe-prov]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-probe-prov');
          var provId = btn.getAttribute('data-prov-id');
          btn.textContent = '⏳';
          postJson('/api/models/probe', { adapter_id: id, provider_id: provId }).then(function (res) {
            if (res.status === 200 && res.body && res.body.ok) {
              toast(id + ' [' + provId + '] 探测完成', true);
              refresh();
            } else {
              toast(id + ' 探测失败', false);
            }
          }).catch(function (err) {
            toast(id + ' 探测异常: ' + err, false);
          }).finally(function () {
            btn.textContent = '⚡ 探测 Provider';
          });
        });
      });

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

  /* ---------- 预算与真实会话用量视图（GET /api/budget + GET /api/usage；GOAL-027） ---------- */
  var usageSummary = null;

  function bindUsageRefresh() {
    var btn = document.getElementById('btn-refresh-usage');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.textContent = '⏳';
        loadUsage().then(function () {
          toast('本地用量与花费数据已刷新', true);
        }).finally(function () {
          btn.textContent = '🔄 刷新本地日志';
        });
      });
    }
  }

  function bindCapEditors(el) {
    el.querySelectorAll('button[data-cap-save]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var actorId = btn.getAttribute('data-cap-save');
        var input = el.querySelector('input[data-cap-actor="' + actorId + '"]');
        var msg = el.querySelector('span[data-cap-msg="' + actorId + '"]');
        var value = Number(input.value);
        if (!isFinite(value) || value <= 0) { msg.textContent = 'cap 必须 > 0'; msg.style.color = 'var(--danger)'; return; }
        putJson('/api/budget/caps/' + encodeURIComponent(actorId), { cap_usd: value })
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

  function renderBudget() {
    var el = document.getElementById('view-budget');
    var usageHtml = '';
    if (usageSummary) {
      var u = usageSummary;
      var hRows = Object.values(u.per_harness_usage || {}).map(function (h) {
        var vol = h.volume || 0;
        return '<tr><td><b>' + esc(h.harness) + '</b></td><td>' + h.sessions_count + ' 会话</td>' +
          '<td class="mono">' + (vol > 10000 ? (vol / 10000).toFixed(1) + ' 万' : vol) + '</td>' +
          '<td class="mono" style="color:var(--accent);font-weight:600">$' + h.cost_usd.toFixed(4) + '</td></tr>';
      }).join('');

      var totalVol = u.total_volume || 0;
      usageHtml = '<div class="card" style="border:1.5px solid var(--line);background:var(--panel-hi);margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<h3 style="margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">📊 本地真实会话用量与花费监控 (ccusage)</h3>' +
        '<button class="act" id="btn-refresh-usage" type="button" style="padding:3px 10px;font-size:11px">🔄 刷新本地日志</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px">' +
        '<div style="background:var(--panel);padding:8px 10px;border-radius:8px;border:1px solid var(--line)"><div style="font-size:11px;color:var(--ink-dim)">今日花费 (Today)</div><div style="font-size:16px;font-weight:700;color:var(--accent);margin-top:2px">$' + u.today_cost_usd.toFixed(4) + '</div></div>' +
        '<div style="background:var(--panel);padding:8px 10px;border-radius:8px;border:1px solid var(--line)"><div style="font-size:11px;color:var(--ink-dim)">累计花费 (All-Time)</div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-top:2px">$' + u.total_cost_usd.toFixed(4) + '</div></div>' +
        '<div style="background:var(--panel);padding:8px 10px;border-radius:8px;border:1px solid var(--line)"><div style="font-size:11px;color:var(--ink-dim)">词元吞吐</div><div style="font-size:16px;font-weight:700;color:var(--ink);margin-top:2px">' + (totalVol > 10000 ? (totalVol / 10000).toFixed(1) + ' 万' : totalVol) + '</div></div>' +
        '<div style="background:var(--panel);padding:8px 10px;border-radius:8px;border:1px solid var(--line)"><div style="font-size:11px;color:var(--ink-dim)">缓存节省 (Cache Saved)</div><div style="font-size:16px;font-weight:700;color:#059669;margin-top:2px">+$' + u.cache_savings_usd.toFixed(4) + '</div></div>' +
        '</div>' +
        (hRows ? '<table style="margin-top:4px"><thead><tr><th>Harness</th><th>活跃记录</th><th>词元消耗</th><th>实际估算花费</th></tr></thead><tbody>' + hRows + '</tbody></table>' : '') +
        '</div>';
    }

    if (!budget || !budget.actors || budget.actors.length === 0) {
      el.innerHTML = usageHtml + '<div class="empty">暂无派发预扣台账记录（USD 台账随 dispatch admission 产生）</div>';
      bindUsageRefresh();
      return;
    }

    var actorHtml = budget.actors.map(function (actor) {
      var cap = actor.cap_usd || 0;
      var spent = actor.spent_usd || 0;
      var cacheSaved = actor.cache_savings_usd || 0;
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
        (cacheSaved > 0 ? '<span class="badge" style="background:rgba(16,185,129,0.1);color:#059669;border:1px solid rgba(16,185,129,0.3)">⚡ 节省 $' + cacheSaved.toFixed(4) + '</span>' : '') +
        '<span class="cap-editor">cap $<input type="number" class="cap-input" min="0.01" step="0.01" value="' + cap.toFixed(2) + '" data-cap-actor="' + esc(actor.actor_id) + '">' +
        '<button class="act approve" data-cap-save="' + esc(actor.actor_id) + '" type="button" style="padding:2px 10px;font-size:11px">保存</button>' +
        '<span class="cap-edit-msg" data-cap-msg="' + esc(actor.actor_id) + '"></span></span></div>' +
        (entries ? '<table style="margin-top:8px"><thead><tr><th>时间</th><th>决策</th><th>金额</th><th>余额</th></tr></thead><tbody>' + entries + '</tbody></table>' : '') +
        '</div>';
    }).join('');


    el.innerHTML = usageHtml + actorHtml;
    bindUsageRefresh();
    bindCapEditors(el);
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

  /* GOAL-029: Thinking 思考块解析 */
  function parseThinkingBlock(rawText) {
    if (!rawText) return { thinking: '', answer: '' };
    var thinkMatch = new RegExp('<think>([\\\\s\\\\S]*?)</think>', 'i').exec(rawText);
    if (thinkMatch) {
      return {
        thinking: thinkMatch[1].trim(),
        answer: rawText.replace(new RegExp('<think>[\\\\s\\\\S]*?</think>', 'i'), '').trim(),
        isStreamingThink: false,
      };
    }
    var openMatch = new RegExp('<think>([\\\\s\\\\S]*)$', 'i').exec(rawText);
    if (openMatch) {
      return {
        thinking: openMatch[1],
        answer: '',
        isStreamingThink: true,
      };
    }
    return { thinking: '', answer: rawText, isStreamingThink: false };
  }

  function renderChatBubbleContent(text) {
    var p = parseThinkingBlock(text);
    var html = '';
    if (p.thinking) {
      html += '<details class="thinking-collapsible"' + (p.isStreamingThink ? ' open' : '') + '>' +
        '<summary class="thinking-summary">🧠 ' + (p.isStreamingThink ? '思考中…' : '思考过程（已折叠）') + '</summary>' +
        '<div class="thinking-content">' + esc(p.thinking) + '</div>' +
        '</details>';
    }
    if (p.answer || !p.thinking) {
      html += '<div class="chat-text-body">' + esc(p.answer) + '</div>';
    }
    return html;
  }

  var chatUserScrolledUp = false;
  function chatScrollBottom(force) {
    var el = chatStreamEl();
    if (!el) return;
    if (force || !chatUserScrolledUp) {
      el.scrollTop = el.scrollHeight;
    }
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
    var bubbleHtml = role === 'head' ? renderChatBubbleContent(text) : esc(text);
    row.innerHTML = avatar + '<div><div class="who">' + esc(who) + '</div>' +
      '<div class="bubble">' + bubbleHtml + '</div>' +
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
      '<div><div class="who">头犬 · <span class="chat-stage">思考中</span> <span class="mono thinking-elapsed">0s</span></div>' +
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

  /* ---------- GOAL-021B：v1.9 异步聊天流式（SSE kind=chat 帧驱动阶段机） ----------
     阶段机：pending 气泡（思考中）→ EXECUTE 增量（生成中，打字机渐显）→
     REPORT（完成/失败 + 重试）。帧匹配键 = dispatch_id（202 ack 登记）；
     ack 前早到帧按 session_id + chatPending 认领（SSE 可能快过 fetch 响应）。 */
  var chatInflightId = null;   // 在途 chat dispatch_id
  var chatStreamRow = null;    // 打字机气泡行（生成中）
  var chatStreamBuf = '';      // 已到达回复增量全文
  var chatStreamShown = 0;     // 打字机已显字符数
  var chatStreamRaf = null;    // rAF 句柄
  var chatStreamFinal = null;  // REPORT 到达后的终态 payload
  var chatWatchdog = null;     // 前端超时看门狗
  var chatLastMessage = '';    // 重试数据源（最后一条发送文本）
  var chatReducedMotion = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  function chatSetStage(row, text) {
    var el = row ? row.querySelector('.chat-stage') : null;
    if (el) el.textContent = text;
  }

  function chatSetElapsed(row, ms) {
    var el = row ? row.querySelector('.thinking-elapsed') : null;
    if (el && typeof ms === 'number') el.textContent = Math.max(0, Math.round(ms / 1000)) + 's';
  }

  function armChatWatchdog() {
    disarmChatWatchdog();
    // 服务端超时 300s（REPORT FAIL 兜底）；前端看门狗 320s 防 SSE 静默丢帧卡死 pending。
    chatWatchdog = setTimeout(function () {
      if (!chatPending) return;
      chatFinishFailure('等待头犬回复超时（前端看门狗 320s），可重试。');
    }, 320000);
  }

  function disarmChatWatchdog() {
    if (chatWatchdog !== null) { clearTimeout(chatWatchdog); chatWatchdog = null; }
  }

  // 打字机：rAF 节流渐显（每帧补 ~1/5 余量，末段收敛）；reduced-motion 降级直接全显。
  function chatTypewriterTick() {
    chatStreamRaf = null;
    if (chatStreamRow === null) return;
    if (chatReducedMotion) {
      chatStreamShown = chatStreamBuf.length;
    } else if (chatStreamShown < chatStreamBuf.length) {
      chatStreamShown = Math.min(chatStreamBuf.length, chatStreamShown + Math.max(2, Math.ceil((chatStreamBuf.length - chatStreamShown) / 5)));
    }
    var currentSub = chatStreamBuf.slice(0, chatStreamShown);
    var p = parseThinkingBlock(currentSub);
    var bubble = chatStreamRow.querySelector('.bubble');
    if (bubble) {
      var thinkEl = bubble.querySelector('.thinking-collapsible');
      var textEl = bubble.querySelector('.typewriter-text');
      if (p.thinking) {
        if (!thinkEl) {
          thinkEl = document.createElement('details');
          thinkEl.className = 'thinking-collapsible';
          thinkEl.open = true;
          thinkEl.innerHTML = '<summary class="thinking-summary">🧠 思考中…</summary><div class="thinking-content"></div>';
          bubble.insertBefore(thinkEl, textEl);
        }
        var cEl = thinkEl.querySelector('.thinking-content');
        if (cEl) cEl.textContent = p.thinking;
        if (!p.isStreamingThink) {
          var sEl = thinkEl.querySelector('.thinking-summary');
          if (sEl) sEl.textContent = '🧠 思考过程（已折叠）';
          thinkEl.open = false;
        }
      }
      if (textEl) textEl.textContent = p.answer || (!p.thinking ? currentSub : '');
    }
    chatScrollBottom();
    if (chatStreamShown < chatStreamBuf.length) {
      chatStreamRaf = requestAnimationFrame(chatTypewriterTick);
    } else if (chatStreamFinal !== null) {
      chatFinalizeReport(); // 打字机播完后定版
    }
  }

  function chatTypewriterKick() {
    if (chatStreamRaf === null) chatStreamRaf = requestAnimationFrame(chatTypewriterTick);
  }

  // 首个 EXECUTE 增量到达：pending 气泡原位移形为生成中打字机气泡。
  function ensureStreamRow() {
    if (chatStreamRow !== null) return;
    var row = thinkingRow;
    if (row === null) {
      // 占位已被移除的边界（如早到 EXECUTE）：直接建行。
      row = document.createElement('div');
      row.className = 'chat-row head chat-thinking';
      row.innerHTML = '<span class="avatar">' + dogLogo('head-dog kimi moon', true) + '</span>' +
        '<div><div class="who">头犬 · <span class="chat-stage">生成中</span> <span class="mono thinking-elapsed">0s</span></div>' +
        '<div class="bubble thinking-bubble"></div></div>';
      chatStreamEl().appendChild(row);
    }
    if (thinkingTimer !== null) { clearInterval(thinkingTimer); thinkingTimer = null; }
    thinkingRow = null;
    row.classList.remove('chat-thinking');
    row.classList.add('chat-streaming');
    chatSetStage(row, '生成中');
    var bubble = row.querySelector('.bubble');
    bubble.classList.remove('thinking-bubble');
    bubble.innerHTML = '<span class="typewriter-text"></span>';
    chatStreamRow = row;
    chatScrollBottom();
  }

  function attachRetry(row) {
    var retry = document.createElement('button');
    retry.className = 'act reject chat-retry';
    retry.type = 'button';
    retry.textContent = '重试';
    retry.addEventListener('click', retryChat);
    row.querySelector('.bubble').parentNode.appendChild(retry);
  }

  function retryChat() {
    if (chatPending || chatLastMessage === '') return;
    document.getElementById('chat-input').value = chatLastMessage;
    sendChat();
  }

  // REPORT：成功（打字机播完后定版全文）或失败（气泡态 + 重试按钮）。
  function chatFinalizeReport() {
    var p = chatStreamFinal || {};
    chatStreamFinal = null;
    disarmChatWatchdog();
    if (chatStreamRaf !== null) { cancelAnimationFrame(chatStreamRaf); chatStreamRaf = null; }
    var failed = p.error !== undefined || (p.status !== 'PASS' && p.status !== 'DRY_RUN');
    var fullReply = typeof p.reply === 'string' && p.reply !== '' ? p.reply : chatStreamBuf;
    var elapsedTxt = typeof p.elapsed_ms === 'number' ? Math.round(p.elapsed_ms / 1000) + 's' : '';
    var row = chatStreamRow;
    chatStreamRow = null;
    if (row !== null) {
      row.classList.remove('chat-streaming');
      var bubble = row.querySelector('.bubble');
      if (failed) {
        row.classList.add('chat-failed');
        chatSetStage(row, '失败' + (elapsedTxt ? ' · ' + elapsedTxt : ''));
        if (bubble) bubble.innerHTML = esc(p.error !== undefined ? '头犬回复失败：' + p.error : (fullReply !== '' ? fullReply : '（无回复）'));
        attachRetry(row);
      } else {
        chatSetStage(row, '完成' + (elapsedTxt ? ' · ' + elapsedTxt : ''));
        if (bubble) bubble.innerHTML = renderChatBubbleContent(fullReply !== '' ? fullReply : '（空回复）');
      }
      chatTurnCount += 1;
    } else if (failed) {
      removeThinking();
      appendChatFailure(p.error !== undefined ? '头犬回复失败：' + p.error : '（无回复）');
    } else {
      removeThinking();
      appendChatRow('head', fullReply !== '' ? fullReply : '（空回复）', new Date().toISOString(), chatInflightId);
    }
    removeThinking(); // 防御：占位残留清理（幂等）
    chatStreamBuf = '';
    chatStreamShown = 0;
    chatInflightId = null;
    setChatPending(false);
    chatScrollBottom();
  }

  // 超时/同步错误失败出口：有流行转失败态，无流行落失败气泡。
  function chatFinishFailure(text) {
    disarmChatWatchdog();
    if (chatStreamRaf !== null) { cancelAnimationFrame(chatStreamRaf); chatStreamRaf = null; }
    if (chatStreamRow !== null) {
      var row = chatStreamRow;
      chatStreamRow = null;
      row.classList.remove('chat-streaming');
      row.classList.add('chat-failed');
      chatSetStage(row, '失败');
      var textEl = row.querySelector('.typewriter-text');
      if (textEl) { textEl.textContent = text; textEl.classList.remove('typewriter-text'); }
      attachRetry(row);
      chatTurnCount += 1;
    } else {
      removeThinking();
      appendChatFailure(text);
    }
    chatStreamBuf = '';
    chatStreamShown = 0;
    chatStreamFinal = null;
    chatInflightId = null;
    setChatPending(false);
    chatScrollBottom();
  }

  // 失败/超时气泡态（红边浅底 + 重试按钮；雪原体系 danger 令牌）。
  function appendChatFailure(text) {
    chatClearEmpty();
    var row = document.createElement('div');
    row.className = 'chat-row head chat-failed';
    row.innerHTML = '<span class="avatar">' + dogLogo('head-dog kimi moon', false) + '</span>' +
      '<div><div class="who">头犬 · <span class="chat-stage">失败</span> · ' + esc(fmtTime(new Date().toISOString())) + '</div>' +
      '<div class="bubble">' + esc(text) + '</div></div>';
    attachRetry(row);
    chatStreamEl().appendChild(row);
    chatTurnCount += 1;
    chatScrollBottom();
  }

  // SSE chat 帧入口（kind=chat，契约 v1.9：ADMITTED → EXECUTE(增量) → HEARTBEAT(耗时) → REPORT）。
  function chatHandleFrame(frame) {
    if (!frame || frame.kind !== 'chat') return;
    if (chatInflightId !== null && frame.dispatch_id !== chatInflightId) return; // 只消费在途帧
    if (chatInflightId === null) {
      if (!chatPending || frame.session_id !== chatSessionId) return; // 非本会话迟到帧忽略
      chatInflightId = frame.dispatch_id; // ack 前早到帧认领
    }
    var p = frame.payload || {};
    if (frame.phase === 'ADMITTED') {
      chatSetStage(thinkingRow || chatStreamRow, '思考中');
      return;
    }
    if (frame.phase === 'HEARTBEAT') {
      chatSetElapsed(chatStreamRow || thinkingRow, p.elapsed_ms); // 心跳耗时实时显示
      return;
    }
    if (frame.phase === 'EXECUTE') {
      if (typeof p.stream_text === 'string' && p.stream_text !== '') {
        chatStreamBuf += p.stream_text;
        ensureStreamRow();
        chatTypewriterKick();
      }
      return;
    }
    if (frame.phase === 'REPORT') {
      chatStreamFinal = p;
      if (typeof p.reply === 'string' && p.reply !== '') chatStreamBuf = p.reply; // 权威全文
      if (chatStreamBuf !== '' && chatStreamRow === null && p.error === undefined) ensureStreamRow();
      if (chatReducedMotion || chatStreamRow === null || chatStreamShown >= chatStreamBuf.length) {
        chatFinalizeReport();
      } else {
        chatTypewriterKick(); // 渐显播完后由 tick 内 chatFinalizeReport 定版
      }
    }
  }

  function sendChat() {
    var input = document.getElementById('chat-input');
    var message = input.value.trim();
    if (!message || chatPending) return;
    input.value = '';
    appendChatRow('user', message, new Date().toISOString()); // 发送即上屏
    setChatPending(true);
    showThinking(); // pending 气泡：思考中阶段占位
    chatLastMessage = message; // 失败/超时重试数据源
    // D1/D2（GOAL-012B/017B）：头犬 harness + 模型变体 + effort 档位随消息提交
    // （v1.3.1 可选字段，缺省后端 head-dog/HIGH；变体 v1.5 model_id 透传）。
    var headSel = document.getElementById('chat-head-select');
    var effortSel = document.getElementById('chat-effort');
    var variantSel = document.getElementById('chat-head-variant');
    var payload = { message: message, resume: chatSessionId };
    if (pendingAttachments && pendingAttachments.length > 0) {
      payload.attachments = pendingAttachments.map(function (a) { return { name: a.name, type: a.type, data: a.data }; });
      pendingAttachments = [];
      renderAttachmentPreviews();
    }
    if (headSel && headSel.value) payload.adapter_id = headSel.value;
    if (variantSel && variantSel.value) payload.model_id = variantSel.value;
    if (effortSel && effortSel.value) payload.effort = effortSel.value;
    postJson('/api/chat', payload).then(function (result) {
      var data = result.body || {};
      if (result.status === 202 && data.ok) {
        // v1.9 异步受理：202 即返 ack；阶段推进由 SSE kind=chat 帧驱动（不再同步等 reply）。
        chatSessionId = data.session_id || chatSessionId;
        chatInflightId = data.dispatch_id || chatInflightId;
        registerSessionId(chatSessionId); // GOAL-018B #3：会话注册表（选择器数据源）
        saveChatSession();
        renderSessionSelector();
        document.getElementById('chat-session-label').textContent = chatSessionId ? 'session ' + String(chatSessionId).slice(0, 8) : '';
        if (data.dispatch_id) trackDispatch(data.dispatch_id, payload.adapter_id || 'head-dog', data.status || 'ADMITTED');
        armChatWatchdog();
        refresh();
      } else {
        chatFinishFailure('（消息未受理：' + (data.error || result.status) + '）');
      }
    }).catch(function (error) {
      chatFinishFailure('（聊天 API 暂不可达：' + String(error) + '）');
    });
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
      updateContextGauge();
    }).catch(function () { /* 静默：下一帧 SSE 再试 */ });
  }

  function updateContextGauge() {
    var gaugeEl = document.getElementById('chat-context-gauge');
    if (!gaugeEl) return;
    var params = [];
    if (chatSessionId) params.push('session=' + encodeURIComponent(chatSessionId));
    var headSelect = document.getElementById('chat-head-select');
    var variantSelect = document.getElementById('chat-head-variant');
    if (variantSelect && variantSelect.value) {
      params.push('model=' + encodeURIComponent(variantSelect.value));
    } else if (headSelect && headSelect.value) {
      params.push('adapter=' + encodeURIComponent(headSelect.value));
    }
    var query = params.length > 0 ? '?' + params.join('&') : '';
    getJson('/api/chat/context-gauge' + query).then(function (data) {
      if (!data || !data.ok || !data.gauge) return;
      var g = data.gauge;
      var kTotal = ((g.t_total || 0) / 1000).toFixed(1) + 'k';
      var kMax = (g.t_max >= 1000000) ? ((g.t_max / 1000000).toFixed(1) + 'M') : (((g.t_max || 200000) / 1000).toFixed(0) + 'k');
      var cachePct = Math.round((g.cache_hit_ratio || 0) * 100);
      var inK = ((g.in_cnt || 0) / 1000).toFixed(1) + 'k';
      var outK = ((g.out_cnt || 0) / 1000).toFixed(1) + 'k';
      var costStr = g.is_free ? '免额度 免费' : ('$' + Number(g.cost_usd || 0).toFixed(4));

      gaugeEl.textContent = '📊 上下文: ' + kTotal + ' / ' + kMax + ' (' + g.percent + '%) | ⚡ 缓存: ' + cachePct + '% | 📥 ' + inK + ' 📤 ' + outK + ' | 💰 ' + costStr;

      gaugeEl.title = '模型: ' + (g.model_id || '未知') +
        '\\n• 窗口上限: ' + (g.t_max || 0) +
        '\\n• 当前水位: ' + (g.t_total || 0) + ' (' + g.percent + '%)' +
        '\\n• 📥 输入: ' + (g.in_cnt || 0) +
        '\\n• 📤 输出: ' + (g.out_cnt || 0) +
        (g.reason_cnt ? ('\\n• 🧠 思考推理: ' + g.reason_cnt) : '') +
        '\\n• ⚡ 缓存命中: ' + cachePct + '% (读 ' + (g.cache_read || 0) + ')' +
        '\\n• 💰 预估费用: ' + (g.is_free ? '0 USD (免费模型)' : ('$' + Number(g.cost_usd || 0).toFixed(6)));

      // 动态颜色提示
      if (g.is_free) {
        gaugeEl.style.color = '#10b981';
        gaugeEl.style.background = 'rgba(16,185,129,0.1)';
        gaugeEl.style.borderColor = 'rgba(16,185,129,0.25)';
      } else if (g.percent > 75) {
        gaugeEl.style.color = '#ef4444';
        gaugeEl.style.background = 'rgba(239,68,68,0.1)';
        gaugeEl.style.borderColor = 'rgba(239,68,68,0.25)';
      } else {
        gaugeEl.style.color = '#d97706';
        gaugeEl.style.background = 'rgba(217,119,6,0.1)';
        gaugeEl.style.borderColor = 'rgba(217,119,6,0.25)';
      }
    }).catch(function () {});
  }

  function triggerChatCompact() {
    if (chatPending) {
      toast('头犬思考中，无法压缩会话', false);
      return;
    }
    toast('正在提炼结构化会话状态快照…', true);
    postJson('/api/chat/compact', { messages: [] }).then(function (result) {
      var data = result.body || {};
      if (data.ok && data.compact) {
        var summary = data.compact.raw_summary || '会话已压缩。';
        appendChatRow('head', summary, new Date().toISOString());
        toast('会话不变式快照已生成', true);
        updateContextGauge();
      } else {
        toast('压缩失败：' + (data.error || '未知错误'), false);
      }
    }).catch(function (err) {
      toast('压缩端点不可达：' + err, false);
    });
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

  function loadTasks(silent) {
    var statusEl = document.getElementById('tasks-refresh-status');
    var refreshBtn = document.getElementById('btn-tasks-refresh');
    if (!silent && statusEl) statusEl.textContent = '同步中…';
    if (!silent && refreshBtn) refreshBtn.style.opacity = '0.6';

    return getJson('/api/tasks').then(function (data) {
      if (data && data.ok && Array.isArray(data.tasks)) tasksData = data.tasks;
      renderTasks();
      renderRecentActivity();
      if (activeDrawerTaskId) openTaskDrawer(activeDrawerTaskId);
      if (statusEl) {
        statusEl.textContent = '已同步 ' + new Date().toLocaleTimeString();
        setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 3000);
      }
      if (refreshBtn) refreshBtn.style.opacity = '1';
    }).catch(function () {
      renderTasks();
      renderRecentActivity();
      if (statusEl) statusEl.textContent = '同步失败';
      if (refreshBtn) refreshBtn.style.opacity = '1';
    });
  }


  /* ---------- GOAL-022（D36 人话原则）：状态/按钮全面中文化 + ID 折叠 + 排序聚簇 ---------- */
  var TASK_STATUS_CN = {
    IDEA: '构想', READY: '就绪', QUEUED: '已排队', IN_FLIGHT: '执行中',
    DONE: '完成', BLOCKED: '受阻', CANCELLED: '已取消'
  };
  // 迁移按钮动词化（目标状态 → 人类动作）
  var TASK_VERB_CN = {
    READY: '转就绪', QUEUED: '排队', IN_FLIGHT: '开始执行',
    DONE: '标记完成', BLOCKED: '标记受阻', CANCELLED: '取消'
  };
  // 多选批量派发选择集（task_id → true；待办泳道复选框）
  var taskSelection = {};
  var PRIORITY_RANK = { '高': 0, '中': 1, '低': 2 };

  function taskSeq(t) {
    // 机器语言折叠：卡片显示 #序号（创建顺序），原始 task_id 入悬浮 title。
    var all = tasksData || [];
    return all.indexOf(t) + 1;
  }

  function sortTasksForLane(list) {
    // 排序：优先级（高>中>低）> 创建时间（早先晚后）；同 goal_id 视觉聚簇（相邻即聚）。
    return list.slice().sort(function (a, b) {
      var pa = PRIORITY_RANK[a.priority] !== undefined ? PRIORITY_RANK[a.priority] : 1;
      var pb = PRIORITY_RANK[b.priority] !== undefined ? PRIORITY_RANK[b.priority] : 1;
      if (pa !== pb) return pa - pb;
      return String(a.created_at_utc || a.created_at || '') < String(b.created_at_utc || b.created_at || '') ? -1 : 1;
    }).sort(function (a, b) {
      // 同 Goal 聚簇（稳定二次排序：同 goal_id 相邻，不动优先级主序内的相对先后）
      var ga = a.goal_id || '';
      var gb = b.goal_id || '';
      if (ga === gb) return 0;
      return ga < gb ? -1 : 1;
    });
  }

  function renderTasks() {
    var lanes = { todo: [], doing: [], done: [] };
    (tasksData || []).forEach(function (t) { lanes[laneOf(t.status)].push(t); });
    ['todo', 'doing', 'done'].forEach(function (lane) {
      var el = document.getElementById('lane-' + lane);
      if (!el) return;
      var list = sortTasksForLane(lanes[lane]);
      var blockedCount = (tasksData || []).filter(function (t) { return t.status === 'BLOCKED'; }).length;
      var blockedBadge = lane === 'doing' && blockedCount > 0
        ? '<div class="hint" style="margin-bottom:6px"><span class="badge BLOCKED">受阻 ' + blockedCount + '</span></div>' : '';
      var batchBar = '';
      if (lane === 'todo') {
        var selectedCount = Object.keys(taskSelection).filter(function (k) { return taskSelection[k]; }).length;
        batchBar = '<div class="task-batch-bar">' +
          '<button class="act approve" id="btn-dispatch-selected" type="button"' + (selectedCount === 0 ? ' disabled style="opacity:.45"' : '') + '>派发所选（' + selectedCount + '）</button>' +
          '<span class="hint" style="display:inline">每单仍各停审批卡（D30）</span></div>';
      }
      if (list.length === 0) {
        el.innerHTML = blockedBadge + batchBar + '<div class="empty" style="padding:12px 0;font-size:12px">（空）</div>';
        bindBatchBar(el);
        return;
      }
      el.innerHTML = blockedBadge + batchBar + list.map(function (t) {
        var transitions = (TASK_TRANSITIONS[t.status] || []);
        var btns = transitions.map(function (next) {
          return '<button class="act cancel" data-task-move="' + esc(t.task_id) + '" data-to="' + esc(next) + '" type="button">' + esc(TASK_VERB_CN[next] || next) + '</button>';
        }).join('');
        var dispatchBtn = t.status === 'READY' || t.status === 'QUEUED'
          ? '<button class="act approve" data-task-dispatch="' + esc(t.task_id) + '" type="button">派发</button>' : '';
        var checkbox = lane === 'todo'
          ? '<input type="checkbox" class="task-select" data-task-select="' + esc(t.task_id) + '"' + (taskSelection[t.task_id] ? ' checked' : '') + ' title="选中批量派发">' : '';
        var goalBadge = t.goal_id ? '<span class="badge goal-cluster">' + esc(t.goal_id) + '</span>' : '';
        var seq = taskSeq(t);
        return '<div class="task-card" data-task-id="' + esc(t.task_id) + '" title="' + esc(t.task_id) + '">' +
          '<div class="task-title">' + checkbox + '<span class="task-seq">#' + seq + '</span> ' + esc(t.title) + '</div>' +
          '<div class="task-meta"><span class="badge prio-' + esc(t.priority || '中') + '">' + esc(t.priority || '中') + '</span>' +
          '<span class="badge">' + esc(TASK_STATUS_CN[t.status] || t.status) + '</span>' +
          goalBadge +
          '<span>' + esc(t.source || 'manual') + '</span>' +
          '<span>派发链 ' + ((t.dispatch_ids || []).length) + '</span></div>' +
          '<div class="task-actions">' + btns + dispatchBtn + '</div></div>';
      }).join('');
      bindBatchBar(el);
      el.querySelectorAll('.task-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('button') || e.target.closest('input')) return;
          var taskId = card.getAttribute('data-task-id');
          if (taskId) openTaskDrawer(taskId);
        });
      });
      el.querySelectorAll('input[data-task-select]').forEach(function (box) {
        box.addEventListener('change', function () {
          taskSelection[box.getAttribute('data-task-select')] = box.checked;
          if (!box.checked) delete taskSelection[box.getAttribute('data-task-select')];
          renderTasks();
        });
      });
      el.querySelectorAll('button[data-task-move]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          postJson('/api/tasks/' + encodeURIComponent(btn.getAttribute('data-task-move')) + '/transition',
            { status: btn.getAttribute('data-to') }).then(function (result) {
            if (result.body && result.body.ok) { loadTasks(); }
            else { toast('迁移失败：' + ((result.body && result.body.error) || result.status), false); }
          }).catch(function (error) { toast('迁移失败：' + error, false); });
        });
      });
      el.querySelectorAll('button[data-task-dispatch]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          prefillDispatchFromTask(btn.getAttribute('data-task-dispatch'));
        });
      });
    });
    renderTasksDag();
  }

  /* ---------- GOAL-024：思维导图 / DAG 路径图渲染与双模切换 ---------- */
  var currentTasksView = 'board';
  function switchTasksView(mode) {
    currentTasksView = mode;
    var boardEl = document.getElementById('tasks-board-container');
    var dagEl = document.getElementById('tasks-dag-container');
    var btnBoard = document.getElementById('btn-tasks-board');
    var btnDag = document.getElementById('btn-tasks-dag');
    if (btnBoard && btnDag) {
      btnBoard.classList.toggle('active', mode === 'board');
      btnDag.classList.toggle('active', mode === 'dag');
    }
    if (boardEl && dagEl) {
      boardEl.style.display = mode === 'board' ? 'grid' : 'none';
      dagEl.style.display = mode === 'dag' ? 'block' : 'none';
    }
    if (mode === 'dag') {
      if (!tasksData || tasksData.length === 0) {
        loadTasks(true).then(renderTasksDag);
      } else {
        renderTasksDag();
      }
    }
  }
  window.switchTasksView = switchTasksView;

  /* ---------- GOAL-024 & D68 演进：全景路线图 (RM-001 ~ RM-007) 与动态 DAG 拓扑 ---------- */
  var DOMAIN_STREAMS = {
    rm001: {
      key: 'rm001',
      icon: '🏛️',
      name: 'RM-001：犬队基建与机检验收 (Infrastructure & Harnesses)',
      desc: 'Node/TS 移植、单测基线、双 Harness 适配器与循环驱动 (GOAL-001 ~ GOAL-012)',
      goals: ['GOAL-001', 'GOAL-002', 'GOAL-003', 'GOAL-004', 'GOAL-005', 'GOAL-006', 'GOAL-007', 'GOAL-008', 'GOAL-009', 'GOAL-010', 'GOAL-011', 'GOAL-012']
    },
    rm002: {
      key: 'rm002',
      icon: '📋',
      name: 'RM-002：看板与工作流治理 (Board & Governance)',
      desc: '工作流连续性、append-only 任务模型、雪原营地看板与人话原则 (GOAL-013 ~ GOAL-023)',
      goals: ['GOAL-013', 'GOAL-014', 'GOAL-018', 'GOAL-019', 'GOAL-020', 'GOAL-021', 'GOAL-022', 'GOAL-023']
    },
    rm003: {
      key: 'rm003',
      icon: '⚡',
      name: 'RM-003：会话流式与零成本梯队 (Streaming & Tiers)',
      desc: 'DAG 路径思维导图、实时探针、零消耗本地模型梯队与用量监控 (GOAL-024 ~ GOAL-027)',
      goals: ['GOAL-024', 'GOAL-025', 'GOAL-026', 'GOAL-027']
    },

    rm004: {
      key: 'rm004',
      icon: '🛡️',
      name: 'RM-004：多拓扑与实战闭环 (Topology & Flagship)',
      desc: '多拓扑验证器、流式思考气泡、调用方鉴权加固与旗舰代码索引 (GOAL-028 ~ GOAL-034)',
      goals: ['GOAL-028', 'GOAL-029', 'GOAL-030', 'GOAL-031', 'GOAL-032', 'GOAL-033', 'GOAL-034']
    },
    rm_c: {
      key: 'rm_c',
      icon: '🔍',
      name: 'Phase C：视觉审查与记忆图谱 (Visual Studio & Memory)',
      desc: 'Diff 审查、Trace 瀑布流、直接控制台、上下文滚动蒸馏与符号记忆 (GOAL-035 ~ GOAL-042)',
      goals: ['GOAL-035', 'GOAL-036', 'GOAL-037', 'GOAL-038', 'GOAL-039', 'GOAL-040', 'GOAL-041', 'GOAL-042']
    },
    rm005: {
      key: 'rm005',
      icon: '🤝',
      name: 'RM-005：社会化 Agent 合作框架 (Social Agent Framework)',
      desc: '协作总线、圆桌辩论、SOP 流水线、红蓝对抗与悬赏撮合大厅 (GOAL-043 ~ GOAL-047)',
      goals: ['GOAL-043', 'GOAL-044', 'GOAL-045', 'GOAL-046', 'GOAL-047']
    },
    rm006: {
      key: 'rm006',
      icon: '🌐',
      name: 'RM-006：跨犬技能联邦与时空状态 (Skills & Time Travel)',
      desc: '跨 Harness 技能双向转译、时间旅行分支、共享黑板与动态液态小队 (GOAL-048 ~ GOAL-051)',
      goals: ['GOAL-048', 'GOAL-049', 'GOAL-050', 'GOAL-051']
    },
    rm007: {
      key: 'rm007',
      icon: '🏆',
      name: 'RM-007：自演进评测天梯与伴侣 (Evolution & Companion)',
      desc: 'ELO 自动对决引擎、路由权重自优化、桌面悬浮伴侣与全景能效战报 (GOAL-052 ~ GOAL-055)',
      goals: ['GOAL-052', 'GOAL-053', 'GOAL-054', 'GOAL-055']
    },
    rm008: {
      key: 'rm008',
      icon: '📊',
      name: 'RM-008：效能经济学与上下文工程 (Economics & Context)',
      desc: '零开销真实用量对账、Prompt Cache 细分计量、@-mention 门禁与结构化压缩 (GOAL-056 ~ GOAL-057)',
      goals: ['GOAL-056', 'GOAL-057']
    },
    rm009: {
      key: 'rm009',
      icon: '🛠️',
      name: 'RM-009：通用挂载、动态思维链、工犬直连与智能 Resume (Universal & Continuity)',
      desc: '工作区自由挂载、多厂商动态思维链规格、头像直连工犬抽屉、自动 Resume 降本与代码解耦 (GOAL-058 ~ GOAL-062)',
      goals: ['GOAL-058', 'GOAL-059', 'GOAL-060', 'GOAL-061', 'GOAL-062']
    },
    active: {
      key: 'active',
      icon: '🚀',
      name: '活跃探索与新立项 (Active Exploration & Goals)',
      desc: '当前工作区自主扫描入池的新 Goal 规格文档与用户自定义任务',
      goals: []
    }
  };

  function detectTaskDomain(t) {
    // 1. 优先提取当前任务自身声明的 Goal ID（严格避免被 detail 中的依赖项文字误导）
    var ownIdText = ((t.goal_id || '') + ' ' + (t.task_id || '') + ' ' + (t.title || '')).toUpperCase();
    var match = /(GOAL-\d+[A-Z]?)/i.exec(ownIdText);
    if (match) {
      var gid = match[1].toUpperCase();
      var num = parseInt(/\d+/.exec(gid)[0], 10);
      if (num >= 1 && num <= 12) return DOMAIN_STREAMS.rm001;
      if (num >= 13 && num <= 23) return DOMAIN_STREAMS.rm002;
      if (num >= 24 && num <= 27) return DOMAIN_STREAMS.rm003;
      if (num >= 28 && num <= 34) return DOMAIN_STREAMS.rm004;
      if (num >= 35 && num <= 42) return DOMAIN_STREAMS.rm_c;
      if (num >= 43 && num <= 47) return DOMAIN_STREAMS.rm005;
      if (num >= 48 && num <= 51) return DOMAIN_STREAMS.rm006;
      if (num >= 52 && num <= 55) return DOMAIN_STREAMS.rm007;
      if (num >= 56 && num <= 57) return DOMAIN_STREAMS.rm008;
      if (num >= 58 && num <= 62) return DOMAIN_STREAMS.rm009;
      return DOMAIN_STREAMS.active;
    }
    // 2. 兜底按数字序号归集
    var numMatch = /\d+/.exec(t.task_id || t.title || '');
    if (numMatch) {
      var n = parseInt(numMatch[0], 10);
      if (n >= 1 && n <= 12) return DOMAIN_STREAMS.rm001;
      if (n >= 13 && n <= 23) return DOMAIN_STREAMS.rm002;
      if (n >= 24 && n <= 27) return DOMAIN_STREAMS.rm003;
      if (n >= 28 && n <= 34) return DOMAIN_STREAMS.rm004;
      if (n >= 35 && n <= 42) return DOMAIN_STREAMS.rm_c;
      if (n >= 43 && n <= 47) return DOMAIN_STREAMS.rm005;
      if (n >= 48 && n <= 51) return DOMAIN_STREAMS.rm006;
      if (n >= 52 && n <= 55) return DOMAIN_STREAMS.rm007;
      if (n >= 56 && n <= 57) return DOMAIN_STREAMS.rm008;
      if (n >= 58 && n <= 62) return DOMAIN_STREAMS.rm009;
    }
    return DOMAIN_STREAMS.active;
  }



  function detectTaskLayer(t) {
    var text = ((t.title || '') + ' ' + (t.detail || '')).toUpperCase();
    if (/UI|前端|看板|页面|CSS|SVG|抽屉|导图|组件|LOGO/i.test(text)) return { name: '前端 UI', cls: 'layer-fe' };
    if (/API|后端|持久化|模型|ENGINE|JSONL|STORE|转译|CORE|ROUTE/i.test(text)) return { name: '后端 Core', cls: 'layer-be' };
    if (/审批|令牌|安全|GATE|CARVEOUT|权限/i.test(text)) return { name: '治理 Gate', cls: 'layer-gate' };
    if (/ADAPTER|HARNESS|RUNNER|PROBE|CLI/i.test(text)) return { name: '适配器 Harness', cls: 'layer-harness' };
    return { name: '全链路 Fullstack', cls: 'layer-fs' };
  }

  function detectTaskDependencies(t) {
    var deps = [];
    var detail = (t.detail || '') + ' ' + (t.title || '');
    var m = /依赖[:：]\s*([A-Za-z0-9_,-.\s✅]+)/i.exec(detail);
    if (m) {
      var rawList = m[1].split(/[,，\s]+/);
      rawList.forEach(function (id) {
        id = id.trim().replace(/✅/g, '');
        if (id && id !== '—' && id !== '无') deps.push(id);
      });
    }
    return deps;
  }

  var dagZoomScale = 1.0;
  function zoomDag(delta) {
    dagZoomScale = Math.max(0.6, Math.min(1.5, Math.round((dagZoomScale + delta) * 10) / 10));
    applyDagZoom();
  }
  function resetDagZoom() {
    dagZoomScale = 1.0;
    applyDagZoom();
  }
  function applyDagZoom() {
    var canvas = document.getElementById('dag-tree-canvas');
    var label = document.getElementById('dag-zoom-level');
    if (canvas) canvas.style.transform = 'scale(' + dagZoomScale + ')';
    if (label) label.textContent = Math.round(dagZoomScale * 100) + '%';
  }
  window.zoomDag = zoomDag;
  window.resetDagZoom = resetDagZoom;

  function renderTasksDag() {
    var container = document.getElementById('tasks-dag-canvas');
    if (!container) return;
    var tasks = tasksData || [];
    if (tasks.length === 0) {
      container.innerHTML = '<div class="empty" style="padding:24px 0;text-align:center;color:var(--ink-dim)">暂无任务卡，可在下方新建或在 goals/ 增加文档</div>';
      return;
    }

    var streamGroups = {};
    for (var key in DOMAIN_STREAMS) {
      streamGroups[key] = { stream: DOMAIN_STREAMS[key], tasks: [] };
    }

    tasks.forEach(function (t) {
      var stream = detectTaskDomain(t);
      streamGroups[stream.key].tasks.push(t);
    });

    var totalDone = tasks.filter(function (t) { return t.status === 'DONE'; }).length;
    var totalInFlight = tasks.filter(function (t) { return t.status === 'IN_FLIGHT' || t.status === 'QUEUED'; }).length;
    var totalReady = tasks.filter(function (t) { return t.status === 'READY' || t.status === 'IDEA'; }).length;
    var totalBlocked = tasks.filter(function (t) { return t.status === 'BLOCKED'; }).length;

    var columnsHtml = Object.keys(streamGroups).map(function (key) {
      var group = streamGroups[key];
      var list = group.tasks;
      if (list.length === 0 && (key === 'active' || key === 'rm008' || key === 'rm009')) return '';

      list.sort(function (a, b) {
        var numA = parseInt((/\d+/.exec(a.goal_id || a.task_id || '') || ['0'])[0], 10);
        var numB = parseInt((/\d+/.exec(b.goal_id || b.task_id || '') || ['0'])[0], 10);
        return numA - numB;
      });

      var doneCount = list.filter(function (t) { return t.status === 'DONE'; }).length;
      var progressText = list.length > 0 ? (doneCount + '/' + list.length + (doneCount === list.length ? ' ✅' : '')) : '0/0';

      var cardsHtml = list.map(function (t, idx) {
        var seq = taskSeq(t);
        var gid = t.goal_id || ('GOAL-' + String(seq).padStart(3, '0'));
        var statusDot = t.status === 'DONE' ? '🟢' : (t.status === 'IN_FLIGHT' || t.status === 'QUEUED' ? '🔵' : (t.status === 'BLOCKED' ? '🔴' : '⚪'));
        var layer = detectTaskLayer(t);
        var deps = detectTaskDependencies(t);
        var depsHtml = deps.length > 0 ? '<span class="dag-card-dep" title="依赖 ' + esc(deps.join(',')) + '">↳ 依 ' + esc(deps.join(',')) + '</span>' : '<span style="color:var(--ok)">✓ 就绪</span>';
        var connectorHtml = idx > 0 ? '<div class="dag-spine-connector"></div>' : '';

        // 提取简要标题
        var displayTitle = (t.title || '').replace(/^#?\s*GOAL-\d+[A-Z]?\s*[:：]\s*/i, '').trim() || t.title;

        return connectorHtml +
          '<div class="dag-card-node" data-task-id="' + esc(t.task_id) + '" title="' + esc(t.title + (t.detail ? ' | ' + t.detail : '')) + '">' +
            '<div class="dag-card-header">' +
              '<span class="dag-card-id">' + statusDot + ' ' + esc(gid) + '</span>' +
              '<span class="dag-layer-badge ' + layer.cls + '">' + esc(layer.name) + '</span>' +
            '</div>' +
            '<div class="dag-card-title">' + esc(displayTitle) + '</div>' +
            '<div class="dag-card-footer">' +
              '<span class="dag-card-seq">#' + seq + '</span>' +
              depsHtml +
            '</div>' +
          '</div>';
      }).join('');

      var streamShortTitle = group.stream.name.split('：')[0];
      var streamDescClean = group.stream.desc.split('(')[0];

      return '<div class="dag-column-group" data-rm="' + esc(group.stream.key) + '">' +
        '<div class="dag-milestone-header">' +
          '<div class="dag-milestone-top">' +
            '<div class="dag-milestone-title">' + group.stream.icon + ' ' + esc(streamShortTitle) + '</div>' +
            '<span class="dag-milestone-progress">' + progressText + '</span>' +
          '</div>' +
          '<div class="dag-milestone-desc">' + esc(streamDescClean) + '</div>' +
        '</div>' +
        '<div class="dag-column-spine">' +
          (cardsHtml ? '<div class="dag-spine-connector"></div>' + cardsHtml : '<div style="padding:12px;font-size:11px;color:var(--ink-faint);text-align:center">暂无任务</div>') +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = '<div class="dag-toolbar">' +
      '<div class="dag-legend">' +
        '<span class="dag-legend-item">🟢 已验收交付 (' + totalDone + ')</span>' +
        '<span class="dag-legend-item">🔵 执行中 (' + totalInFlight + ')</span>' +
        '<span class="dag-legend-item">⚪ 待办就绪 (' + totalReady + ')</span>' +
        '<span class="dag-legend-item">🔴 门禁受阻 (' + totalBlocked + ')</span>' +
      '</div>' +
      '<div class="dag-zoom-controls">' +
        '<button type="button" class="dag-zoom-btn" onclick="zoomDag(-0.1)">➖ 缩小</button>' +
        '<span id="dag-zoom-level" style="font-size:11px;font-family:var(--font-mono);color:var(--ink-dim)">' + Math.round(dagZoomScale * 100) + '%</span>' +
        '<button type="button" class="dag-zoom-btn" onclick="zoomDag(0.1)">➕ 放大</button>' +
        '<button type="button" class="dag-zoom-btn" onclick="resetDagZoom()">🔄 适中</button>' +
      '</div>' +
    '</div>' +
    '<div class="dag-tree-canvas" id="dag-tree-canvas">' + columnsHtml + '</div>';

    container.querySelectorAll('.dag-card-node').forEach(function (node) {
      node.addEventListener('click', function () {
        var taskId = node.getAttribute('data-task-id');
        if (taskId) openTaskDrawer(taskId);
      });
    });
    applyDagZoom();
  }



  function bindBatchBar(laneEl) {
    var btn = laneEl.querySelector('#btn-dispatch-selected');
    if (!btn || btn.getAttribute('data-bound')) return;
    btn.setAttribute('data-bound', '1');
    btn.addEventListener('click', function () {
      var ids = Object.keys(taskSelection);
      if (ids.length === 0) { toast('请先勾选待办卡片', false); return; }
      // 逐单预填依次提交：每单仍各停审批卡（D30 语义不破）。
      // 串行预填第一单，后续单随审批应答逐单推进（队列寄存）。
      dispatchQueue = ids.slice();
      taskSelection = {};
      prefillDispatchFromTask(dispatchQueue.shift());
      if (dispatchQueue.length > 0) {
        toast('批量派发：共 ' + (dispatchQueue.length + 1) + ' 单，逐单预填——每单审批应答后自动预填下一单', true);
      }
    });
  }

  var dispatchQueue = [];

  function prefillDispatchFromTask(taskId) {
    var task = (tasksData || []).filter(function (t) { return t.task_id === taskId; })[0];
    // 「派发」预填派发表单携带 task_id（v1.7 字段随提交；v1.7 落盘前为前端提案）。
    var dispatchBtn = document.querySelector('button[data-view="dispatch"]');
    if (dispatchBtn) dispatchBtn.click();
    document.getElementById('dispatch-prompt').value = task ? (task.title + (task.detail ? '\\n\\n' + task.detail : '')) : '';
    document.getElementById('dispatch-form').setAttribute('data-task-id', taskId);
    toast('已预填派发表单（#' + (task ? taskSeq(task) : '?') + '）', true);
  }

  // 批量队列推进：派发提交成功后自动预填下一单。
  function advanceDispatchQueue() {
    if (dispatchQueue.length === 0) return;
    prefillDispatchFromTask(dispatchQueue.shift());
  }

  /* ---------- GOAL-023: 活动时间线与任务卡抽屉 (D38) ---------- */
  var activeDrawerTaskId = null;

  function formatTaskCost(t) {
    if (!t) return '—';
    var dispatches = (snapshot && snapshot.dispatches) ? snapshot.dispatches : [];
    var taskDispatches = dispatches.filter(function (d) {
      return d.task_id === t.task_id || (t.dispatch_ids && t.dispatch_ids.indexOf(d.dispatch_id) >= 0);
    });
    var totalCost = 0;
    var hasCost = false;
    taskDispatches.forEach(function (d) {
      if (typeof d.amount_usd === 'number') { totalCost += d.amount_usd; hasCost = true; }
    });
    return hasCost ? ('$' + totalCost.toFixed(3)) : '—';
  }

  function synthesizeTaskActivities(t) {
    if (!t) return [];
    var list = [];
    if (t.created_at_utc || t.created_at) {
      list.push({
        activity_id: 'act-create-' + t.task_id,
        task_id: t.task_id,
        actor: 'owner',
        text_zh: '创建了任务卡 #' + taskSeq(t),
        at_utc: t.created_at_utc || t.created_at,
        kind: 'task_create'
      });
    }
    var dispatches = (snapshot && snapshot.dispatches) ? snapshot.dispatches : [];
    var related = dispatches.filter(function (d) {
      return d.task_id === t.task_id || (t.dispatch_ids && t.dispatch_ids.indexOf(d.dispatch_id) >= 0);
    });
    related.forEach(function (d) {
      var actor = d.adapter_id || 'dog';
      if (d.status === 'ADMITTED' || d.status === 'RUNNING') {
        list.push({
          activity_id: 'act-disp-start-' + d.dispatch_id,
          task_id: t.task_id,
          dispatch_id: d.dispatch_id,
          actor: actor,
          text_zh: actor + ' 开始执行派发任务',
          at_utc: d.at_utc,
          kind: 'dispatch_start'
        });
      } else if (d.status === 'PASS' || d.status === 'DRY_RUN') {
        list.push({
          activity_id: 'act-disp-done-' + d.dispatch_id,
          task_id: t.task_id,
          dispatch_id: d.dispatch_id,
          actor: actor,
          text_zh: actor + ' 执行完成' + (d.elapsed_sec ? '（耗时 ' + Math.round(d.elapsed_sec) + ' 秒）' : ''),
          at_utc: d.at_utc,
          kind: 'dispatch_pass',
          amount_usd: d.amount_usd
        });
      } else if (d.status === 'FAIL') {
        list.push({
          activity_id: 'act-disp-fail-' + d.dispatch_id,
          task_id: t.task_id,
          dispatch_id: d.dispatch_id,
          actor: actor,
          text_zh: actor + ' 执行失败',
          at_utc: d.at_utc,
          kind: 'dispatch_fail'
        });
      }
    });
    if (t.status === 'DONE') {
      list.push({
        activity_id: 'act-done-' + t.task_id,
        task_id: t.task_id,
        actor: 'owner',
        text_zh: '任务已标记完成 🏁',
        at_utc: t.updated_at_utc || t.updated_at || new Date().toISOString(),
        kind: 'task_done'
      });
    }
    list.sort(function (a, b) { return String(a.at_utc || '') < String(b.at_utc || '') ? -1 : 1; });
    return list;
  }

  function renderActivityTimeline(task, activities) {
    var el = document.getElementById('task-activity-timeline');
    if (!el) return;
    var list = (activities && activities.length > 0) ? activities : synthesizeTaskActivities(task);
    if (list.length === 0) {
      el.innerHTML = '<div class="empty" style="padding:10px 0;font-size:12px">暂无活动记录</div>';
      return;
    }
    el.innerHTML = list.map(function (act) {
      var isOwner = act.actor === 'owner' || !act.actor;
      var logoHtml = isOwner
        ? '<span style="font-size:10px">👤</span>'
        : dogLogo(act.actor, 'idle');
      var costTag = (typeof act.amount_usd === 'number')
        ? ' <span class="badge prio-低" style="margin-left:4px">$' + act.amount_usd.toFixed(3) + '</span>' : '';
      var dispTag = act.dispatch_id
        ? ' <span class="mono hint" style="font-size:11px">[' + esc(String(act.dispatch_id).slice(0, 8)) + ']</span>' : '';
      return '<div class="timeline-node">' +
        '<div class="timeline-dot">' + logoHtml + '</div>' +
        '<div class="timeline-header">' +
          '<span class="mono">' + escTime(act.at_utc) + '</span>' +
          '<strong>' + esc(act.actor || '') + '</strong>' +
          dispTag + costTag +
        '</div>' +
        '<div class="timeline-body">' + esc(act.text_zh || act.text || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function openTaskDrawer(taskId) {
    activeDrawerTaskId = taskId;
    var task = (tasksData || []).filter(function (t) { return t.task_id === taskId; })[0];
    if (!task) return;
    var overlay = document.getElementById('task-drawer-overlay');
    if (!overlay) return;
    
    document.getElementById('drawer-task-seq').textContent = '#' + taskSeq(task);
    document.getElementById('drawer-task-title').textContent = task.title;
    
    var goalBadge = task.goal_id ? '<span class="badge goal-cluster">' + esc(task.goal_id) + '</span>' : '';
    document.getElementById('drawer-task-meta').innerHTML =
      '<span class="badge prio-' + esc(task.priority || '中') + '">' + esc(task.priority || '中') + '</span>' +
      '<span class="badge">' + esc(TASK_STATUS_CN[task.status] || task.status) + '</span>' +
      goalBadge +
      '<span class="hint">来源: ' + esc(task.source || 'manual') + '</span>' +
      '<span class="badge" title="任务成本估算">💰 ' + formatTaskCost(task) + '</span>';

    // 关联区 (Context Links)
    var dispatches = (snapshot && snapshot.dispatches) ? snapshot.dispatches : [];
    var relatedDispatches = dispatches.filter(function (d) {
      return d.task_id === task.task_id || (task.dispatch_ids && task.dispatch_ids.indexOf(d.dispatch_id) >= 0);
    });
    var contextEl = document.getElementById('task-context-links');
    if (contextEl) {
      var linksHtml = '';
      if (task.goal_id) {
        linksHtml += '<div class="context-link-item"><span>所属 Goal: <strong>' + esc(task.goal_id) + '</strong></span><span class="hint">已聚簇</span></div>';
      }
      if (relatedDispatches.length > 0) {
        linksHtml += relatedDispatches.map(function (d) {
          return '<div class="context-link-item">' +
            '<span>派发 <strong class="mono">' + esc(String(d.dispatch_id).slice(0, 10)) + '…</strong> (' + esc(d.adapter_id) + ')</span>' +
            '<span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span>' +
          '</div>';
        }).join('');
      } else {
        linksHtml += '<div class="context-link-item"><span class="hint">暂无关联派发</span></div>';
      }
      contextEl.innerHTML = linksHtml;
    }

    // 三透镜操作绑定 (Three Lenses)
    var btnTrace = document.getElementById('btn-lens-trace');
    if (btnTrace) {
      btnTrace.onclick = function () {
        var last = relatedDispatches[relatedDispatches.length - 1];
        closeTaskDrawer();
        var dispBtn = document.querySelector('button[data-view="dispatch"]');
        if (dispBtn) dispBtn.click();
        if (last) {
          toast('正在查看派发 #' + String(last.dispatch_id).slice(0, 8) + ' 的执行步骤 (Trace)', true);
        }
      };
    }
    var btnChat = document.getElementById('btn-lens-chat');
    if (btnChat) {
      btnChat.onclick = function () {
        closeTaskDrawer();
        var chatBtn = document.querySelector('button[data-view="chat"]');
        if (chatBtn) chatBtn.click();
        var chatInput = document.getElementById('chat-input');
        if (chatInput) {
          chatInput.value = '关于任务 #' + taskSeq(task) + '「' + task.title + '」：';
          chatInput.focus();
        }
      };
    }
    var btnBudget = document.getElementById('btn-lens-budget');
    if (btnBudget) {
      btnBudget.onclick = function () {
        closeTaskDrawer();
        var budgetBtn = document.querySelector('button[data-view="budget"]');
        if (budgetBtn) budgetBtn.click();
      };
    }

    // 拉取或合成活动时间线
    renderActivityTimeline(task, []);
    getJson('/api/activity?task_id=' + encodeURIComponent(taskId)).then(function (data) {
      if (data && data.ok && Array.isArray(data.activities)) {
        renderActivityTimeline(task, data.activities);
      }
    }).catch(function () {
      renderActivityTimeline(task, []);
    });

    overlay.style.display = 'flex';
  }

  function closeTaskDrawer() {
    var overlay = document.getElementById('task-drawer-overlay');
    if (overlay) overlay.style.display = 'none';
    activeDrawerTaskId = null;
  }

  function renderRecentActivity() {
    var streamEl = document.getElementById('recent-activity-stream');
    var railEl = document.getElementById('rail-activity');
    if (!streamEl && !railEl) return;
    
    // 从后端 GET /api/activity 或从 tasksData + dispatches 合成最近活动流
    getJson('/api/activity?limit=10').then(function (data) {
      if (data && data.ok && Array.isArray(data.activities) && data.activities.length > 0) {
        populateActivityList(data.activities);
      } else {
        synthesizeAndPopulateRecent();
      }
    }).catch(function () {
      synthesizeAndPopulateRecent();
    });

    function synthesizeAndPopulateRecent() {
      var allActivities = [];
      (tasksData || []).forEach(function (t) {
        allActivities = allActivities.concat(synthesizeTaskActivities(t));
      });
      allActivities.sort(function (a, b) {
        return String(a.at_utc || '') > String(b.at_utc || '') ? -1 : 1;
      });
      populateActivityList(allActivities.slice(0, 10));
    }

    function populateActivityList(list) {
      if (!list || list.length === 0) {
        var emptyHtml = '<div class="empty" style="padding:6px 0;font-size:12px">暂无活动</div>';
        if (streamEl) streamEl.innerHTML = emptyHtml;
        if (railEl) railEl.innerHTML = emptyHtml;
        return;
      }
      var html = list.map(function (act) {
        var isOwner = act.actor === 'owner' || !act.actor;
        var logoHtml = isOwner ? '<span style="font-size:11px">👤</span>' : dogLogo(act.actor, 'idle');
        return '<div class="activity-item" data-task-id="' + esc(act.task_id || '') + '">' +
          logoHtml +
          '<span style="font-weight:500">' + esc(act.text_zh || act.text || '') + '</span>' +
          '<span class="activity-time">' + escTime(act.at_utc) + '</span>' +
        '</div>';
      }).join('');
      if (streamEl) {
        streamEl.innerHTML = html;
        streamEl.querySelectorAll('.activity-item').forEach(function (item) {
          item.addEventListener('click', function () {
            var tid = item.getAttribute('data-task-id');
            if (tid) openTaskDrawer(tid);
          });
        });
      }
      if (railEl) {
        railEl.innerHTML = html;
        railEl.querySelectorAll('.activity-item').forEach(function (item) {
          item.addEventListener('click', function () {
            var tid = item.getAttribute('data-task-id');
            if (tid) {
              var taskTab = document.querySelector('button[data-view="tasks"]');
              if (taskTab) taskTab.click();
              openTaskDrawer(tid);
            }
          });
        });
      }
    }
  }

  // 关闭抽屉事件绑定
  var closeBtn = document.getElementById('btn-close-task-drawer');
  if (closeBtn) closeBtn.addEventListener('click', closeTaskDrawer);
  var drawerOverlay = document.getElementById('task-drawer-overlay');
  if (drawerOverlay) {
    drawerOverlay.addEventListener('click', function (e) {
      if (e.target === drawerOverlay) closeTaskDrawer();
    });
  }
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activeDrawerTaskId) closeTaskDrawer();
  });

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

  /* ---------- GOAL-020 B2 & GOAL-025：右侧犬队栏（每犬一卡：徽标+实测状态+单犬探测⚡+最近回报摘要） ---------- */
  function renderRailDogs() {
    var el = document.getElementById('rail-dogs');
    var roster = (snapshot.roster || []).filter(function (r) {
      return r.adapter_id !== 'head-dog' && r.adapter_id !== 'fake-t1' && !r.adapter_id.startsWith('agy-');
    });
    var latest = latestDispatchPerAdapter();

    if (roster.length === 0) { el.innerHTML = '<div class="empty" style="padding:8px 0">暂无在册犬只</div>'; return; }
    el.innerHTML = roster.map(function (r) {
      var last = latest[r.adapter_id] || null;
      var running = last ? isRunningStatus(last.status) : false;
      var logoState = running ? 'working' : 'idle';
      var note = last ? esc(last.status) + ' · ' + escTime(last.at_utc || '') : '未活动';
      var noteStyle = running ? ' style="color:var(--ok);font-weight:600"' : '';
      var probeBadge = r.probe_status === 'ONLINE'
        ? '<span class="badge" style="font-size:9px;padding:1px 4px;background:rgba(16,185,129,0.15);color:#047857" title="实测在线">🟢' + (r.live_models ? r.live_models.length : 1) + '</span>'
        : (r.probe_status === 'QUOTA_EXHAUSTED' ? '<span class="badge" style="font-size:9px;padding:1px 4px;background:rgba(239,68,68,0.15);color:#b91c1c" title="额度耗尽">🔴</span>' : '');
      return '<div class="rail-dog-card dog-avatar" data-dog="' + esc(r.adapter_id) + '" title="点击直连【' + esc(r.adapter_id) + '】专属终端">' + dogLogo(r.adapter_id + ' ' + (r.expected_model_id || ''), logoState) +
        '<span class="rail-dog-name">' + esc(r.adapter_id) + '</span>' +
        probeBadge +
        '<button class="act" data-rail-probe="' + esc(r.adapter_id) + '" type="button" style="padding:1px 5px;font-size:10px;margin-left:auto;background:var(--panel-hi);border:1px solid var(--line);color:var(--ink)" title="单独探测 ' + esc(r.adapter_id) + '">⚡</button>' +
        '<span class="rail-dog-note"' + noteStyle + '>' + note + '</span></div>';
    }).join('');
    el.querySelectorAll('button[data-rail-probe]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-rail-probe');
        btn.textContent = '⏳';
        postJson('/api/models/probe', { adapter_id: id }).then(function (res) {
          if (res.status === 200 && res.body && res.body.ok) {
            toast(id + ' 实测探测已完成', true);
            refresh();
          } else {
            toast(id + ' 探测失败', false);
          }
        }).catch(function (err) {
          toast(id + ' 探测异常: ' + err, false);
        }).finally(function () {
          btn.textContent = '⚡';
        });
      });
    });
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
    renderRecentActivity();
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
      var viewName = btn.getAttribute('data-view');
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('main > section.view, main > section.view-panel').forEach(function (s) {
        s.classList.remove('active');
        s.style.display = 'none';
      });
      btn.classList.add('active');
      var target = document.getElementById('view-' + viewName);
      if (target) {
        target.classList.add('active');
        target.style.display = '';
      }
      if (viewName === 'tasks') {
        loadTasks(false);
      }
    });
  });

  document.getElementById('dispatch-form').addEventListener('submit', submitDispatch);
  document.getElementById('dispatch-adapter').addEventListener('change', renderDispatchProviderOptions);
  var dispatchProv = document.getElementById('dispatch-provider');
  if (dispatchProv) dispatchProv.addEventListener('change', renderModelOptions);
  var dispatchMod = document.getElementById('dispatch-model');
  if (dispatchMod) dispatchMod.addEventListener('change', function () { renderDynamicThinkingOptions(this.value); });
  document.getElementById('dispatch-real').addEventListener('change', function () {

    document.getElementById('real-hint').style.display = this.checked ? 'block' : 'none';
  });

  // 本地工作区浏览与选择器事件绑定
  var btnWsBrowseNative = document.getElementById('btn-workspace-browse-native');
  if (btnWsBrowseNative) btnWsBrowseNative.addEventListener('click', function () { triggerNativeFolderPicker('workspace-register-path'); });
  var btnChatWsBrowse = document.getElementById('chat-workspace-browse-btn');
  if (btnChatWsBrowse) btnChatWsBrowse.addEventListener('click', function () { triggerNativeFolderPicker('workspace-register-path'); });

  var btnWsTree = document.getElementById('btn-workspace-tree');
  if (btnWsTree) btnWsTree.addEventListener('click', function () { openWorkspaceTreeDialog('workspace-register-path'); });
  var btnChatWsTree = document.getElementById('chat-workspace-tree-btn');
  if (btnChatWsTree) btnChatWsTree.addEventListener('click', function () { openWorkspaceTreeDialog('workspace-register-path'); });

  var wsTreeClose = document.getElementById('ws-tree-close');
  if (wsTreeClose) wsTreeClose.addEventListener('click', closeWorkspaceTreeDialog);
  var wsTreeCancel = document.getElementById('ws-tree-cancel-btn');
  if (wsTreeCancel) wsTreeCancel.addEventListener('click', closeWorkspaceTreeDialog);

  var wsTreeUp = document.getElementById('ws-tree-up-btn');
  if (wsTreeUp) wsTreeUp.addEventListener('click', function () {
    if (currentWsTreePath) {
      getJson('/api/workspaces/fs-tree?path=' + encodeURIComponent(currentWsTreePath)).then(function (data) {
        if (data && data.parentPath) loadWorkspaceTreePath(data.parentPath);
        else loadWorkspaceTreePath('');
      });
    }
  });

  var wsTreeGo = document.getElementById('ws-tree-go-btn');
  if (wsTreeGo) wsTreeGo.addEventListener('click', function () {
    var val = document.getElementById('ws-tree-path-input').value.trim();
    if (val) loadWorkspaceTreePath(val);
  });

  var wsTreeConfirm = document.getElementById('ws-tree-confirm-btn');
  if (wsTreeConfirm) wsTreeConfirm.addEventListener('click', function () {
    var chosen = currentWsTreeSelected || currentWsTreePath;
    if (!chosen) {
      toast('请先选择一个文件夹', false);
      return;
    }
    var input = document.getElementById(targetWsInputId);
    if (input) input.value = chosen;
    postJson('/api/workspaces/create', { path: chosen }).then(function (res) {
      if (res.status === 201 || res.status === 409) {
        postJson('/api/workspaces/select', { path: chosen }).then(function () {
          closeWorkspaceTreeDialog();
          toast('工作区已切换为: ' + chosen, true);
          refresh();
        });
      } else {
        closeWorkspaceTreeDialog();
        toast('工作区登记完成', true);
        refresh();
      }
    }).catch(function (e) {
      closeWorkspaceTreeDialog();
      toast('工作区登记结果: ' + e, true);
      refresh();
    });
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

  /* ---------- GOAL-012：聊天面板事件绑定 + 多模态图片与通知开关 ---------- */
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendChat(); }
  });
  var chatAttachBtn = document.getElementById('chat-attach-btn');
  var chatFileInput = document.getElementById('chat-file-input');
  if (chatAttachBtn && chatFileInput) {
    chatAttachBtn.addEventListener('click', function () { chatFileInput.click(); });
    chatFileInput.addEventListener('change', function () {
      handleFileSelection(chatFileInput.files);
      chatFileInput.value = '';
    });
  }
  var chatInputEl = document.getElementById('chat-input');
  if (chatInputEl) {
    chatInputEl.addEventListener('paste', function (e) {
      var clip = e.clipboardData || window.clipboardData;
      if (!clip || !clip.items) return;
      var imgFiles = [];
      for (var i = 0; i < clip.items.length; i++) {
        if (clip.items[i].type.indexOf('image') !== -1) {
          var f = clip.items[i].getAsFile();
          if (f) imgFiles.push(f);
        }
      }
      if (imgFiles.length > 0) {
        e.preventDefault();
        handleFileSelection(imgFiles);
      }
    });
  }
  var chatComposerEl = document.getElementById('chat-composer') || document.querySelector('.chat-input-row');
  if (chatComposerEl) {
    chatComposerEl.addEventListener('dragover', function (e) { e.preventDefault(); });
    chatComposerEl.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files);
      }
    });
  }
  document.getElementById('chat-new-session').addEventListener('click', chatNewSession);
  var compactBtn = document.getElementById('chat-compact-btn');
  if (compactBtn) compactBtn.addEventListener('click', triggerChatCompact);
  var chatWsSel = document.getElementById('chat-workspace-select');
  if (chatWsSel) {
    chatWsSel.addEventListener('change', function () { updateChatWorkspace(this.value); });
  }
  var drawerClose = document.getElementById('child-dog-drawer-close');
  if (drawerClose) drawerClose.addEventListener('click', closeChildDogDrawer);
  var drawerSend = document.getElementById('child-dog-drawer-send');
  if (drawerSend) drawerSend.addEventListener('click', sendChildDogMessage);
  var drawerInput = document.getElementById('child-dog-drawer-input');
  if (drawerInput) drawerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendChildDogMessage(); }
  });
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || target.closest('button') || target.closest('input') || target.closest('select')) return;
    var avatarEl = target.closest('.dog-avatar, [data-dog-avatar], .roster-avatar, .slot-avatar, .node-avatar');
    if (avatarEl) {
      var dog = avatarEl.getAttribute('data-dog') || avatarEl.getAttribute('data-adapter') || avatarEl.textContent.trim();
      var sess = avatarEl.getAttribute('data-session-id');
      if (dog) openChildDogDrawer(dog, sess);
    }
  });
  // GOAL-018B #3：会话选择器切换/新建。

  document.getElementById('chat-session-select').addEventListener('change', function () {
    switchChatSession(this.value);
  });
  // GOAL-017B #2/#3：级联选择联动（harness 切换 → provider 切换 → 变体重算 + 徽章链刷新 + 上下文水位与费率刷新）。
  document.getElementById('chat-head-select').addEventListener('change', renderHeadProviderOptions);
  document.getElementById('chat-head-select').addEventListener('change', renderHeadVariantOptions);
  document.getElementById('chat-head-select').addEventListener('change', updateContextGauge);
  var chatHeadProv = document.getElementById('chat-head-provider');
  if (chatHeadProv) chatHeadProv.addEventListener('change', function () { renderHeadVariantOptions(); updateContextGauge(); });
  document.getElementById('chat-head-variant').addEventListener('change', renderHeadDogBadge);
  document.getElementById('chat-head-variant').addEventListener('change', updateContextGauge);

  document.getElementById('chat-head-variant').addEventListener('change', function () {
    renderDynamicThinkingOptions(this.value);
  });



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

  function loadUsage() {
    return getJson('/api/usage').then(function (data) {
      if (data && data.ok) usageSummary = data.usage;
      renderBudget();
    }).catch(function () {});
  }

  function loadBudget() {
    loadUsage();
    return getJson('/api/budget').then(function (data) {
      if (data.ok) budget = data;
      renderBudget();
      renderRailBudget(); // GOAL-020 B2：栏内迷你条同步刷新
    }).catch(function () { renderBudget(); renderRailBudget(); });
  }

  function bindProbeButtons() {
    var chatProbeBtn = document.getElementById('chat-probe-btn');
    if (chatProbeBtn) {
      chatProbeBtn.addEventListener('click', function () {
        var sel = document.getElementById('chat-head-select');
        var provSel = document.getElementById('chat-head-provider');
        var varSel = document.getElementById('chat-head-variant');
        var id = sel && sel.value;
        if (!id) return;
        var provId = provSel && provSel.value ? provSel.value : undefined;
        var provName = provSel && provSel.options[provSel.selectedIndex] ? provSel.options[provSel.selectedIndex].text : '';
        var modelId = varSel && varSel.value ? varSel.value : undefined;

        chatProbeBtn.textContent = '⏳';
        toast('正在探测 ' + id + (provName ? ' [' + provName + ']' : '') + ' 模型连通性…', true);
        postJson('/api/models/probe', { adapter_id: id, provider_id: provId, model_id: modelId }).then(function (res) {
          if (res.status === 200 && res.body && res.body.ok) {
            toast('🟢 ' + id + (provName ? ' (' + provName + ')' : '') + ' 实测探测完成，通道在线！', true);
            refresh();
          } else {
            toast('🔴 ' + id + ' 探测失败: ' + ((res.body && res.body.error) || res.status), false);
          }
        }).catch(function (err) {
          toast('🔴 ' + id + ' 探测异常: ' + err, false);
        }).finally(function () {
          chatProbeBtn.textContent = '⚡ 探测';
        });
      });
    }

    var dispatchProbeBtn = document.getElementById('dispatch-probe-btn');
    if (dispatchProbeBtn) {
      dispatchProbeBtn.addEventListener('click', function () {
        var sel = document.getElementById('dispatch-adapter');
        var provSel = document.getElementById('dispatch-provider');
        var modSel = document.getElementById('dispatch-model');
        var id = sel && sel.value;
        if (!id) return;
        var provId = provSel && provSel.value ? provSel.value : undefined;
        var provName = provSel && provSel.options[provSel.selectedIndex] ? provSel.options[provSel.selectedIndex].text : '';
        var modelId = modSel && modSel.value ? modSel.value : undefined;

        dispatchProbeBtn.textContent = '⏳';
        toast('正在探测 ' + id + (provName ? ' [' + provName + ']' : '') + ' 模型连通性…', true);
        postJson('/api/models/probe', { adapter_id: id, provider_id: provId, model_id: modelId }).then(function (res) {
          if (res.status === 200 && res.body && res.body.ok) {
            toast('🟢 ' + id + (provName ? ' (' + provName + ')' : '') + ' 实测探测完成，通道在线！', true);
            refresh();
          } else {
            toast('🔴 ' + id + ' 探测失败: ' + ((res.body && res.body.error) || res.status), false);
          }
        }).catch(function (err) {
          toast('🔴 ' + id + ' 探测异常: ' + err, false);
        }).finally(function () {
          dispatchProbeBtn.textContent = '⚡ 探测';
        });
      });
    }


    var railProbeAll = document.getElementById('rail-probe-all');
    if (railProbeAll) {
      railProbeAll.addEventListener('click', function () {
        railProbeAll.textContent = '⏳';
        postJson('/api/models/probe', {}).then(function (res) {
          if (res.status === 200 && res.body && res.body.ok) {
            toast('全队实测探测完成', true);
            refresh();
          } else {
            toast('探测失败', false);
          }
        }).catch(function (err) {
          toast('探测异常: ' + err, false);
        }).finally(function () {
          railProbeAll.textContent = '🔍 实测探测';
        });
      });
    }
  }

  function loadCarveouts() {
    return getJson('/api/carveouts').then(function (data) {
      if (data && data.ok) {
        renderCarveouts(data);
      }
    }).catch(function () {});
  }

  function renderCarveouts(data) {
    var wrap = document.getElementById('carveout-active-wrap');
    var historyEl = document.getElementById('carveouts-history-list');
    if (!wrap || !historyEl) return;
    if (!data) { loadCarveouts(); return; }

    var active = data.active;
    if (active) {
      var expiresAt = new Date(active.expires_at_utc).getTime();
      var remSecs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      var remMin = Math.floor(remSecs / 60);
      var remSec = remSecs % 60;
      wrap.innerHTML = '<div style="background:var(--panel-hi);border:1px solid var(--ok);border-radius:6px;padding:10px 14px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div><strong>🟢 ACTIVE 切片: </strong><code>' + esc(active.carveout_id) + '</code> (' + esc(active.task_ref) + ')</div>' +
        '<button class="act reject" id="btn-revoke-carveout" data-id="' + esc(active.carveout_id) + '" style="padding:4px 12px;font-size:12px;">紧急熔断撤销</button>' +
        '</div>' +
        '<div style="margin-top:6px;font-size:12px;color:var(--ink-dim)">白名单路径: <code>' + esc(active.path_roots.join(', ')) + '</code></div>' +
        '<div style="margin-top:4px;font-size:12px;color:var(--ink-dim)">剩余时效: <strong>' + remMin + '分' + remSec + '秒</strong> · 截止: ' + escTime(active.expires_at_utc) + '</div>' +
        '</div>';
      var revokeBtn = document.getElementById('btn-revoke-carveout');
      if (revokeBtn) {
        revokeBtn.addEventListener('click', function () {
          postJson('/api/carveout/revoke', { carveout_id: active.carveout_id }).then(function () {
            toast('Carve-out 白名单已撤销', true);
            loadCarveouts();
          }).catch(function (err) {
            toast('撤销失败: ' + err, false);
          });
        });
      }
    } else {
      wrap.innerHTML = '<div style="background:var(--panel-hi);border:1px dashed var(--line);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--ink-faint);">当前无 ACTIVE 写面切片（写操作默认只读阻断）</div>';
    }

    var list = data.carveouts || [];
    if (list.length === 0) {
      historyEl.innerHTML = '<div class="empty">暂无切片记录</div>';
    } else {
      historyEl.innerHTML = list.slice().reverse().map(function (c) {
        var badgeClass = c.status === 'ACTIVE' ? 'ok' : (c.status === 'REVOKED' ? 'broken' : 'SUPERSEDED');
        return '<div class="card" style="margin-bottom:8px;padding:8px 12px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;">' +
          '<span><code>' + esc(c.carveout_id) + '</code> <strong>' + esc(c.task_ref) + '</strong> <span class="badge ' + badgeClass + '">' + esc(c.status) + '</span></span>' +
          '<span class="mono">' + escTime(c.granted_at_utc) + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--ink-dim);margin-top:4px;">路径: <code>' + esc(c.path_roots.join(', ')) + '</code> · 原因: ' + esc(c.reason) + '</div>' +
          '</div>';
      }).join('');
    }
  }

  var coForm = document.getElementById('form-grant-carveout');
  if (coForm) {
    coForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pathsInput = (document.getElementById('co-input-paths') || {}).value || '';
      var durationMins = Number((document.getElementById('co-select-duration') || {}).value || '60');
      var taskRef = (document.getElementById('co-input-task') || {}).value || '';
      var reason = (document.getElementById('co-input-reason') || {}).value || '';
      var paths = pathsInput.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      var expiresAt = new Date(Date.now() + durationMins * 60000).toISOString();
      postJson('/api/carveout/grant', {
        path_roots: paths,
        expires_at: expiresAt,
        task_ref: taskRef,
        reason: reason
      }).then(function (res) {
        if (res && (res.ok || res.status === 201)) {
          toast('Carve-out 白名单已签发', true);
          coForm.reset();
          loadCarveouts();
        } else {
          toast('签发失败: ' + ((res && res.body && res.body.error) || '未知错误'), false);
        }
      }).catch(function (err) {
        toast('签发异常: ' + err, false);
      });
    });
  }

  bindProbeButtons();

  var btnTasksRef = document.getElementById('btn-tasks-refresh');
  if (btnTasksRef) {
    btnTasksRef.addEventListener('click', function () {
      loadTasks(false);
    });
  }

  // 任务池与路径导图轻量自动探测轮询（8 秒）
  setInterval(function () {
    var tasksView = document.getElementById('view-tasks');
    if (tasksView && tasksView.classList.contains('active')) {
      loadTasks(true);
    }
  }, 8000);

  refresh().then(function () {
    loadWorkspaces();
    loadBudget();
    loadStreams();
    loadCarveouts();
    loadTasks(true);
    // GOAL-018B #3：页面加载即恢复上次会话（localStorage session_id → GET history 全量重渲染）。
    if (chatSessionId) switchChatSession(chatSessionId); else renderSessionSelector();
    var status = document.getElementById('sse-status');
    var source = new EventSource('/api/stream');
    source.onopen = function () { status.textContent = 'SSE 实时'; status.className = 'live'; };
    source.onerror = function () { status.textContent = 'SSE 断开（重连中）'; status.className = 'down'; };
    source.onmessage = function (msg) {
      var payload = null;
      try { payload = JSON.parse(msg.data); } catch (e) { payload = null; }
      if (payload && payload.kind === 'chat') {
        chatHandleFrame(payload); // GOAL-021B：聊天流式阶段机（事件驱动，不做全量 refresh）
        return;
      }
      if (payload && payload.kind === 'dispatch') {
        trackDispatch(payload.dispatch_id, payload.adapter_id, payload.status);
        loadBudget();
        // 头犬派发进入 REPORT/REVIEW 后，头犬回复已落盘 runtime/chat —— 拉历史补齐气泡。
        // GOAL-021B：在途 chat 派发已由 kind=chat 帧渲染，跳过避免覆盖打字机/失败态。
        if (payload.adapter_id === 'head-dog' && (payload.phase === 'REPORT' || payload.phase === 'REVIEW') && payload.dispatch_id !== chatInflightId) {
          chatRefreshHistory();
        }
      }
      refresh();
      loadTasks(true);
    };
  });

  ${getCollaborationClientScript()}
})();
</script>
</body>
</html>
`;
}
