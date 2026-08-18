# 派发包 rm004-m1a — Deepseek 执行 M1 旗舰（意向项目 RM-055-RF-A）

你是 mush 旗舰执行犬（deepseek-dsh）。**首个真实产品任务**——意向项目 RM-055-RF-A
回环控制路径修复。按对方治理"一次人类授权一个切片"，本次只做 RF-A。

## 前置（必须满足才能派发）

- M0 carve-out 已合并入 master（GOAL-014A），`POST /api/carveout/grant` 可用；
- owner 已通过 grant API 创建 ACTIVE carve-out（白名单见下，时效 24h）；
- dispatch 派发时携带 `carveout_id` + `cwd=D:/意向项目`。

## 第一步：按序读取

1. `AGENTS.md` — mush 项目层指引
2. `goals/GOAL-014-realwork-flagship.md` — M1 章程
3. `D:/意向项目/spec/rm055-daily-freshness-recovery-plan-2026-07-24.md` §3 RF-A 段
   — **权威任务说明**（四个 checkbox + Exit 条件）
4. `D:/意向项目/spec/rf-c-discovery-diagnosis-2026-08-17.md` — RF-C 诊断报告
   （根因证据：运输失败时代理拦回环，URLError）
5. `D:/意向项目/backend/cli.py` — 待修文件（理解现有 _run_local_refresh_once + 回环调用）
6. `D:/意向项目/backend/tests/test_coverage_observation_cli.py` — 待改测试

## F-45 工作方式

- **工作目录**：`D:/意向项目`（意向项目仓内，**非 mush worktree**）；
- **分支**：在意向项目仓内 `git checkout -b rf-a`（基于意向项目 master `1e16039`）；
- **carve-out 白名单（绝对路径，严格限定）**：
  - `D:/意向项目/backend/cli.py`
  - `D:/意向项目/backend/tests/test_coverage_observation_cli.py`
- **永久 deny**：`.agent-bridge/` 整树（任意仓，carve-out 不可覆盖）；
- **产物**：在意向项目 `rf-a` 分支上的 commit；**不 push 意向项目**，
  产出 `git format-patch` 交 owner 手动应用（对齐对方治理）；
- **mush 侧留痕**：dispatch 回执记 carveout_id + 白名单快照 + patch 文件路径。

## 任务（计划 §3 四个 checkbox，逐项完成）

1. **参数化 RED 测试**：证明环境代理配置（HTTP_PROXY/HTTPS_PROXY/ALL_PROXY）
   不被两个固定回环请求（health + refresh 到 `127.0.0.1:8000`）使用；
   connection-refused/no-listener 恰好触发 `_run_local_refresh_once()` 一次。
2. **保留 RED/GREEN 测试**：timeout / reachable bad health / malformed health JSON /
   HTTP error / invalid POST response / POST transport failure **永不**触发 local fallback。
3. **加 `_open_loopback_json` seam**：backed by `build_opener(ProxyHandler({}))`；
   **不修改** `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` 进程状态。
4. **`_run_local_refresh_once()` 不变**：仍调 `auto_refresh.refresh_once()`；
   collectors 继续用 `RSS_PROXY`（有则用，无则 `trust_env=True`）——跑现有 RSS 测试证明。

## 验收口径

- `cd D:/意向项目/backend; ../venv/Scripts/python.exe -m pytest
  tests/test_coverage_observation_cli.py tests/test_rss_collector.py -q` 全绿；
- `cd D:/意向项目/backend; ../venv/Scripts/python.exe -m pytest -q` 全绿；
- **Exit 条件（计划 §3）**：固定回环控制流量不能被用户系统代理捕获；
  恰好一个 refresh 路径运行；response schema / Coverage criteria / collectors /
  sources / API **不变**；
- patch 文件产出（`git format-patch master..rf-a` → `*.patch`），交 owner。

## 不授权（红线）

- 真实 refresh（real run 仍是 Red，需另授权）；
- 联网（不触发任何真实 HTTP 请求到外部源）；
- git push 意向项目（只产 patch）；
- 修改 `.agent-bridge/` 任何文件；
- 改 response schema / Coverage 门槛 / collectors / sources / API；
- 修改白名单外任何文件（超范围 = 红线违反，记入事件链）。

## 纪律

- path-limited commit（`rf-a` 分支，commit message 前缀 `RF-A:`）；
- 批次回执 `BATCH-49-ds-flagship`（mush 仓内落盘 `goals/receipts/`）；
- 意向项目仓的 commit 不入库 mush（patch 文件单独存 `goals/receipts/` 带哈希）；
- DEF-07 转义铁律（如需 PowerShell 跑 pytest，用 `-File` 脚本）；
- D15 机检全绿 + patch 产出后停 owner 显式接受；
- 终止：DoD 全满足 + `goals/receipts/GOAL-014B-completion.json` 落盘（含 patch sha256）。

## 关键提示

- RF-C 诊断报告已证明根因：07-21/24 两次 0 seeds 是运输失败
  （代理拦回环 URLError，`sources.py:77-80` trust_env 走环境代理）；
  RF-A 修的是**固定回环控制路径**用显式 proxy-free opener，让代理无法拦截；
- 计划 §3 是权威，本派发包不重复其细节，逐项对照 checkbox 完成；
- 这是 mush 首个真实产品任务——事件链留痕质量 = RM-004 M1 收官的证明。
