# GOAL-084：C6/A6 审批准备收口（2026-10-03，Codex 接续）

状态：两张真实待批准申请已在 http://127.0.0.1:4790/ 可见；**未批准、未复位真实熔断、未执行模型**。Goal 保持 PROPOSED。

## 两张具体请求

| 包 | 模型 | 派发号 | 状态 |
| --- | --- | --- | --- |
| C6 | Codex / gpt-5.5 | 70e4d1ceaf564a0fb6bacb0bd68113c4 | BLOCKED_WAITING_OWNER |
| A6 | Antigravity / gemini-3.7-flash-high | d8165a61f9f943c697cf0e14d92d838e | BLOCKED_WAITING_OWNER |

卡片位于 `goals/receipts/approval-requests/dispatch-<id>.json`。两包 LOW、180s、cap_usd=0.10，实际费用与账户权益仍 UNKNOWN。scope 仅输出格式核验，成功也不构成五维权限通过。

C6 限制为 `--sandbox read-only`；A6 为 `--sandbox --disable-slash-commands`。schema 只允许 body=PROBE_SCHEMA_OK / stance=support，哈希 `BB1082FCECFDBB8CF9AABB4F60A79A44C0AA6F983EF89BA87C459304469B9978`。工作目录为宿主 `runtime/collab-probes/C6|A6/workspace`，登记合成目录但 owner 活动工作区保持 D:\mush。

## 接手时查到的真实阻塞

GLM 的旧 C6/A6 请求（0e7b7e1dd7e642dcaaba53461112c012 / f3adccc8d4f74808ba9957c1fe8f3a36）都被同一个全局 CircuitBreaker 拒绝。trip 时间为 2026-09-06T13:03:41.680Z、reason=连续失败 3 次；不是本轮 Codex 或 agy 模型执行失败。这两单无完整模型/schema 冻结，不沿用、不重试，原记录保留。

只向 ordinary `POST /api/dispatch` 塞 outputSchema/restrictTools 不会产生 internal 执行配置；原来“202 已受理”也不等于已创建审批卡。

## 本轮实现

- 增加宿主固定的 `POST /api/collaboration/probes/prepare`，只接受 packet_id=C6/A6。固定模型、schema、限制参数、时间与预算阈值；不开放 caller 提供 internal/凭据/provider。
- 准备路径先静态校验、独立快照、指纹、落卡：不调用 runner/liveness，不占预算，不解除熔断。重复同一未变包复用待批准记录。
- 获批执行继续检查旧门。停机时 APPROVED 返回 409，尚不写 owner-response；REJECTED 可用。准备记录不允许借 real=false 重跑绕过审批。探针关闭隐式故障转移。
- source：`src/web/collaboration-probes.ts`、dispatch/server/sources；契约 v1.53。GLM 已完成的审批展示、合同漂移拒绝与资产迁入 tests/fixtures 保留并验证。
- 新增 6 条聚焦测试，先红后绿；另 gp32 + probe-assets 共 17/17、typecheck exit 0。已重载空闲的原看板，仅停止确认 PID 的实例；真实熔断文件未更改。

## 证据与当前限制

产物目录：`.test-fixtures/g084-takeover-2026-10-03/`。

- `actual-prepared-cards.json`：两包数据、冻结字段、实际 UI 投影、breaker 文件前后哈希相同（`34995e65…`）；两 actor 准备前后 spent_usd=0、admission_count 保持 codex=0 / agy=1。
- Playwright 实际页面读取两张内联卡，展开 schema/Prompt；模型/限制/schema/哈希/指纹均可见。截图 `actual-approval-cards.png`、`actual-approval-details.png`；批准按钮点击 0 次。
- 宿主执行环境（仍预加载 tests/setup.ts 隔离用户目录、账本和模型 fixture）：默认全量与独立全量 **826/826，exit 0**。完整 stdout/stderr/结果 JSON：full-host / isolated-host；stdout sha256 分别 `737f5d93…` / `7ad062b1…`。
- 受限沙箱下默认全量日志 **822/826**（Windows PowerShell 执行策略失败与 browse-native 断开测试），未取得 npm 自然退出；独立默认模式亦被 Windows 探针阻塞后终止；日志完整保留。仅测试子进程 Bypass 的对照全量 **823/826 exit 1**，失败转为进程/端口检查。未把这些结果抹掉或称“原环境全绿”，未修改系统策略。
- g076 HTTP/DOM 冒烟 7/7（不代替上述实际浏览器验收）；docs-reconcile PASS（47 映射/v1.53/D87）；相关 tracked 源码 diff --check exit 0。历史 persistence/pi-rpc 间歇失败根因未借本次通过而宣称已解决。

## Owner 下一步

熔断仍为 halted。代码明确“恢复必须 owner 显式 reset”（src/core/circuit-breaker.ts）。需要 owner 决定复位这项旧全局熔断；**复位不等于批准模型调用**。随后 owner 在看板分别点批 C6/A6，执行结果按回执再核验；同一包不另开第二通道、不自动重试。

未提交、未推送；没有清理或覆盖无关在途改动。

## 后续执行补注（2026-10-03）

Owner 随后授权“修复+你可以自主操作浏览器审批”。旧熔断已按授权复位，C6/A6 已经真实运行并通过格式核验；本页正文保留为当时准备证据。A6 档位修为 HIGH，旧卡/失败保留，新卡批准记录注明委托。现状以 [实弹执行报告](goal084-schema-probes-live-2026-10-03.md) 为准；五维准入仍未验证，Goal仍PROPOSED。
