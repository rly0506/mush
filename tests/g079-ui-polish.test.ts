import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderBoardPage } from '../src/web/page.ts';
import { getCollaborationStyles } from '../src/web/ui/styles.ts';
import { readFileSync } from 'node:fs';

// GOAL-079：前端精修——设计令牌与动效礼节。渲染层断言（机检规格）。
// 负向断言一律扫描「全部样式块」（076 自证循环教训：不能只查改动行；
// 验收裁定 P3-1：全站口径含 companion 浮窗样式）。
function allStyles(html: string): string {
  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  return styleBlocks.join('\n');
}

describe('GOAL-079: UI polish — design tokens & motion manners', () => {
  const html = renderBoardPage();
  const styles = allStyles(html) + '\n' + getCollaborationStyles()
    + '\n' + readFileSync(new URL('../src/companion/floating-page.ts', import.meta.url), 'utf8');

  test('1. 动效令牌一次定义：ease/dur/shadow 八枚 + prefers-reduced-motion 块', () => {
    for (const tok of ['--ease-out:', '--ease-drawer:', '--dur-press:', '--dur-pop:', '--dur-drawer:', '--shadow-pop:', '--shadow-drawer:', '--shadow-card:']) {
      assert.ok(styles.includes(tok), `缺少令牌 ${tok}`);
    }
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, '必须有 reduced-motion 降级块');
  });

  test('2. 胶囊 popover：含 transition 且非 display 驱动，两枚 origin 各钉固定角', () => {
    const popBlock = styles.match(/\.capsule-pop \{[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.ok(popBlock.includes('transition:'), 'capsule-pop 必须带 transition');
    assert.ok(!popBlock.includes('display: none'), 'capsule-pop 不得用 display:none 隐藏');
    assert.ok(popBlock.includes('opacity: 0') && popBlock.includes('scale(0.97)'), '基态应为 opacity:0 + scale(0.97)');
    assert.match(styles, /#head-dog-pop \{ transform-origin: top left/, '头犬 pop origin 钉 top left');
    assert.match(styles, /#workspace-pop \{ transform-origin: top right/, '工作区 pop origin 钉 top right');
    const openBlock = styles.match(/\.capsule-pop\.open \{[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.ok(openBlock.includes('visibility: visible'), 'open 态必须恢复 visibility');
  });

  test('3. 派发抽屉：translateX(100%) 过渡 + visibility 延迟隐藏', () => {
    const drawerBlock = styles.match(/\.dispatch-drawer \{[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.ok(drawerBlock.includes('translateX(100%)'), '抽屉基态应 translateX(100%)');
    assert.ok(drawerBlock.includes('visibility: hidden'), '抽屉基态应 visibility:hidden');
    assert.ok(drawerBlock.includes('var(--ease-drawer)'), '抽屉应使用 --ease-drawer 曲线');
    assert.ok(drawerBlock.includes('visibility 0s linear'), '抽屉 visibility 必须延迟隐藏否则 transition 失效');
    assert.match(styles, /\.dispatch-drawer\.open \{[\s\S]*?visibility: visible/, 'open 态恢复可见');
  });

  test('4. toast：不用 @keyframes 驱动，@starting-style 入场 + 离场同一边', () => {
    assert.ok(!/@keyframes toast-in/.test(styles), 'toast 不得再由 keyframes 驱动');
    assert.match(styles, /@starting-style \{ \.toast \{ opacity: 0; transform: translateY\(8px\); \} \}/, 'toast 入场应走 @starting-style');
    assert.match(styles, /\.toast\.leaving \{ opacity: 0; transform: translateY\(8px\); \}/, '离场必须走同一边（向上淡出）');
    const toastBlock = styles.match(/\.toast \{[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.ok(toastBlock.includes('transition:'), 'toast 必须带 transition');
    assert.ok(html.includes("el.classList.add('leaving')"), 'JS 侧 remove 前必须加 leaving class');
  });

  test('5. 按压态覆盖 button 族 + 全样式块无 transition: all 残留（负向扫全块）', () => {
    assert.match(styles, /button:active \{ transform: scale\(0\.97\); \}/, '必须有全局 :active 按压态');
    assert.ok(!/transition:\s*all/.test(styles), '全部样式块不得残留 transition: all');
  });

  test('6. 主题切换经 View Transitions 渐进增强包裹', () => {
    assert.ok(html.includes('document.startViewTransition'), '主题切换应走 View Transitions API');
    assert.match(html, /document\.startViewTransition\(function \(\) \{ applyTheme\(next\); \}\)/, 'applyTheme 调用应被 startViewTransition 包裹');
  });

  test('7. 视图切换：opacity 淡入 120ms（降档，不做位移）', () => {
    assert.match(styles, /section\.view\.active \{ display: block; animation: view-fade-in 120ms/, '视图淡入应为 120ms');
    assert.match(styles, /@keyframes view-fade-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/, '淡入只动 opacity');
  });

  test('8. DEF-07 解析守卫：模板内无未转义废码（内联脚本可解析）', () => {
    // 渲染产物不应出现裸 \n 序列或反引号泄漏进文本节点
    assert.ok(!html.includes('\\n  '), '模板转义泄漏：出现字面 \\n');
    assert.ok(!/style="[^"]*`/.test(html), '模板反引号泄漏进属性');
  });

  test('9. 配色不变：无新增颜色令牌、无双主题外第三主题（owner 2026-08-29 补充）', () => {
    const rootBlock = styles.match(/:root \{[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.ok(!rootBlock.includes('--bg:') && !rootBlock.includes('--panel:'), ':root 不得新增配色值（配色留在亮/暗两块）');
    assert.ok(!/data-theme="(?!light|dark)[a-z]+"/.test(html), '不得引入第三主题');
  });
});
