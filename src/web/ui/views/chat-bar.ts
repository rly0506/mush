/**
 * GOAL-043: 聊天底栏协作模式切换组件 (Chat Bar Mode Capsules)
 */

export function renderCollaborationModeCapsulesHtml(): string {
  return `
<div class="collab-mode-bar" id="collab-mode-bar">
  <div class="mode-capsules">
    <button class="mode-capsule active" data-mode="free" id="mode-cap-free">
      <span class="cap-icon">💬</span>
      <span class="cap-label">自由对话</span>
    </button>
    <button class="mode-capsule" data-mode="debate" id="mode-cap-debate">
      <span class="cap-icon">⚔️</span>
      <span class="cap-label">圆桌辩论</span>
    </button>
    <button class="mode-capsule" data-mode="pipeline" id="mode-cap-pipeline">
      <span class="cap-icon">⛓️</span>
      <span class="cap-label">SOP 流水</span>
    </button>
    <button class="mode-capsule" data-mode="verify" id="mode-cap-verify">
      <span class="cap-icon">🛡️</span>
      <span class="cap-label">红蓝对抗</span>
    </button>
  </div>

  <div class="collab-pair-indicator" id="collab-pair-indicator" style="display:none;position:relative;">
    <span class="pair-label">推荐阵容:</span>
    <span class="badge primary-dog" id="indicator-primary-dog" style="cursor:pointer" title="点击调配主执行犬">claude-code</span>
    <span class="vs">vs</span>
    <span class="badge opposing-dog" id="indicator-opposing-dog" style="cursor:pointer" title="点击调配对席/审查犬">deepseek-chat</span>
    <button class="btn-micro-switch" id="btn-switch-pair" title="切换对席与审查阵容">🔄 调配</button>

    <div class="collab-pair-selector-pop" id="collab-pair-selector-pop" style="display:none;position:absolute;bottom:36px;right:0;background:var(--panel-hi, #f6f8fa);border:1.5px solid var(--line, #e3e8ee);border-radius:8px;padding:12px 14px;box-shadow:0 6px 20px rgba(0,0,0,0.18);z-index:99;font-size:12px;min-width:280px;">
      <div style="font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;color:var(--ink);">
        <span>🐕 协作阵容自由调配</span>
        <button type="button" id="btn-close-pair-pop" style="background:none;border:none;cursor:pointer;color:var(--ink-dim);font-size:13px;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label style="display:block;color:var(--ink-dim);margin-bottom:4px;font-size:11px;">🔵 正方/主犬</label>
          <select id="select-primary-dog" style="width:100%;padding:4px;font-size:12px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--ink);"></select>
        </div>
        <div>
          <label style="display:block;color:var(--ink-dim);margin-bottom:4px;font-size:11px;">🔴 反方/审查犬</label>
          <select id="select-opposing-dog" style="width:100%;padding:4px;font-size:12px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--ink);"></select>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <button type="button" id="btn-swap-pair" class="act cancel" style="padding:3px 8px;font-size:11px;background:var(--panel);border:1px solid var(--line);color:var(--ink);">⇄ 对调</button>
        <button type="button" id="btn-apply-pair" class="act approve" style="padding:4px 14px;font-size:11px;background:var(--accent, #0e9f8f);color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">确认调配</button>
      </div>
    </div>
  </div>
</div>

`;
}
