# RM-011 M1 演练战报 · 全链路四阶段（2026-08-24）

- 执行者：会话内 agent（owner 授权「由你自己执行完成」，采用与聊天链同语义的 originOwner 授权通道）
- 执行环境：**隔离临时实例**（临时双工作区 A/B、独立端口），不触碰生产看板；代码为工作树当前版本（D82 批次 + 本会话六批修复，截至本报告未提交）
- 统一参数：adapter=opencode · model=x-preview-f-free · cap_usd=0.10 · timeout_s=300 · 免费档实际成本 $0
- 上游噪声说明：演练窗口前后免费档存在 network_error 与 41~58s 单发延迟波动，本报告已将上游抖动与链路缺陷分开归因

---

## S1 单犬闭环 —— ✅ PASS

| 验收项 | 结果 | 证据 |
|---|---|---|
| 工犬输出规范 JSON | ✓ | `{"ok":true,"model":"x-preview-f-free","calc":611,"cwd_files":32}` |
| calc==611 | ✓ | 47×13 真实计算 |
| 回执归档 | ✓ | `.mush-receipts/dispatch-bf270381….json` exists=true |
| 台账成本≤cap | ✓ | ledger 1 条目，合计 $0（免费档）≤ $0.10 |
| 零文件写入（犬写面） | ✓ | 差异仅 mush 数据面：`runtime/live-probes.json`（GOAL-064 模型回执）、`runtime/streams.jsonl`（流日志）；豁免口径=.mush-receipts/.mush/runtime |

## S2 会话续跑 —— ✅ PASS（机制差异如实注记）

- 同流确认：两单 stream_id 一致（自动归流 adapter×goal）。
- 追问「上一轮 calc 的结果是多少？」→ 回复 `611` ✓。
- **机制注记**：opencode 合同无 `resume_flag`（context_management=none），续跑走 dsh 缝合路径（[流历史] 注入上一单 output_preview）而非原生 `--session`。验收意图（子会话上下文延续）达成，机制与 GOAL-061 原生 resume 不同源，已如实标注。

## S3 隔离穿越 —— ✅ PASS（附一处测试布局缝隙记录）

| 验收项 | 结果 | 证据 |
|---|---|---|
| B 侧互不可见 | ✓ | 切 B 后任务池 0 条、流 0 条、数据体中无 A 的 dispatch_id/RM011-S3 字样 |
| 在途派发跨切换完成 | ✓ | A 发起 → 切 B → 该单照常走完 ADMISSION→EXECUTE×4→REPORT→REVIEW（SSE 7 帧） |
| SSE 通知 | ✓ | REPORT/REVIEW 帧在切换后正常抵达（EXECUTE×4 即 stdout/stderr 实时增量帧，streamLiveOutput 生效实证） |
| 切回 A 数据面回放 | ✓* | 流数据回放可见 ✓；派发详情查得 ✗→归因如下 |

**缝隙归因（非生产缺陷）**：切回后 GET 派发详情 404。根因＝server.ts 两处 runtime 布局不对称——初始上下文缺省 `approvalRoot/runtime`（186 行，测试缺省），热切换上下文固定 `<workspace>/runtime`（310 行，生产布局）。本演练初始管线的记录落在 `approvals/runtime/dispatches/991dfa96….jsonl`（已实勘该文件存在），切回 A 时按生产布局回放 ws-A/runtime → 空。**生产 CLI 显式传 runtimeRoot，两侧同布局，不受影响。**
加固建议（M2 前）：初始上下文缺省改为 `<workspaceRoot>/runtime`，消除双布局footgun。

## S4 审计对账 —— ✅ PASS

| 验收项 | 结果 | 证据 |
|---|---|---|
| 台账哈希链校验 | ✓ | `ledger_chain_status: VALID`（生产同布局：runtime/budget-ledger.jsonl） |
| 成功率/成本 | ✓ | success_rate=100%，total_cost=$0，actual_cost_entries=0（免费档零成本计费正确） |
| 四阶段留痕可回放 | ✓ | persistence 落盘目录结构完整（dispatches/*.jsonl header+events append-only）；每单生命周期帧齐备 |
| 无未授权写入 | ✓ | 犬写面差异=[] |
| 观测项 | — | summary.total_events/event_chain_files=0 为无头实例缝隙（EventLog 由看板服务层写入；生产 runtime 存在 event-log-board-server-run.jsonl），非缺陷，建议审计报告对该字段在无服务场景标注 N/A |

---

## 缺陷清单（M1 战报输入）

1. **DEF-14（新，高优）：opencode T1 通道不遵守 spawn cwd。** S1 工犬报 `cwd_files:32`，而 ws-A 仅簿记目录——两次独立实测（另一次空目录报 20）证明 opencode 在自身解析的项目根执行工具，无视进程 cwd。风险：跨工作区任务时犬的读写落在错误目录；S3 数据面隔离不受影响，但文件面隔离被绕过。
   **【2026-08-24 修复】** `opencode run --help` 实证存在 `--dir <directory>` 旗标；合同层新增 `cwd_flag` 字段（同 resume_flag 模式），opencode 契约声明 `cwd_flag:'--dir'`，runner 在 argv 中显式钉死派发工作目录。单测覆盖注入/未声明两路；空工作区实弹验证 ✓（工犬回报 cwd=派发目录、files=2，此前为外来目录 20/32 条）。附带发现：opencode 另有 `--thinking`（思维链开关）、`-s <session>`（原生会话续跑）、`--format json`——已更新 GOAL-075 通道假设。
2. **观测：免费档上游抖动**（network_error / pong 41~58s 波动）——非链路缺陷；建议派发侧对 network_error 类失败提供一键重试语义（现可手工重跑）。
3. **加固：初始上下文 runtime 布局统一**（见 S3）。
4. **观测：聊天链头犬超时已修**（300s 硬编码 → chatTimeoutS 900s 可配 + 前端看门狗同步 + 超时部分回复保留）；f62c928f 类失败在重启后不应复现。

## 结论

**S1–S4 全绿（1 项机制注记 + 1 处非生产缝隙 + 1 个真实缺陷 DEF-14）。** 按【通过标准】宣告 RM-011 M1 演练「实战绿」；DEF-14 与两项加固建议作为 M2（chaos+soak）前的整改输入。

— 本报告由演练实测数据直接生成，脚本与原始输出见会话记录（.tmp-rm011-s12/s3/s4 已完成任务待清理）。
