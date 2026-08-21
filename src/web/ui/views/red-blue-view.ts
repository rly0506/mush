/**
 * GOAL-046: 红蓝对抗验证室视图组件 (Red-Blue Studio View)
 */

export function renderRedBlueStudioHtml(): string {
  return `
  <section id="view-redblue" class="view" style="display:none">
    <div class="redblue-header">
      <div class="redblue-title-row">
        <span class="redblue-badge">🛡️ 红蓝对抗验证室</span>
        <span id="redblue-task-title" class="redblue-topic">极端边界用例与破坏性攻防打回闭环</span>
        <span id="redblue-status-tag" class="redblue-status-tag active">IN_PROGRESS</span>
      </div>
      <div class="redblue-meta-row">
        <span class="meta-item">攻防轮次: <strong id="redblue-round-indicator">第 1 轮 (上限 3 轮)</strong></span>
        <span class="meta-item blue-tag">🛡️ 蓝方生成犬: <strong id="redblue-generator-dog">agy</strong></span>
        <span class="meta-item red-tag">⚔️ 红方验证犬: <strong id="redblue-verifier-dog">deepseek-code</strong></span>
        <button class="btn-micro-switch" id="btn-redblue-refresh" type="button">🔄 刷新攻防</button>
      </div>
    </div>

    <!-- 双色攻防视窗网格 -->
    <div class="redblue-columns-container">
      <!-- 左栏：蓝方实现代码 -->
      <div class="redblue-column blue-column">
        <div class="column-header">
          <span class="dot blue-dot"></span>
          <span>🛡️ 蓝方实现方案 (Generator)</span>
          <span class="col-dog-badge" id="blue-col-dog">agy</span>
        </div>
        <div class="column-content">
          <div class="code-box-header">
            <span id="blue-code-summary">初始实现方案代码</span>
          </div>
          <pre class="code-preview" id="blue-code-preview">// 等待蓝方生成业务实现代码…</pre>
        </div>
      </div>

      <!-- 右栏：红方破坏性用例与攻击报告 -->
      <div class="redblue-column red-column">
        <div class="column-header">
          <span class="dot red-dot"></span>
          <span>⚔️ 红方破坏性用例与爆破点 (Verifier)</span>
          <span class="col-dog-badge" id="red-col-dog">deepseek-code</span>
        </div>
        <div class="column-content">
          <div class="attack-cases-list" id="red-attack-cases-list">
            <div class="empty">等待红方注入破坏性测试用例（并发/边界/注入/内存）…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 攻防打回反馈与熔断控制卡 -->
    <div class="redblue-feedback-panel" id="redblue-feedback-panel">
      <div class="feedback-header">
        <h3 id="feedback-title">🔍 对抗测试断言与打回诊断报告</h3>
        <span class="gate-status-text" id="redblue-gate-status">等待对抗结果…</span>
      </div>
      <div class="feedback-content">
        <pre class="failure-trace-box" id="redblue-failure-trace">暂无破坏性测试失败堆栈。若发现 Bug，将自动打回蓝方修正重写。</pre>
      </div>
    </div>
  </section>
`;
}
