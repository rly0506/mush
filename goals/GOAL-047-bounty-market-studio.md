# GOAL-047: Contract Net 悬赏招投标市场与动态撮合池 (Bounty Market Studio)

- 状态：`PROPOSED`（RM-005 M4 核心规划，2026-08-19 立项）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + FIPA Contract Net Protocol
- 优先级：中（RM-005 M4）
- 依赖：GOAL-039 (智能路由画像), GOAL-027 (用量与单价监控)

---

## 1. 目标与价值

在多任务并发场景下，静态派发容易造成某只犬队列积压而其他犬闲置，资源利用率低下。

本目标旨在构建 **Contract Net 自由悬赏与招投标撮合大厅**：
1. **任务公开发标（Call for Proposals - CFP）**：将任务池中的 Goal 或 Bug 挂牌悬赏，标明预算上限（Cap USD）与交付截止要求；
2. **自主竞标算法（Bidding Algorithm）**：各在册犬根据当前并发负荷、上下文水位、领域擅长分与单价自动提交竞标出价（Bid: 预计耗时、预估成本、置信度）；
3. **最优性价比撮合授标（Awarding）**：系统自动完成最优出价撮合并授标执行，支持超载自动分包转包；
4. **任务拍卖大厅工作台**：顶部提供「悬赏大厅」视图，展示任务挂牌牌面、各犬竞标出价与实时撮合看板。

---

## 2. 核心架构设计

### 2.1 悬赏招投标撮合引擎 (`src/orchestration/bounty-market.ts` [NEW])
- `BountyTask`: `{ bounty_id, title, max_cap_usd, status: 'OPEN' | 'BIDDING' | 'AWARDED' | 'SETTLED' }`
- `DogBid`: `{ adapter_id, estimated_cost_usd, estimated_time_ms, confidence_score }`
- `matchOptimalBid(bountyId: string, bids: DogBid[]): DogBid`
- 持久化至 `runtime/bounties/<bounty_id>.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/bounties`：发布公开悬赏标（Caller Token 鉴权）
- `GET /api/bounties` & `GET /api/bounties/:id/bids`：查询悬赏与竞标看板
- `POST /api/bounties/:id/award`：确认授标并拉起派发

### 2.3 前端悬赏大厅视图 (`src/web/ui/views/bounty-view.ts`)
- 任务悬赏牌、各犬出价走势图与自动撮合看板

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g047-bounty-market-studio.test.ts`
- [ ] 验证 Contract Net 发标、投标、撮合与授标全流程
- [ ] 验证基于负荷与单价的最优竞标撮合算法
- [ ] 验证端点鉴权与状态持久化
- [ ] 验证前端 HTML/CSS 渲染正确，无外部资源依赖
