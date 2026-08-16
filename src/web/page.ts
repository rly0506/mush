/**
 * mush M5 Web 看板（GOAL-005 U3）— 单页静态 HTML。
 * 无框架、无构建、无 CDN 外链；四视图：犬队状态 / epoch 事件链 / 预算消耗 / 审批。
 * 密钥红线：页面只渲染快照中已脱敏的身份字段。
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
  header { padding: 12px 20px; border-bottom: 1px solid #2a3138; display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; letter-spacing: 1px; }
  header .meta { font-size: 12px; color: #7c8791; }
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
  .badge.ok { color: #56d364; border-color: #56d364; }
  .badge.broken { color: #f85149; border-color: #f85149; }
  .card { background: #161b21; border: 1px solid #2a3138; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card h3 { margin: 0 0 8px; font-size: 13px; color: #9aa6b0; }
  .empty { color: #5c6670; font-size: 13px; padding: 24px 0; text-align: center; }
  #sse-status { font-size: 11px; }
  #sse-status.live { color: #56d364; }
  #sse-status.down { color: #f85149; }
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
</style>
</head>
<body>
<header>
  <h1>mush 看板</h1>
  <span class="meta" id="generated"></span>
  <span class="meta" id="sse-status">SSE 连接中…</span>
</header>
<nav>
  <button data-view="dogs" class="active">犬队状态</button>
  <button data-view="epochs">事件链</button>
  <button data-view="budget">预算消耗</button>
  <button data-view="approvals">审批 <span id="waiting-count"></span></button>
</nav>
<main>
  <section id="view-dogs" class="view active"></section>
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
  var currentApproval = null;

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
    setTimeout(function () { el.className = ''; el.style.display = 'none'; }, 4000);
  }

  function renderDogs() {
    var el = document.getElementById('view-dogs');
    var actors = snapshot.actors;
    if (actors.length === 0) { el.innerHTML = '<div class="empty">暂无犬只活动（等待事件流入）</div>'; return; }
    var rows = actors.map(function (a) {
      return '<tr><td class="mono">' + esc(a.actor_instance_id) + '</td><td>' + esc(a.role) + '</td>' +
        '<td>' + esc(a.provider) + '</td><td>' + esc(a.model_id) + '</td>' +
        '<td class="mono">' + shortHash(a.capability_id) + '</td>' +
        '<td>' + a.event_count + '</td><td>' + esc(a.last_event_type) + '</td></tr>';
    }).join('');
    el.innerHTML = '<table><thead><tr><th>犬（实例）</th><th>角色</th><th>provider</th><th>model</th><th>capability</th><th>事件数</th><th>最近事件</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderEpochs() {
    var el = document.getElementById('view-epochs');
    if (snapshot.epochs.length === 0) { el.innerHTML = '<div class="empty">暂无 epoch 事件链</div>'; return; }
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

  function renderBudget() {
    var el = document.getElementById('view-budget');
    var gates = snapshot.approvals.filter(function (a) { return a.gate === 'BUDGET_GATE'; });
    if (gates.length === 0) { el.innerHTML = '<div class="empty">暂无预算门记录（预算事件化记账随 dispatch 产生）</div>'; return; }
    var rows = gates.map(function (a) {
      return '<tr><td class="mono">' + esc(a.actor_id) + '</td><td>' + esc(a.reason || '') + '</td>' +
        '<td>' + esc(a.requested_at_utc) + '</td>' +
        '<td><span class="badge ' + a.status + '">' + a.status + '</span></td></tr>';
    }).join('');
    el.innerHTML = '<div class="card"><h3>预算门事件（BUDGET_GATE）</h3>' +
      '<table><thead><tr><th>actor</th><th>事由</th><th>请求时间</th><th>状态</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
  }

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
    fetch('/api/approvals/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_file: currentApproval.request_file, decision: decision })
    }).then(function (res) {
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    }).then(function (result) {
      document.getElementById('approval-dialog').close();
      if (result.status === 201) {
        toast('已' + (decision === 'APPROVED' ? '批准' : '否决') + '：' + currentApproval.request_file, true);
        refresh();
      } else {
        toast('应答失败：' + (result.body.error || result.status), false);
      }
    }).catch(function (error) { toast('应答失败：' + error, false); });
  }

  function renderAll() {
    document.getElementById('generated').textContent = '快照 ' + snapshot.generated_at_utc;
    renderDogs();
    renderEpochs();
    renderBudget();
    renderApprovals();
  }

  function refresh() {
    return fetch('/api/snapshot').then(function (res) { return res.json(); }).then(function (data) {
      snapshot = data;
      renderAll();
    });
  }

  document.querySelectorAll('nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('section.view').forEach(function (s) { s.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('view-' + btn.getAttribute('data-view')).classList.add('active');
    });
  });
  document.getElementById('btn-approve').addEventListener('click', function () { respond('APPROVED'); });
  document.getElementById('btn-reject').addEventListener('click', function () { respond('REJECTED'); });
  document.getElementById('btn-cancel').addEventListener('click', function () {
    document.getElementById('approval-dialog').close();
  });

  refresh().then(function () {
    var status = document.getElementById('sse-status');
    var source = new EventSource('/api/stream');
    source.onopen = function () { status.textContent = 'SSE 实时'; status.className = 'live'; };
    source.onerror = function () { status.textContent = 'SSE 断开（重连中）'; status.className = 'down'; };
    source.onmessage = function () { refresh(); };
  });
})();
</script>
</body>
</html>
`;
}
