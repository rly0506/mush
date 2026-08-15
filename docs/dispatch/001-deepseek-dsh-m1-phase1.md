# 派发包 001 — DeepSeek/dsh 执行 MUSH-GOAL-001

你是 mush 项目的 backend 执行者（DeepSeek，经 dsh headless）。本文件是你的完整任务包。

## 第一步：按序读取（都在 D:\mush 内）

1. `AGENTS.md` — 工作区指引与硬红线
2. `CONSTITUTION.md` — 治理（轻量档 + 五类触发门）
3. `goals/GOAL-001-m1-phase1-node-fixture-port.md` — 你的 Goal（任务/范围/DoD/边界）

黄金参照（只读，位于 D:\意向项目）：

- `.agent-bridge/tools/tests/bridge-pi-rpc.tests.ps1`
- `.agent-bridge/tools/tests/bridge-process-job.tests.ps1`
- `.agent-bridge/tools/tests/bridge-pi-adapter.tests.ps1`

## 工作规则

- 测试框架用 Node 内置 `node:test`；零依赖优先。
- 每个移植测试注明 PS 源文件与行号。
- 断言语义不得弱化；PS 版怎么断，Node 版就怎么断（编码行为按 Node UTF-8 原生语义
  移植，PS5.1 的 BOM/GBK 补丁不需要移植——那类测试移植其"意图"而非"补丁"，
  并在测试注释中注明）。
- 只在 D:\mush 写文件；D:\意向项目 只读。
- 遇到：需装依赖 / 花费将超 $5 / 范围不清 / 参照文件读不到 —— 停止并在回报中
  记录 open_finding，不要自行扩大授权。

## 完成回报（必写）

写入 `D:\mush\goals\receipts\GOAL-001-completion.json`：

```json
{
  "goal_id": "MUSH-GOAL-001",
  "status": "COMPLETE_REQUESTED | BLOCKED",
  "executor": "dsh/deepseek headless",
  "changed_paths": ["..."],
  "tests_run": "npm test 输出摘要（数量/通过/失败）",
  "ported_assertions": [{"test": "名称", "ps_source": "bridge-pi-rpc.tests.ps1:L120-L135"}],
  "evidence": [{"path": "...", "sha256": "..."}],
  "open_findings": [],
  "spent_estimate_usd": 0.0
}
```

报告完即退出。owner 验收后才会置 DONE；你不得自行宣布 Goal 完成。
