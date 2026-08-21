/**
 * GOAL-045: SOP 工序流水线工作台视图组件 (Pipeline Studio View)
 */

export function renderPipelineStudioHtml(): string {
  return `
  <section id="view-pipeline" class="view" style="display:none">
    <div class="pipeline-header">
      <div class="pipeline-title-row">
        <span class="pipeline-badge">⛓️ SOP 工序流水线</span>
        <span id="pipeline-task-title" class="pipeline-topic">从规格到交付的全自动工步接力</span>
        <span id="pipeline-status-tag" class="pipeline-status-tag active">RUNNING</span>
      </div>
      <div class="pipeline-meta-row">
        <span class="meta-item">当前阶段: <strong id="pipeline-current-stage-name">1. 需求与契约规格</strong></span>
        <span class="meta-item">预算消耗: <span id="pipeline-spent-budget">$0.00</span> / <span id="pipeline-max-budget">$2.50</span></span>
        <button class="btn-micro-switch" id="btn-pipeline-refresh" type="button">🔄 刷新流水</button>
      </div>
    </div>

    <!-- 横向 5 阶段进度指示条 -->
    <div class="pipeline-progress-track">
      <div class="progress-step active" data-step="0"><span class="step-num">1</span> 需求 (Spec)</div>
      <div class="step-arrow">➔</div>
      <div class="progress-step" data-step="1"><span class="step-num">2</span> 架构 (Arch)</div>
      <div class="step-arrow">➔</div>
      <div class="progress-step" data-step="2"><span class="step-num">3</span> 编码 (Code)</div>
      <div class="step-arrow">➔</div>
      <div class="progress-step" data-step="3"><span class="step-num">4</span> 测试 (Test)</div>
      <div class="step-arrow">➔</div>
      <div class="progress-step" data-step="4"><span class="step-num">5</span> 审计 (Audit)</div>
    </div>

    <!-- 5 阶段卡片横向网格 -->
    <div class="pipeline-stages-grid" id="pipeline-stages-container">
      <div class="pipeline-card active" id="stage-card-0">
        <div class="card-header">
          <span class="card-stage-title">1. 需求规格</span>
          <span class="card-status-badge running">RUNNING</span>
        </div>
        <div class="card-dog-row">
          <span class="dog-label">执飞犬:</span>
          <span class="badge dog-badge">kimi-code</span>
        </div>
        <div class="card-body">
          <div class="artifact-preview" id="stage-preview-0">等待需求规格提炼…</div>
        </div>
        <div class="card-footer">
          <button class="btn-view-artifact" data-stage="0">📄 查看工件</button>
        </div>
      </div>

      <div class="pipeline-card" id="stage-card-1">
        <div class="card-header">
          <span class="card-stage-title">2. 架构拓扑</span>
          <span class="card-status-badge pending">PENDING</span>
        </div>
        <div class="card-dog-row">
          <span class="dog-label">执飞犬:</span>
          <span class="badge dog-badge">claude-code</span>
        </div>
        <div class="card-body">
          <div class="artifact-preview" id="stage-preview-1">等待需求工件输入…</div>
        </div>
        <div class="card-footer">
          <span class="gate-hint">🔒 包含架构门禁</span>
        </div>
      </div>

      <div class="pipeline-card" id="stage-card-2">
        <div class="card-header">
          <span class="card-stage-title">3. 编码实现</span>
          <span class="card-status-badge pending">PENDING</span>
        </div>
        <div class="card-dog-row">
          <span class="dog-label">执飞犬:</span>
          <span class="badge dog-badge">agy</span>
        </div>
        <div class="card-body">
          <div class="artifact-preview" id="stage-preview-2">等待架构契约输入…</div>
        </div>
        <div class="card-footer">
          <span class="gate-hint">🔒 包含代码门禁</span>
        </div>
      </div>

      <div class="pipeline-card" id="stage-card-3">
        <div class="card-header">
          <span class="card-stage-title">4. 单元测试</span>
          <span class="card-status-badge pending">PENDING</span>
        </div>
        <div class="card-dog-row">
          <span class="dog-label">执飞犬:</span>
          <span class="badge dog-badge">deepseek-code</span>
        </div>
        <div class="card-body">
          <div class="artifact-preview" id="stage-preview-3">等待功能代码实现…</div>
        </div>
        <div class="card-footer">
          <span class="gate-hint">⚡ 破坏性用例</span>
        </div>
      </div>

      <div class="pipeline-card" id="stage-card-4">
        <div class="card-header">
          <span class="card-stage-title">5. 安全审计</span>
          <span class="card-status-badge pending">PENDING</span>
        </div>
        <div class="card-dog-row">
          <span class="dog-label">执飞犬:</span>
          <span class="badge dog-badge">zcode</span>
        </div>
        <div class="card-body">
          <div class="artifact-preview" id="stage-preview-4">等待测试报告汇入…</div>
        </div>
        <div class="card-footer">
          <span class="gate-hint">🛡️ 终审门禁</span>
        </div>
      </div>
    </div>

    <!-- 工件抽屉与门禁操作卡 -->
    <div class="pipeline-detail-panel" id="pipeline-detail-panel">
      <div class="panel-header">
        <h3 id="detail-stage-name">阶段工件详情与门禁审核</h3>
        <div id="detail-gate-actions" style="display:none">
          <button class="btn-approve-gate" id="btn-approve-gate">✅ 批准放行进入下一工步</button>
        </div>
      </div>
      <div class="panel-content">
        <pre class="artifact-content-box" id="artifact-content-box">点击上方任一工步卡片查看输入与输出工件详情…</pre>
      </div>
    </div>
  </section>
`;
}
