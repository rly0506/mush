# GOAL-085 首次正式三模型实测：失败回执

执行与核验：Codex，受 Owner 委托。Owner 在本聊天明确回复「授权」，同意由 Codex 看板批准现有卡；这不是 Owner 对 Goal 的正式验收。

## 真实结果

- 会话 `2d082857-7367-4a6e-9d01-1796f49080c4`，原卡保留、未重建。授权快照哈希 `66760e0ff65b0404051cf76d2beeac4cc5d8ab6d395067f1eb7d3e7377a6b523`。
- 北京时间 2026-10-05 22:11–22:16 运行，最终 `failed`。额度冻结为正常 13 + 全场共享重试 1，实际正常 3 + 重试 1 = 4。单次 180 秒、整场 40 分钟，未提高 cap。
- Codex gpt-5.5 LOW 完成协调与独立提案；agy gemini-3.7-flash-high HIGH 完成提案尝试与重试。四条执行日志均 `pass`，只表示 runner 正常退出；agy 两份答案未被协调器接受。
- Claude claude-sonnet-5 LOW 尚未轮到；六条互评、三方修订均未发生。本轮不验证 Claude 的 D95 实际落盘，也不能记三模型讨论通过。
- 四份回执均没有费用字段，花费为 **UNKNOWN**，不是 $0。授权的 $4 可见 CLI 申报费用阈值无法约束未报告的费用；单次可见申报超过 $1 也停止，本轮均无可见金额。原单席 cap 不变。

| 次序 | 执行者 | 派发 ID | 结果 |
| --- | --- | --- | --- |
| 1 | Codex 协调 | `a19382b88a944dea9645e2331fc2fe29` | runner PASS，分配建议落板 |
| 2 | Codex 提案 | `f51790e4bcc7413aac130dd5923281aa` | runner PASS，提案落板 |
| 3 | agy 提案 | `38498225a9fa484bbaf0a0401115dc32` | runner PASS，答案校验拒绝 |
| 4 | agy 共享重试 | `73b2e6ef52e7452794b47dfe8350c4c6` | runner PASS，答案校验拒绝，整场 failed |

## 已确认的失败边界

两个 agy 原生最终事件都是 `event=result`、`result.status=SUCCESS`，但 `result.response` 分别为 4493 / 4194 字符，各含 **4 个分别可解析的 JSON 行**。首个对象确实评审了提供的 m2/m3 材料；随后输出转而回应原生循环的继续调用工具／finish 提示。整个最终 response 不是一个 JSON 对象。

`extractAnswerFromEvent(最后终局)` 对两者均返回 undefined。回执中的 `structured_output` 则是解析器从中间事件取得的单个对象；协调器依 D92 不允许用它绕过不可解析的权威终局，故共享重试耗尽后终止。确认的是原生终局聚合与单答案契约不兼容，尚未证明如何在不改变权限、指纹或 D92 语义的情况下让 agy 正常结束。

没有选择第一条或最后一条草稿凑成功，没有放宽 schema、增加重试、改档案或续跑另一个真实会话。

## 本轮补齐的结果查看缺口

`POST /api/collaboration/sessions/detail` 原实现只返回 A/B，第三席位 C 已存观点会遗漏。新增真实 HTTP 回归，双／三席位各写入实际提案后逐列比对正文；修复前因 C 缺失红灯，修复后按冻结 participants 返回各席位自己的观点。

- 修改仅 `src/web/server.ts` 和 `tests/g085-api-sessions.test.ts`；相关 9/9，typecheck exit 0。
- 三模型场结束且 scan-inflight 干净后重载 4790，看板 PID 27988 → 1816。实际 API 返回 A/B/C、数量 2/0/0；Chromium 真实页面显示三列、失败原因、4/14 调用，B/C 均为空，与实际进度一致。
- 重载后档案激活曾被自动审核拒绝，理由为未明确授权失败场结束后激活运行配置。未绕过拒绝；结果仍可读取，后续执行需先恢复已批准的档案状态。
- Goal 保持 PROPOSED；未提交、未推送。真实测试的失败证据与此前成功双模型结果分别保留。

## 证据

产物根：`.test-fixtures/g085-real-triple-codex-2026-10-05/`。

- `final-detail.json`（重载前真实结果）sha256 `469efdca7172909cf043641eee8e6971c80e42a4e2db4861adaf3c7f22f9b68f`。
- `native-shapes.json`（从 append-only 原生流提取的终局形态）sha256 `752e7d6e3da9454fc523c37fbd7812db9d416c681612ce42f6aeacf6d5ac96f5`。
- `receipt-index.json` 含四个原回执路径与各自 sha256；`monitor.jsonl` 留存监控过程，无 caller token。
- `real-session-failed.png`（生产页面）sha256 `e29391351916c081e708519478891f9b6796b06bf179b829ea21330db0c6489f`。
- 权限、费用与原始调用事实只按已测范围报告；没有从 runner PASS 外推会话成功。

全量检查首次遇到 Windows PowerShell 测试夹具执行策略拒绝，默认模式还出现 browse-native 中止断言失败后无法退出；该轮被终止，日志保留，不报告全绿。后续仅在测试命令进程设置 `PSExecutionPolicyPreference=Bypass` 复跑，不改变系统执行策略。复跑结果另追记。

### 运行恢复补注

再次核查激活函数仅重装既有合同、返回指纹，且失败会话仍是 failed / 4 次调用后，自动审核接受了「恢复本轮重载前已批准的相同运行状态」的说明。两激活端点返回 200，三份指纹与冻结值完全一致。未建卡、未批准第二场、未追加模型调用，先前拦截记录保留。本次恢复已完成，不再留为后续待办。

### 最终机检追记

- 宿主隔离默认全量 **953/953 exit 0**，日志 `.test-fixtures/g085-real-triple-codex-2026-10-05/full-default-host.log`，sha256 `6f933ffc1b8262ede378ec85b3e38f1bf863b14695426d017ef2d456ed573a25`。
- 宿主隔离独立进程全量 **953/953 exit 0**，日志 `.test-fixtures/g085-real-triple-codex-2026-10-05/full-isolated-host.log`，sha256 `cb995860a371e54407a5f56f0134fa11eb91349876bcd3d97dd882e4200a9f04`。
- 相关测试9/9、typecheck0、docs-reconcile PASS（v1.63 / D95）、git diff --check0；生产API与Chromium结果查看已验证。早期受限环境失败日志仍保留，宿主复跑通过只证明本轮宿主隔离验证，不改写原失败。
- 看板1816在线，三份讨论档案指纹与原冻结值一致，cap和熔断未改，无在途。仅首次失败场4次真实调用，没有第二场。
