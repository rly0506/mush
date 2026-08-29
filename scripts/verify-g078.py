# -*- coding: utf-8 -*-
# GOAL-078 verification: capsule popovers, header declutter, overflow menu.
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4790/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1800)

    info = page.evaluate("""JSON.stringify({
      headPop: !!document.getElementById('head-dog-pop'),
      wsPop: !!document.getElementById('workspace-pop'),
      headSelectInPop: !!document.querySelector('#head-dog-pop #chat-head-select'),
      wsSelectInPop: !!document.querySelector('#workspace-pop #chat-workspace-select'),
      generatedInHeader: !!document.querySelector('header #generated'),
      generatedInSettings: !!document.querySelector('#chat-settings-panel #generated'),
      sseHidden: getComputedStyle(document.getElementById('sse-status')).display,
      settingsCascadeGone: !document.querySelector('#chat-settings-panel #chat-head-select'),
      gaugeText: document.getElementById('chat-context-gauge').textContent
    })""")
    print("STRUCT:", info)
    page.screenshot(path=".playwright-mcp/g078-chat.png")

    # open head-dog popover
    page.click("#head-dog-badge")
    page.wait_for_timeout(400)
    print("head pop open:", page.evaluate("document.getElementById('head-dog-pop').className"))
    page.screenshot(path=".playwright-mcp/g078-headpop.png")
    page.keyboard.press("Escape")

    # open workspace popover
    page.click("#workspace-current")
    page.wait_for_timeout(400)
    page.screenshot(path=".playwright-mcp/g078-wspop.png")
    page.keyboard.press("Escape")

    # sidebar collapse regression
    page.click("#nav-collapse")
    page.wait_for_timeout(400)
    print("chat after collapse:", page.evaluate(
        "getComputedStyle(document.getElementById('view-chat')).display"))
    page.click("#nav-collapse")

    # workbench overflow menu
    page.click('nav button[data-view="workbench"]')
    page.wait_for_timeout(1500)
    counts = page.evaluate("""JSON.stringify({
      menus: document.querySelectorAll('button[data-task-menu]').length,
      markDone: document.querySelectorAll('button[data-task-mark-done]').length,
      visibleMoveBtns: Array.from(document.querySelectorAll('button[data-task-move]')).filter(function(b){return b.offsetParent!==null && !b.closest('.task-menu')}).length
    })""")
    print("WORKBENCH:", counts)
    menu = page.locator('button[data-task-menu]').first
    if menu.count() > 0:
        menu.click()
        page.wait_for_timeout(300)
        page.screenshot(path=".playwright-mcp/g078-overflow.png")
    page.screenshot(path=".playwright-mcp/g078-workbench.png")
    browser.close()
print("verify done")
