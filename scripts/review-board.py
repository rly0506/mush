# -*- coding: utf-8 -*-
# Screenshot workbench lanes + chat view for design review.
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4790/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    page.screenshot(path=".playwright-mcp/review-chat.png")
    # open settings panel to see selectors
    page.click("#chat-settings-toggle")
    page.wait_for_timeout(400)
    page.screenshot(path=".playwright-mcp/review-chat-settings.png")
    page.click('nav button[data-view="workbench"]')
    page.wait_for_timeout(1500)
    page.screenshot(path=".playwright-mcp/review-workbench.png")
    browser.close()
print("done")
