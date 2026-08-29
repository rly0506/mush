/**
 * GOAL-054: Spotlight 极简雪橇桌面浮窗页面渲染 (Floating Sled Spotlight HTML)
 */

export function renderFloatingSledHtml(callerToken = ''): string {
  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="mush-caller-token" content="${callerToken}">
  <title>mush Spotlight Sled</title>
  <style>
    :root {
      --bg: #ffffff;
      --panel: #f6f8fa;
      --text: #24292e;
      --muted: #6a737d;
      --line: #e1e4e8;
      --primary: #1a73e8;
      --primary-hover: #1557b0;
      --focus-ring: rgba(26, 115, 232, 0.3);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1e1e1e;
        --panel: #252526;
        --text: #d4d4d4;
        --muted: #858585;
        --line: #333333;
        --primary: #0e639c;
        --primary-hover: #1177bb;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      padding: 12px;
      user-select: none;
    }
    .spotlight-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
    }
    .input-row {
      display: flex;
      align-items: center;
      background: var(--panel);
      border: 2px solid var(--primary);
      border-radius: 8px;
      padding: 8px 12px;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .sled-logo {
      font-size: 18px;
    }
    .spotlight-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      font-size: 14px;
      color: var(--text);
    }
    .mode-pills {
      display: flex;
      gap: 6px;
      overflow-x: auto;
    }
    .pill-btn {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 4px 10px;
      font-size: 11px;
      color: var(--muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .pill-btn.active, .pill-btn:hover {
      background: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }
    .code-preview-box {
      flex: 1;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      color: var(--text);
      resize: none;
      outline: none;
    }
    .action-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--muted);
    }
    .btn-send {
      background: var(--primary);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
    }
    .btn-send:hover {
      background: var(--primary-hover);
    }
  </style>
</head>
<body>
  <div class="spotlight-container">
    <div class="input-row">
      <span class="sled-logo">🛷</span>
      <input type="text" id="spotlight-input" class="spotlight-input" placeholder="输入指令或选中代码后按 Enter 派发雪橇队…" autofocus />
    </div>
    <div class="mode-pills">
      <button class="pill-btn active" data-mode="DEBATE" type="button">⚔️ Alt+1 辩论</button>
      <button class="pill-btn" data-mode="PIPELINE" type="button">⛓️ Alt+2 流水线</button>
      <button class="pill-btn" data-mode="REVIEW" type="button">🛡️ Alt+3 审查</button>
      <button class="pill-btn" data-mode="TEST" type="button">🧪 Alt+4 单测</button>
    </div>
    <textarea id="code-context" class="code-preview-box" placeholder="（可选）粘贴或从剪贴板捕获的代码片段…"></textarea>
    <div class="action-footer">
      <span>💡 Alt+Space 快速唤起 / Esc 隐藏</span>
      <button id="btn-dispatch" class="btn-send" type="button">速派 (Enter)</button>
    </div>
  </div>

  <script>
    let currentMode = 'DEBATE';
    const inputEl = document.getElementById('spotlight-input');
    const codeEl = document.getElementById('code-context');
    const btnSend = document.getElementById('btn-dispatch');
    const pillBtns = document.querySelectorAll('.pill-btn');
    const token = document.querySelector('meta[name="mush-caller-token"]')?.getAttribute('content') || '';

    pillBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        pillBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.getAttribute('data-mode') || 'DEBATE';
      });
    });

    async function doDispatch() {
      const prompt = inputEl.value.trim();
      if (!prompt) return;
      btnSend.disabled = true;
      btnSend.textContent = '派发中…';

      try {
        const headers = { 'content-type': 'application/json' };
        if (token) headers['x-mush-caller-auth'] = token;

        const res = await fetch('/api/companion/quick-action', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action_type: currentMode,
            prompt,
            selected_code: codeEl.value.trim() || undefined
          })
        });
        const data = await res.json();
        if (data.ok) {
          inputEl.value = '';
          codeEl.value = '';
          btnSend.textContent = '✅ 已派发';
          setTimeout(() => { btnSend.textContent = '速派 (Enter)'; btnSend.disabled = false; }, 1200);
        } else {
          alert(data.error || '派发失败');
          btnSend.textContent = '速派 (Enter)';
          btnSend.disabled = false;
        }
      } catch (err) {
        alert(err.message || '网络异常');
        btnSend.textContent = '速派 (Enter)';
        btnSend.disabled = false;
      }
    }

    btnSend.addEventListener('click', doDispatch);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doDispatch();
      }
    });
  </script>
</body>
</html>`;
}
