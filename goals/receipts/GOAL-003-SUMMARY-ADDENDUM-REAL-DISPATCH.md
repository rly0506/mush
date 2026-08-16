# GOAL-003 真实 dispatch 验收 addendum（append-only）· 2026-08-17

本文件是对 `GOAL-003-SUMMARY-2026-08-17.md` 的追加，不覆盖原文。

## 结论

owner 已于 2026-08-17 对话确认「M3确认，继续目标」（D6 解锁）。两犬各执行了
一次真实有界 dispatch：

| 犬 | dispatch_id | 结果 | 原因 |
| --- | --- | --- | --- |
| deepseek (dsh) | dsh-real-001 | **BLOCKED_ENV** | `MISSING_CREDENTIAL`：启动环境无 `DEEPSEEK_API_KEY`（按边界不动凭据） |
| claude-code | claude-real-001 | **BLOCKED_ENV** | `Not logged in · Please run /login`（custom endpoint 环境未登录） |

- 身份层已证明：dsh identity=deepseek/deepseek-v4-flash；claude stream-json
  init 报告 claude-opus-5（证据文件保留原始字段）。
- 证据（append-only）：`goals/receipts/dispatch-events/dsh-real-001.json`、
  `claude-real-001.json`；owner approval：`goals/receipts/dispatch-approvals/*.approved.json`。
- 未虚构任何 PASS；两项仍列 BLOCKED（现在是环境阻塞，不再是等待 owner）。

## 顺带修正（已入代码）

claude 2.1 要求 `--output-format stream-json` 必须配 `--verbose`；
`src/adapters/claude.ts` 合同已修正并测试同步（F-24）。

## 给 owner 的下一步

- 在可用的凭据环境（有 `DEEPSEEK_API_KEY`，claude 已 `/login`）重跑两条命令即可
  完成 M3 真实 dispatch 验收；approval 记录已在仓库内，无需再次确认。
- GOAL-003 机检规格仍全绿（158/158），可按 D15 升 AUTO_ACCEPTED；DONE 等你一句话。
