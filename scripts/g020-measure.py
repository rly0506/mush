# 量测聊天气泡计算样式：注入一个真实 bubble 节点后读 font-size。
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
preview = ROOT / '.test-fixtures' / 'g020-board-preview.html'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    page.goto(preview.as_uri())
    page.wait_for_load_state('networkidle')
    page.evaluate("""() => {
      const stream = document.querySelector('#chat-stream');
      stream.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'chat-row head';
      row.innerHTML = '<div><div class="who">头犬</div><div class="bubble">测试气泡文本</div></div>';
      stream.appendChild(row);
    }""")
    page.wait_for_timeout(200)
    fs = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).fontSize")
    lh = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).lineHeight")
    fw = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).fontWeight")
    print('head bubble font-size:', fs, 'line-height:', lh, 'font-weight:', fw)
    browser.close()
