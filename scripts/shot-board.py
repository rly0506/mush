# -*- coding: utf-8 -*-
# Screenshot mush board (http://127.0.0.1:4790) views for frontend review.
# Usage: .venv-pw/Scripts/python scripts/shot-board.py [out_prefix]
import sys
from playwright.sync_api import sync_playwright

prefix = sys.argv[1] if len(sys.argv) > 1 else ".playwright-mcp/board"
BASE = "http://127.0.0.1:4790/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{prefix}-chat.png")

    # workbench view
    page.click('nav button[data-view="workbench"]')
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{prefix}-workbench.png", full_page=False)

    # collapsed sidebar state (reproduce bug 1)
    page.click('nav button[data-view="chat"]')
    page.wait_for_timeout(800)
    page.click("#nav-collapse")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{prefix}-collapsed.png")

    # is chat still visible?
    visible = page.evaluate(
        "var el=document.getElementById('view-chat');"
        "el ? getComputedStyle(el).display : 'missing'"
    )
    active = page.evaluate(
        "var el=document.getElementById('view-chat');"
        "el ? el.className : 'missing'"
    )
    print("AFTER-COLLAPSE view-chat display:", visible, "| class:", active)
    browser.close()
print("done")
