# 有数据态截图：预览页注入 mock fetch（snapshot/budget/workspaces/streams/tasks/chat）
# 再截全页，目检雪原营地主题在真实数据下的呈现。
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
preview = ROOT / '.test-fixtures' / 'g020-board-preview.html'
out = ROOT / 'goals' / 'receipts' / 'g020-board-screenshot-data.png'

NOW = '2026-08-17T12:00:00.000Z'

MOCK = """
window.__respond = function(url, body) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' } }));
};
const roster = [
  { adapter_id: 'head-dog', expected_provider: 'deepseek', expected_model_id: 'deepseek-chat', role: 'head', variants: [] },
  { adapter_id: 'deepseek-dsh', expected_provider: 'deepseek', expected_model_id: 'deepseek-chat', role: 'executor', variants: [] },
  { adapter_id: 'claude-code', expected_provider: 'anthropic', expected_model_id: 'claude-sonnet-4', role: 'executor', variants: ['claude-sonnet-4','claude-opus-4'] },
  { adapter_id: 'kimi-code', expected_provider: 'moonshot', expected_model_id: 'kimi-k2', role: 'executor', variants: [] },
  { adapter_id: 'zcode', expected_provider: 'zhipu', expected_model_id: 'glm-4.6', role: 'executor', variants: [] },
  { adapter_id: 'codex', expected_provider: 'openai', expected_model_id: 'gpt-5', role: 'executor', variants: [], verified: false, verify_reason: 'F-50 通道未实证' }
];
const dispatches = [
  { dispatch_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', adapter_id: 'deepseek-dsh', status: 'RUNNING', at_utc: '%NOW%', receipt_path: null },
  { dispatch_id: 'b2c3d4e5f60718293a4b5c6d7e8f90a1', adapter_id: 'claude-code', status: 'PASS', at_utc: '%NOW%', receipt_path: 'runtime/dispatches/x.json' },
  { dispatch_id: 'c3d4e5f60718293a4b5c6d7e8f90a1b2', adapter_id: 'kimi-code', status: 'FAIL', at_utc: '%NOW%', receipt_path: null }
];
const snapshot = {
  generated_at_utc: '%NOW%', epochs: [], actors: [], roster,
  dispatches,
  approvals: [
    { request_file: 'dispatch-abc123.json', gate: 'budget', actor_id: 'deepseek-dsh', goal_id: 'MUSH-GOAL-020',
      reason: 'real 派发超 per-actor cap 报备', status: 'WAITING', requested_at_utc: '%NOW%',
      dispatch: { dispatch_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', goal_id: 'MUSH-GOAL-020', adapter_id: 'deepseek-dsh',
        effort: 'HIGH', timeout_s: 300, workspace: 'D:\\\\mush', actor_spent_usd: 3.42, cap_usd: 5,
        prompt_preview: '写一份雪原营地主题的回执摘要……' } }
  ]
};
window.fetch = function(url, opts) {
  if (typeof url !== 'string') return Promise.reject(new Error('bad url'));
  if (url.startsWith('/api/snapshot')) return window.__respond(url, snapshot);
  if (url.startsWith('/api/budget/caps')) return window.__respond(url, { ok: true });
  if (url.startsWith('/api/budget')) return window.__respond(url, { ok: true, actors: [
    { actor_id: 'deepseek-dsh', spent_usd: 3.4213, cap_usd: 5, entries: [{ at_utc: '%NOW%', decision: 'ADMITTED', amount_usd: 1.2, remaining_usd: 1.58 }] },
    { actor_id: 'claude-code', spent_usd: 0.84, cap_usd: 5, entries: [] },
    { actor_id: 'kimi-code', spent_usd: 4.91, cap_usd: 5, entries: [] }
  ]});
  if (url.startsWith('/api/workspaces')) return window.__respond(url, { ok: true, workspaces: [
    { path: 'D:/mush', is_git: true, mush_managed: true, selected: true }
  ]});
  if (url.startsWith('/api/streams')) return window.__respond(url, { ok: true, streams: [] });
  if (url.startsWith('/api/tasks')) return window.__respond(url, { ok: true, tasks: [
    { task_id: 'T-001', title: '雪原营地视觉改版', status: 'IN_FLIGHT', priority: '高', source: 'GP-33', dispatch_ids: ['a1b2'] },
    { task_id: 'T-002', title: '任务池后端契约 v1.7', status: 'READY', priority: '中', source: 'GOAL-019', dispatch_ids: [] },
    { task_id: 'T-003', title: '会话连续性 v2', status: 'DONE', priority: '中', source: 'GOAL-018', dispatch_ids: ['x','y','z'] }
  ]});
  if (url.startsWith('/api/chat/history')) return window.__respond(url, { ok: true, turns: [
    { role: 'user', text: '汇报一下雪原营地改版进度', at_utc: '%NOW%' },
    { role: 'head', text: 'B1-B5 已完成：亮色令牌、指挥台骨架、审批收编、排版阶梯、任务池三泳道。337/337 全绿。', at_utc: '%NOW%', dispatch_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }
  ]});
  if (url.startsWith('/api/chat')) return window.__respond(url, { ok: true, session_id: 's1', role: 'head', dispatch_id: 'd1', status: 'PASS', reply: 'ok' });
  if (url.startsWith('/api/stream')) {
    return Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(': connected\\n\\n')); } }), {
      status: 200, headers: { 'content-type': 'text/event-stream' } }));
  }
  return window.__respond(url, { ok: false, error: 'unmocked ' + url });
};
""".replace('%NOW%', NOW)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    page.add_init_script(MOCK)
    page.goto(preview.as_uri())
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1200)
    page.screenshot(path=str(out), full_page=True)
    print('saved:', out)
    browser.close()
