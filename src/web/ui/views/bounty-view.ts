/**
 * GOAL-047: Contract Net 悬赏大厅视图组件 (Bounty Market View)
 */

export function renderBountyMarketHtml(): string {
  return `
  <section id="view-bounties" class="view" style="display:none">
    <div class="bounty-header">
      <div class="bounty-title-row">
        <span class="bounty-badge">🏷️ Contract Net 悬赏大厅</span>
        <span class="bounty-subtitle">分布式任务挂牌、犬只自主竞标与多因子性价比撮合</span>
        <button class="btn-micro-switch" id="btn-bounty-refresh" type="button">🔄 刷新大厅</button>
      </div>
      <div class="bounty-stats-grid">
        <div class="stat-card">
          <span class="stat-label">开放悬赏标的</span>
          <span class="stat-value" id="bounty-stat-open">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">竞标与撮合中</span>
          <span class="stat-value" id="bounty-stat-bidding">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">累计成功授标</span>
          <span class="stat-value" id="bounty-stat-awarded">0</span>
        </div>
      </div>
    </div>

    <!-- 悬赏标的与出价看板两栏布局 -->
    <div class="bounty-main-grid">
      <!-- 左栏：公开悬赏任务卡片流 -->
      <div class="bounty-column left-col">
        <div class="column-header">
          <span>📋 挂牌悬赏标的列表</span>
        </div>
        <div class="bounty-cards-container" id="bounty-cards-list">
          <div class="empty">暂无挂牌悬赏任务，可通过 POST /api/bounties 发布新标的…</div>
        </div>
      </div>

      <!-- 右栏：选中标的竞标与授标看板 -->
      <div class="bounty-column right-col">
        <div class="column-header">
          <span>🎯 犬只自主竞标出价与撮合授标</span>
          <!-- GOAL-067（P2-14，F3）：恢复可见并接通真实撮合（collectAutomaticBids
               → awardBounty 最优标），此前永久隐藏且 handler 只刷新列表。 -->
          <button class="btn-action-sm" id="btn-auto-match-bid" type="button">⚡ 自动性价比撮合</button>
        </div>
        <div class="bids-detail-container" id="bounty-bids-detail">
          <div class="empty">请从左侧选择一个悬赏标的查看各犬竞标出价…</div>
        </div>
      </div>
    </div>
  </section>
`;
}
