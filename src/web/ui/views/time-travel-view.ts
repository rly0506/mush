/**
 * GOAL-049: 时空状态树与因果时间旅行视图组件 (Time-Travel View)
 */

export function renderTimeTravelHtml(): string {
  return `
  <section id="view-timetravel" class="view" style="display:none">
    <div class="timetravel-header">
      <div class="timetravel-title-row">
        <span class="timetravel-badge">⏳ 时空状态树与因果时间旅行</span>
        <span class="timetravel-subtitle">轻量微快照、Git-like 因果演化树与秒级时空倒流</span>
        <button class="btn-micro-switch" id="btn-timetravel-refresh" type="button">🔄 刷新时空树</button>
      </div>
      <div class="timetravel-stats-grid">
        <div class="stat-card">
          <span class="stat-label">时空快照总数</span>
          <span class="stat-value" id="timetravel-stat-total-nodes">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">活跃分支数</span>
          <span class="stat-value" id="timetravel-stat-branches">1 (main)</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">当前时空锚点</span>
          <span class="stat-value" id="timetravel-stat-active-node" style="font-size:13px">最新 (HEAD)</span>
        </div>
      </div>
    </div>

    <!-- 时空状态树与节点快照双栏布局 -->
    <div class="timetravel-main-grid">
      <!-- 左栏：因果状态树节点列表 -->
      <div class="timetravel-column left-col">
        <div class="column-header">
          <span>🌿 因果分支状态树</span>
        </div>
        <div class="timeline-nodes-container" id="timeline-nodes-list">
          <div class="empty">暂无时空快照，派发任务前后或手动触发将自动生成微快照节点…</div>
        </div>
      </div>

      <!-- 右栏：选定节点文件快照与倒流操作 -->
      <div class="timetravel-column right-col">
        <div class="column-header">
          <span>📜 节点快照详情与时空倒流</span>
        </div>
        <div class="node-detail-container" id="timetravel-node-detail">
          <div class="empty">请从左侧选择一个时空节点查看快照文件并执行一键倒流…</div>
        </div>
      </div>
    </div>
  </section>
`;
}
