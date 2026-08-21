/**
 * GOAL-051: 液态临时战时攻关小队视图组件 (Liquid Squads View)
 */

export function renderLiquidSquadsHtml(): string {
  return `
  <section id="view-squads" class="view" style="display:none">
    <div class="squads-header">
      <div class="squads-title-row">
        <span class="squads-badge">🐺 液态临时战时攻关小队</span>
        <span class="squads-subtitle">多维能力感知自适应选举指挥犬、敏捷集结与战后自解散</span>
        <button class="btn-micro-switch" id="btn-squads-refresh" type="button">🔄 刷新小队</button>
      </div>
      <div class="squads-stats-grid">
        <div class="stat-card">
          <span class="stat-label">⚔️ 活跃攻坚小队</span>
          <span class="stat-value" id="squads-stat-active">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">🏁 已完成归档</span>
          <span class="stat-value" id="squads-stat-disbanded">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">👑 指挥犬自适应匹配率</span>
          <span class="stat-value" id="squads-stat-lead-rate">100%</span>
        </div>
      </div>
    </div>

    <!-- 小队卡片流容器 -->
    <div class="squads-main-container">
      <div class="column-header">
        <span>🐺 攻坚小队战况与编制看板</span>
      </div>
      <div class="squads-list" id="squads-list-container">
        <div class="empty">暂无活跃液态小队，可通过 POST /api/squads 动态集结…</div>
      </div>
    </div>
  </section>
`;
}
