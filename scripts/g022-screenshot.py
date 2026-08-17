# GOAL-022 目检截图：注入 34 张真卡（主仓台账快照）+ 双泳道滚动验证。
from pathlib import Path
from playwright.sync_api import sync_playwright
import json

ROOT = Path(__file__).resolve().parent.parent
preview = ROOT / '.test-fixtures' / 'g022-board-preview.html'
out = ROOT / 'goals' / 'receipts' / 'g022-taskpool-screenshot.png'

# 生成预览页（若不存在）
if not preview.exists():
    import subprocess
    subprocess.run(['node', '--experimental-transform-types', '-e',
        "import('./src/web/page.ts').then(m=>{require('fs').writeFileSync('.test-fixtures/g022-board-preview.html', m.renderBoardPage());console.log('written');});"],
        cwd=str(ROOT), check=True, capture_output=True)

# 主仓 34 真卡读侧折叠
by_id = {}
for line in Path('D:/mush/runtime/tasks.jsonl').read_text(encoding='utf-8').splitlines():
    if line.strip():
        t = json.loads(line)
        by_id[t['task_id']] = t
tasks = list(by_id.values())
tasks_json = json.dumps(tasks, ensure_ascii=False)

MOCK = f"""
window.__respond = function(url, body, status) {{
  return Promise.resolve(new Response(JSON.stringify(body), {{
    status: status || 200, headers: {{ 'content-type': 'application/json' }} }}));
}};
const tasks = {tasks_json};
const snapshot = {{ generated_at_utc: '2026-08-17T13:00:00.000Z', epochs: [], actors: [],
  roster: [{{ adapter_id: 'head-dog', expected_provider: 'deepseek', expected_model_id: 'deepseek-chat', role: 'head', variants: [] }}],
  dispatches: [], approvals: [] }};
window.fetch = function(url) {{
  if (typeof url !== 'string') return Promise.reject(new Error('bad url'));
  if (url.startsWith('/api/snapshot')) return window.__respond(url, snapshot);
  if (url.startsWith('/api/tasks')) return window.__respond(url, {{ ok: true, tasks }});
  if (url.startsWith('/api/budget')) return window.__respond(url, {{ ok: true, actors: [] }});
  if (url.startsWith('/api/workspaces')) return window.__respond(url, {{ ok: true, workspaces: [] }});
  if (url.startsWith('/api/streams')) return window.__respond(url, {{ ok: true, streams: [] }});
  if (url.startsWith('/api/stream')) return Promise.resolve(new Response(new ReadableStream({{ start(c) {{ c.enqueue(new TextEncoder().encode(': connected\\n\\n')); }} }}), {{ status: 200, headers: {{ 'content-type': 'text/event-stream' }} }}));
  return window.__respond(url, {{ ok: false, error: 'unmocked' }});
}};
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    page.add_init_script(MOCK)
    page.goto(preview.as_uri())
    page.wait_for_load_state('networkidle')
    # 切到任务池视图
    page.click('button[data-view="tasks"]')
    page.wait_for_timeout(1200)
    page.screenshot(path=str(out), full_page=True)
    # 量测：泳道滚动容器 + 卡片数 + 中文化
    lane_h = page.evaluate("getComputedStyle(document.querySelector('#lane-todo')).maxHeight")
    overflow = page.evaluate("getComputedStyle(document.querySelector('#lane-todo')).overflowY")
    cards = page.evaluate("document.querySelectorAll('#lane-todo .task-card').length")
    first_title = page.evaluate("document.querySelector('#lane-todo .task-card .task-title')?.textContent || ''")
    page_h = page.evaluate("document.body.scrollHeight")
    print('lane-todo max-height:', lane_h, '| overflow-y:', overflow)
    print('todo lane cards:', cards)
    print('first card title:', first_title[:60])
    print('body scrollHeight:', page_h)
    browser.close()
print('saved:', out)
