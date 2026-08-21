/**
 * GOAL-044: 圆桌辩论工作台组件 (Debate View)
 */

export function renderDebateArenaHtml(): string {
  return `
<section id="view-debate" class="view-panel view" style="display:none;">
  <div class="debate-header">

    <div class="debate-title-row">
      <div class="debate-badge"><span class="icon">⚔️</span> 圆桌对席辩论台</div>
      <div id="debate-topic-display" class="debate-topic">等待发起议题...</div>
      <div id="debate-status-tag" class="debate-status-tag">IDLE</div>
    </div>
    <div class="debate-dogs-row">
      <div class="pro-tag">🔵 正方立论: <strong id="pro-dog-name">claude-code</strong></div>
      <div class="vs-tag">VS</div>
      <div class="con-tag">🔴 反方质询: <strong id="con-dog-name">deepseek-chat</strong></div>
      <div class="round-indicator" id="debate-round-info">第 1 轮 · 独立立论</div>
    </div>
  </div>

  <!-- 双栏对立视窗 -->
  <div class="debate-columns-container">
    <!-- 左栏：正方立论与方案 -->
    <div class="debate-column pro-column">
      <div class="column-header">
        <span class="dot pro-dot"></span>
        <span class="col-title">正方方案与立论</span>
        <span class="col-dog-badge" id="pro-column-badge">claude-code</span>
      </div>
      <div class="column-content" id="pro-turns-container">
        <div class="empty-hint">等待正方立论输出...</div>
      </div>
    </div>

    <!-- 右栏：反方挑刺与质询 -->
    <div class="debate-column con-column">
      <div class="column-header">
        <span class="dot con-dot"></span>
        <span class="col-title">反方质询与反驳</span>
        <span class="col-dog-badge" id="con-column-badge">deepseek-chat</span>
      </div>
      <div class="column-content" id="con-turns-container">
        <div class="empty-hint">等待反方交叉质询...</div>
      </div>
    </div>
  </div>

  <!-- 底部共识提纯与终审仲裁卡 -->
  <div class="debate-arbitration-panel" id="debate-arbitration-panel">
    <div class="arbitration-grid">
      <!-- 共识清单 -->
      <div class="consensus-box">
        <div class="box-title">✅ 提纯达成共识（Consensus）</div>
        <ul id="debate-consensus-list" class="distill-list">
          <li>暂无提纯共识</li>
        </ul>
      </div>

      <!-- 核心争议分歧点 -->
      <div class="disputes-box">
        <div class="box-title">⚠️ 核心争鸣分歧点（Disputes）</div>
        <ul id="debate-disputes-list" class="distill-list">
          <li>暂无分歧点</li>
        </ul>
      </div>
    </div>

    <!-- 人类一键仲裁操作栏 -->
    <div class="arbitration-actions" id="arbitration-action-bar">
      <div class="arbitration-prompt">⚖️ 人类最终仲裁：</div>
      <button class="btn btn-pro" id="btn-arbitrate-pro">🔵 采纳正方方案</button>
      <button class="btn btn-con" id="btn-arbitrate-con">🔴 采纳反方方案</button>
      <button class="btn btn-merge" id="btn-arbitrate-merge">🟣 融合修正采纳</button>
    </div>
  </div>
</section>
`;
}
