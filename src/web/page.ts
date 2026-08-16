/**
 * mush Web 看板（GOAL-005 U3 + GOAL-007）— 单页静态 HTML。
 * 无框架、无构建、无 CDN 外链；视图：调度（派发+workspace+跟踪）/ 犬队状态 /
 * epoch 事件链 / 预算消耗（GET /api/budget 真实数据）/ 审批弹窗。
 * 契约：src/web/api-contract.md v1。密钥红线：永不渲染凭据材料。
 */

export function renderBoardPage(): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mush 看板</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; background: #101418; color: #d7dde3; }
  header { padding: 12px 20px; border-bottom: 1px solid #2a3138; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; letter-spacing: 1px; }
  header .meta { font-size: 12px; color: #7c8791; }
  #workspace-current { font-size: 12px; color: #e3b341; border: 1px solid #e3b341; border-radius: 10px; padding: 1px 10px; }
  nav { display: flex; gap: 4px; padding: 8px 20px 0; }
  nav button { background: #1a2027; color: #aeb8c2; border: 1px solid #2a3138; border-bottom: none; padding: 8px 16px; cursor: pointer; font-size: 13px; border-radius: 6px 6px 0 0; }
  nav button.active { background: #101418; color: #ffffff; border-color: #4a5560; }
  main { padding: 16px 20px; border-top: 1px solid #2a3138; }
  section.view { display: none; }
  section.view.active { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #232a31; vertical-align: top; }
  th { color: #7c8791; font-weight: 600; }
  code, .mono { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
  .hash { color: #6fb3d8; word-break: break-all; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; border: 1px solid; }
  .badge.WAITING { color: #e3b341; border-color: #e3b341; }
  .badge.APPROVED { color: #56d364; border-color: #56d364; }
  .badge.REJECTED { color: #f85149; border-color: #f85149; }
  .badge.ADMITTED { color: #6fb3d8; border-color: #6fb3d8; }
  .badge.DRY_RUN { color: #56d364; border-color: #56d364; }
  .badge.PASS { color: #56d364; border-color: #56d364; }
  .badge.RUNNING { color: #6fb3d8; border-color: #6fb3d8; }
  .badge.RUNNING::before { content: '●'; display: inline-block; margin-right: 4px; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  .elapsed { font-size: 11px; color: #7c8791; margin-left: 6px; }
  .badge.BLOCKED_WAITING_OWNER, .badge.BLOCKED_ENV { color: #e3b341; border-color: #e3b341; }
  .badge.FAIL { color: #f85149; border-color: #f85149; }
  .badge.ok { color: #56d364; border-color: #56d364; }
  .badge.broken { color: #f85149; border-color: #f85149; }
  .card { background: #161b21; border: 1px solid #2a3138; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card h3 { margin: 0 0 8px; font-size: 13px; color: #9aa6b0; }
  .empty { color: #5c6670; font-size: 13px; padding: 24px 0; text-align: center; }
  #sse-status { font-size: 11px; }
  #sse-status.live { color: #56d364; }
  #sse-status.down { color: #f85149; }
  form#dispatch-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
  form#dispatch-form label { font-size: 12px; color: #7c8791; display: block; margin-bottom: 4px; }
  form#dispatch-form .full { grid-column: 1 / -1; }
  select, input[type=number], textarea { width: 100%; background: #0c1014; color: #d7dde3; border: 1px solid #2a3138; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
  textarea { min-height: 90px; resize: vertical; }
  .hint { font-size: 11px; color: #5c6670; margin-top: 4px; }
  #real-hint { color: #e3b341; display: none; }
  button.primary { background: #1d3323; color: #56d364; border: 1px solid #56d364; border-radius: 6px; padding: 9px 22px; font-size: 13px; cursor: pointer; }
  .dispatch-card { background: #161b21; border: 1px solid #2a3138; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; font-size: 13px; cursor: pointer; }
  .dispatch-card:hover { border-color: #4a5560; }
  .dispatch-card .detail { display: none; margin-top: 8px; border-top: 1px solid #232a31; padding-top: 8px; }
  .dispatch-card.open .detail { display: block; }
  dialog { background: #161b21; color: #d7dde3; border: 1px solid #4a5560; border-radius: 8px; padding: 20px; max-width: 560px; width: 90%; }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  dialog h2 { font-size: 15px; margin: 0 0 12px; }
  dialog dl { font-size: 13px; }
  dialog dt { color: #7c8791; margin-top: 8px; }
  dialog dd { margin: 2px 0 0; word-break: break-all; }
  dialog .actions { margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end; }
  button.act { padding: 8px 18px; border-radius: 6px; border: 1px solid; cursor: pointer; font-size: 13px; background: transparent; }
  button.act.approve { color: #56d364; border-color: #56d364; }
  button.act.reject { color: #f85149; border-color: #f85149; }
  button.act.cancel { color: #aeb8c2; border-color: #4a5560; }
  #toast { position: fixed; bottom: 16px; right: 16px; padding: 10px 16px; border-radius: 6px; font-size: 13px; display: none; }
  #toast.ok { display: block; background: #1d3323; color: #56d364; border: 1px solid #56d364; }
  #toast.err { display: block; background: #3d1d1d; color: #f85149; border: 1px solid #f85149; }
  .bar { height: 8px; background: #232a31; border-radius: 4px; overflow: hidden; min-width: 120px; }
  .bar > div { height: 100%; background: #56d364; }
  .bar.hot > div { background: #f85149; }
</style>
</head>
<body>
<header>
  <h1>mush 看板</h1>
  <span id="workspace-current" title="当前 workspace">…</span>
  <span class="meta" id="generated"></span>
  <span class="meta" id="sse-status">SSE 连接中…</span>
</header>
<nav>
  <button data-view="dispatch" class="active">调度</button>
  <button data-view="dogs">犬队状态</button>
  <button data-view="epochs">事件链</button>
  <button data-view="budget">预算消耗</button>
  <button data-view="approvals">审批 <span id="waiting-count"></span></button>
</nav>
<main>
  <section id="view-dispatch" class="view active">
    <div class="card">
      <h3>派发任务</h3>
      <form id="dispatch-form">
        <div>
          <label for="dispatch-adapter">犬只（在册，身份证明）</label>
          <select id="dispatch-adapter"></select>
        </div>
        <div id="dispatch-model-wrap" style="display:none">
          <label for="dispatch-model">模型变体</label>
          <select id="dispatch-model"></select>
          <div class="hint">变体 = 身份期望（合同声明），非实时能力清单。</div>
        </div>
        <div>
          <label for="workspace-select">workspace</label>
          <select id="workspace-select"></select>
        </div>
        <div class="full">
          <label for="dispatch-prompt">任务</label>
          <textarea id="dispatch-prompt" maxlength="64000" placeholder="写给犬的任务…"></textarea>
        </div>
        <div>
          <label for="dispatch-effort">effort 档位（D20）</label>
          <select id="dispatch-effort">
            <option>LOW</option>
            <option>HIGH</option>
            <option>XHIGH</option>
          </select>
        </div>
        <div>
          <label for="dispatch-cap">cap_usd（per-actor 上限）</label>
          <input type="number" id="dispatch-cap" min="0.01" step="0.01" value="5">
        </div>
        <div>
          <label><input type="checkbox" id="dispatch-real"> real（真实执行，花钱）</label>
          <div class="hint" id="real-hint">real 模式需 approval 在案（D6），否则 BLOCKED_WAITING_OWNER。</div>
        </div>
        <div style="align-self:end"><button type="submit" class="primary" id="btn-dispatch">派发</button></div>
      </form>
      <div class="hint" id="dispatch-result"></div>
    </div>
    <h3 style="font-size:13px;color:#9aa6b0">派发跟踪</h3>
    <div id="dispatch-list"><div class="empty">暂无派发记录</div></div>
  </section>
  <section id="view-dogs" class="view"></section>
  <section id="view-epochs" class="view"></section>
  <section id="view-budget" class="view"></section>
  <section id="view-approvals" class="view"></section>
</main>
<dialog id="approval-dialog">
  <h2>审批请求</h2>
  <dl id="approval-detail"></dl>
  <div class="actions">
    <button class="act cancel" id="btn-cancel">取消</button>
    <button class="act reject" id="btn-reject">否决</button>
    <button class="act approve" id="btn-approve">批准</button>
  </div>
</dialog>
<div id="toast"></div>
<script>
(function () {
  'use strict';
  var snapshot = null;
  var budget = null;
  var workspaces = [];
  var currentApproval = null;
  var trackedDispatches = [];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function shortHash(hash) { return hash ? esc(hash.slice(0, 12)) + '…' : '—'; }
  function toast(message, ok) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.className = ok ? 'ok' : 'err';
    el.style.display = 'block';
    setTimeout(function () { el.className = ''; el.style.display = 'none'; }, 4000);
  }
  function getJson(url) {
    return fetch(url).then(function (res) { return res.json(); });
  }
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, body: data }; });
    });
  }

  /* ---------- 犬只下拉（G009 修复：取 roster 注册名册；无活动时也应有犬可选） ---------- */
  function renderAdapterOptions() {
    var select = document.getElementById('dispatch-adapter');
    var roster = (snapshot && snapshot.roster) || [];
    if (roster.length > 0) {
      select.innerHTML = roster.map(function (r) {
        var badge = esc(r.expected_provider) + ' / ' + esc(r.expected_model_id);
        return '<option value="' + esc(r.adapter_id) + '" data-variants="' + esc((r.variants || []).join(',')) + '">' + esc(r.adapter_id) + '（' + badge + '）</option>';
      }).join('');
      renderModelOptions();
      return;
    }
    var actors = (snapshot && snapshot.actors) || [];
    if (actors.length === 0) {
      select.innerHTML = '<option value="">（无在册犬只）</option>';
      return;
    }
    select.innerHTML = actors.map(function (a) {
      var badge = esc(a.provider) + ' / ' + esc(a.model_id);
      return '<option value="' + esc(a.actor_instance_id) + '">' + esc(a.actor_instance_id) + '（' + badge + '）</option>';
    }).join('');
  }

  /* ---------- G009：模型变体下拉（合同 variants；无变体通道隐藏） ---------- */
  function renderModelOptions() {
    var wrap = document.getElementById('dispatch-model-wrap');
    var select = document.getElementById('dispatch-model');
    var adapterSelect = document.getElementById('dispatch-adapter');
    var opt = adapterSelect && adapterSelect.options[adapterSelect.selectedIndex];
    var variants = (opt && opt.getAttribute('data-variants') || '').split(',').filter(Boolean);
    if (variants.length === 0) { wrap.style.display = 'none'; select.innerHTML = ''; return; }
    wrap.style.display = '';
    select.innerHTML = variants.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }

  /* ---------- workspace 选择器（G7B-D1：歧义空项改为明确文案；selected 联动 header） ---------- */
  function renderWorkspaces() {
    var select = document.getElementById('workspace-select');
    if (workspaces.length === 0) {
      select.innerHTML = '<option value="">（未选择，默认服务目录）</option>';
      return;
    }
    var hasSelected = workspaces.some(function (w) { return w.selected; });
    select.innerHTML = workspaces.map(function (w) {
      var tags = [];
      if (w.is_git) tags.push('git');
      if (w.mush_managed) tags.push('mush');
      if (w.selected) tags.push('当前');
      return '<option value="' + esc(w.path) + '"' + (w.selected ? ' selected' : '') + '>' +
        esc(w.path) + (tags.length ? ' [' + tags.join(', ') + ']' : '') + '</option>';
    }).join('');
    if (!hasSelected) {
      select.insertAdjacentHTML('afterbegin', '<option value="" selected>（未选择，默认服务目录）</option>');
    }
    var current = workspaces.filter(function (w) { return w.selected; })[0];
    document.getElementById('workspace-current').textContent = current ? current.path : 'workspace: 服务 cwd';
  }

  /* ---------- 派发提交 ---------- */
  function submitDispatch(event) {
    event.preventDefault();
    var adapterId = document.getElementById('dispatch-adapter').value;
    var prompt = document.getElementById('dispatch-prompt').value.trim();
    var effort = document.getElementById('dispatch-effort').value;
    var capUsd = Number(document.getElementById('dispatch-cap').value);
    var real = document.getElementById('dispatch-real').checked;
    var workspace = document.getElementById('workspace-select').value;
    if (!adapterId) { toast('请选择犬只', false); return; }
    if (!prompt) { toast('任务不能为空', false); return; }
    var body = { adapter_id: adapterId, prompt: prompt, effort: effort, cap_usd: capUsd, real: real };
    if (workspace) body.workspace = workspace;
    var modelSel = document.getElementById('dispatch-model');
    if (modelSel && modelSel.value) body.model_id = modelSel.value;
    postJson('/api/dispatch', body).then(function (result) {
      var data = result.body;
      if (result.status === 202 && data.ok) {
        // G7B-D2：响应到达即有 dispatch_id，卡片即时可见；生命周期靠 SSE upsert 刷新。
        trackDispatch(data.dispatch_id, adapterId, data.status);
        toast('派发已受理：' + data.status + ' ' + (data.dispatch_id || ''), true);
        document.getElementById('dispatch-result').textContent =
          'dispatch_id=' + data.dispatch_id + ' status=' + data.status;
        refresh();
      } else if (result.status === 402) {
        toast('超预算门（DENIED）：' + (data.error || ''), false);
      } else {
        toast('派发失败：' + (data.error || result.status), false);
      }
    }).catch(function (error) { toast('派发失败：' + error, false); });
  }

  /* ---------- 派发跟踪卡片（G7B-D2：upsert 更新 + 已耗时计时 + 完成 toast） ---------- */
  var TERMINAL_STATUSES = { DRY_RUN: 1, PASS: 1, FAIL: 1, BLOCKED_WAITING_OWNER: 1, BLOCKED_ENV: 1 };

  function trackDispatch(dispatchId, adapterId, status) {
    if (!dispatchId) return;
    var existing = null;
    for (var i = 0; i < trackedDispatches.length; i += 1) {
      if (trackedDispatches[i].dispatch_id === dispatchId) { existing = trackedDispatches[i]; break; }
    }
    if (existing !== null) {
      // upsert：SSE 后续帧（EXECUTE/REPORT/PASS）必须刷新既有卡片。
      var wasTerminal = TERMINAL_STATUSES[existing.status] === 1;
      existing.status = status;
      existing.at_utc = new Date().toISOString();
      renderDispatches();
      if (!wasTerminal && TERMINAL_STATUSES[status] === 1) {
        toast('完成：' + status + '（' + adapterId + '）', status === 'PASS' || status === 'DRY_RUN');
      }
      return;
    }
    trackedDispatches.unshift({
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      status: status,
      at_utc: new Date().toISOString(),
      started_ms: Date.now(),
    });
    trackedDispatches = trackedDispatches.slice(0, 20);
    renderDispatches();
  }

  function elapsedText(d) {
    if (!d.started_ms) return '';
    var seconds = Math.max(0, Math.round((Date.now() - d.started_ms) / 1000));
    return seconds + 's';
  }

  function renderDispatches() {
    var el = document.getElementById('dispatch-list');
    var fromSnapshot = (snapshot && snapshot.dispatches) || [];
    var known = {};
    fromSnapshot.forEach(function (d) { known[d.dispatch_id] = d; });
    trackedDispatches.forEach(function (d) { if (!known[d.dispatch_id]) known[d.dispatch_id] = d; });
    var list = Object.keys(known).map(function (id) { return known[id]; });
    if (list.length === 0) { el.innerHTML = '<div class="empty">暂无派发记录</div>'; return; }
    el.innerHTML = list.map(function (d) {
      var elapsed = elapsedText(d);
      return '<div class="dispatch-card" data-dispatch="' + esc(d.dispatch_id) + '">' +
        '<span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span> ' +
        '<span class="mono">' + esc(String(d.dispatch_id).slice(0, 12)) + '…</span> ' +
        esc(d.adapter_id || '') + ' <span class="meta">' + esc(d.at_utc || '') + '</span>' +
        (elapsed ? '<span class="elapsed">' + elapsed + '</span>' : '') +
        '<div class="detail">加载中…</div></div>';
    }).join('');
    el.querySelectorAll('.dispatch-card').forEach(function (card) {
      card.addEventListener('click', function () { toggleDispatchDetail(card); });
    });
  }

  function toggleDispatchDetail(card) {
    var detail = card.querySelector('.detail');
    if (card.classList.contains('open')) { card.classList.remove('open'); return; }
    card.classList.add('open');
    var dispatchId = card.getAttribute('data-dispatch');
    getJson('/api/dispatch/' + encodeURIComponent(dispatchId)).then(function (data) {
      if (!data.ok || !data.dispatch) { detail.innerHTML = '<span class="hash">' + esc(data.error || '无详情') + '</span>'; return; }
      var d = data.dispatch;
      var events = (d.events || []).map(function (ev) {
        return '<tr><td>' + esc(ev.phase || ev.kind || '') + '</td><td>' + esc(ev.status || '') + '</td><td class="mono">' + esc(ev.at_utc || '') + '</td></tr>';
      }).join('');
      var stdoutBlock = '';
      if (d.stdout_tail && d.stdout_tail.text) {
        stdoutBlock = '<dt style="color:#7c8791">任务输出（末段' + (d.stdout_tail.truncated ? '，已截断' : '') + '）</dt>' +
          '<dd><pre class="mono" style="white-space:pre-wrap;max-height:200px;overflow:auto;margin:4px 0">' + esc(d.stdout_tail.text) + '</pre></dd>';
      }
      if (d.stderr_tail && d.stderr_tail.text) {
        stdoutBlock += '<dt style="color:#7c8791">stderr（末段' + (d.stderr_tail.truncated ? '，已截断' : '') + '）</dt>' +
          '<dd><pre class="mono" style="white-space:pre-wrap;max-height:120px;overflow:auto;margin:4px 0">' + esc(d.stderr_tail.text) + '</pre></dd>';
      }
      detail.innerHTML = '<dl style="margin:0">' +
        '<dt style="color:#7c8791">状态</dt><dd><span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span></dd>' +
        '<dt style="color:#7c8791">回执锚点</dt><dd class="mono hash">' + esc(d.receipt_path || '（未落盘）') + '</dd>' +
        stdoutBlock + '</dl>' +
        (events ? '<table><tbody>' + events + '</tbody></table>' : '');
    }).catch(function (error) { detail.textContent = '加载失败：' + error; });
  }

  /* ---------- 犬队状态（G009：活动为空时回退 roster 名册；G7B-D3：roster 行聚合最近派发） ---------- */
  function renderDogs() {
    var el = document.getElementById('view-dogs');
    var actors = snapshot.actors;
    var dispatches = snapshot.dispatches || [];
    function dispatchStats(adapterId) {
      var count = 0;
      var latest = null;
      for (var i = 0; i < dispatches.length; i += 1) {
        if (dispatches[i].adapter_id !== adapterId) continue;
        count += 1;
        if (latest === null || String(dispatches[i].at_utc || '') > String(latest.at_utc || '')) latest = dispatches[i];
      }
      return { count: count, latest: latest };
    }
    if (actors.length === 0) {
      var roster = snapshot.roster || [];
      if (roster.length === 0) { el.innerHTML = '<div class="empty">暂无在册犬只</div>'; return; }
      var rr = roster.map(function (r) {
        var stats = dispatchStats(r.adapter_id);
        var activity = stats.count === 0
          ? '（未活动，注册在册）'
          : stats.count + ' 次 · <span class="badge ' + esc(stats.latest.status) + '">' + esc(stats.latest.status) + '</span> <span class="mono">' + esc(stats.latest.at_utc || '') + '</span>';
        return '<tr><td class="mono">' + esc(r.adapter_id) + '</td><td>—</td>' +
          '<td>' + esc(r.expected_provider) + '</td><td>' + esc(r.expected_model_id) + '</td>' +
          '<td class="mono">' + esc((r.variants || []).join(' | ')) + '</td>' +
          '<td>' + activity + '</td></tr>';
      }).join('');
      el.innerHTML = '<table><thead><tr><th>犬（合同）</th><th>角色</th><th>provider</th><th>model</th><th>变体</th><th>最近派发</th></tr></thead><tbody>' + rr + '</tbody></table>';
      return;
    }
    var rows = actors.map(function (a) {
      return '<tr><td class="mono">' + esc(a.actor_instance_id) + '</td><td>' + esc(a.role) + '</td>' +
        '<td>' + esc(a.provider) + '</td><td>' + esc(a.model_id) + '</td>' +
        '<td class="mono">' + shortHash(a.capability_id) + '</td>' +
        '<td>' + a.event_count + '</td><td>' + esc(a.last_event_type) + '</td></tr>';
    }).join('');
    el.innerHTML = '<table><thead><tr><th>犬（实例）</th><th>角色</th><th>provider</th><th>model</th><th>capability</th><th>事件数</th><th>最近事件</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---------- 事件链（G009：无 epoch 链时回退显示派发生命周期记录） ---------- */
  function renderEpochs() {
    var el = document.getElementById('view-epochs');
    if (snapshot.epochs.length === 0) {
      var dispatches = snapshot.dispatches || [];
      if (dispatches.length === 0) { el.innerHTML = '<div class="empty">暂无 epoch 事件链（无派发记录；派发后此处显示其生命周期）</div>'; return; }
      var dr = dispatches.map(function (d) {
        return '<tr><td class="mono">' + esc(d.dispatch_id.slice(0, 12)) + '</td>' +
          '<td>' + esc(d.adapter_id) + '</td>' +
          '<td><span class="badge ' + esc(d.status) + '">' + esc(d.status) + '</span></td>' +
          '<td class="mono">' + esc(d.at_utc || '') + '</td></tr>';
      }).join('');
      el.innerHTML = '<div class="hint">（无 epoch 链时显示派发生命周期记录）</div>' +
        '<table><thead><tr><th>dispatch</th><th>犬</th><th>状态</th><th>最近时间</th></tr></thead><tbody>' + dr + '</tbody></table>';
      return;
    }
    el.innerHTML = snapshot.epochs.map(function (epoch) {
      var chainBadge = epoch.chain_verified
        ? '<span class="badge ok">链校验通过</span>'
        : '<span class="badge broken">链断裂</span>';
      var rows = epoch.events.map(function (ev) {
        return '<tr><td>' + ev.sequence + '</td><td>' + esc(ev.event_type) + '</td>' +
          '<td class="mono">' + esc(ev.actor_instance_id) + '</td><td>' + esc(ev.phase) + '</td>' +
          '<td>' + esc(ev.summary || '') + '</td>' +
          '<td class="hash">' + shortHash(ev.sha256) + '</td>' +
          '<td class="hash">' + (ev.previous_sha256 ? shortHash(ev.previous_sha256) : 'genesis') + '</td>' +
          '<td class="mono">' + esc(ev.created_at_utc) + '</td></tr>';
      }).join('');
      return '<div class="card"><h3>run ' + esc(epoch.run_id) + ' · epoch ' + epoch.assignment_epoch +
        ' · ' + epoch.event_count + ' 事件 ' + chainBadge +
        ' <span class="hash">head ' + shortHash(epoch.chain_head) + '</span></h3>' +
        '<table><thead><tr><th>#</th><th>类型</th><th>actor</th><th>phase</th><th>摘要</th><th>sha256</th><th>前锚</th><th>时间</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>';
    }).join('');
  }

  /* ---------- 预算真实视图（GET /api/budget） ---------- */
  function renderBudget() {
    var el = document.getElementById('view-budget');
    if (!budget || !budget.actors || budget.actors.length === 0) {
      el.innerHTML = '<div class="empty">暂无预算台账记录（USD 台账随 dispatch admission 产生）</div>';
      return;
    }
    el.innerHTML = budget.actors.map(function (actor) {
      var cap = actor.cap_usd || 0;
      var spent = actor.spent_usd || 0;
      var pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
      var entries = (actor.entries || []).slice(-5).reverse().map(function (entry) {
        return '<tr><td class="mono">' + esc(entry.at_utc) + '</td><td>' + esc(entry.decision) + '</td>' +
          '<td>$' + Number(entry.amount_usd).toFixed(4) + '</td><td>$' + Number(entry.remaining_usd).toFixed(4) + '</td></tr>';
      }).join('');
      return '<div class="card"><h3>' + esc(actor.actor_id) + '</h3>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
        '<div class="bar' + (pct > 80 ? ' hot' : '') + '"><div style="width:' + pct + '%"></div></div>' +
        '<span class="mono">$' + spent.toFixed(4) + ' / $' + cap.toFixed(2) + '（' + pct.toFixed(0) + '%）</span></div>' +
        (entries ? '<table style="margin-top:8px"><thead><tr><th>时间</th><th>决策</th><th>金额</th><th>余额</th></tr></thead><tbody>' + entries + '</tbody></table>' : '') +
        '</div>';
    }).join('');
  }

  /* ---------- 审批 ---------- */
  function renderApprovals() {
    var el = document.getElementById('view-approvals');
    var waiting = snapshot.approvals.filter(function (a) { return a.status === 'WAITING'; });
    document.getElementById('waiting-count').textContent = waiting.length > 0 ? '(' + waiting.length + ')' : '';
    if (snapshot.approvals.length === 0) { el.innerHTML = '<div class="empty">暂无审批请求</div>'; return; }
    var rows = snapshot.approvals.map(function (a, index) {
      var action = a.status === 'WAITING'
        ? '<button class="act approve" data-approval="' + index + '">处理</button>'
        : esc(a.response ? a.response.responded_at_utc : '');
      return '<tr><td class="mono">' + esc(a.request_file) + '</td><td>' + esc(a.gate) + '</td>' +
        '<td class="mono">' + esc(a.actor_id) + '</td><td>' + esc(a.reason || '') + '</td>' +
        '<td><span class="badge ' + a.status + '">' + a.status + '</span></td><td>' + action + '</td></tr>';
    }).join('');
    el.innerHTML = '<table><thead><tr><th>请求文件</th><th>门</th><th>actor</th><th>事由</th><th>状态</th><th>动作/应答时间</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
    el.querySelectorAll('button[data-approval]').forEach(function (btn) {
      btn.addEventListener('click', function () { openDialog(snapshot.approvals[Number(btn.getAttribute('data-approval'))]); });
    });
  }

  function openDialog(approval) {
    currentApproval = approval;
    var dl = document.getElementById('approval-detail');
    dl.innerHTML = '<dt>请求文件</dt><dd class="mono">' + esc(approval.request_file) + '</dd>' +
      '<dt>门</dt><dd>' + esc(approval.gate) + '</dd>' +
      '<dt>actor</dt><dd class="mono">' + esc(approval.actor_id) + '</dd>' +
      '<dt>事由</dt><dd>' + esc(approval.reason || '') + '</dd>' +
      '<dt>请求时间</dt><dd class="mono">' + esc(approval.requested_at_utc) + '</dd>';
    document.getElementById('approval-dialog').showModal();
  }

  function respond(decision) {
    if (!currentApproval) return;
    postJson('/api/approvals/respond', { request_file: currentApproval.request_file, decision: decision })
      .then(function (result) {
        document.getElementById('approval-dialog').close();
        if (result.status === 201) {
          toast('已' + (decision === 'APPROVED' ? '批准' : '否决') + '：' + currentApproval.request_file, true);
          refresh();
        } else {
          toast('应答失败：' + (result.body.error || result.status), false);
        }
      }).catch(function (error) { toast('应答失败：' + error, false); });
  }

  /* ---------- 汇总刷新 ---------- */
  function renderAll() {
    if (!snapshot) return;
    document.getElementById('generated').textContent = '快照 ' + snapshot.generated_at_utc;
    renderAdapterOptions();
    renderDispatches();
    renderDogs();
    renderEpochs();
    renderBudget();
    renderApprovals();
  }

  function refresh() {
    return getJson('/api/snapshot').then(function (data) {
      snapshot = data;
      renderAll();
    });
  }

  /* ---------- 事件绑定 ---------- */
  document.querySelectorAll('nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('section.view').forEach(function (s) { s.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('view-' + btn.getAttribute('data-view')).classList.add('active');
    });
  });
  document.getElementById('dispatch-form').addEventListener('submit', submitDispatch);
  document.getElementById('dispatch-adapter').addEventListener('change', renderModelOptions);
  document.getElementById('dispatch-real').addEventListener('change', function () {
    document.getElementById('real-hint').style.display = this.checked ? 'block' : 'none';
  });
  document.getElementById('workspace-select').addEventListener('change', function () {
    var selected = this.value;
    if (!selected) return;
    postJson('/api/workspaces/select', { path: selected }).then(function (result) {
      if (result.status === 201) { toast('workspace 已切换：' + selected, true); loadWorkspaces(); }
      else { toast('workspace 切换失败：' + (result.body.error || result.status), false); }
    }).catch(function (error) { toast('workspace 切换失败：' + error, false); });
  });
  document.getElementById('btn-approve').addEventListener('click', function () { respond('APPROVED'); });
  document.getElementById('btn-reject').addEventListener('click', function () { respond('REJECTED'); });
  document.getElementById('btn-cancel').addEventListener('click', function () {
    document.getElementById('approval-dialog').close();
  });

  // G7B-D2：RUNNING 卡片已耗时每秒刷新（本地时钟，无需后端）。
  setInterval(function () {
    var hasRunning = trackedDispatches.some(function (d) { return !TERMINAL_STATUSES[d.status]; });
    if (hasRunning) renderDispatches();
  }, 1000);

  function loadWorkspaces() {
    return getJson('/api/workspaces').then(function (data) {
      if (data.ok && Array.isArray(data.workspaces)) workspaces = data.workspaces;
      renderWorkspaces();
    }).catch(function () { renderWorkspaces(); });
  }

  function loadBudget() {
    return getJson('/api/budget').then(function (data) {
      if (data.ok) budget = data;
      renderBudget();
    }).catch(function () { renderBudget(); });
  }

  refresh().then(function () {
    loadWorkspaces();
    loadBudget();
    var status = document.getElementById('sse-status');
    var source = new EventSource('/api/stream');
    source.onopen = function () { status.textContent = 'SSE 实时'; status.className = 'live'; };
    source.onerror = function () { status.textContent = 'SSE 断开（重连中）'; status.className = 'down'; };
    source.onmessage = function (msg) {
      var payload = null;
      try { payload = JSON.parse(msg.data); } catch { payload = null; }
      if (payload && payload.kind === 'dispatch') {
        trackDispatch(payload.dispatch_id, payload.adapter_id, payload.status);
        loadBudget();
      }
      refresh();
    };
  });
})();
</script>
</body>
</html>
`;
}
