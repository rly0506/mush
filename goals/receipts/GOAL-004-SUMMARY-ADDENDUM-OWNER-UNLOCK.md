# GOAL-004 追加记录 · 2026-08-17（owner 解锁后）

本文件是 `GOAL-004-SUMMARY-2026-08-17.md` 的追加（append-only，不覆盖原文）。

## owner 两项决定已落盘

1. **凭据**：`goals/receipts/dispatch-approvals/credential-use-2026-08-17.json`
   （「claude code和deepseek使用现有密钥登录」）——密钥仅在探测进程内临时使用，
   未打印、未入库、未入日志。
2. **首任务**：`goals/receipts/owner-selections/zcode-adapter.selected.json`
   （「zcode适配」）。

## 真实 dispatch 闭环：两犬 PASS（GOAL-003 收口）

| 犬 | dispatch_id | 结果 | nonce | 身份 |
| --- | --- | --- | --- | --- |
| deepseek (dsh) | dsh-real-002 | **PASS** | matched | provider=deepseek，model 配置级 deepseek-v4-flash |
| claude-code | claude-real-003 | **PASS** | matched | stream-json 运行时报告 model=deepseek-v4-flash；cost $0.14051 |

证据：`dispatch-events/{dsh-real-002,claude-real-003}.json`；
`loop-evidence/closure-ready-2026-08-17.json`（status=READY）。

## 首个 live loop（首任务 zcode 适配器）已闭环

- 事件链：`loop-evidence/loop-zcode-001.json`
  （SCAN→RECOMMEND→CONFIRM→DISPATCH→EXECUTE→REPORT→REVIEW(PASS)→ACCEPT，
  7 事件，SHA-256 链由 src/loop/loop.ts 真实生成并 verifyChain 通过）。
- 交付：`src/adapters/zcode.ts` + `tests/adapters-zcode.test.ts`
  （合同 `--prompt --json --max-turns 1`、`--json` 解析、身份 UNKNOWN 门、
  nonce 证据路径；commit `c980508`，5 tests / 21 断言）。

## 仍待 owner 的事项

1. **zcode 真实 nonce/有界 dispatch**（F-28）：zcode 为 Z.AI OAuth 登录、预算
   UNKNOWN；本轮 owner 仅授权 claude/deepseek 现有密钥。需要你一句
   「zcode 探测也授权」后即可执行。
2. **预算门 APPROVAL_REQUEST**：`approval-requests/budget-gate-mush-goal-004-
   probe-*.json` 仍在 WAITING_OWNER_APPROVAL（RM DoD 的“真实弹审批”等你一句）。
3. **对调实验真跑**：骨架与事件已备；真实对调（claude 任头犬跑一次有界任务）
   可在你确认后执行。
