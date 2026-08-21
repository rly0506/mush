# GOAL-046: 红蓝对抗验证室与闭环自动打回流 (Red-Blue Verification Studio)

- 状态：`PROPOSED`（RM-005 M3 核心规划，2026-08-19 立项）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + RM-005 路线图 + `llm-as-a-verifier`
- 优先级：高（RM-005 M3）
- 依赖：GOAL-028 (独立 Verifier), GOAL-043 (协作总线)

---

## 1. 目标与价值

落实 `llm-as-a-verifier` 核心哲学：**生成与验证物理硬隔离（Generator !== Verifier）**，消除生成犬自写自审带来的逻辑盲区与自证陷阱。

本目标旨在构建 **红蓝对抗攻防室与闭环自动打回修正流**：
1. **角色物理隔离与对抗性视角**：指定具备破坏性测试能力的独立 Verifier 犬（如 DeepSeek/ZCode）作为红方，生成犬作为蓝方；
2. **破坏性测试用例自动构造（Fuzzing & Red-Teaming）**：红方专门编写极端边界、越权注入、并发竞态、死锁与内存溢出的破坏性用例；
3. **闭环自动打回流（Correction Loop）**：若破坏性测试爆出 Bug，系统自动携带错误现场、堆栈与断言失败原因打回给蓝方重写，直到全绿或达到最大重试熔断；
4. **攻防双色视窗工作台**：顶部提供「攻防室」视图，左侧展示蓝方实现，右侧展示红方用例与爆破点热图。

---

## 2. 核心架构设计

### 2.1 红蓝攻防闭环引擎 (`src/orchestration/verifier-loop.ts` [NEW])
- `VerificationRound`: `{ round: number, generator_diff: string, attack_tests: string[], pass: boolean, failure_context?: string }`
- `runRedBlueLoop(taskId: string, generatorDog: string, verifierDog: string, maxRetries?: number): Promise<RedBlueResult>`
- 持久化至 `runtime/verifications/<task_id>.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/verify/red-blue`：启动红蓝对抗验证任务（Caller Token 鉴权）
- `GET /api/verify/red-blue/:id`：获取对抗历史与用例详情

### 2.3 前端攻防双色视图 (`src/web/ui/views/red-blue-view.ts`)
- 蓝方代码视窗 vs 红方破坏性用例视窗
- 爆破点高亮与打回重写进度条

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g046-red-blue-verification-studio.test.ts`
- [ ] 验证 `Generator !== Verifier` 硬隔离与自审拦截
- [ ] 验证测试失败时自动打回重修与上下文携带逻辑
- [ ] 验证全绿放行与最大重试次数熔断保护
- [ ] 验证端点安全性与无外部 CDN 泄露
