/**
 * mush 样式库与协作工作台样式 (Ponytail Modular Styles)
 */

export function getCollaborationStyles(): string {
  return `
  /* 协作模式底栏胶囊 (GOAL-043) */
  .collab-mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--panel-hi, #f6f8fa);
    border-top: 1px solid var(--line, #e3e8ee);
    border-radius: 0 0 8px 8px;
    font-size: 12px;
    gap: 8px;
  }
  .mode-capsules {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mode-capsule {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 14px;
    border: 1px solid var(--line, #e3e8ee);
    background: var(--panel, #ffffff);
    color: var(--ink-dim, #5a6675);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .mode-capsule:hover {
    border-color: var(--accent, #0e9f8f);
    color: var(--ink, #1d2733);
  }
  .mode-capsule.active {
    background: var(--accent, #0e9f8f);
    border-color: var(--accent, #0e9f8f);
    color: #ffffff;
  }
  .collab-pair-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--ink-dim, #5a6675);
  }
  .collab-pair-indicator .badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 11px;
  }
  .collab-pair-indicator .primary-dog {
    background: #e8f0fe;
    color: #1a73e8;
  }
  .collab-pair-indicator .opposing-dog {
    background: #fce8e6;
    color: #d93025;
  }
  .collab-pair-indicator .vs {
    font-weight: bold;
    color: var(--ink-faint, #9aa5b1);
  }
  .btn-micro-switch {
    background: none;
    border: 1px solid var(--line, #e3e8ee);
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    color: var(--ink-dim, #5a6675);
  }

  /* 圆桌辩论工作台样式 (GOAL-044)；GOAL-067：移除 DOM 中不存在的 #debate-view 死选择器 */
  #view-debate {
    display: flex;
    flex-direction: column;

    height: 100%;
    padding: 16px;
    gap: 14px;
    overflow-y: auto;
  }
  .debate-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .debate-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .debate-badge {
    font-size: 14px;
    font-weight: bold;
    color: var(--ink, #1d2733);
  }
  .debate-topic {
    flex: 1;
    font-weight: 600;
    color: var(--accent, #0e9f8f);
  }
  .debate-status-tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    background: #e3e8ee;
  }
  .debate-status-tag.active {
    background: #e8f0fe;
    color: #1a73e8;
  }
  .debate-status-tag.settled {
    background: #e6f4ea;
    color: #137333;
  }
  .debate-dogs-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .pro-tag strong { color: #1a73e8; }
  .con-tag strong { color: #d93025; }
  .round-indicator {
    margin-left: auto;
    font-size: 11px;
    color: var(--ink-dim, #5a6675);
    background: var(--panel-hi, #f6f8fa);
    padding: 2px 8px;
    border-radius: 4px;
  }

  /* 双栏对立视窗 */
  .debate-columns-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    flex: 1;
    min-height: 280px;
  }
  .debate-column {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pro-column { border-top: 3px solid #1a73e8; }
  .con-column { border-top: 3px solid #d93025; }
  .column-header {
    padding: 10px 14px;
    background: var(--panel-hi, #f6f8fa);
    border-bottom: 1px solid var(--line, #e3e8ee);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .pro-dot { background: #1a73e8; }
  .con-dot { background: #d93025; }
  .col-dog-badge {
    margin-left: auto;
    font-size: 11px;
    font-weight: normal;
    color: var(--ink-dim, #5a6675);
  }
  .column-content {
    padding: 14px;
    flex: 1;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.5;
  }
  .turn-bubble {
    background: var(--panel-hi, #f6f8fa);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 10px;
    border-left: 3px solid var(--line, #e3e8ee);
  }
  .turn-bubble.pro { border-left-color: #1a73e8; }
  .turn-bubble.con { border-left-color: #d93025; }
  .turn-bubble .turn-header {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
  }

  /* 仲裁卡 */
  .debate-arbitration-panel {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .arbitration-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .consensus-box, .disputes-box {
    background: var(--panel-hi, #f6f8fa);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
  }
  .consensus-box { border-left: 3px solid #2e9e5b; }
  .disputes-box { border-left: 3px solid #c07a1f; }
  .box-title {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .distill-list {
    margin: 0;
    padding-left: 18px;
    color: var(--ink-dim, #5a6675);
  }
  .distill-list li { margin-bottom: 3px; }
  .arbitration-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--line, #e3e8ee);
  }
  .arbitration-prompt {
    font-weight: 600;
    font-size: 13px;
  }
  .btn-pro {
    background: #1a73e8;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .btn-con {
    background: #d93025;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .btn-merge {
    background: #7c5cff;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }

  /* SOP 工序流水线样式 (GOAL-045) */
  #view-pipeline {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .pipeline-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pipeline-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pipeline-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .pipeline-topic {
    font-weight: 600;
    color: var(--accent, #0e9f8f);
    flex: 1;
  }
  .pipeline-status-tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    background: #e8f0fe;
    color: #1a73e8;
  }
  .pipeline-status-tag.completed {
    background: #e6f4ea;
    color: #137333;
  }
  .pipeline-meta-row {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 12px;
    color: var(--ink-dim, #5a6675);
  }
  .pipeline-progress-track {
    display: flex;
    align-items: center;
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 10px 16px;
    gap: 10px;
    overflow-x: auto;
  }
  .progress-step {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-dim, #5a6675);
    padding: 4px 10px;
    border-radius: 14px;
    background: var(--panel-hi, #f6f8fa);
  }
  .progress-step.active {
    background: var(--accent, #0e9f8f);
    color: #fff;
  }
  .progress-step.completed {
    background: #e6f4ea;
    color: #137333;
  }
  .step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(0,0,0,0.1);
    font-size: 11px;
    font-weight: bold;
  }
  .step-arrow {
    color: var(--ink-faint, #9aa5b1);
    font-size: 12px;
  }
  .pipeline-stages-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
  }
  .pipeline-card {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pipeline-card.active {
    border-color: var(--accent, #0e9f8f);
    box-shadow: 0 0 0 2px rgba(14, 159, 143, 0.15);
  }
  .card-header {
    padding: 8px 10px;
    background: var(--panel-hi, #f6f8fa);
    border-bottom: 1px solid var(--line, #e3e8ee);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-stage-title {
    font-weight: 600;
    font-size: 12px;
  }
  .card-status-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
  }
  .card-status-badge.running { background: #e8f0fe; color: #1a73e8; }
  .card-status-badge.completed { background: #e6f4ea; color: #137333; }
  .card-status-badge.pending { background: #f1f3f4; color: #5f6368; }
  .card-status-badge.blocked_gate { background: #fef7e0; color: #b06000; }
  .card-dog-row {
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    border-bottom: 1px solid var(--line, #e3e8ee);
  }
  .dog-badge {
    background: #e8f0fe;
    color: #1a73e8;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
  }
  .card-body {
    padding: 10px;
    flex: 1;
    font-size: 11px;
    color: var(--ink-dim, #5a6675);
    min-height: 60px;
  }
  .card-footer {
    padding: 6px 10px;
    border-top: 1px solid var(--line, #e3e8ee);
    display: flex;
    justify-content: center;
    background: var(--panel-hi, #f6f8fa);
    font-size: 11px;
  }
  .btn-view-artifact {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .pipeline-detail-panel {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .artifact-content-box {
    background: var(--panel-hi, #f6f8fa);
    border-radius: 6px;
    padding: 12px;
    font-family: Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    max-height: 260px;
    overflow-y: auto;
    margin: 0;
  }
  .btn-approve-gate {
    background: #2e9e5b;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }

  /* 红蓝对抗验证室样式 (GOAL-046) */
  #view-redblue {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .redblue-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .redblue-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .redblue-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .redblue-topic {
    font-weight: 600;
    color: var(--accent, #0e9f8f);
    flex: 1;
  }
  .redblue-status-tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    background: #e8f0fe;
    color: #1a73e8;
  }
  .redblue-status-tag.passed { background: #e6f4ea; color: #137333; }
  .redblue-status-tag.failed { background: #fce8e6; color: #d93025; }
  .redblue-meta-row {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 12px;
  }
  .blue-tag strong { color: #1a73e8; }
  .red-tag strong { color: #d93025; }
  .redblue-columns-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    flex: 1;
    min-height: 320px;
  }
  .redblue-column {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .blue-column { border-top: 3px solid #1a73e8; }
  .red-column { border-top: 3px solid #d93025; }
  .blue-dot { background: #1a73e8; }
  .red-dot { background: #d93025; }
  .code-preview {
    background: var(--panel-hi, #f6f8fa);
    padding: 12px;
    border-radius: 6px;
    font-family: Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    overflow-y: auto;
    margin: 0;
    flex: 1;
  }
  .attack-test-card {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .attack-test-card.broken {
    border-color: #d93025;
    background: #fff8f7;
  }
  .attack-type-badge {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    background: #fce8e6;
    color: #d93025;
  }
  .redblue-feedback-panel {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .failure-trace-box {
    background: var(--panel-hi, #f6f8fa);
    border-radius: 6px;
    padding: 12px;
    font-family: Consolas, monospace;
    font-size: 12px;
    color: var(--ink, #1d2733);
    white-space: pre-wrap;
    margin: 0;
    max-height: 200px;
    overflow-y: auto;
  }

  /* 悬赏招投标市场样式 (GOAL-047) */
  #view-bounties {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .bounty-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bounty-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bounty-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .bounty-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .bounty-stats-grid {
    display: flex;
    gap: 12px;
  }
  .stat-card {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .stat-label {
    font-size: 11px;
    color: var(--muted, #6a737d);
  }
  .stat-value {
    font-size: 18px;
    font-weight: bold;
    color: var(--accent, #0e9f8f);
  }
  .bounty-main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    flex: 1;
    min-height: 340px;
  }
  .bounty-column {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bounty-card {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 10px;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .bounty-card:hover {
    border-color: var(--accent, #0e9f8f);
    background: #ffffff;
  }
  .bounty-card.active {
    border-color: var(--accent, #0e9f8f);
    box-shadow: 0 0 0 1px var(--accent, #0e9f8f);
  }
  .bounty-cap-tag {
    background: #e6f4ea;
    color: #137333;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 11px;
  }
  .bid-card {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bid-card.awarded {
    border-color: #2e9e5b;
    background: #f4faf6;
  }
  .btn-action-sm {
    background: var(--accent, #0e9f8f);
    color: #ffffff;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  /* 技能联邦大厅样式 (GOAL-048) */
  #view-skills {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .skills-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .skills-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .skills-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .skills-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .skills-stats-grid {
    display: flex;
    gap: 12px;
  }
  .skills-main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    flex: 1;
    min-height: 340px;
  }
  .skills-column {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .transpile-tabs {
    display: flex;
    gap: 4px;
  }
  .transpile-tabs .tab-btn {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .transpile-tabs .tab-btn.active {
    background: var(--accent, #0e9f8f);
    color: #fff;
    border-color: var(--accent, #0e9f8f);
  }
  .transpile-content-box {
    padding: 12px;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  /* 时空穿梭样式 (GOAL-049) */
  #view-timetravel {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .timetravel-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .timetravel-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .timetravel-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .timetravel-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .timetravel-stats-grid {
    display: flex;
    gap: 12px;
  }
  .timetravel-main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    flex: 1;
    min-height: 340px;
  }
  .timetravel-column {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .timeline-nodes-container {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
  }
  .node-detail-container {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  .branch-pill {
    background: #e8f0fe;
    color: #1a73e8;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }

  /* 共享黑板样式 (GOAL-050) */
  #view-blackboard {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .blackboard-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .blackboard-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .blackboard-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .blackboard-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .blackboard-stats-grid {
    display: flex;
    gap: 12px;
  }
  .blackboard-quad-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 16px;
    flex: 1;
    min-height: 380px;
  }
  .blackboard-quadrant {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .quadrant-header {
    background: var(--panel-hi, #f6f8fa);
    padding: 8px 12px;
    font-weight: 600;
    font-size: 12px;
    border-bottom: 1px solid var(--line, #e3e8ee);
  }
  .quadrant-items {
    padding: 12px;
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* 液态小队样式 (GOAL-051) */
  #view-squads {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .squads-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .squads-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .squads-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .squads-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .squads-stats-grid {
    display: flex;
    gap: 12px;
  }
  .squads-main-container {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    min-height: 380px;
  }
  .squads-list {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  .squad-card {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lead-badge {
    background: #fff8e1;
    color: #b78103;
    border: 1px solid #ffe082;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
  }
  .member-badge {
    background: #e8f0fe;
    color: #1a73e8;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  /* ELO 天梯榜样式 (GOAL-052) */
  #view-elo {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .elo-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .elo-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .elo-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .elo-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .elo-stats-grid {
    display: flex;
    gap: 12px;
  }
  .elo-main-container {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    min-height: 380px;
  }
  .elo-table-wrapper {
    padding: 12px;
    overflow-x: auto;
  }
  .elo-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .elo-table th, .elo-table td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--line, #e3e8ee);
  }
  .elo-table th {
    background: var(--panel-hi, #f6f8fa);
    font-weight: 600;
    color: var(--muted, #6a737d);
  }
  .tier-badge {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: bold;
    display: inline-block;
  }
  .tier-grandmaster { background: #fce8e6; color: #c5221f; border: 1px solid #fad2cf; }
  .tier-master { background: #f3e8fd; color: #8430ce; border: 1px solid #e1cbf7; }
  .tier-diamond { background: #e8f0fe; color: #1a73e8; border: 1px solid #c8dafc; }
  .tier-platinum { background: #e6f4ea; color: #137333; border: 1px solid #ceead6; }
  .tier-gold { background: #fef7e0; color: #b06000; border: 1px solid #feeaa9; }
  .tier-silver { background: #f1f3f4; color: #5f6368; border: 1px solid #dadce0; }

  /* 3-Tier Hierarchy Styles (Harness ➔ Provider ➔ Model) */
  .harness-tree-card {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    margin-bottom: 14px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .harness-tree-header {
    background: var(--panel-hi, #f8fafc);
    padding: 12px 16px;
    border-bottom: 1px solid var(--line, #e3e8ee);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .harness-title-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 600;
  }
  .harness-meta-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .harness-providers-body {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .provider-card-item {
    background: var(--bg, #fdfdfe);
    border: 1px solid var(--line, #e2e8f0);
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .provider-card-item.active-provider {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.02);
  }
  .provider-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
  }
  .provider-tag-active {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
  }
  .provider-tag-backup {
    background: #f1f5f9;
    color: #64748b;
    border: 1px solid #e2e8f0;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
  }
  .model-tree-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .model-tree-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #cbd5e1);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
  .model-tree-badge.verified {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.04);
  }
  .thinking-spec-tag {
    background: rgba(124, 92, 255, 0.1);
    color: #6d28d9;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 500;
  }

  /* ELO Filter Bar */
  .elo-filter-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--panel-hi, #f8fafc);
    border-bottom: 1px solid var(--line, #e2e8f0);
    flex-wrap: wrap;
  }
  .elo-filter-pill {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #cbd5e1);
    color: var(--ink-dim, #64748b);
    padding: 3px 10px;
    border-radius: 14px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .elo-filter-pill:hover {
    color: var(--ink, #0f172a);
    border-color: var(--ink-dim, #64748b);
  }
  .elo-filter-pill.active {
    background: #3b82f6;
    color: #ffffff;
    border-color: #2563eb;
    font-weight: 600;
  }


  /* 进化路由样式 (GOAL-053) */
  #view-routing {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
  }
  .routing-header {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .routing-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .routing-badge {
    font-weight: bold;
    font-size: 14px;
  }
  .routing-subtitle {
    font-size: 12px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .routing-stats-grid {
    display: flex;
    gap: 12px;
  }
  .routing-main-container {
    background: var(--panel, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    min-height: 380px;
  }
  .domain-matrix-grid {
    padding: 16px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
    overflow-y: auto;
  }
  .domain-card {
    background: var(--panel-hi, #f6f8fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .domain-card-title {
    font-weight: 600;
    font-size: 13px;
  }
  .domain-bars {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .weight-bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .weight-bar-row > span:first-child {
    width: 90px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
  .bar-bg {
    flex: 1;
    height: 8px;
    background: var(--line, #e3e8ee);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: #1a73e8;
    border-radius: 4px;
  }
  .velocity-header {
    background: var(--panel, #f7f9fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
  }
  .velocity-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .velocity-badge {
    font-weight: 700;
    font-size: 13px;
    color: #1a73e8;
  }
  .velocity-subtitle {
    font-size: 11px;
    color: var(--muted, #6a737d);
    flex: 1;
  }
  .velocity-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }
  .velocity-main-container {
    background: var(--bg, #ffffff);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 8px;
    overflow: hidden;
  }
  .velocity-chart-wrapper {
    padding: 16px;
    background: var(--bg, #ffffff);
  }
  .velocity-svg {
    display: block;
  }
  .velocity-matrix-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .milestone-badge-box {
    background: var(--panel, #f7f9fa);
    border: 1px solid var(--line, #e3e8ee);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text, #24292e);
  }
`;
}







