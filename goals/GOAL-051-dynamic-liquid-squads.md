# GOAL-051: 液态临时战时攻关小队与指挥犬选举协议 (Dynamic Liquid Squads)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；液态小队在库（liquid-squad.ts），专测 tests/g051-*.test.ts 通过；目标池 RM-006 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + 液态组织学 (Holonic Multi-Agent System)
- 优先级：中（RM-006 M4）
- 依赖：GOAL-039 (智能路由), GOAL-050 (共享黑板)

---

## 1. 目标与价值

面对突发的疑难攻坚任务，固定的层级结构不够敏捷。

本目标旨在构建 **液态临时战时攻关小队与动态选举机制**：
1. **战时指挥犬自适应选举**：根据任务特征（如重构、逆向分析、并发调优）自动选举当前领域置信度最高的犬担任临时 Squad Lead；
2. **敏捷小队动态集结（Liquid Squad Assembly）**：动态绑定 2~3 只具备互补能力的犬建立临时作战单元，分流子任务；
3. **任务结束自动解散与经验沉淀**：任务验收完成后，临时小队自动解散并清理瞬时状态，核心结论沉淀入符号记忆图谱。

---

## 2. 核心架构设计

### 2.1 液态小队调度器 (`src/orchestration/liquid-squad.ts` [NEW])
- `LiquidSquad`: `{ squad_id, task_id, lead_dog, member_dogs, status: 'FORMED' | 'ACTIVE' | 'DISBANDED' }`
- `electSquadLead(taskFeatures: Record<string, number>): string`
- `formLiquidSquad(taskId: string, memberDogs: string[]): LiquidSquad`
- `disbandLiquidSquad(squadId: string): void`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/squads`：创建液态攻坚小队（Caller Token 鉴权）
- `GET /api/squads`：查询活跃小队状态
- `POST /api/squads/:id/disband`：解散小队并归档

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g051-dynamic-liquid-squads.test.ts`
- [ ] 验证指挥犬自适应选举与小队动态组建
- [ ] 验证小队协同执行与完成后的干净解散
- [ ] 验证端点安全性与无内存泄漏
