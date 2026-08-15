# 外部项目参考评估（2026-08-15）

评估框架沿用 agent-bridge（意向项目侧）黄金参照时代的对比维度：治理深度、部署形态、
证据纪律、模型绑定、完成语义。结论只代表评估时点。

## 1. zcode-app-cli（kingsword09/zcode-cli，npm: zcode-app-cli）— RETAIN（适配器候选）

- **是什么**：ZCode Desktop 官方 agent runtime（extracted `zcode.cjs` 内核）的非官方
  终端客户端，本地 TUI 基于 `@earendil-works/pi-tui`（与 Pi 同生态）。
- **对 mush 适配器合同三条件**：headless 入口 ✅（`--prompt`/`--print`/`--target`
  非交互模式，`--json` 结构化输出）；运行时身份可证明 ✅（官方 runtime 承载模型/
  凭据/MCP/会话，非重实现）；完成可机检 ⚠️ 待实测（--print 输出格式需探测，
  预期可复用 Pi adapter 的事件流解析经验）。
- **接入定位**：`glm→zcode` 专属武器的第三个适配器（M3 双犬稳定后）。
- **注意**：非官方项目（评估时 ⭐7，活跃）；README 自提醒 runtime 再分发需上游
  允许——个人使用可，mush 开源时不得捆绑。Windows 下避开 .cmd 垫片，直接
  `node.exe + 入口 js` 启动（意向项目 Directive 5 的 pi.ps1 stdin 教训）。
- **接入前置**：全局 npm 安装走宪法触发门；先零成本探测 --print 输出格式与
  模型身份报告方式。

## 2. agent-bridge（xyva-yuangui/agent-bridge，⭐13，Apache-2.0）— RETAIN（先行参照）

- **是什么**："Make Claude Code, Codex, Reasonix, ZCode work as one team"——
  本地任务看板：agents 经各自 harness 钩子（Codex: AGENTS.md 指令+MCP；
  Claude Code: UserPromptSubmit hook；ZCode: plugin hook）向共享
  `~/.agent-bridge/board.json` 签到认领任务；Python stdlib、无常驻进程、
  252 测试、跨平台。
- **定位辨析（重要）**：它是**被动协调的看板层**，不是编排器——没有父级调度、
  派发、审查循环、预算门、模型身份 fail-closed、证据哈希。mush 的核心
  （父→子 loop + 触发门治理 + 证据链）它都没有；反过来它的"各 harness 内
  钩子签到"设计是 mush 看板（M5）值得借鉴的：犬只在自己的 harness 内部
  就能报告状态，不需要父级轮询。
- **与名字冲突**：仓库名与意向项目的 `.agent-bridge/` 撞名纯属巧合，无关联。

## 3. EchoBird（edison7009/EchoBird，⭐3019）— RETAIN（能力发现参考）

- **是什么**：一键安装 + 模型切换器，覆盖 Claude Code / Codex / Grok Build /
  Kimi / Qwen Code / OpenCode / ZCode / Pi / OpenClaw 等十余家 CLI。
- **对 mush 的价值**：A2"专属武器矩阵"的 capability scan 现成参照——它的
  安装检测/provider 切换逻辑可以直接对标设计 mush 的犬只注册流程；
  也验证了"多 CLI 共存管理"是有真实需求的普遍痛点。

## 收录检查表（沿用意向项目惯例）

新增参考时回答：解决什么真实问题 / 可独立借鉴的原则 / 不适合的依赖或假设 /
现在采用-候选验证-暂缓-拒绝 / 是否触碰宪法红线（全局包、密钥、无人值守）。
