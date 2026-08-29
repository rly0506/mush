# GOAL-079: 前端精修——设计令牌与动效礼节 (UI Polish: Design Tokens & Motion Manners)

- 状态：`AUTO_ACCEPTED`（owner 2026-08-29 授权立卡；方案出自头犬视觉审核 + emil-design-eng / find-animation-opportunities / apple-design 技能方法论，六机会全部过四问门禁；Kimi 施工完毕，机检规格全绿按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：GOAL-078 收官审核中发现的动效断层（popover/抽屉/toast 全部 display 硬切瞬移）+ owner 授权的前端美化方案落地
- 优先级：中（商业化门面的最后一层「手感」；纯表现层，不动任何契约）
- 依赖：GOAL-076 / GOAL-078（信息架构与胶囊体系已定型，本 Goal 只做精修不重排）

---

## 1. 目标与价值

GOAL-076/078 解决了「乱」，本 Goal 解决「糙」：当前看板所有浮层都是 `display:none ↔ block` 硬切——popover 凭空出现、抽屉瞬移、toast 离场蒸发、全站仅 1 处按压反馈。用户说不出哪里不对，但「感觉像内部工具」。本 Goal 以设计令牌为底座补齐六个经过门禁筛选的动效机会（拒绝清单见 §5，刻意比接受多），让界面从「能用」到「顺手」。

价值依据：unseen details compound——单个细节用户不会注意，聚合起来就是「这工具很靠谱」的体感（emil-design-eng 核心命题）。

## 2. 设计令牌先行（一次定义，全站引用）

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);     /* 入场反馈 */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);  /* 抽屉 iOS 曲线 */
  --dur-press: 160ms; --dur-pop: 180ms; --dur-drawer: 400ms;
  --shadow-pop / --shadow-drawer / --shadow-card;  /* 现有 3 处硬编码阴影令牌化 */
}
@media (prefers-reduced-motion: reduce) { /* 全站动效降为 1ms，a11y 底线 */ }
```

约束：只用 transform/opacity（合成层属性）；零框架、零 CDN、零构建步骤（宪法级红线延续）；全部原生 CSS/少量 JS。

## 3. 动效机会（四问门禁全过，按杠杆排序）

| # | 位置 | 现状 | 目的 | 频率档 | 方案 |
|---|---|---|---|---|---|
| 1 | `.capsule-pop` | display 硬切，凭空出现 | 空间一致性 | 偶发 | `opacity:0+scale(0.97)→1`，`--ease-out 180ms`，`transform-origin` 动态指向触发胶囊 |
| 2 | `.dispatch-drawer` | display 硬切瞬移 | 空间一致性 | 偶发 | `translateX(100%)↔0`（百分比写法），`--ease-drawer 400ms`，遮罩 `opacity 200ms` |
| 3 | `.toast` | keyframes 入场、离场瞬移 | 空间一致性 | 偶发 | 改 CSS transition（可中断重定向）：`@starting-style` 入场，**离场走同一边** |
| 4 | 全站可按压元素 | 仅 1 处 `:active` | 反馈 | 每日数十次 | 全局 `button:active { transform: scale(0.97) }`，160ms |
| 5 | 主题切换 | 全页瞬时翻转 | 防割裂 | 罕见 | `document.startViewTransition` 200ms 交叉淡化，渐进增强 |
| 6 | 左栏视图切换 | 内容区瞬变 | 防割裂 | 每日数十次 | **降档**：仅 `opacity 120ms` 淡入，不做位移 |

## 4. 模块与文件变更清单

- `src/web/page.ts` [MODIFY] — 令牌定义 + 六处动效 + `transition: all` ×6 收敛为指名属性 + 字号三档（12/13/15）收敛
- `src/web/ui/styles.ts` [MODIFY] — 阴影/时长/曲线令牌与 page.ts 内嵌样式对齐（与 ponytail 审计指出的「两个 CSS 家」合并同批施工）
- `tests/g079-ui-polish.test.ts` [NEW] — 渲染断言：令牌存在、`.capsule-pop` 含 transition 且非 display 驱动、`:active` 按压态覆盖、`prefers-reduced-motion` 块存在、toast 不用 `@keyframes` 驱动、无 `transition: all` 残留、DEF-07 解析守卫
- `scripts/g076-board-regression-baseline.cjs` [VERIFY] — 7/7 基线不破

## 5. 非目标清单（拒绝清单——门禁杀掉的目标，反向护栏）

- **不做**泳道卡片列表入场 stagger（SSE 自动刷新频率不可控，高频档直接毙）；
- **不做** ELO 天梯/路由置信度条形图加载动画（用户在读的功能数据，装饰有害）；
- **不做**犬队 logo 动效加码（现有 pulse/hop/glow 已是正当状态指示）；
- **不做**打字机/思考点改造（现状正确）；
- **不做**键盘高频操作动效（命令类交互永不动画）；
- 不动任何 API 契约、不引入框架/CDN、不改信息架构（076/078 已定型）。

## 6. 验收规格

- [x] 新建自动化测试 `tests/g079-ui-polish.test.ts` 全绿（9/9；负向断言扫全样式块，076 教训）
- [x] 六机会全部落地且各带 `prefers-reduced-motion` 降级（:root 后全局 media 块，transition/animation 双降 1ms）
- [x] 全站无 `transition: all` 残留（page.ts ×4 + styles.ts ×3 收敛为指名属性，机检钉死）、无 `@keyframes` 驱动的 toast（改 `@starting-style` 入场 + `.leaving` 同边离场）、`:active` 按压态覆盖主按钮族（全局 `button:active { transform: scale(0.97) }`，160ms）
- [x] 主题切换经 View Transitions API（不支持的原样瞬时，渐进增强）
- [x] g076 回归基线 7/7 不破；全量测试 + typecheck 全绿（670 tests / 27 suites / 0 fail）；DEF-07 解析守卫通过
- [x] 严格遵守宪法红线：零框架/零 CDN/零凭据、不动 API 契约、Windows 转义铁律（DEF-07 教训：模板内 `\n` 双写）
- [x] owner 补充（2026-08-29）：配色维持「月之亮/暗面」现有色值不变——仅令牌化收纳阴影/时长/曲线，无新颜色令牌、无第三主题（g079 测试 §9 钉死）

## 6.1 实机验证证据（真实 Chromium，Playwright）

`node scripts/g079-verify-runner.cjs`（fixture 隔离起板 + 真浏览器断言，`scripts/verify-g079.py`）输出要点：

- POP_BASE `display:flex opacity:0 visibility:hidden`；POP_MID opacity=0.997（过渡中）；CLOSING 时 visibility 延迟仍 visible、opacity 淡出中 ✓
- DRAWER_BASE `visibility:hidden`；MID transform=matrix(...,38.4,0)（滑入中）；OPEN transform=none ✓
- TOAST `animation:none transition:opacity,transform`，离场走 leaving 同边 ✓
- PRESS_RULES 含 `button:active { transform: scale(0.97) }` ✓
- VT hasVT=true（Chromium 走包裹）；reduced-motion 块存在 ✓；主题切换后 data-theme=dark ✓
- 视图切换 MID opacity=0.74 → FINAL 1（120ms 淡入，无位移）✓
- JS_ERRORS=[]（真实浏览器无渲染断链）✓；截图归档 `.playwright-mcp/g079-*.png`

## 6.2 验收裁定偏差补账（头犬 zcode 裁定 2026-08-29，append-only，不改写 §3/§4 原文）

- **P2-1 空证据已修**：`verify-g079.py` 原读 `window.__errs`（无写入方，永空断言），已改 `page.on("pageerror")` 真监听且遇错退出码 1，重跑确认真实无错。
- **P2-2 遮罩维持不做**：§3 机会 2 写了「遮罩 opacity 200ms」，但抽屉实际没有遮罩元素（076 遗留行为：× 按钮 + Esc 关闭）。经 owner 对账维持现状，规格该项以本条记录替代。
- **P2-3 字号收敛维持不做**：§4 写了「字号三档（12/13/15）收敛」，实际页面存 9/10/11/12/13/14/15/16/18px 九档。收敛涉及全站字号排权重排，超出「动效精修」范围且风险高于收益，维持现状，规格该项以本条记录替代。
- **P3-1 已修**：`src/companion/floating-page.ts:90` 残留 `transition: all` 已收敛为指名属性；g079 测试负向断言口径扩至 companion 浮窗样式。
- **P3-2 已披露**：origin 静态钉角（top left / top right）替代规格的「动态指向触发胶囊」——效果等价、少写 JS，裁定认可为正确 YAGNI。
- **AGENTS.md 基线更正**：全量基线 661 系 078 落库时记错的账，真实基线为 658（076 收官 652 + 078 新增 6）；本次工作树 670 = 658 + 9（g079）+ 3（TBTK 在途，另一犬的活）。

## 7. 施工分期

- **P1（约 60 行 CSS + 5 行 JS）**：机会 1/2/3（popover/抽屉/toast）——078 刚落地，此刻补过渡成本最低；
- **P2**：按压态 + View Transition + 令牌收敛（与「两个 CSS 家」合并同批）。
