# -*- coding: utf-8 -*-
# GOAL-079 verification: motion manners on real Chromium.
# Checks computed styles of popover/drawer/toast transitions, press feedback,
# View Transition wrap, and view fade-in. Screenshots archived to .playwright-mcp/.
import sys, json, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

BASE = os.environ.get("G079_BASE", "http://127.0.0.1:4790/")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    js_errors = []
    page.on("pageerror", lambda exc: js_errors.append(str(exc)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    # 1. capsule popover: hidden via opacity/visibility (not display), opens with transition
    base = page.evaluate("""JSON.stringify((function(){
      var el = document.getElementById('head-dog-pop');
      var cs = getComputedStyle(el);
      return { display: cs.display, opacity: cs.opacity, visibility: cs.visibility,
               transition: cs.transitionProperty, origin: cs.transformOrigin };
    })())""")
    print("POP_BASE:", base)
    page.click("#head-dog-badge")
    page.wait_for_timeout(120)  # mid-transition
    mid = page.evaluate("getComputedStyle(document.getElementById('head-dog-pop')).opacity")
    print("POP_MID_OPACITY(should be between 0 and 1):", mid)
    page.wait_for_timeout(400)
    print("POP_OPEN:", page.evaluate("document.getElementById('head-dog-pop').className"))
    page.screenshot(path=".playwright-mcp/g079-headpop-open.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    closing = page.evaluate("JSON.stringify({v: getComputedStyle(document.getElementById('head-dog-pop')).visibility, o: getComputedStyle(document.getElementById('head-dog-pop')).opacity})")
    print("POP_CLOSING:", closing)

    # 2. dispatch drawer: translateX transition (按钮在工作台视图，先切过去)
    d = page.evaluate("""JSON.stringify((function(){
      var el = document.getElementById('view-dispatch');
      var cs = getComputedStyle(el);
      return { transform: cs.transform, visibility: cs.visibility, transition: cs.transitionProperty };
    })())""")
    print("DRAWER_BASE:", d)
    page.click('nav button[data-view="workbench"]')
    page.wait_for_timeout(600)
    btn = page.locator('#btn-open-dispatch')
    if btn.count() > 0:
        btn.click()
        page.wait_for_timeout(150)
        print("DRAWER_MID:", page.evaluate("getComputedStyle(document.getElementById('view-dispatch')).transform"))
        page.wait_for_timeout(500)
        print("DRAWER_OPEN:", page.evaluate("getComputedStyle(document.getElementById('view-dispatch')).transform"))
        page.screenshot(path=".playwright-mcp/g079-drawer-open.png")
        cb = page.locator('#btn-close-dispatch')
        if cb.count() > 0: cb.click()
        page.wait_for_timeout(600)

    # 3. toast: transition-driven, leaves via same side（toast 是闭包内函数，手动造节点验证 CSS）
    page.evaluate("""(function(){
      var stack = document.getElementById('toast-stack');
      var el = document.createElement('div');
      el.className = 'toast ok'; el.textContent = 'g079 verify toast';
      stack.appendChild(el);
      setTimeout(function(){ el.classList.add('leaving'); }, 300);
    })()""")
    page.wait_for_timeout(100)
    t = page.evaluate("""JSON.stringify((function(){
      var el = document.querySelector('#toast-stack .toast');
      if (!el) return null;
      var cs = getComputedStyle(el);
      return { transition: cs.transitionProperty, animation: cs.animationName, opacity: cs.opacity };
    })())""")
    print("TOAST_IN:", t)
    page.screenshot(path=".playwright-mcp/g079-toast.png")

    # 4. press feedback: button:active scale
    press = page.evaluate("""JSON.stringify((function(){
      var rules = [];
      for (var s of document.styleSheets) { try { for (var r of s.cssRules) { if (r.cssText && r.cssText.indexOf(':active')>-1 && r.cssText.indexOf('scale(0.97)')>-1) rules.push(r.cssText.slice(0,80)); } } catch(e){} }
      return rules;
    })())""")
    print("PRESS_RULES:", press)

    # 5. theme toggle: View Transitions wrap + reduced-motion media block
    vt = page.evaluate("""JSON.stringify({
      hasVT: typeof document.startViewTransition === 'function',
      hasReducedBlock: (function(){ for (var s of document.styleSheets){ try { for (var r of s.cssRules){ if (r.cssText && r.cssText.indexOf('prefers-reduced-motion')>-1) return true; } } catch(e){} } return false; })()
    })""")
    print("VT:", vt)
    page.click("#theme-toggle")
    page.wait_for_timeout(300)
    print("THEME_AFTER_TOGGLE:", page.evaluate("document.documentElement.getAttribute('data-theme')"))
    page.screenshot(path=".playwright-mcp/g079-theme-dark.png")
    page.click("#theme-toggle")
    page.wait_for_timeout(300)

    # 6. view fade-in on nav switch
    page.click('nav button[data-view="chat"]')
    page.wait_for_timeout(400)
    page.click('nav button[data-view="workbench"]')
    page.wait_for_timeout(60)
    midv = page.evaluate("getComputedStyle(document.getElementById('view-workbench')).opacity")
    print("VIEW_MID_OPACITY:", midv)
    page.wait_for_timeout(300)
    print("VIEW_FINAL_OPACITY:", page.evaluate("getComputedStyle(document.getElementById('view-workbench')).opacity"))

    # JS errors surfaced only in real browser（pageerror 真监听，验收裁定 P2-1 补账）
    print("JS_ERRORS:", js_errors)
    if js_errors:
        sys.exit(1)
    browser.close()
print("DONE g079 verify")
