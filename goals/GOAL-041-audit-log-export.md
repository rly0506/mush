# GOAL-041: 看板审计日志归档导出 (Audit Log Export)

- 状态：`DONE`（2026-08-19 交付，基于 GP-15 / D11 扩展；测试全绿）
- 来源：GP-15（D11 扩展）
- 优先级：低
- 依赖：无

---

## 1. 目标与价值

mush 运行期间产生大量审计数据——事件哈希链、派发记录、审批历史、预算台账、犬只探测记录等分散在多个 JSONL/JSON 文件中。当前缺少统一的归档与导出能力，不便于：
- 离线审计与合规回溯
- 跨设备/跨时间段的运营复盘
- 向第三方展示系统运行证据

本目标构建 **一键审计日志归档导出器**：
1. **全量采集**：汇总事件链（`runtime/events.jsonl`）、派发台账（`runtime/budget-ledger.jsonl`）、审批记录（`runtime/approvals/`）、犬只探测缓存（`runtime/live-probes.json`）、任务池（`runtime/tasks.jsonl`）、工作流（`runtime/workstreams.jsonl`）；
2. **结构化 Markdown 报告**：生成人可读的归档报告，包含：
   - 运营概览（总派发数、成功率、总花费、Token 吞吐）
   - 事件时间线（人话转译，复用 GOAL-023 活动时间线能力）
   - 犬只运营明细（每犬派发数/成功率/花费）
   - 审批决策流水
   - 异常与告警记录
3. **时间范围过滤**：支持导出"今日"、"本周"、"全量"等预设范围；
4. **一键触发**：看板提供 `📤 导出审计报告` 按钮，生成后提供下载链接。

### 预期收益
- 一键生成完整运营证据链，便于离线存档
- 为项目里程碑复盘提供标准化数据源
- 零外部工具依赖（纯 Node 生成 Markdown）

---

## 2. 核心架构设计

### 2.1 导出引擎 (`src/web/audit-export.ts` [NEW])
- `generateAuditReport(options): AuditReport`
  - `options.timeRange`: `'today' | 'week' | 'all' | { from: Date, to: Date }`
  - `options.format`: `'markdown'`（初期仅支持 Markdown）
  - 遍历各 runtime 数据源，聚合统计指标
  - 生成结构化 Markdown 字符串
- `saveReport(report, outputPath)`: 保存至 `runtime/exports/audit-<date>.md`

### 2.2 报告模板结构
```markdown
# mush 审计报告 — {date_range}
## 1. 运营概览
| 指标 | 数值 |
| 总派发数 | ... |
| 成功率 | ...% |
| 总花费 | $... |

## 2. 事件时间线
- [2026-08-19 10:00] 🐕 claude-code 完成任务 "修复登录逻辑"
- ...

## 3. 犬只运营明细
### claude-code
| 派发数 | 成功率 | 总花费 | 平均耗时 |
...

## 4. 审批决策记录
...

## 5. 异常与告警
...
```

### 2.3 服务端与前端
- `POST /api/audit/export`：触发报告生成，返回下载路径
- `GET /api/audit/exports`：列出已生成的报告
- 看板设置区增加「📤 导出审计报告」按钮与时间范围选择器

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g041-audit-log-export.test.ts`
- [ ] 验证各数据源的采集与聚合
- [ ] 验证 Markdown 报告生成的完整性与可读性
- [ ] 验证时间范围过滤
- [ ] 验证下载端点与前端交互
- [ ] 报告中零密钥/零凭据泄露
- [ ] API 契约升级，`npm test` 保持 100% 全绿
