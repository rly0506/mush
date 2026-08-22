/**
 * GOAL-055: 多犬协作全景战报与研发能效大屏视图组件 (Velocity Matrix View)
 */

export function renderVelocityMatrixHtml(): string {
  return `
  <section id="view-velocity" class="view" style="display:none">
    <div class="velocity-header">
      <div class="velocity-title-row">
        <span class="velocity-badge">📈 多犬协作全景战报与研发能效大屏</span>
        <span class="velocity-subtitle">DORA & SPACE 研发度量模型、吞吐走势图与一键生成全景战报</span>
        <!-- GOAL-067（P2-14，F3 裁决）：本视图指标为 D65 收官基线的基准推演值，
             非实时实测——按证据纪律明示角标，防误读为实测度量。 -->
        <span class="badge" style="background:rgba(217,119,6,0.12);color:#b45309;font-size:11px;padding:2px 8px;border-radius:10px" title="指标为 RM-001~RM-007 收官基线的推演参考值，非当前实时遥测">⚠ 基准推演参考</span>
        <button class="btn-micro-switch" id="btn-export-sled-report" type="button">📥 导出全景战报 (Markdown)</button>
      </div>
      <div class="velocity-stats-grid">
        <div class="stat-card">
          <span class="stat-label">🎯 全量 Goals 达成</span>
          <span class="stat-value" id="velocity-stat-goals" style="color:var(--ok, #28a745)">55 / 55 (100%)</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">⏱️ 平均响应耗时</span>
          <span class="stat-value" id="velocity-stat-lead-time">1.85s</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">🛡️ Verifier 缺陷拦截率</span>
          <span class="stat-value" id="velocity-stat-intercept">96.5%</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">💰 研发 ROI 能效比</span>
          <span class="stat-value" id="velocity-stat-roi">23,600 行+用例 / $1</span>
        </div>
      </div>
    </div>

    <!-- 效能走势大屏图表与路线图收官矩阵 -->
    <div class="velocity-main-container">
      <div class="column-header">
        <span>📊 团队吞吐量与多犬协作交付走势 (Pure Inline SVG)</span>
      </div>
      <div class="velocity-chart-wrapper">
        <svg class="velocity-svg" viewBox="0 0 700 160" width="100%" height="160">
          <defs>
            <linearGradient id="grad-velocity" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1a73e8" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#1a73e8" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <path d="M 20 140 Q 150 120 280 80 T 520 40 T 680 20 L 680 150 L 20 150 Z" fill="url(#grad-velocity)" />
          <path d="M 20 140 Q 150 120 280 80 T 520 40 T 680 20" fill="none" stroke="#1a73e8" stroke-width="3" />
          <circle cx="20" cy="140" r="4" fill="#1a73e8" />
          <circle cx="280" cy="80" r="4" fill="#1a73e8" />
          <circle cx="520" cy="40" r="4" fill="#1a73e8" />
          <circle cx="680" cy="20" r="5" fill="#28a745" />
          <text x="30" y="130" font-size="11" fill="var(--muted, #6a737d)">RM-001 (犬队基建)</text>
          <text x="250" y="70" font-size="11" fill="var(--muted, #6a737d)">RM-004 (实战流式)</text>
          <text x="480" y="30" font-size="11" fill="var(--muted, #6a737d)">RM-006 (技能联邦)</text>
          <text x="590" y="15" font-size="11" font-weight="bold" fill="var(--ok, #28a745)">RM-007 (收官)</text>
        </svg>
      </div>

      <div class="column-header" style="border-top:1px solid var(--line, #e3e8ee)">
        <span>🗺️ mush 全部 7 大路线图全量收官矩阵</span>
      </div>
      <div class="velocity-matrix-grid">
        <div class="milestone-badge-box">✅ RM-001 犬队基建与机检验收 (G01~G12)</div>
        <div class="milestone-badge-box">✅ RM-002 看板与工作流治理 (G13~G23)</div>
        <div class="milestone-badge-box">✅ RM-003 会话流式与零成本梯队 (G24~G27)</div>
        <div class="milestone-badge-box">✅ RM-004 多拓扑与实战闭环 (G28~G34)</div>
        <div class="milestone-badge-box">✅ Phase C 视觉审查与记忆图谱 (G35~G42)</div>
        <div class="milestone-badge-box">✅ RM-005 社会化 Agent 合作框架 (G43~G47)</div>
        <div class="milestone-badge-box">✅ RM-006 技能联邦与时空状态内核 (G48~G51)</div>
        <div class="milestone-badge-box">✅ RM-007 自演进评测天梯与雪橇伴侣 (G52~G55)</div>
      </div>
    </div>
  </section>
`;
}
