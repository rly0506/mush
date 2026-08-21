/**
 * GOAL-052: ELO 天梯战绩大屏视图组件 (ELO Leaderboard View)
 */

export function renderEloRankingsHtml(): string {
  return `
  <section id="view-elo" class="view" style="display:none">
    <div class="elo-header">
      <div class="elo-title-row">
        <span class="elo-badge">🏆 实战战绩与 ELO 天梯排位榜</span>
        <span class="elo-subtitle">跨 Harness 影子盲测、Pass@1 / 成本 / 延迟 / 安全 4 维动态天梯评级</span>
        <button class="btn-micro-switch" id="btn-elo-refresh" type="button">🔄 刷新天梯榜</button>
      </div>
      <div class="elo-stats-grid">
        <div class="stat-card">
          <span class="stat-label">👑 天梯榜首 (Top Dog)</span>
          <span class="stat-value" id="elo-stat-top-dog">-</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">⚔️ 累计对战局数</span>
          <span class="stat-value" id="elo-stat-total-matches">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">🎯 综合最高胜率</span>
          <span class="stat-value" id="elo-stat-highest-winrate">0%</span>
        </div>
      </div>
    </div>

    <!-- 天梯排行榜大屏 -->
    <div class="elo-main-container">
      <div class="column-header">
        <span>🏆 在册犬 ELO 天梯排位总榜</span>
      </div>
      <div class="elo-filter-bar" id="elo-harness-filters">
        <button type="button" class="elo-filter-pill active" data-harness="all">全部 (All)</button>
      </div>
      <div class="elo-table-wrapper">
        <table class="elo-table">
          <thead>
            <tr>
              <th style="width:50px">排名</th>
              <th>Harness 犬系</th>
              <th>Provider 渠道</th>
              <th>Model 变体</th>
              <th>段位</th>
              <th>ELO 积分</th>
              <th>战绩 (胜/平/负)</th>
              <th>胜率</th>
            </tr>
          </thead>
          <tbody id="elo-rankings-tbody">
            <tr>
              <td colspan="8" class="empty">暂无战绩数据，系统将在影子评测或实战中自动计算 ELO 积分…</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
`;
}

