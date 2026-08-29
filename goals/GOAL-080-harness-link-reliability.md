# GOAL-080: 犬链可靠性——探针阶梯、派发预检与故障转移 (Harness Link Reliability: Liveness Ladder, Pre-flight Gate & Failover)

- 状态：`AUTO_ACCEPTED`（2026-08-29 收官：头犬施工 → 独立子代理审计一轮（缺口全数修复）→ UI 收尾完成。最终交付：探针阶梯 L0-L3（L2/L3 由 live-probes 台账权威回填，恒零成本——测试断言仅发 `--version`/合同声明探针，零 LLM 请求）/派发预检门（10min TTL、REJECTED 零台账副作用、L0 失败带修复指引）/故障转移（同审批预算包络内换道一跳、候选犬过预检才换、failover_from+attempt 旁路回执、record.adapter_id 归因实际执飞犬、熔断停机即停链）/**诚实标签 UI 落地**——犬卡级位徽标（`data-liveness-badge`，`/api/dogs/liveness` 60s 轮询，PROCESS_ONLY=「可调度·未实弹」绝不冒充实弹）。**去向决议**：能力注册表中间档字段不再新增——UI 直接消费阶梯 label 即唯一事实源，注册表再存一份属冗余（YAGNI）。g080 测试 10/10 + 全量 698/698 + typecheck 0 + 基线 7/7；D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：owner 三关切（体验/链接/完成率）之二 + 头犬能力雷达评审（无人值守自主性 6.5 的欠账在「建成未证明」）
- 优先级：高
- 依赖：无硬依赖——零件已在库：G025 实测探测、G026 零 Token 信度梯队、D13 nonce 身份探测、G070 opencode 免费通道、G053 路由自进化、能力注册表

---

## 1. 目标与价值

现状：探针是手动按 ⚡ 的、结论是参考性的（派发不强制预检）、状态有时效（注册时在线 ≠ 发车时在线）。G072 实测的失败模式——opencode 夜间 ~60% 静默失败、kimi/zcode 403 预扣费失败、dsh cordos 崩溃——全部是**发车后才发现**。本 Goal 把「检测得准」升级为「断了有人接」：零成本探针阶梯 + 派发预检门 + 运行时故障转移，让 8h soak 里那 4 次上游抖动从「任务失败」降级为「换道重试的日志行」。

价值：无人值守的地基——没人看管时，「叫得动犬」是一切的前提；同时直接改善有人值守体验（人话预检报错 vs 900 秒黑箱超时）。

## 2. 核心架构设计

### 2.1 探针阶梯（Liveness Ladder）

| 级 | 检什么 | 方法 | 成本 | 置信 |
|---|---|---|---|---|
| L0 进程层 | 可执行文件存在且能起 | `--version`/`--help` 退出码 | 恒 0 | 进程可拉起 |
| L1 鉴权层 | key/订阅有效 | HTTP `GET /v1/models`（OpenAI 兼容系免费）；CLI `--dump-config`/配置枚举（dsh/opencode 实证路径） | 恒 0 | 鉴权可通 |
| L2 免费实弹 | 端到端一轮 | opencode free / agy OAuth 发 `回复 ok` | $0 | 真跑得通 |
| L3 微额实弹 | 付费计费链路 | ≤20 token 微单 | ≈$0.001 | 计费链路健康 |

### 2.2 模块与文件变更清单
- `src/core/liveness-ladder.ts` [NEW] — 各级探针实现 + 结果缓存（TTL 10min）+ 信度评级
- `src/web/dispatch.ts` [MODIFY] — **派发预检门**：缓存过期自动跑 L0+L1（毫秒级），不过即 fail-closed，错误信息带修复指引（如「dsh 不在 PATH → scripts/setup-harnesses.cmd」）
- `src/web/dispatch.ts` [MODIFY] — **运行时故障转移**：exit 1/超时/403 预扣费失败 → 按信度梯队自动换已验证犬重试该次派发（子级级直换，不经头犬重规划），台账留痕 `failover_from`
- `src/adapters/contract.ts` [MODIFY] — 契约增 `liveness` 声明（各通道 L1 方法注记）
- 能力注册表 [MODIFY] — probe_status 增中间档「可调度·未实弹」（L0/L1 过而 L2 未跑，禁止冒充 🟢——诚实原则）
- `src/web/page.ts` [MODIFY] — 犬卡与派发表单显示探针级位 + 新鲜度（「🟢 实测在线 · 3 分钟前」）

### 2.3 关键接口与数据契约
- `GET /api/dogs/liveness`（契约 v1.14）：逐犬 `{ adapter_id, level_reached, level_confidence, checked_at_utc, next_tier_cost }`；
- 派发台账增 `preflight: { level, checked_at_utc }` 与 `failover_from?: adapter_id` 字段；契约升版记录 api-contract.md。

## 3. 验收规格

- [x] 新建自动化测试 `tests/g080-liveness.test.ts`：阶梯各级 fail-closed 单测（L0 缺失/L1 401/L2 超时的判级与降档） ✅（10/10：L0 失败→DEAD、L1 401→DEAD、实弹台账 free→L2/付费→L3、>24h 降档回 L1、TTL 缓存、预检门、换道、候选犬死亡不换道、熔断协同、UI 收尾标记）
- [x] 预检门：过期缓存触发 L0+L1，通道坏时派发被拒且错误含修复指引（断言不产生任何 LLM 调用——零成本断言） ✅（REJECTED 零台账副作用——断言台账文件根本未创建；spawnCalls 全为 `--version`；L0 失败 detail 带 setup-harnesses 指引）
- [x] 故障转移：注入首犬 exit 1 → 自动换道重试成功且台账含 `failover_from`；全员失败 → 任务受阻并进监理滞涩队列（GOAL-082 接口预留） ✅（换道成功 + failover_from + attempt1 旁路回执 + 单次 admission；候选犬探针死亡不换道；失败→noteBlocked 已接线监理）
- [x] 诚实标签：L0/L1 过而 L2 未跑显示「可调度·未实弹」，不得计为 ONLINE ✅（PROCESS_ONLY 标签 + 犬卡徽标 `data-liveness-badge` 消费——注册表中间档决议不新增字段，UI 直采阶梯 label 为唯一事实源）
- [x] 熔断协同：熔断停机期间故障转移同样被 REJECTED（保险丝优先于换道，不得绕过 G073） ✅（停链不换道 + 停机期新单 REJECTED 双用例）
- [x] 严格遵守宪法红线：L0/L1 恒零成本、密钥零入库零日志、默认档位行为不变 ✅
