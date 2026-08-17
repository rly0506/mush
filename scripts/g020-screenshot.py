# GOAL-020 screenshot目检：无头 Chromium 打开静态预览页，截全页 PNG。
# 用法：.test-fixtures/pw-venv/Scripts/python scripts/g020-screenshot.py
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
preview = ROOT / '.test-fixtures' / 'g020-board-preview.html'
out = ROOT / 'goals' / 'receipts' / 'g020-board-screenshot.png'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    page.goto(preview.as_uri())
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)
    page.screenshot(path=str(out), full_page=True)

    # 结构量测（代替人眼初检）
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    deck = page.evaluate("getComputedStyle(document.querySelector('#view-chat')).display")
    grid = page.evaluate("getComputedStyle(document.querySelector('#view-chat')).gridTemplateColumns")
    bubble = page.evaluate("getComputedStyle(document.querySelector('.chat-row .bubble') || document.body).fontSize")
    rail = page.evaluate("!!document.querySelector('#rail-dogs')")
    print('body background:', bg)
    print('chat view display:', deck)
    print('chat grid columns:', grid)
    print('chat bubble font-size:', bubble)
    print('rail-dogs present:', rail)
    browser.close()
print('screenshot saved:', out)
