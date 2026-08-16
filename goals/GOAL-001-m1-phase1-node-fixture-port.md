---
goal_id: MUSH-GOAL-001
status: AUTO_ACCEPTED（D15 非阻断验收，2026-08-16；DONE 待 owner 转正）
mode: LIGHT（宪法 §1 轻量档；触发门照常生效）
rm: RM-001 / M1 Phase-1
executor_model_profile: dsh/deepseek（dsh --profile headless）
executor_capability_evidence: 2026-08-16 nonce 探测通过（计算正确 + probe-nonce-9f3a.txt
  真实落盘且内容精确匹配，磁盘核验非模型自述）
per_actor_budget_usd: 5
created: 2026-08-16
owner_decision: owner 2026-08-16 对话批准（D6 半自动首任务确认）
---

# MUSH-GOAL-001：M1 Phase-1 — Node 测试骨架与首批 fixture 移植

## 任务

在 mush 仓库建立 Node/TS 测试基础设施，并把 agent-bridge（黄金参照）fixture 套件中
**第一批核心断言**移植为 Node 测试，开启"fixture 即验收规格"（RM-001 M1）。

## 范围与要求

1. 测试框架：**Node 内置 `node:test`**（零依赖；如确需换框架，先在完成回报中说明
   理由并列为 finding，不得静默引入依赖）。
2. 建立最小 `package.json`（`npm test` 可跑）+ `tsconfig.json`（如用 TS）。
   禁止全局安装；项目内依赖仅在必要时且逐项说明。
3. 从以下黄金参照源移植 **≥20 个核心断言**（挑选优先级：状态机边角 >
   fail-closed 用例 > 身份/租约 > RPC 编解码）：
   - `D:\意向项目\.agent-bridge\tools\tests\bridge-pi-rpc.tests.ps1`
   - `D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1`
   - `D:\意向项目\.agent-bridge\tools\tests\bridge-pi-adapter.tests.ps1`
4. 每个移植测试注明 PS 源文件与行号（可追溯）。
5. 全部测试绿；禁止为过测试而弱化断言语义（PS 版断言强度不得降低）。
6. 完成回报写入 `goals/receipts/GOAL-001-completion.json`（格式见派发包）。

## 边界（硬红线）

- 只在 `D:\mush` 内写文件；**只读** `D:\意向项目`（黄金参照，禁止修改）。
- 不 push、不发布、不装全局包、不动密钥；花费接近 $5 上限即停并回报。
- 完成语义：owner 显式接受才 DONE；执行者回报 status=COMPLETE_REQUESTED 而非 DONE。

## DoD

- `npm test` 退出码 0，≥20 个移植断言全绿；
- 每个测试有 PS 源追溯注释；
- 完成回报 JSON 落盘（含 changed_paths、测试输出、证据哈希、open_findings）；
- `D:\意向项目` git status 无任何变化。
