# GOAL-074: 放闸就绪认证与演练战报总纲 (Unattended Readiness Certification)

- 状态：`IN_PROGRESS`（RM-011 M4 终局；认证引擎/端点/初版报告落地，当前 NOT_READY——E4 8h soak 收官后重跑 `node scripts/readiness-certify.mjs` 刷新为 READY 即总纲收官；soak 摘要位于独立工作区 runtime，刷新前拷贝至 `<repo>/runtime/soak-summary.json`）
- 状态备注：`READY`（RM-011 M4 原值，2026-08-25 开工）
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

- [ ] 新建自动化测试 `tests/g074-readiness-certifier.test.ts`
- [ ] 证据缺失任一项即整体 NOT_READY（fail-closed 断言）
- [ ] 向导流程在证据齐备时才解锁档位提升操作
- [ ] 输出认证报告并归档；RM-011 战报总纲收官
- [ ] 严格遵守宪法红线：不自动变更 D8 默认值，零凭据泄露
