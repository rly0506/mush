# GOAL-074: 放闸就绪认证与演练战报总纲 (Unattended Readiness Certification)

- 状态：`DONE`（2026-08-27 复验收官：六项证据聚合 READY + **放闸就绪门禁落地**——PUT policy 档位提升被 readiness gate fail-closed 锁定、降级恒通（409 点名失败项）；认证字段对齐契约 `evidence_hash`/`aux_sha256` 且 E4 补齐句柄/RSS 双曲线判定与损坏行 fail-open 封堵；readiness 端点补录 v1.13；报告 docs/dispatch/rm011-readiness-certification.md 归档。此前「DONE」宣称时向导门禁与契约补录实际缺席，经审核退回补完后方为本收官。RM-011 战报总纲：M0~M4 全线 DONE。D8 默认值翻转权仍归 owner——随时可开、开不开由你）
- 来源：头犬提案，owner 规划会批准；D8 默认值翻转权归 owner，本 Goal 只交认证证据
- 优先级：中
- 依赖：GOAL-073

---

## 1. 目标与价值

把「敢不敢开无人值守」从主观判断变成机检可验的证据链。本 Goal 构建就绪度 checklist 引擎，聚合 RM-011 全程证据（演练战报、混沌恢复记录、soak 曲线、熔断演练、审计回放包），输出《无人值守放闸就绪认证报告》与一键开启向导——开启与否、何时开启，由 owner 持有终裁权。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/core/readiness-certifier.ts` [NEW] — 证据聚合与逐项机检（每项关联具体测试/工件哈希锚点）
- `src/web/page.ts` [MODIFY] — 放闸向导 UI：证据清单 → 风险披露确认 → （owner 显式操作后）档位提升入口
- `docs/dispatch/rm011-readiness-certification.md` [NEW] — 认证报告归档

### 2.2 关键接口与数据契约
- `GET /api/unattended/readiness` 返回逐项 `{ id, title, passed, evidence_hash }`；
- 契约升版记录 api-contract.md。

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g074-readiness-certifier.test.ts` ✅（9/9 全绿；另有 `tests/g074-readiness-gate.test.ts` 4/4——放闸门禁 HTTP 层用例）
- [ ] 证据缺失任一项即整体 NOT_READY（fail-closed 断言） ✅（缺 soak/空仓库/坏行/泄漏曲线四路实测均拦下）
- [ ] 向导流程在证据齐备时才解锁档位提升操作 ✅（2026-08-27 落地：rail 面板未就绪禁高阶选项 + 认证报告折叠清单 + 提升前风险披露 confirm；后端 PUT `/api/unattended/policy` readiness gate 409 兜底——双保险均 fail-closed）
- [ ] 输出认证报告并归档；RM-011 战报总纲收官 ✅（scripts/readiness-certify.mjs 可重放刷新）
- [ ] 严格遵守宪法红线：不自动变更 D8 默认值，零凭据泄露 ✅
