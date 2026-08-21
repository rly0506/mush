/**
 * GOAL-050: 跨犬共享黑板协作空间视图组件 (Blackboard View)
 */

export function renderBlackboardHtml(): string {
  return `
  <section id="view-blackboard" class="view" style="display:none">
    <div class="blackboard-header">
      <div class="blackboard-title-row">
        <span class="blackboard-badge">📋 跨犬共享黑板协作空间</span>
        <span class="blackboard-subtitle">4 分区结构化协作区、细粒度 ACL 读写仲裁与事件条件唤醒</span>
        <button class="btn-micro-switch" id="btn-blackboard-refresh" type="button">🔄 刷新黑板</button>
      </div>
      <div class="blackboard-stats-grid">
        <div class="stat-card">
          <span class="stat-label">📦 共享工件 (Artifacts)</span>
          <span class="stat-value" id="bb-stat-artifacts">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">🚨 攻坚疑难 (Issues)</span>
          <span class="stat-value" id="bb-stat-issues">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">💡 方案假设 (Hypotheses)</span>
          <span class="stat-value" id="bb-stat-hypotheses">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">⚖️ 权威决议 (Decisions)</span>
          <span class="stat-value" id="bb-stat-decisions">0</span>
        </div>
      </div>
    </div>

    <!-- 黑板 4 分区四象限网格布局 -->
    <div class="blackboard-quad-grid">
      <!-- 1. 工件区 -->
      <div class="blackboard-quadrant" data-section="artifacts">
        <div class="quadrant-header">
          <span>📦 共享工件区 (Artifacts)</span>
        </div>
        <div class="quadrant-items" id="bb-items-artifacts">
          <div class="empty">暂无工件发布…</div>
        </div>
      </div>

      <!-- 2. 疑难区 -->
      <div class="blackboard-quadrant" data-section="issues">
        <div class="quadrant-header">
          <span>🚨 攻坚疑难区 (Open Issues)</span>
        </div>
        <div class="quadrant-items" id="bb-items-issues">
          <div class="empty">暂无未解疑难…</div>
        </div>
      </div>

      <!-- 3. 假设区 -->
      <div class="blackboard-quadrant" data-section="hypotheses">
        <div class="quadrant-header">
          <span>💡 方案假设区 (Hypotheses)</span>
        </div>
        <div class="quadrant-items" id="bb-items-hypotheses">
          <div class="empty">暂无方案假设…</div>
        </div>
      </div>

      <!-- 4. 决议区 -->
      <div class="blackboard-quadrant" data-section="decisions">
        <div class="quadrant-header">
          <span>⚖️ 权威决议区 (Decisions)</span>
        </div>
        <div class="quadrant-items" id="bb-items-decisions">
          <div class="empty">暂无已定决议…</div>
        </div>
      </div>
    </div>
  </section>
`;
}
