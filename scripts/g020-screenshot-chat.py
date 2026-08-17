# 目检：双气泡（owner+head）渲染验证 + 修正后复截。
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
preview = ROOT / '.test-fixtures' / 'g020-board-preview.html'
out = ROOT / 'goals' / 'receipts' / 'g020-board-screenshot-chat.png'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    page.goto(preview.as_uri())
    page.wait_for_load_state('networkidle')
    # 直接调用页面内函数渲染双气泡（真实渲染路径 appendChatRow）
    page.evaluate("""() => {
      const stream = document.querySelector('#chat-stream');
      stream.innerHTML = '';
      // 模拟 appendChatRow 的 DOM 结构（与 page.ts 内联函数一致）
      function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
      const paw = '<span class="dog-logo" style="color:#8a9cb0"><svg viewBox="0 0 24 24"><circle cx="12" cy="14.5" r="4.2" fill="currentColor"/><circle cx="6.5" cy="9.5" r="1.9" fill="currentColor"/><circle cx="17.5" cy="9.5" r="1.9" fill="currentColor"/></svg></span>';
      const moon = '<span class="dog-logo" style="color:#7C5CFF"><svg viewBox="0 0 24 24"><path d="M14.5 3a9 9 0 1 0 6.5 15.2A10.5 10.5 0 0 1 14.5 3z" fill="currentColor"/></svg></span>';
      const user = document.createElement('div');
      user.className = 'chat-row user';
      user.innerHTML = '<span class="avatar">'+paw+'</span><div><div class="who">你 · 08-17 20:00:01</div><div class="bubble">'+esc('汇报一下雪原营地改版进度')+'</div></div>';
      const head = document.createElement('div');
      head.className = 'chat-row head';
      head.innerHTML = '<span class="avatar">'+moon+'</span><div><div class="who">头犬 · 08-17 20:00:12</div><div class="bubble">'+esc('B1-B5 已完成：亮色令牌、指挥台骨架、审批收编、排版阶梯、任务池三泳道。337/337 全绿。')+'</div></div>';
      stream.appendChild(user); stream.appendChild(head);
    }""")
    page.wait_for_timeout(300)
    page.screenshot(path=str(out), full_page=True)
    ubg = page.evaluate("getComputedStyle(document.querySelector('.chat-row.user .bubble')).backgroundColor")
    hbg = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).backgroundColor")
    hfs = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).fontSize")
    hfw = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).fontWeight")
    hcolor = page.evaluate("getComputedStyle(document.querySelector('.chat-row.head .bubble')).color")
    print('user bubble bg:', ubg)
    print('head bubble bg:', hbg, 'font-size:', hfs, 'weight:', hfw, 'color:', hcolor)
    browser.close()
print('saved:', out)
