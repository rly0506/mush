# 核心流程浏览器验收与阻塞修复

日期：2026-09-05。范围：隔离模拟执行器，未调用外部模型，未提交或推送。

## 实测修复

1. 默认聊天通道仅支持 DEFAULT，页面却提交 HIGH，导致第一条消息 400。档位改为读取各自合同。
2. 聊天把输入直接视为执行授权。现在先停逐单审批，审批重放和失败重试保留会话关联。
3. 刷新时内联审批卡被历史重建清除；快速批准时旧等待气泡挡住新执行帧。已修复卡片恢复和重放交接。
4. 失败记录刷新后缺错误与重试入口。现在持久化状态、保留错误，重试生成新审批。
5. 工作区切换仍显示旧会话、选择标记丢失，模拟执行器也会被默认执行器替换。已隔离 UI 状态、恢复选中目录，并让注入执行器覆盖所有工作区。
6. 目录树旧响应覆盖新路径。已保护手工输入、拒绝过期响应。
7. 手机端仍用 208px 侧栏挤压聊天。新增窄屏布局，未改变整体视觉体系。

## 当前证据

- Playwright 页面操作 15/15：提交停卡、刷新审批、执行状态与完整结果、刷新结果、快速批准、失败刷新、重新审批后重试、A/B 工作区隔离与恢复、移动端无横向溢出、无未捕获页面异常、浏览器请求仅 loopback。
- 桌面 1366x900、手机 390x844，截图已人工查看。包括执行中、结果、失败恢复和工作区切换状态。
- `npm.cmd run typecheck`：exit 0。
- `npm.cmd test`：719/719，exit 0。
- `npm.cmd run test:isolated`：719/719，exit 0。
- `node --import ./tests/setup.ts scripts/g076-board-regression-baseline.cjs`：7/7，exit 0；这是 HTTP/DOM 基线，不替代浏览器验收。
- `git diff --check`：exit 0。
- Windows 进程/PowerShell fixture 在沙箱内受执行策略影响；上述两次全量是在获准的沙箱外运行，测试自身仍预加载 `tests/setup.ts`，未改系统策略。

本地证据位于 `.test-fixtures/core-flow/`：

- `run-kT53sU/browser/acceptance.json`：浏览器断言及请求记录。
- `run-kT53sU/browser/01-startup.png` 至 `10-mobile-settled.png`：截图。
- `run-kT53sU/mock-calls.json`：四次模拟执行，仅 fixture 工作区。
- `verification.json`、`final-*.log`：验证命令、退出码和原始输出。
- `evidence-manifest.json`：源码和证据的 SHA-256 锚点。
- `serve.cjs` 与 `browser-acceptance.cjs`：本机可复跑的隔离服务和 Playwright 脚本，不新增项目依赖。

## 真实渠道边界（派发前快照）

真实模型验收状态：**NOT_RUN**。模拟环境中的 real=true 仅用于经过审批状态机，执行器始终为本地注入函数。

本地脱敏配置发现：Codex 当前登记 Poke，deepseek-dsh 当前登记 tbtk，agy 登记 Google OAuth。配置发现不是余额或调用证明。未查询任何供应商远端余额、未使用 tbtk、未更改供应商或凭据路径。

当前代码的余额面仍是 mush 自身消费预算，并非账户余额。官方/第三方供应商目录虽存在，但历史可用性主要按 harness 缓存；本轮只补诚实提示，不宣称完成供应商级额度检查或选择门禁。GOAL-077 仍未完成。

真实验收准备时已运行 `scripts/scan-inflight.ps1`：未见有标题的任务窗口；4790 不可达，不能据此断言全机无在途任务。本轮未创建真实审批卡；后续需先核对实际实例与供应商状态，再由 owner 逐单点批低预算任务。

## 2026-09-05 审批重放阻塞

- 生产看板已在 `http://127.0.0.1:4790/` 启动；doctor 显示 `claude-code=READY`，激活 Provider 为“claude按次计费”。
- 首张真实验收单 `dcdd7549eca245949a2073c72b308431` 获得 owner 批准，但未调用模型：重放先将原单写成 `SUPERSEDED`，随后派发前校验抛错，替代单未落盘。
- 修复：`DispatchPipeline.rerun()` 仅在替代派发成功返回后标记原单 `SUPERSEDED`；失败时保留 `BLOCKED_WAITING_OWNER`。新增 `tests/web-dispatch.test.ts` 回归覆盖。
- 验证：`npm.cmd run typecheck` 通过；相关测试 25/25；全量 `npm.cmd test` 720/720。
- 修复后重新创建真实验收单 `3ea00839b97844edb411d4faeb036d97`，参数为 Claude Code、LOW、60 秒、`$0.10` 上限；当前仍等待 owner 审批，尚未调用模型。

## 追加：真实审批与渠道验收（2026-09-05）

- 通过当前看板实例 `http://127.0.0.1:4790/` 的同源 caller token 提交 `dispatch-3ea00839b97844edb411d4faeb036d97.json`，接口返回 HTTP `201`，并写入 append-only owner response；响应体为 `rerun: STARTED`。
- 原单 `3ea00839b97844edb411d4faeb036d97` 正确收敛为 `SUPERSEDED`，替代单为 `14dc36f1e7f84b5888cda036c2644b05`。这证明审批重放不再先制造孤儿单；新增服务器回归覆盖“执行器挂起时审批接口仍立即返回”。
- 替代单实际启动 Claude Code，激活 Provider 为“claude按次计费”，预算上限 `$0.10`、`LOW`、60 秒。上游记录 7 次 `api_retry`，均为 HTTP `503 server_error`，最终状态 `TIMEOUT`，回执为 `.mush-receipts/dispatch-14dc36f1e7f84b5888cda036c2644b05.json`，没有有效模型结果。
- 结论：**审批传输与状态重放通过；Claude Code 真实渠道验收失败（503/超时）**。未切换供应商、未追加第二笔真实单，也没有把该次记为 PASS。余额/API 权益仍不能由本地配置推断。
- 本轮新增异步审批回归后重新验证：`npm.cmd run typecheck` exit 0，`npm.cmd test` `721/721`，`npm.cmd run test:isolated` `721/721`，`git diff --check` exit 0。

