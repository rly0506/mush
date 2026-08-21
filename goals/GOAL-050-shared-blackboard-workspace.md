# GOAL-050: 跨犬共享黑板协作空间与读写白名单仲裁 (Shared Blackboard Workspace)

- 状态：`PROPOSED`（RM-006 M3 核心规划，2026-08-19 立项）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + 经典 AI 黑板模型
- 优先级：中（RM-006 M3）
- 依赖：GOAL-042 (点对点信箱), GOAL-034 (写面白名单)

---

## 1. 目标与价值

传统的中央层级派发中，所有信息必须经头犬中转，存在“中转税（Relay Tax）”与上下文衰减。

本目标旨在构建 **跨犬共享黑板协作空间（Shared Blackboard Architecture）**：
1. **多分区黑板内存拓扑**：划分为 `Artifacts`（共享工件区）、`OpenIssues`（待攻坚疑难区）、`Hypotheses`（方案假设区）与 `Decisions`（已定决议区）；
2. **细粒度读写白名单仲裁**：为各犬分配只读、追加（Append-Only）或独占写权限，彻底防止并发编辑冲突；
3. **事件驱动条件唤醒（Blackboard Triggers）**：当指定黑板区域发生状态变更（如测试犬在 OpenIssues 登记新缺陷）时，自动唤醒订阅该区域的修复犬。

---

## 2. 核心架构设计

### 2.1 共享黑板引擎 (`src/orchestration/blackboard.ts` [NEW])
- `BlackboardSection`: `'artifacts' | 'issues' | 'hypotheses' | 'decisions'`
- `BlackboardItem`: `{ id, section, author_dog, content, version, tags }`
- `writeBlackboard(item: Omit<BlackboardItem, 'id' | 'version'>, callerToken: string): BlackboardItem`
- `subscribeSection(section: BlackboardSection, callback: (event: BlackboardEvent) => void): void`

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/blackboard` & `GET /api/blackboard/:section`：获取黑板分区数据
- `POST /api/blackboard`：写入黑板数据（Caller Token 鉴权保护）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g050-shared-blackboard-workspace.test.ts`
- [ ] 验证黑板分区读写、版本自增与白名单权限拦截
- [ ] 验证事件驱动条件唤醒与下游犬通知
- [ ] 验证端点鉴权与并发安全
