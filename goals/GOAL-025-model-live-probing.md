# GOAL-025 模型实测选择与名册真实回填（Live Model Probing & Authoritative Roster Backfill）

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；模型实测探测（契约 v1.12）在库，专测 tests/g025-*.test.ts 通过；目标池 GP-16/GP-35 已记完成（2026-08-18/19）；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）

## 目标与背景

根据 owner 的核心治理原则——**「以实测为准（Ground-Truth Probing）」** 与 GP-35 目标定义：
1. **主动实测探测**：针对已配置或已入册的 Harness（`agy`、`pi-rpc`、`dsh`、`claude`、`kimi`、`codex`、`opencode`、`zcode`），探测当前密钥与网络环境下**实际可用的模型清单**；
2. **派发回执权威回填**：派发执行返回后，从实际响应提取真实模型（`actual_model_id`）并权威回填名册，杜绝 DEF-01（挂名 claude 实发 deepseek）与假通道故障；
3. **看板实测状态可视化**：前端派发下拉框与犬队名册区分展示「🟢 实测在线」、「🔴 额度耗尽/受阻」、「⚪ 声明兜底」，并提供一键「🔍 实测探测」按钮。

---

## 架构设计

### 1. 后端：实测探针引擎与名册扩展 (`src/adapters/live-probe.ts` & `src/web/dispatch.ts`)

- **`LiveModelProber` 探针引擎**：
  - `probeAdapterModels(adapterId, contract)`：
    - 对 `agy`：执行 `agy --list-models` 或探测已知 14 款变体连通性；
    - 对 `pi-rpc`：执行 pi-rpc 握手检查；
    - 对 `dsh` / `kimi` / `claude` / `codex` / `opencode` / `zcode`：基于 CLI 版本与 cc-switch 只读探针检查就绪性；
  - 缓存机制：写入 `runtime/live-probes.json`，避免频繁重复探测造成延迟；
- **回执权威回填机制**：
  - 派发执行结束（`DRY_RUN` 或 `PASS`）时，若输出或回执解析出 `actual_model_id`，自动记录到 `DispatchPipeline.authoritativeModels` 映射；
  - `listRoster()` 动态将权威返回模型与实测可用变体注入 `roster` 输出。

### 2. HTTP API 接口扩展 (`src/web/server.ts` & `src/web/api-contract.md`)

- **`GET /api/models/probe`**：返回所有 Harness 的最新实测模型列表、健康状态与上次探测时间；
- **`POST /api/models/probe`**：触发一次后台全量或单犬在线实测探测；
- **`GET /api/roster`**：在名册数据中扩充 `probed_models`、`actual_model_id`、`probe_status`。

### 3. 前端交互升级 (`src/web/page.ts`)

- 派发面板：
  - 选犬后，模型变体下拉框按状态分组展示：
    - `🟢 实测在线 (Live Verified)`
    - `⚪ 合同声明 (Declared Fallback)`
    - `🔴 额度耗尽/不可用 (Quota Exhausted / Offline)`
- 犬队名册面板：
  - 增加「🔍 实测探测」按钮，点击触发异步探测并在页面给出 Toast 提示；
  - 卡片上直观展示实际运行过的真实模型徽章。

---

## 验收规格（Acceptance Criteria）

1. **探测器单元测试**：支持正确识别 `agy` 的 14 种变体、`pi-rpc` 与各 harness 状态；
2. **回执权威回填**：派发成功返回特定模型时，名册中对应犬的 `actual_model_id` 自动更新；
3. **HTTP 接口契约**：`GET /api/models/probe` 与 `POST /api/models/probe` 返回 200 且格式符合契约；
4. **前端看板展示**：前端页面渲染实测模型状态与探测按钮；
5. **测试全绿**：全量测试套件（400+ 项）100% 通过。
