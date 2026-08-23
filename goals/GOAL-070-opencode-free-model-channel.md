# GOAL-070: opencode free 模型通道接入 (OpenCode Free Model Channel Integration)

- 状态：`READY`（RM-011 M0；owner 2026-08-23 规划会认可）
- 来源：owner 追问「opencode 为什么没接 free 模型」→ 规划会立项；本机通道活性已被实测证明
- 优先级：高
- 依赖：无（RM-011 首个里程碑，为 M2 soak 提供零成本执行档）

---

## 1. 目标与价值

本机 opencode 已配置并实测可用 **6 个 free 模型**（hy3-free / mimo-v2.5-free / muse-spark-1.2-contributor-free / nemotron-3-ultra-free / nemotron-3.5-lightning-free / x-preview-f-free）及 botcf/kimi-k3、pixel/grok-4.5、tbtk/glm-5.3 转介通道，但 mush 三处断层使其完全闲置：(1) 适配器只拼 `opencode run <prompt>` 不注入 `-m`；(2) 模型发现层不调 `opencode models`；(3) 通道整体 UNVERIFIED 被挡在关键路径外。接入后工犬梯队获得零成本执行档，免费模型自动落零成本计费（`isFreeModel` 已识别 `*-free` 命名），直接支撑 RM-011 M2 的 8h+ soak 与日常低风险任务派发。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/adapters/opencode.ts` [MODIFY] — 契约支持按派发参数注入 `-m <provider/model>`；`expected_model_id` 由参数驱动而非固定 UNKNOWN
- `src/web/dispatch.ts` [MODIFY] — spawn 参数组装携带 `model_id`
- `src/web/server.ts`（发现层）[MODIFY] — `discoverHarnessGroupedModels` 增加 opencode 枚举源：`opencode models [provider]` 输出解析
- `src/web/pricing.ts` [VERIFY] — `opencode/*-free` 命名命中 FREE_MODEL_PRICING 补单测
- `src/core/model-registry`（如涉及）[MODIFY] — live probe 身份回执 proven 后走既有 registry VERIFIED 升级流程

### 2.2 关键接口与数据契约
- 复用既有花名册/模型选择端点呈现 opencode 分组；契约版本随实现升版并在 api-contract.md 记录；
- 密钥边界不变：BYOK，opencode 自持凭据（`opencode providers`），mush 零接触。

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g070-opencode-free-channel.test.ts`（枚举解析 / -m 注入 / free 计费归零）
- [ ] live probe 实测至少 1 个 free 模型身份回执 proven=true，通道 UNVERIFIED → VERIFIED
- [ ] 端到端：看板选择 free 模型 → 派发 opencode 工犬 → 台账记 0 成本
- [ ] 严格遵守宪法红线：零凭据泄露、零外部 CDN、意向项目只读
