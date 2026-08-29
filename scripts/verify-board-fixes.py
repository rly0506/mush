# -*- coding: utf-8 -*-
# Verify fix 1 (sidebar collapse must not hide chat view) and fix 2 (mark-done button).
import json
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4790/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    # Fix 1: collapse sidebar twice, chat must stay visible
    page.click("#nav-collapse")
    page.wait_for_timeout(400)
    st1 = page.evaluate(
        "var el=document.getElementById('view-chat');"
        "JSON.stringify({display:getComputedStyle(el).display, cls:el.className, navCollapsed:document.body.className})"
    )
    page.click("#nav-collapse")
    page.wait_for_timeout(400)
    st2 = page.evaluate(
        "var el=document.getElementById('view-chat');"
        "JSON.stringify({display:getComputedStyle(el).display, cls:el.className, navCollapsed:document.body.className})"
    )
    print("collapsed :", st1)
    print("expanded  :", st2)
    page.click("#nav-collapse")  # collapse again for screenshot
    page.wait_for_timeout(400)
    page.screenshot(path=".playwright-mcp/verify-collapsed-fixed.png")
    page.click("#nav-collapse")

    # Fix 2: workbench -> check mark-done buttons exist on non-terminal cards
    page.click('nav button[data-view="workbench"]')
    page.wait_for_timeout(1500)
    counts = page.evaluate(
        "JSON.stringify({markDone:document.querySelectorAll('button[data-task-mark-done]').length,"
        " cards:document.querySelectorAll('.task-card').length})"
    )
    print("workbench :", counts)
    page.screenshot(path=".playwright-mcp/verify-workbench-markdone.png")
    browser.close()
print("verify done")
