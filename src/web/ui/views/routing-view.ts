/**
 * GOAL-053: 自进化智能路由矩阵视图组件 (Self-Evolving Routing View)
 */

export function renderSelfEvolvingRoutingHtml(): string {
  return `
  <section id="view-routing" class="view" style="display:none">
    <div class="routing-header">
      <div class="routing-title-row">
        <span class="routing-badge">🧠 自进化智能路由优化器</span>
        <span class="routing-subtitle">实战人类审批与测试反馈闭环打标、在线梯度自适应权重调优与帕累托预算求解</span>
        <button class="btn-micro-switch" id="btn-routing-refresh" type="button">🔄 刷新权重矩阵</button>
      </div>
      <div class="routing-stats-grid">
        <div class="stat-card">
          <span class="stat-label">📚 实战学习样本数</span>
          <span class="stat-value" id="routing-stat-feedback-count">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">👑 综合主推犬</span>
          <span class="stat-value" id="routing-stat-top-dog">agy</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">⚡ 自适应收敛状态</span>
          <span class="stat-value" id="routing-stat-status" style="color:var(--ok, #28a745)">已收敛 (Online)</span>
        </div>
      </div>
    </div>

    <!-- 领域自适应权重矩阵大屏 -->
    <div class="routing-main-container">
      <div class="column-header">
        <span>📊 各工程领域在册犬动态置信度分布</span>
      </div>
      <div class="domain-matrix-grid" id="domain-matrix-container">
        <div class="domain-card">
          <div class="domain-card-title">🔧 代码重构 (Refactoring)</div>
          <div class="domain-bars">
            <div class="weight-bar-row"><span>agy</span><div class="bar-bg"><div class="bar-fill" style="width:40%"></div></div><span>40%</span></div>
            <div class="weight-bar-row"><span>claude-code</span><div class="bar-bg"><div class="bar-fill" style="width:30%"></div></div><span>30%</span></div>
            <div class="weight-bar-row"><span>deepseek-code</span><div class="bar-bg"><div class="bar-fill" style="width:20%"></div></div><span>20%</span></div>
          </div>
        </div>
        <div class="domain-card">
          <div class="domain-card-title">🛡️ 安全审计 (Audit & Verification)</div>
          <div class="domain-bars">
            <div class="weight-bar-row"><span>zcode</span><div class="bar-bg"><div class="bar-fill" style="width:45%"></div></div><span>45%</span></div>
            <div class="weight-bar-row"><span>deepseek-code</span><div class="bar-bg"><div class="bar-fill" style="width:25%"></div></div><span>25%</span></div>
            <div class="weight-bar-row"><span>agy</span><div class="bar-bg"><div class="bar-fill" style="width:20%"></div></div><span>20%</span></div>
          </div>
        </div>
        <div class="domain-card">
          <div class="domain-card-title">✨ 新功能实现 (Feature Engineering)</div>
          <div class="domain-bars">
            <div class="weight-bar-row"><span>agy</span><div class="bar-bg"><div class="bar-fill" style="width:35%"></div></div><span>35%</span></div>
            <div class="weight-bar-row"><span>claude-code</span><div class="bar-bg"><div class="bar-fill" style="width:35%"></div></div><span>35%</span></div>
            <div class="weight-bar-row"><span>deepseek-code</span><div class="bar-bg"><div class="bar-fill" style="width:20%"></div></div><span>20%</span></div>
          </div>
        </div>
        <div class="domain-card">
          <div class="domain-card-title">🐞 疑难调试 (Deep Debugging)</div>
          <div class="domain-bars">
            <div class="weight-bar-row"><span>deepseek-code</span><div class="bar-bg"><div class="bar-fill" style="width:40%"></div></div><span>40%</span></div>
            <div class="weight-bar-row"><span>zcode</span><div class="bar-bg"><div class="bar-fill" style="width:30%"></div></div><span>30%</span></div>
            <div class="weight-bar-row"><span>agy</span><div class="bar-bg"><div class="bar-fill" style="width:20%"></div></div><span>20%</span></div>
          </div>
        </div>
      </div>
    </div>
  </section>
`;
}
