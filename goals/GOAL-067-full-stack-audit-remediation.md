# GOAL-067: 全栈 Review 修复与冗余清理 (Full-Stack Audit Remediation and Redundancy Cleanup)

- 状态：`IN_PROGRESS`
- 来源：owner 授权（2026-08-22 对话裁决：Q1 记录不退出 / Q2 实现真过滤 / Q3 一次做完；F1 选 A 补路由、F2 选 B 归档 loop、F3 折中真数据+标注、S5 选 A 文档明示+UNC 阻断）
- 优先级：高
- 依赖：无（基于 978648f 之后的工作区）

---

## 1. 目标与价值

七组并行深审发现全栈缺陷：启动可靠性（撕裂行致看板无法启动）、进程崩溃面（void handler 裸 fs 写入无兜底）、审计账本口径失真（违反宪法证据纪律）、安全边界缺口（time-travel 穿越/UNC 探测/session_id 注入）、前端协作层鉴权 Bug 与功能坏死路由。本 Goal 按 owner 点批的 P0-P3 四批次一次性修复，并完成死代码清理，恢复"审计可信、边界自洽、叙事与现实一致"。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单

P0 止血：
- `src/web/persistence.ts` [MODIFY] — 三处 JSONL 读回逐行容错 + releaseLock 防御
- `src/web/server.ts` [MODIFY] — 异步 handler 异常包装 + unhandledRejection 日志兜底
- `src/adapters/t1-runner.ts` [MODIFY] — 超时 kill 后第二看门狗强制 settle
- `src/adapters/claude.ts` [MODIFY] — spawn 副本补 shim 解析 + stdin onError（消除复制漂移）
- `src/web/audit-export.ts` [MODIFY] — event-log-* 聚合、DispatchRecord 终态成功率、time_range 真过滤、审批口径对齐 sources.ts
- `scripts/scan-inflight.ps1` [MODIFY] — 终态集合补 REJECTED/SUPERSEDED（纯 ASCII）

P1 安全收口：
- `src/orchestration/time-travel.ts` [MODIFY] — 快照读侧 + 还原写侧路径包含性校验
- `src/orchestration/distiller.ts` [MODIFY] — saveMemory basename 纵深防御
- `src/web/server.ts` [MODIFY] — distill session_id 白名单；fs-tree UNC 拒绝
- `src/web/dispatch.ts` [MODIFY] — record.model_id → record.request?.model_id 归因修正
- `src/web/ui/client-scripts.ts` [MODIFY] — 鉴权头补齐、request_file 字段名、approvals 数据端点改接真实源

P2 功能对齐：
- `src/web/server.ts` [MODIFY] — 新增 GET /api/child-sessions、POST /api/child-sessions/chat、GET /api/harness/doctor
- `DECISIONS.md` [APPEND] — D80：src/loop/* 归档为 fixture 参照
- `src/loop/README.md` [NEW] — 归档身份标注
- `docs/api-contract.md` [MODIFY] — 威胁模型章节 + 新路由契约
- `src/web/page.ts` / `src/web/ui/views/bounty-view.ts` / `client-scripts.ts` [MODIFY] — 战报角标、仲裁按钮接真实状态、撮合按钮恢复
- `src/web/tasks.ts` [MODIFY] — GOAL- 前缀严格匹配

P3 清理：
- `src/schema/index.ts`、`src/web/ui/icons.ts` [DELETE]
- 死语句/死导入/不可达 return 清理；sha256Hex/esc/HEAD_DOG_CHARTER/VerifierDecouplingError 收敛；CSS 双定义清理
- tests ×3 ChatStreamEvent → ChatFrameEvent

### 2.2 关键接口与数据契约

- 新增契约端点写入 docs/api-contract.md（child-sessions×2、harness/doctor）
- time-travel 边界校验复用 diff-collector 的 normRoot+sep 标准（抽共享 helper 放 core）
- 台账读回容错语义：坏行跳过 + stderr 告警，不中断回放

---

## 3. 验收规格

- [ ] 全量 npm test 全绿（baseline 557 只增不减）
- [ ] 新增回归：撕裂行容错、time-travel 穿越×4、UNC 阻断、session_id 白名单、GOAL 正则反例、child-sessions 路由契约
- [ ] DECISIONS.md D80 append-only 落痕
- [ ] DONE 判定权归 owner（D15），机检全绿仅升 AUTO_ACCEPTED
