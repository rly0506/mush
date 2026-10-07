# GOAL-052: 影子评测与实战战绩 ELO 天梯榜引擎 (Auto-Benchmark ELO Engine)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；ELO 天梯在库（elo-engine.ts），专测 tests/g052-*.test.ts 通过；目标池 RM-007 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + 竞技对战 ELO 算法
- 优先级：高（RM-007 M1）
- 依赖：GOAL-040 (影子分流评测), GOAL-039 (智能路由)

---

## 1. 目标与价值

各大模型厂商宣传的纸面 Benchmark 与本地实际工程实战往往存在偏差。

本目标旨在构建 **基于实战与影子对决的 ELO 战绩天梯榜引擎**：
1. **自动影子分流盲测**：在后台针对代表性代码任务自动并行派发不同犬只，进行盲审对决；
2. **多维综合 ELO 评分体系**：
   - 代码一次通过率（Pass@1 weight: 40%）；
   - 消耗 Token 能效比（Token Efficiency weight: 30%）；
   - 响应与执行延迟（Latency weight: 15%）；
   - 安全与无越权表现（Security weight: 15%）；
3. **在册犬天梯排行榜大屏**：直观呈现全队犬只段位（Grandmaster / Master / Diamond / Gold）与胜负战绩走势图。

---

## 2. 核心架构设计

### 2.1 ELO 评分与战绩引擎 (`src/orchestration/elo-engine.ts` [NEW])
- `DogEloProfile`: `{ adapter_id, elo_rating, matches_played, win_rate, rank_tier }`
- `updateEloAfterMatch(winnerId: string, loserId: string, matchMetrics: MatchMetrics): void`
- `calculateGlobalEloRankings(): DogEloProfile[]`
- 持久化至 `runtime/elo/rankings.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/elo/rankings`：获取全队战绩天梯榜
- `POST /api/elo/match`：登记比赛/实战结果（Caller Token 鉴权）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g052-auto-benchmark-elo-engine.test.ts`
- [ ] 验证 ELO 积分公式与多维权重计算
- [ ] 验证段位升降级逻辑与战绩持久化
- [ ] 验证前端排行榜图表渲染与零外部资源泄露
