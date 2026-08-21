/**
 * GOAL-048: 跨 Harness 技能联邦视图组件 (Skills Federation View)
 */

export function renderSkillsFederationHtml(): string {
  return `
  <section id="view-skills" class="view" style="display:none">
    <div class="skills-header">
      <div class="skills-title-row">
        <span class="skills-badge">🧰 跨 Harness 技能联邦大厅</span>
        <span class="skills-subtitle">统一 AST 抽象、Claude/AGY/Codex/DSH 双向转译与热挂载</span>
        <button class="btn-micro-switch" id="btn-skills-refresh" type="button">🔄 扫描刷新</button>
      </div>
      <div class="skills-stats-grid">
        <div class="stat-card">
          <span class="stat-label">已挂载目录</span>
          <span class="stat-value" id="skills-stat-mounted-dirs">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">联邦技能总数</span>
          <span class="stat-value" id="skills-stat-total-count">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">安全合规率</span>
          <span class="stat-value" id="skills-stat-safety-rate">100%</span>
        </div>
      </div>
    </div>

    <!-- 技能联邦双栏布局 -->
    <div class="skills-main-grid">
      <!-- 左栏：技能卡片流 -->
      <div class="skills-column left-col">
        <div class="column-header">
          <span>📦 发现的联邦技能</span>
        </div>
        <div class="skills-cards-container" id="skills-cards-list">
          <div class="empty">暂无挂载技能，请使用 POST /api/skills/mount 挂载本地技能目录…</div>
        </div>
      </div>

      <!-- 右栏：多 Harness 转译预览 -->
      <div class="skills-column right-col">
        <div class="column-header">
          <span>🔄 跨 Harness 转译预览</span>
          <div class="transpile-tabs" id="transpile-tabs">
            <button class="tab-btn active" data-harness="agy" type="button">AGY</button>
            <button class="tab-btn" data-harness="claude" type="button">Claude</button>
            <button class="tab-btn" data-harness="codex" type="button">Codex</button>
            <button class="tab-btn" data-harness="dsh" type="button">DSH</button>
          </div>
        </div>
        <div class="transpile-content-box">
          <pre class="code-preview" id="skill-transpile-preview">// 从左侧选择一个技能查看针对目标 Harness 的转译格式…</pre>
        </div>
      </div>
    </div>
  </section>
`;
}
