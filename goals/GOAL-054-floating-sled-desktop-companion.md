# GOAL-054: 极简系统托盘常驻伴侣与全局热键雪橇浮窗 (Floating Sled Desktop Companion)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；托盘伴侣与雪橇浮窗在库（src/companion/tray-service.ts），专测 tests/g054-*.test.ts 通过；目标池 RM-007 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + 桌面极简人机工程学
- 优先级：中（RM-007 M3）
- 依赖：GOAL-043 (协作总线), D4 (状态机)

---

## 1. 目标与价值

每次需要多 Agent 协作时打开浏览器看板仍有少量切屏与操作摩擦。

本目标旨在构建 **极简系统托盘常驻伴侣与全局快捷键浮窗（Floating Sled）**：
1. **轻量系统托盘守护（Tray Daemon）**：原生轻量托盘驻留（内存占用 < 20MB），托盘图标显示雪橇队运行状态；
2. **全局热键（Alt+Space）呼之即来**：在任意 IDE 或文本编辑器中，按下 `Alt+Space` 立即唤起极简 Spotlight 式浮窗；
3. **划词极速审查与一键速派**：支持选中代码后一键发送给 Claude/DeepSeek 开启对席辩论或快速生成单测；
4. **桌面原生通知与审批弹窗**：触发审批门时弹出非阻塞原生通知，点击直接在浮窗批准。

---

## 2. 核心架构设计

### 2.1 桌面托盘伴侣与快捷键服务 (`src/companion/tray-service.ts` [NEW])
- 纯轻量级系统托盘进程与全局热键绑定
- 通过本地 HTTP/WebSocket 与 mush 服务端握手
- 32 位 Bearer Token 自动注入

### 2.2 极简浮窗界面 (`src/companion/floating-ui.html`)
- Spotlight 风格极简输入栏与模式选择快捷键
- 划词剪贴板上下文自动关联

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g054-floating-sled-desktop-companion.test.ts`
- [ ] 验证托盘启动、退出与热键绑定生命周期
- [ ] 验证浮窗快速派发请求与主服务通讯鉴权
- [ ] 验证内存占用与零崩溃健壮性
