# GOAL-034: 看板 Carve-out 声明式写面可视化工作台 (Visual Carve-out Studio)

- 状态：`DONE`（2026-08-19 交付，基于 GP-24 / D31；全量 439 tests 全绿）
- 依据：`CONSTITUTION.md`（硬红线防御）、`DECISIONS.md` 与 API 契约演进。

---

## 1. 目标与价值

`carve-out` 是 mush 在真实任务派发中用于限定犬只写权限的声明式白名单安全门控（RM-004 M0 / D31）。此前仅有后端 API 与 token 校验，看板缺乏直观的可视化授权、生命周期倒计时与一键熔断面板。

本目标旨在打造 **看板 Carve-out 声明式写面可视化工作台 (Visual Carve-out Studio)**：
1. **切片清单查询接口**：`GET /api/carveouts`（列出所有 ACTIVE/REVOKED/EXPIRED 切片与剩余时效）；
2. **可视化切片授权工作台 (UI)**：
   - 路径范围框选与输入；
   - 时效快速预设（15分钟 / 1小时 / 24小时）；
   - 关联任务与原因留痕；
3. **动态状态与紧急熔断**：
   - 实时显示当前 ACTIVE 切片的剩余有效时间；
   - 提供一键紧急撤销（`Revoke Kill-Switch`）；
   - 派发面板一键关联当前可用切片；
4. **冻结区防御与无敏感词合规**：
   - 严格遵守零外链、无敏感凭据入库、`D:\意向项目` 黄金基准只读保护。

---

## 2. 核心架构设计

### 1. 服务端接口与契约 (`src/web/server.ts`, `src/web/api-contract.md`)
- `GET /api/carveouts`: 返回已授权切片列表（按状态与更新时间排序）；
- `POST /api/carveout/grant`: 签发新切片（支持 Caller Token 鉴权）；
- `POST /api/carveout/revoke`: 一键熔断撤销切片。

### 2. 前端看板渲染 (`src/web/page.ts`)
- 渲染 `carveout-studio` 面板；
- 包含切片卡片、授权表单、熔断按钮与倒计时标签。

---

## 3. 验收规格

- [ ] 新建自动化测试 [`tests/g034-visual-carveout-studio.test.ts`](file:///D:/mush/tests/g034-visual-carveout-studio.test.ts)；
- [ ] 验证 `GET /api/carveouts` 状态与时效计算；
- [ ] 验证 Grant / Revoke 切片生命周期与 Token 联动；
- [ ] 验证看板 HTML/JS 渲染正确且无语法/敏感词问题；
- [ ] API 契约升级至 **`v1.18`**，全量 `npm test` 保持 100% 全绿。
