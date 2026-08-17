# 自动决策日志（append-only）

依据：DECISIONS.md D16（findings 常备默认裁决）+ D15（非阻断验收）。
非触发门类事项由执行者按默认表自动裁决并记录于此；owner 异步批量复核，
可在任意时间以追加条目否决/调整（不覆盖本文件已有条目）。
触发门类事项（花钱/外部影响/不可恢复删除/范围扩张/身份密钥）**不适用本日志**，
仍走 CONSTITUTION.md §1 弹审批。

---

## AD-01 · GOAL-001 验收（D15 非阻断验收首次适用）

- **对象**：`goals/receipts/GOAL-001-completion.json`（status=COMPLETE_REQUESTED）
- **裁决**：升 `AUTO_ACCEPTED`。机检验收规格全部满足：
  - `npm test` 91 tests / 91 pass / 0 fail / exit 0（夜间六批次真实输出 +
    SHA-256 锚点落盘 `goals/receipts/BATCH-01..06-test-output.txt`）；
  - 完成回报 JSON 落盘、changed_paths 与证据哈希齐全；
  - 全部移植测试带 PS 黄金源文件+行号追溯；
  - DoD 各项（含意向项目三黄金源 diff=0）核验通过。
- **生效**：2026-08-16。后续 Goal（GOAL-002）不再等待本 Goal 验收。
- **余留**：正式 DONE 由 owner 一句话转正；owner 异议则追加 reopen 条目。

## AD-02 · F-01（沙箱 EPERM / --test-isolation=none）→ 环境自适应类

- **裁决**：`npm test` 在沙箱环境保持 `--test-isolation=none`（唯一可用形态）；
  新增 `npm run test:isolated` 供普通环境使用 node:test 默认进程隔离。
  执行者按运行环境自动选择，不再上报。
- **变更**：`package.json` scripts 增加 `test:isolated`。

## AD-03 · F-02（意向项目既有脏状态）→ 范围外观察类

- **裁决**：记录即关闭。`D:\意向项目` 为只读黄金参照，其工作区脏状态不属于
  mush 可写范围；M1/夜间会话已核验 GOAL 指名三黄金源文件 diff=0，验收不受影响。
  来源确认属 owner 侧事务，mush 不再就此等待或上报。

## AD-04 · F-05 / F-07 / F-08（Job Object / reparse / named-pipe 内核行为）→ 语义模型类

- **裁决**：M1/M2 默认采用"意图移植"语义模型（夜间实现即为此），断言语义不弱化。
  内核级实现仅在后续里程碑验收确需时提出；若构成范围扩张仍走触发门 4。
  GOAL-002 边界已按此写明。

## AD-05 · F-06（.test-fixtures/ 累积）→ 可再生临时物类

- **裁决**：按 D16 默认表清理。删除前清单+哈希已落盘（本条目）；恢复路径已实证
  （见下）。`npm test` 全量重建所需临时物，故不构成门 3"不可恢复删除"。
- **删除清单**（17 文件，2026-08-16 删除）：

```
ed8c90760c4cb684cc86f395ba0d1016ac0b61b59d997080db1bd9f91dda3d28  .test-fixtures/pi-rpc/allowed-read-only.txt
a9b18fc50d095731fae943d1232ec7fa670a1030414cbe280712aa63ff26d74a  .test-fixtures/pi-rpc/dispatch-packet.json
32e3c0215358a1f45d846a4a2d924cf7901caa608db81c166e70fc4ac2fecd9a  .test-fixtures/pi-rpc/expected-evidence.json
51162de81c192f6419cdeff31f3e6ae781ea0786c5b78c9e6a3937d80fd203eb  .test-fixtures/pi-rpc/goal-packet.json
a44c0a27ba69f19a6d0542812f90fc2a2bb3dba74860ca4dbeca0ecb36af1ca8  .test-fixtures/pi-rpc-edge/allowed-a.txt
ef00490ffda77878228e93f2921c04f742a64ce3e26106e32118c671f8379467  .test-fixtures/pi-rpc-edge/allowed-b.txt
c0d14ec1457c37048f7df8945d0dccc771262b1e2869d113133c8a766451e7d5  .test-fixtures/pi-rpc-edge/evidence-a.json
ae9558e6f4ab09e3d9e256a8fee90d4fb1e2e0088aa1987ed5dbbde6610e99d3  .test-fixtures/pi-rpc-edge/evidence-b.json
06381b7d11954460d9785b4831b0a42eaa9fdabfb55b3071c107002733517a08  .test-fixtures/pi-rpc-edge/invalid-utf8-packet.json
efae02f96b2628a412647d1ff6128bf238bc537415de4e52b4cb00ca79f77535  .test-fixtures/process-gates/10512-1786814170309-724396/dispatch.ready.json
3f8102bdd49c1397769956f42208595419d4148364e9c141f0f04fcb953fbf15  .test-fixtures/process-gates/26860-1786813936857-741549/dispatch.ready.json
90ac393b4014e01b337f718c23f901f951e4235f57e8358d34f9dc1fd46fbf30  .test-fixtures/process-gates/29972-1786814321304-318161/dispatch.ready.json
acfefac170aa6a92c452c30244667c7bfce402b79d62966ab80dd9c3404bca8b  .test-fixtures/process-gates/30804-1786813929840-118746/dispatch.ready.json
4743aedfb00ac59118b4e90fcf6ea78b35287f195a31cbdceb3355b3792ff8a3  .test-fixtures/process-gates/31452-178681391410-707264/dispatch.ready.json
5ffa7c33a6a68c18239f654d4e4652337e2a0cecde6ab7e472965eb7ba4bc2b9  .test-fixtures/process-gates/500-1786814535731-708033/dispatch.ready.json
b47afd7c0fd93fdead7b48392b3dcc1e9e46791d991776330e49a83540d91403  .test-fixtures/process-gates/8656-1786814035018-583134/dispatch.ready.json
7a8e6ae31312ce483dc92d4b09a007d56e8bcc5a766e663b9e59e67bb556dc45  .test-fixtures/process-gates/9900-1786814478527-272381/dispatch.ready.json
```

- **恢复路径实证**（2026-08-16）：删除后 `npm test` = 91/91 pass / exit 0，
  本次运行重建 10 个临时物（旧 17 个中 7 个为历史批次陈旧累积——即 F-06
  所述堆积本体，验证了周期性清理的必要性）。

## AD-06 · F-04 / F-09（超时毫秒语义 / BOM 意图移植）→ 备案类

- **裁决**：无需动作。夜间已按"意图移植、语义不弱化、注释注明"处理，
  属移植纪律内的正常记录，不构成决策点。

## AD-07 · GOAL-002 U1 远端同步失败（D19 常规动作未完成）

- **对象**：`git push origin master`（github.com/rly0506/mush，D19 授权私有远端）。
- **裁决**：按派发包 002"失败不阻塞，记 finding，本地 commit 为准"处理。
  本环境无 GitHub 凭据（schannel SEC_E_NO_CREDENTIALS，push exit 128）；
  U1 本地 commit `b4b12c1` 为准。后续单元仍按包继续尝试，凭据问题不由本
  Goal 内解决（不接触密钥路径、不弹门）。

## AD-08 · GOAL-002 U2-U5 远端同步持续失败（同一环境因，本地 commit 为准）

- **对象**：U2 `e14f28c`、U3 `5537e35`、U4 `2e169b2`、U5 收口 commit 的
  `git push origin master` 尝试。
- **裁决**：与 AD-07 同因（本环境无凭据，SEC_E_NO_CREDENTIALS），按包
  "失败不阻塞"继续；每单元已尝试一次并保留本地 commit 链为权威。owner
  配置凭据后一条 `git push origin master` 即可同步全部。

## AD-09 · GOAL-002 验收（D15 第二次适用）+ U1–U5 findings 处置

- **验收**：升 `AUTO_ACCEPTED`。头犬独立复跑 `npm test` = **124/124 pass /
  exit 0**（2026-08-17）；回报/哈希锚点/PS 源追溯齐全；9 个黄金源 diff=0 核验。
- **F-11**（lease 语义模型）→ AD-04 默认：语义模型为 M2 默认，文件级集成留后续里程碑。
- **F-12**（D20 真实探测留 M3）→ 按计划顺延，GOAL-003 任务项包含。
- **F-13**（epoch21–49 事件缺失）→ **头犬只读复核坐实**：epoch21–49 run root
  无 `events/` 目录；主 run root `RM065-GOAL-010/events/` 为空（0 文件）；
  epoch50 的 2 个事件为唯一幸存事件流。orchestrator/ 内无归档可追。回放覆盖
  以诚实索引为准，验收通过；若 owner 知晓 orchestrator/ 之外的归档位置，告知
  后可扩展回放数据。
- **F-14**（schema sequence/nullable 修正）→ Goal 内已解决，备案。
- **F-15 / AD-07 / AD-08**（push 无凭据）→ 头犬持有凭据，验收后一次性全量同步，
  关闭。

## AD-10 · GOAL-003 验收与真实 dispatch 环境阻塞（owner 已确认 M3）

- **owner 确认**：2026-08-17 对话「M3确认，继续目标」→ 按 D6 解锁两犬首次真实
  有界 dispatch；approval 证据落盘 `goals/receipts/dispatch-approvals/
  {deepseek-dsh,claude-code}.approved.json`。
- **真实 dispatch 结果（诚实 BLOCKED_ENV，不虚构 PASS）**：
  - deepseek-dsh `dsh-real-001`：exit 1，`MISSING_CREDENTIAL`（启动环境无
    DEEPSEEK_API_KEY）。按边界不动凭据路径/密钥。
  - claude-code `claude-real-001`：exit 1，`Not logged in · Please run /login`。
    按边界不代登录。
  - 证据：`goals/receipts/dispatch-events/{dsh,claude}-real-001.json` +
    `GOAL-003-real-dispatch-addendum.json`。
- **验收**：GOAL-003 机检规格满足（`npm test` 158/158 pass / exit 0；回报与
  证据齐全）→ 按 D15 升 **AUTO_ACCEPTED**。真实 dispatch 两项按证据记
  BLOCKED_ENV（不再 WAITING_OWNER）；在可用凭据环境重跑即闭环，无需再次确认。
  正式 DONE 仍归 owner。
- **F-24**：claude 2.1 要求 stream-json 配 `--verbose`，合同已修正并测试同步。
- **F-22/F-23**：上述两犬环境阻塞原因，备案。

## AD-11 · GOAL-004 准备单元完成 + U-REAL 前置未满足（诚实 BLOCKED）

- **机检**：`npm test` = **177/177 pass / exit 0**（U1 loop 状态机、U2 扫描/
  owner 确认门、U3+U4 审核门与对调骨架、U5+U6 闭环检查器与预算触发门，每批
  commit `0c3bf62`/`99dfca9`/`6f1e45b`/`d20f672`）。
- **预算门真实验证**：`goals/receipts/approval-requests/budget-gate-mush-
  goal-004-probe-*.json`（cap=0.01/amount=0.02 人工小额场景）已发出
  WAITING_OWNER_APPROVAL——RM DoD“真实弹审批至少一次”的机制侧证据成立，
  等 owner 一句批准/否决补全闭环。
- **U-REAL**：BLOCKED_ENV（DEEPSEEK_API_KEY 缺、claude 未登录）+
  BLOCKED_WAITING_OWNER（首任务 m5-board/zcode-adapter 未选定）。两者均为
  owner 侧前置，不代做、不虚构。
- **验收建议**：GOAL-004 整单暂不升 AUTO_ACCEPTED（DoD 的真实 loop 未闭环）；
  U1–U6 准备单元可按 D15 机检记录，U-REAL 闭环后再转正。

## AD-12 · GOAL-004 实跑轮复核（2026-08-17，头犬 zcode 会话）

- **机检**：头犬独立复跑 `npm test` = **182/182 pass / exit 0**；提交链
  `99dfca9..2fde05b` 检视无异常；首个 live loop 事件链（zcode-001，
  SCAN→…→REVIEW(PASS)→ACCEPT，7 事件哈希链）与 owner 选择落盘核验。
- **验收**：GOAL-004 U-REAL 实跑轮交付 **ACCEPT**，GOAL-004 整单升
  **AUTO_ACCEPTED**（首个真实 loop 闭环已达成）。
- **缺陷判定 DEF-01（身份证据矛盾，须修正）**：`claude-real-003` 记录
  `provider: anthropic` + `model_id: deepseek-v4-flash` + `identity_proven: true`。
  事实链：owner 明示 claude 犬经 cc-switch 当前 profile（ANTHROPIC_AUTH_TOKEN/
  BASE_URL）服务——即该通道实际由 DeepSeek 后端响应。**fail-closed（宪法 §3）
  要求运行时模型身份与合同不符即停**：nonce 匹配只证明"响应来自一个一致后端"，
  不证明"它是 claude 合同犬"。该 dispatch 应判身份不符而非 PASS。
  处置：修 `src/adapters/claude.ts` 身份校验（运行时 model_id 必须匹配合同
  provider 期望，否则 FAIL + 事件化）；之后要么换真实 anthropic 端点重跑，
  要么把该通道重定义为 deepseek-via-claude-cli 合同。**修前 claude-real-003
  不得作为"Claude Code 犬可用"的依据**。
- **F-28**（zcode 真实探测授权）→ 属门 5 + 花钱：**等 owner 一句话**，头犬不代批。
- **预算门 APPROVAL_REQUEST**（AD-11 小额探测）→ RM DoD"真实弹审批"记录保留
  OPEN，等 owner 批准/否决（不阻塞队列）。
- **对调实验真跑** → 真实花钱执行需一次有界 dispatch 确认，随 F-28 一并问 owner。

## AD-13 · WSL 不可用 → Docker 路线（路线 B）落地（2026-08-17）

- **背景**：owner 亲测路线 A 失败（管理员下 `wsl --update` 仍 403、Ubuntu 仍
  E_UNEXPECTED）→ 授权路线 B。
- **落地**：Docker Desktop daemon 拉起；`docker/dsh.Dockerfile` 构建本地镜像
  **mush-dsh:local**（node:24-slim + dsh + wrapper，dsh 包缺 bin 链接的怪癖已
  解决）；容器内 `dsh --version` 冒烟通过；`D:\mush` 挂载进容器可用。
- **新 finding F-29**：Linux 容器内 `npm test` 4 失败（reparse×2、CLI status
  路径形态、commit-phase 超时竞态）——Windows 专属语义的预期差异 + 一处值得
  收紧的慢环境竞态；Windows 基线 182/182 仍为权威。详见 `docker/README.md`。
- **凭据注入方式**：真实 dispatch 时 key 经 `-e DEEPSEEK_API_KEY` 进程内注入，
  不落盘不镜像不入库（门 5 合规）。

## AD-14 · DEF-01 修复 + owner 三项授权执行结果（2026-08-17，dsh 执行）

- **owner 授权**：`授权探测，批准预算，可以执行对调`（已落
  `goals/receipts/dispatch-approvals/owner-unlock-2026-08-17.json`）。
- **DEF-01 修复**：`src/adapters/claude.ts` 增加 runtime model-family 校验
  （anthropic 合同要求模型前缀 `claude-`，否则 identity_mismatch + FAIL）；
  回归测试在案；`claude-real-003` 已用 append-only correction 文件撤回
  （REVOKED-FAIL-IDENTITY-MISMATCH）；closure 同步下调 claude=NOT-READY-DEF-01。
- **真实 anthropic 通道尝试**：cc-switch `claude-official`（无 env）、
  `pixelapi 官方claude key`（403：group 不允许 /v1/messages dispatch）均不可用
  → 本环境暂无第二模型家族；claude 犬身份真实化待 owner 提供可用通道。
- **zcode 真实探测**：owner 已授权后尝试 3 次均环境失败（无效参数 /
  ~/.zcode EPERM / ZCODE_STORAGE_DIR 重定向后 SQLite readonly）→ 按包纪律停
  该项，能力保持 UNKNOWN（F-30）。
- **预算门**：owner 已批准（owner-response 落盘）→ RM DoD“真实弹审批并得到
  owner 应答”闭环完成。
- **对调实验**：无第二模型家族（DEF-01 未解），不造假执行；状态 BLOCKED_DEF-01，
  骨架已备，claude 真实通道就绪后补跑。

## AD-15 · DEF-01 修复轮复核（2026-08-17，头犬 zcode 会话）

- **机检**：独立复跑 `npm test` = **183/183 pass / exit 0**（新增 claude
  model-family fail-closed 回归测试）。
- **DEF-01 修复验收**：✅ `src/adapters/claude.ts` 运行时 model-family 校验 +
  回归测试；`claude-real-003` 以 append-only correction 规范撤回
  （REVOKED-FAIL-IDENTITY-MISMATCH，原文件未改写）——核验通过。
- **claude-real-005 核验**：诚实 FAIL（403 group 不允许 /v1/messages），
  `identity_mismatch` 字段已生效。结论维持：**本环境暂无第二模型家族**，
  claude 犬 NOT-READY 直至真实 anthropic 通道或 deepseek-via-claude-cli
  合同重定义。
- **预算门闭环核验**：✅ owner-response（APPROVED）落盘——RM DoD"真实弹审批
  + owner 应答"全闭环。
- **F-30**（zcode 探测 3× 环境失败：`--json` 参数缺失、EPERM、SQLite readonly）
  → 按纪律停，能力 UNKNOWN 诚实保留。补充头犬视角：本会话即 zcode，可作
  M4 后补充探测的备用通道（nonce 由头犬自证）。
- **对调实验**：BLOCKED_DEF-01 正确（无第二家族时结论无效）。
- **push 欠账**：头犬侧全量同步本轮一并完成。

## AD-16 · GOAL-005 验收 + RM-001 整单收口（2026-08-17，头犬 zcode 会话）

- **机检**：独立复跑 `npm test` = **199/199 pass / exit 0**（183→+16）。
- **真实冒烟**：`node bin/mush board` 起服 → GET / 200；/api/snapshot 读出真实
  GOAL-004 预算门审批记录；/api/stream SSE 200（text/event-stream）——头犬亲测。
- **验收**：GOAL-005 升 **AUTO_ACCEPTED**（executor: kimi-k3 thinking 模式，
  5 commits a652e91…ca27a62，花费 ~$1.05）。
- **D7/D14 里程碑**：北极星"最终只和一个页面交流"的第一块拼图落地。
- **RM-001 DoD 终检**：M1–M5 全绿 ✅；dogfood loop 闭环（loop-zcode-001）✅；
  触发门真实弹审批 + owner 应答（预算门 APPROVED）✅；头犬/执行犬对调
  （role-swap-001，三模型家族）✅；黄金参照零改动 ✅。
  → **RM-001 全部 DoD 满足，整单 COMPLETE_REQUESTED，DONE 待 owner 一句话。**
- 遗留（不阻断，记 findings）：F-G5-02 loop→看板推送接线/USD 台账落盘（M5+）；
  F-G5-03 局域网暴露待 owner（门 4）；GOAL-004 遗留散件已由头犬纳入本提交。

## AD-17 · G6-U1 API 契约 v1 定稿 + BATCH 编号说明（2026-08-17，dsh 执行）

- **交付**：`src/web/api-contract.md` v1 定稿（8 端点/schema/错误码/SSE
  dispatch+loop 事件类型/向后兼容规则），GOAL-007 关键路径已解锁。
- **编号说明（F-31）**：dsh 首次回报误用 BATCH-24/25 号创建了
  `BATCH-24-test-output.txt`、`BATCH-25-test-output.txt` 两个新文件；G5 原有
  `BATCH-24-baseline-test-output.txt` 与各 completion 均未受影响。本批规范为
  **BATCH-27**；误建文件保留为历史痕迹，不覆盖任何既有证据。

## AD-17 · GOAL-006/007/008 验收 + DEF-02（2026-08-17，头犬 zcode 会话）

- **机检**：独立复跑 `npm test` = **223/223 pass / exit 0**（222 交付 + 头犬
  DEF-02 回归测试 1）。
- **活体验收**：`node bin/mush board` 三端点亲测——workspaces/budget 正常；
  dispatch 到可执行缺失的适配器（fake-t1）**暴露 DEF-02**（见下），修复后复测：
  受控 FAIL JSON + 服务存活（GET / 200）。
- **DEF-02（头犬发现并修复）**：dispatch 管线的 spawn ENOENT 走未处理 error
  事件 → 看板服务整进程崩溃（一次派错犬 = 看板 DoS）。测试套件未覆盖因全部
  注入 fake spawn。修复：`t1-runner` 增加 onError 通道，spawn 失败受控收尾
  （exit 127 + 回执 `spawn_error` 标记 + 抛 BLOCKED_ENV）；回归测试
  `DEF-02: real spawn ENOENT is contained...`（真实 spawn 路径，非注入）。
- **验收**：G006 / G007 / G008 均 **AUTO_ACCEPTED**（executor 分别为
  deepseek-dsh ×2、kimi-k3）。
- **G008 扩编结果备案**：codex/opencode = REGISTERED-UNVERIFIED（沙箱 EPERM，
  BLOCKED_ENV 证据在案，普通环境补跑 nonce 即可转正）；zcode headless 三关
  FAIL 记录在案，交互式在册兜底有效。
- **并行协作事件备案**：kimi 报告两次工作区批次撞号（BATCH-27/28 文件交错），
  处置正确（恢复他犬文件、保留己方改动、全绿再提交）——并行拓扑首次真实
  摩擦，无损失；后续并行派发包应错开批次号段（改进项记 M5+）。
- **RM-002 进度**：G006+G007 收口 → **G009（试验田）编排前置就绪**。

## AD-18 · GOAL-010 验收（2026-08-17，头犬 zcode 会话）

- **机检**：跟踪面独立复跑 9/9（web-dispatch + ccswitch-probe）；全量 242/242
  （首跑 1 fail 复跑即过——F-29 同族超时竞态 flaky，继续观察）。
- **产物核验**：`runtime/capability-registry.json` 生成（probed_at 时间戳在案）；
  **脱敏扫描 clean**（无 sk-/token/api_key）；roster 活体验证：claude-code
  19 变体、codex 61、opencode 2、deepseek-dsh 2——cc-switch 实测枚举生效。
- **验收**：GOAL-010 升 **AUTO_ACCEPTED**（executor deepseek-dsh，commit 4d2440f）。
  D20"实测注册"自此落地：变体=可调用候选（verified:false），身份仍以 nonce
  实测为准（D13）。
- **并行协作**：kimi 在途文件（page.ts/api-contract.md/utils 新件）在工作树，
  属 GOAL-007-B 未完工作，头犬验收不触碰；其提交后全量自然恢复绿。

## AD-19 · GOAL-007B 验收 + 错位交付归位（2026-08-17，头犬 zcode 会话）

- **机检**：全量 242/242（kimi 交付基线）；清理错位副本后 236/236（-6 为
  dateFmt 测试随迁 playground）。
- **活体验证**：select playground → `selected=true` 回显 ✓；dispatch detail
  含 stdout_tail/stderr_tail ✓；fake-t1 终态 FAIL 为无 exe 的诚实结果
  （DEF-02 受控）。四项 owner 缺陷（D1-D4）修复确认。
- **验收**：GOAL-007B 升 **AUTO_ACCEPTED**（executor kimi-k3，commits
  561eb4e/969f463）。
- **悬案 F-38 破案与归位**：`src/utils.ts`/`tests/utils.test.ts`（mush 仓内
  未跟踪）= owner 早期真实派发的 dateFmt 任务产物——当时 workspace 选择存在
  D1 缺陷，犬在错误仓库（D:\mush）执行。处置：交付物已归位
  `D:\mush-playground`（utils.ts 合并 + tests/datefmt.test.ts，playground
  10/10 绿，commit 34d0e47——即恢复路径）；mush 侧副本按 D16 清理，哈希
  锚点：utils.ts a94abb28…4ce9a80d、utils.test.ts 93a91a3d…19ac530。
  **owner 早期那次派发实际成功**，只是落错了地方——D1 修复后不再复发。
- **新 finding F-39（小）**：workspaces 列表同路径双条目（`D:\…` 与 `D:/…`
  形态未归一化）——known-workspaces 读写时统一 path.resolve，下批顺手修。

## AD-20 · RM-002 DoD「owner 实操全流程」落袋（2026-08-17）

- **owner 亲手在看板完成干净全流程**：选犬（deepseek-dsh）→ 写任务（"1+1等于几"）
  → effort/cap/real → 派发 → 卡片实时反馈 → detail 输出预览（"1+1等于2。"）
  → 完整生命周期（ADMISSION→EXECUTE→REPORT→REVIEW 全 PASS）。
- **证据锚点**：dispatch_id `eaaad0820d8d4fee90ff8d941bcf5419`，回执
  `D:\mush-playground\.mush-receipts\dispatch-eaaad082….json`
  （sha256 92b88d80…4b9cff0，exit 0，real=true）。
- **意义**：GOAL-007B 四项修复经 owner 实操确认；workspace 正确落在
  playground（D1 修复验证）；RM-002 DoD 剩余：意向项目收官任务（owner 指定）
  + 扩编犬 nonce 补跑（普通环境）。

## AD-21 · GP-02 验收 + 并行协作新规则（2026-08-17，头犬 zcode 会话）

- **隔离验证（git worktree @ c106abc）**：248/248 全绿；活体验证 create 201 /
  重复 409 / 相对路径 400 / 正斜杠登记归一回显 selected=true 无双条目——
  kimi 交付时点 252/252 主张属实（当时树无 deepseek 在途文件）。
- **验收**：GP-02 **AUTO_ACCEPTED**（executor kimi-k3，commits 2b2515d/c106abc）。
- **F-45（流程改进，源自本次干扰）**：共享工作树的并行批次第三次交错
  （BATCH 撞号、F-37 全量红、本次 11 fail），头犬验收被迫 worktree 隔离。
  **新规则（即日生效）：并行派发包必须配 per-dog git worktree**（如
  `runtime/worktrees/<dog>`），完成后由头犬合并——dashi-taskboard worktree
  协作教训的直接落地。写入派发包模板。
- **F-46（悬案，待 owner 说明）**：`gargantua-raytracer/`（web 项目，
  2026-08-16 17:42 创建，含 .npm-cache2）在 D:\mush 内、无任何派发/回执
  记录对应——来源不明，非 mush 治理内产物。头犬未动；请 owner 确认来源
  （自行实验/其他工具产物/可归档删除）。

## AD-22 · F-46 结案（2026-08-17）

- **owner 说明**：`gargantua-raytracer/` 为其对 deepseek 的私人测试项目，
  "完成后就可以删除，先不用管"。头犬不动该目录；删除授权**待 owner 届时
  一句话触发**（不自行判定"已完成"）。

## AD-23 · GP-03 验收（2026-08-17，头犬 zcode 会话）

- **隔离验证（worktree @ 877d63f）**：253/253 全绿；真杀进程冒烟（头犬环境，
  补 deepseek 沙箱不能做的部分）：起服→dry-run 派发→kill -9→重启→
  `snapshot.dispatches` 记忆存活 ✅；**F-42 锁实测**：同目录第二实例
  exit 3 + 明确 PID 报错 ✅。
- **台账链**：字段为 `previous_sha256`（genesis null）+ `sha256`，
  verifyLedgerChain 套内测试通过（头犬首轮校验脚本字段名用错，已更正）。
- **验收**：GP-03 **AUTO_ACCEPTED**（executor deepseek-dsh，commit 877d63f）。
  宪法 §2 审计链（台账锚点）补全；看板重启不失忆达成。
- **DEF-05（小，显示级）**：重启回放只读 header.status（ADMITTED），不折叠
  后续生命周期事件（EXECUTE/REPORT/REVIEW 的 FAIL 未反映）——事件数据完整
  落盘（5 行全链），属回放聚合缺陷。归 GP-10（运行历史）或下一后端批顺手修。
- **F-40/编号事件**：deepseek 误用 BATCH-33 后已 git 恢复 kimi 原文并规范为
  BATCH-34——核验通过（两份回执俱在）。

## AD-24 · GP-01 验收：意向项目首个真实任务完成——RM-002 DoD 全满足（2026-08-17）

- **任务**：RM-055-RF-C discovery 0 seeds 只读诊断（dispatch `f49de5c7`，deepseek-dsh，
  real，20:26-20:42 本地，PASS）。
- **产物**：`D:\意向项目\spec\rf-c-discovery-diagnosis-2026-08-17.md`（201 行，
  frontmatter 规范，结论：0 seeds 属"collectors 返回零/上游运输层失败"而非过滤删光；
  证据带 file:line，discovery.db 以 mode=ro 打开）。
- **红线核验**：意向项目 git status 与执行前一致 + 仅新增报告与 mush 运行时目录；
  backend untracked 文件均为 8 月初既有脏状态（F-02），非犬产物；.agent-bridge/ 零接触。
- **历程备案**（诚实记录）：两次被误杀（120s 旧超时；头犬重启孤儿化）+ 一次头犬
  派发漏 workspace 字段跑错仓库（已终止，DEF-10：派发默认工作区应取持久化选择）。
  第四次成功——机制修复（900s/僵尸回收/重启纪律）逐一兑现。
- **里程碑**：RM-002 DoD 全满足——owner 实操全流程 ✅ + 意向项目真实任务 ✅。
  RM-002 状态 COMPLETE_REQUESTED，DONE 待 owner 一句话。
- GP-18（完成通知）升级为 owner 明确诉求；DEF-10 记入池。

## AD-25 · 批量转正（2026-08-17，owner 一句话"全部转正"）

GOAL-001 / 002 / 003 / 004 / 005 / 007B / GP-02 / GP-03 / GOAL-010 全部
AUTO_ACCEPTED → **DONE**（goal 文件与 completion 回执同步更新）。至此
RM-001、RM-002 全部构件正式收官。另：派发包编号改带 RM 前缀（rm003-pNN），
杜绝 Goal 号/包号歧义（GOAL-010 重复领单教训）。

## AD-26 · GOAL-011 验收 + 合并（2026-08-17，头犬 zcode 会话）

- **隔离验证**：worktree g011-deepseek 260/260 全绿（255+5）。
- **合并**：F-45 首次实战——master 合入 g011-deepseek（chat API/head-dog
  适配器/角色注册/DEF-10/会话续跑机制）。
- **F-48（执行者记为 F-41，编号撞车特此归正）**：dsh 0.1.0 headless 不支持
  --resume。头犬补丁：① dsh/head-dog 合同摘除 resume_flag 声明（诚实）；
  ② chat.ts 改**上下文缝合**（近 12 轮织入 prompt，任何通道可用）；
  ③ chat 默认 real=true（聊天无 dry-run 意义）+ timeout 300s。
- **真实验收（合并后 master，头犬亲测）**：两轮聊天全 PASS——round 2 逐字
  引用 round 1 提问（多轮上下文实证）；头犬对在册犬的回答准确（5 只 +
  kimi 待补编）。
- **验收**：GOAL-011 **AUTO_ACCEPTED**（executor deepseek-dsh，分支
  g011-deepseek @ a300083 + 头犬 F-48 补丁）。
- 深seek worktree 已合并待清；kimi g012 在途。

## AD-27 · Linux 对照实验收篷（F-49，2026-08-17）

- **已完成**：mush-dsh:local 镜像修复并构建成功（三层坑逐一排掉：包名
  legacy-dsh→@deepseek-ai/dsh；node-pty 无 linux 预编译→apt 工具链；
  手写 wrapper 的 printf 在 Dockerfile 引号层被啃坏→删掉，npm bin 链接
  本就可用）。容器内 `dsh --version` = 0.1.0-rc.6（与 Windows 同版本）。
- **F-49（阻塞）**：dsh 凭据存储（dsh-credentials-local）不可跨 OS 移植——
  容器加载挂载的 ~/.dsh 凭据在 cordis.init 崩溃；:ro 挂载直接 EROFS。
  破解需专项（最小凭据文件/env 注入且密钥不进命令行=红线约束）。
- **结论**：Windows 原生 nonce 基线已测（16.1s matched）；Linux 侧
  "更优"假说无法用 nonce 计时单独回答，且 dsh 当前形态 Windows 侧完全
  够用。**搁置为 GP-28**（owner 需要时再攻）；镜像与 Dockerfile 已入仓
  可随时续。

## AD-28 · GOAL-012 验收 + 合并 + M1 联调（2026-08-17，头犬 zcode 会话）

- **隔离验证**：worktree g012 263/263 全绿（web-page-parse 每批必过）；
  设计问责在案（BATCH-38 design_rationale：极夜雪橇队母题 + 两 skill
  采纳/舍弃逐条）。
- **合并**：g012 → master，268/268 全绿；契约升 v1.3 权威源（删除分支
  指向注）。
- **M1 联调（真实两轮）PASS**：合并后 master 上 POST /api/chat 两轮，
  上下文缝合正确（round2 准确复述 round1 指令）。
- **事故与修复（DEF-11）**：联调首跑 FAIL——两层环境伤：① Windows 侧
  dsh 安装损坏（lib/ 目录丢失，原因未明，重装 0.1.0-rc.6 修复）；
  ② **Linux 实验（AD-27）的 RW 容器挂载在 ~/.dsh 留下坏 reparse point**
  （Linux 符号链接物化为 Windows 不可读重解析点 → EACCES）——ACL 重置
  无效，删除 profiles/node_modules（包管理产物可重建）后 dsh 自愈。
  **教训入册：容器挂载宿主配置目录必须 :ro 或专项卷，RW 直挂 = ACL/
  reparse 污染（GP-28 前置约束更新）。**
- **验收**：GOAL-012 **AUTO_ACCEPTED**（executor kimi-k3，g012 @ ddd4d4f）。
  RM-003 M1+M2 完成；剩余 DoD：owner 经面板实操多轮对话 + G013（M3）。

## AD-29 · GOAL-012B 验收 + 合并（2026-08-17，头犬 zcode 会话）

- **隔离验证**：worktree g012b 279/279（+11）；冒烟脚本 8/8。
- **合并**：master 279/279 全绿。
- **活体验证（头犬亲测）**：① chat 带 effort 参数 PASS 且响应体含
  `reply`（D3 修复实证——回复直达气泡数据源）；② adapter_id=executor
  伪充头犬 → 400（D1 fail-closed 实证）。
- **验收**：GOAL-012B **AUTO_ACCEPTED**（executor kimi-k3，g012b @ f7385e9）。
  附注：执行者发现并修复 Node/libuv Windows SSE 关闭竞态
  （process.exit→exitCode），经验入回执——加分项。
- RM-003 进度：M2 补完；余 p13（图标动效）/p14（犬力批）在途。

## AD-30 · GOAL-013 验收 + 合并 + kimi 转 READY（2026-08-17，头犬 zcode 会话）

- **隔离验证**：worktree g013 278/278（+10）；合并 master（契约版本行
  冲突手工合流 v1.4）后 **289/289 全绿**（g012b+g013 测试并集）。
- **kimi nonce 复核（头犬非沙箱环境直测）**：**PASS**——哈希精确匹配
  （证据 kimi-real-003.json）。deepseek 沙箱内的 FAIL 系环境，通道与
  凭据正常。**kimi-code 犬正式 READY**（六犬满编：deepseek/claude/kimi/
  zcode/codex/opencode + head-dog）。
- **验收**：GOAL-013 **AUTO_ACCEPTED**（executor deepseek-dsh，g013 @ 1bcf8df）。
  profile/effort 合同/rerun/kimi 合同全部落库；契约 v1.4。
- RM-003 进度：M1 ✅ M2 ✅ M3 ✅（待 p13 图标动效合并后收官）。

## AD-31 · GOAL-013L 验收 + 合并（2026-08-17，头犬 zcode 会话）

- **隔离验证**：worktree 284/284（+5）；**web-page-parse 防线首次实战立功**
  ——当场抓获 onerror 内嵌 JS 的模板转义陷阱（DEF-07 回归测试的价值实证）。
- **合并**：契约版本行冲突合流；kimi 的 BATCH-40 撞名回执改名
  BATCH-40L-kimi-logo.json（双方保全）；master **294/294 全绿**。
- **活体验证**：/assets/brands/deepseek.svg 200（svg）；路径穿越 404；
  页面含品牌引用与 logo-hop 动效类 ×5。
- **验收**：GOAL-013L **AUTO_ACCEPTED**（executor kimi-k3，g013-logo @ d84513a）。
- **RM-003 全部构件齐**：M1+M2+M3+三补丁包（12B/13/13L/14）合并完毕。
  收官余项（owner 侧）：① 复验聊天+图标+动效；② 一次真实弹审批应答。

## AD-32 · GOAL-017A/017B（调度自由 M4）验收 + 合并（2026-08-17，头犬 zcode 会话）

- **隔离验证**：worktree g017a **304/304**、g017b **299/299**（头犬独立复跑）。
- **安全审查（D23，新 API 面）**：
  - `POST /api/adapters` 仅六基础模板 + 白名单参数（profile/model_id），
    **不可注册任意可执行文件**（任意命令注入向量不存在）；adapter_id 正则
    `[A-Za-z0-9._-]+`；注册表文件损坏 fail-closed 不加载；DELETE 为软删。
  - verified 三源判定：用户注册按模板家族（codex/opencode 模板恒 false）/
    registry 证据 / 代码白名单；**codex F-50 接口层拒绝实测命中**
    （"codex is UNVERIFIED (F-50) and cannot be head-dog"）。
  - caps：finite/>0 校验齐全；CAP_CHANGE 台账行入哈希链（实测尾部
    previous_sha256 链式衔接）；新路由全部处于 DEF-04 Host 闸门内侧。
  - 低危观察（不阻断）：① dry-run 自报 amount_usd>0 会入准入闸门不入
    spent 投影（口径边缘，现网无此形态）；② registry verified:true 可
    证据驱动解锁头犬资格——含未来 codex 换通道重探 PASS 的预期解锁路径。
- **合并**：g017a 快进（犬基于 D29 后 master 建枝）；g017b 撞名回执按
  BATCH-40L 先例改道 **BATCH-41L-completion.json**（双方保全）；合并后
  master **309/309 全绿**；契约 v1.5。
- **真实冒烟**（重启前查在途 EXECUTE=0；合并后 master 起板 4790）：
  - adapters CRUD：POST zcode-x（origin=user/glm-4.7/verified=true）→
    roster 可见 → DELETE → 隐藏；
  - caps：PUT kimi-code=8 ✅ / =0 拒绝 ✅ / 台账留痕 ✅；
  - kimi 冒烟脚本重跑打真实后端 **9/9**；
  - **zcode 任头犬真实对话**：链路（resolve→admit→审批闸）全程正确，
    按治理进入 owner 审批卡（派发 `7217a1ba`，BLOCKED_WAITING_OWNER）；
    zcode 裸 `--prompt` 合同执行另有 zcode-real-002 nonce PASS 背书。
- **验收**：GOAL-017A **AUTO_ACCEPTED**（deepseek-dsh，g017a @ 2f7f113）；
  GOAL-017B **AUTO_ACCEPTED**（kimi-k3，g017b @ 829c0c8，mock 级项经
  联调实测转真）。worktree/分支已清理。
- **RM-004 M4 机检面完成**；owner 侧余项：① 看板复验五项（加犬/级联/
  徽章/辉光/cap）；② 审批卡 `7217a1ba` 批准或忽略（zcode 真实回复可见）。

## AD-33 · p18 队列派发 + DEF-12 热修（2026-08-17，头犬 zcode 会话）

- **队列自续（D17）**：p18a → deepseek-dsh（`bd324e95`）、p18b → kimi-code
  （`8aa198d7`）并行执行中（双 ADMITTED=执行态；F-45 各建 worktree，
  文件面后端/前端不相交）。D29 修订版派发单生效首发。
- **DEF-12（热修 `08e9ead`，310/310 绿）**：首例 board→kimi 真实 spawn
  暴露垫片解析缺陷——DEF-03 正则只认 `.js` 入口，kimi 垫片入口为
  `dist/main.mjs` 不匹配 → 恒 ENOENT。**此前 kimi 任务全部依赖 owner
  手开窗口投喂，看板从未真正拉起过 kimi**（owner「每次新开窗口」痛点
  的组成部分）。证据：`cbf6a97b` 回执 stderr_tail=
  "spawn failed (BLOCKED_ENV): spawn kimi ENOENT"；真身 runT1 复现一致。
  修正 `/\.(?:mjs|cjs|js)/i` + 回归测试（真实垫片形态三例：
  main.mjs/bin.js/无入口）。
- **附带观察**：p18a 首发被 effort 合同拒绝（deepseek-dsh
  effort_levels=['DEFAULT']，p14 犬力批后的合同语义）——头犬派发前
  应先查 roster effort_levels，已记入操作惯例。
- **头犬自省（铁律重申）**：本轮两次违反自己的转义铁律——heredoc 套层
  把 `\r\n` 拆成真换行损坏测试文件；`.cjs` 顶层 await。均当场修复。
  教训固化：写/改文件一律用文件工具，不经 shell 叠转义。

## AD-34 · 双通道投喂事故收敛 + 单通道规则（2026-08-17，头犬 zcode 会话）

- **事件**：owner 手开 kimi/deepseek 两窗口投喂 p18a/b，与头犬看板侧真实
  派发（bd324e95/8aa198d7）形成**同一包双通道双开**（同 worktree 冲突风险 +
  双份花费）。kimi-e 已有主体提交与 BATCH-43 脏工作区（未提交文件保留在
  worktree，无损失）。
- **处置**：停看板侧（重启折算，两派发 → INTERRUPTED，台账留痕）；owner
  手开两只窗口为本轮唯一执行通道。
- **常设规则（单通道）**：一份派发包同一时刻只允许一个投喂通道——
  要么 owner 手开窗口，要么看板派发，禁止并行。DEF-12 修复后看板已可
  真实拉起 kimi/dsh，后续包默认走看板（GOAL-018 落地后同窗续跑由系统
  接管，owner 不再手开窗口）。
- **联调时序提醒**：kimi BATCH-43 联调前提「p18a 后端已落盘」当时并不
  成立（g018a 零提交）——deepseek 窗口完成 U1-U7 并落 g018a 提交后再做
  真链路联调；期间 kimi 按 p18b 包内 mock 约定继续前端面工作。

## AD-35 · 在途可见性补丁：三件套扫描 + 窗口命名约定（2026-08-17，头犬 zcode 会话）

- **owner 质询**：头犬为何察觉不到手开窗口的在途任务（AD-34 双通道成因
  之一）。答复：手开会话对编排层不可见（无登记/心跳）= 系统盲区；头犬
  派发前只查了 dispatch 记录、漏查 worktree = 检查清单漏洞，两者均有。
- **补丁**：①窗口命名约定 `mush|<packet>|<dog>`（owner 提议）——标题对
  owner 与头犬均机器可读（PowerShell MainWindowTitle）；②
  `scripts/dog-window.cmd` 一键开窗自动带标题；③`scripts/scan-inflight.ps1`
  三件套扫描（犬窗口/worktree/看板派发），实测当场识别出两只在途手开犬；
  ④AGENTS.md 常设：头犬派发前必跑扫描。
- **根治方向**：GOAL-018 流记录（session registry）落成后手开会话结构化
  登记，三件套降级为兜底。

## AD-36 · 桌面快捷方式双开窗口修复 + 双通道花费核对结论（2026-08-17，头犬 zcode 会话）

- **owner 报障**：点击「mush board.lnk」浏览器开两个窗口。
- **根因**：board-up.cmd 无条件预开（2s 后 Start-Process）+ DEF-06 exit 3
  分支再开——已有实例时两路都触发。
- **修复**：逻辑全量移入 `scripts/board-up.ps1`（先查锁：活实例→只开一次
  退出；冷启动→新控制台窗口起板→轮询端口→只开一次），board-up.cmd 改
  薄委托（桌面 .lnk 无需改动）。**实测两路径**：热路径 exit 0 单开；冷
  路径冷启动成功（snapshot 200）单开。
- **双通道 token 损耗核对（结论：本地不可精确计量）**：cc-switch 代理日志
  今日零流量——dsh/kimi 各走自有凭据（~/.dsh、~/.kimi-code），不经
  cc-switch，无本地明细。有界估计：被打断的两段会话（~03:30–03:55Z，
  各约 25 分钟的读包+起步工作）按两犬 cap（$5/$8）封顶，量级预计远低于
  cap；精确数字以 provider 账单为准。教训已由 D30/AD-35 制度化。

## AD-37 · GOAL-018A/018B（会话连续性 v2 / M5）验收 + 合并（2026-08-17，头犬 zcode 会话）

- **合并路径说明**：g018a 系 **owner 本人**于 11:35+0800 自行合入 master
  （`0d997e2`）——owner 有权直接动 master，非犬只越权；头犬验收改事后
  补审。g018b 由头犬常规合并（`2c4ba9f`，零冲突，kimi 侧已自行折合）。
- **g018a 事后安全审查（D23）**：PASS。streams 路由 id 正则无穿越；外部
  handoff 写入同回环信任域；extractSessionId 字符集受控（无 shell 注入）；
  dsh 缝合结构常量固定。观察项（不阻断）：①外部 handoff 无长度上限
  （建议后续加上限）；②session_id 理论可捕获 `--` 前缀串形成参数注入
  边缘（自毒场景，回环信任域内低危）。
- **测试**：master 含 g018a 319/319；并入 g018b 后 **324/324 全绿**。
- **干跑冒烟（零花销，D30 无涉）**：同 goal 两次派发自动归同一流
  （1 流 2 事件）；`POST /api/streams/:id/handoff` 201 带 sha256；
  时间线含交接块。脚本 `scripts/g018-merged-smoke.mjs`（初版 process.exit
  撞 libuv 退出断言，已改 exitCode，复跑 EXIT=0）。
- **验收**：GOAL-018A **AUTO_ACCEPTED**（deepseek-dsh，g018a @ 49a34c2）；
  GOAL-018B **AUTO_ACCEPTED**（kimi-k3，g018b @ 51cae80，联调批含
  v1.6 实契约对齐 + `new_window` 前端提案字段待契约补录）。
- **悬置项（诚实记录）**：kimi 真实自动压缩实测未做（需长真实会话，
  涉真实花销——按 D30 走审批卡或留待 GP 项）；代码已保证 `unknown`
  档不误触发换窗。
- **RM-004 进度**：M4 ✅ M5 ✅（机检面）。余：M0 carve-out（GP-24）、
  M1 旗舰（待 owner 切片授权）、M2 聊天流式、M3 任务池；GP-32 单次
  审批制现已解除阻塞（p18a 已并）。

## AD-38 · GP-32 逐单审批落地（2026-08-17，头犬 zcode 亲自执行，D23 安全线）

- **owner 报障**：审批卡无按钮、无报备信息、与旧审批视图两套并存。
  根因：看板审批 UX 是常设文件时代产物，D30 废档后才暴露缺口。
- **实现（统一到既有 D6 审批视图）**：
  - real 派发无令牌 → 自动生成审批请求文件（犬只/强度/超时/工作区/
    cap/已花/完整 prompt 报备）进审批视图；回放补建旧卡；
  - 批准 = 单次令牌（读即焚）+ approved_via 自动重跑，原单折
    SUPERSEDED；否决 = REJECTED（两新终态）；
  - 弹窗报备面板 + 派发卡「去审批」按钮；
  - **owner 亲启通道**（产品关键裁决）：ChatService 内部 originOwner——
    owner 聊天敲字即批准不设卡（否则逐卡审批杀死对话 UX）；公开
    dispatch API 不接受该语义，代理发起一律停卡。
- **测试**：331/331 全绿（GP-32 新增 7 用例：停卡+请求生成/常设废除/
  令牌消费+SUPERSEDED/否决/快照投影/HTTP 批准+否决/回放补建）。
- **遗留（诚实）**：①board API 无调用者身份（GP-32②）仍开——聊天通道
  维持回环信任（与 D30 前一致），派发通道现已逐单设卡；②外部 handoff
  长度上限与 session_id 前缘边缘（AD-37 观察项）未动。
- **即刻效果**：重启看板后 owner 可在审批视图直接批/否 p19a/p19b 两张
  在场卡（补建生效）。

## 附：同批落盘
- D31：前端双模决议（浅色默认+极夜可选）——owner 已选方向，实施由
  owner 直接与 kimi 对话推进（单通道）；GP-33：ccusage 模式用量监控
  入池（本地日志解析+定价表，零依赖模仿，数据源含各 harness 本地会话
  日志与 cc-switch 代理库）。

## AD-39 · DEF-13 定性（dsh headless 工具调用即崩）+ 应答误报修复（2026-08-17，头犬 zcode）

- **DEF-13（上游缺陷，dsh 0.1.0-rc.6 headless）**：批准重跑 `481d0b7e`
  17s 崩于 `PI_AI_ERROR: Cannot read properties of undefined (reading
  'startsWith')`。头犬四轮二分复现矩阵（scripts/def13-bisect*.mjs，证据
  脚本入库）：
  - 过：纯指令/缝合结构/项目层简报/纯 5.3k 长度/纯 CJK 问候/禁工具任务；
  - 崩：任何会诱导模型**调用工具**的任务文本（读文件任务 9s 崩；同类
    任务明令禁工具 8s 过）——与语言、长度、缝合、简报全部无关。
  - 8-16 两张 head-dog FAIL 旧卡哈希比对为**不同错误**（非同病）；
    RF-C 当时 PASS 属模型未走工具的运气。
  - **结论：看板→dsh 真实派发对"会动用工具的任务"不可用**；owner
    交互窗口（TUI 路径）不受影响——现行狗任务经 owner 手开窗口投喂
    （AD-34 单通道惯例）。正路候选：GP-29 pi 复活（升优先建议待 owner）、
    GP-30 dsh 版本观察、G018-U6 探明的 dsh web Typert RPC。
  - 不做自动重试：一次批准=一次执行（D30 语义），重试走新审批卡。
- **应答误报修复**：respond 端点原同步等待整段重跑（真实任务数十分钟），
  前端超时先放弃 → owner 批准后弹"应答失败"（实际成功）。改为**令牌
  授予后异步启动重跑**（void），应答即刻 201 `{rerun:'STARTED'}`，执行
  状态经 SSE 生命周期事件推送。332/332 全绿（HTTP 用例改轮询断言）。

## AD-40 · GOAL-019A（任务池后端 M3）验收 + 合并（2026-08-17，头犬 zcode 会话）

- **独立复跑**：worktree g019a **336/336**（分支基点 56ca013，早于 AD-39；
  犬只提交面干净 9 文件，无越界）。
- **安全审查（D23）**：PASS——状态/优先级白名单校验；transition 路由正则
  `[A-Za-z0-9_-]+` 无穿越；task 回链 fail-closed（未知 task_id 拒绝）；
  approval 段未触碰（包内约束遵守）。观察项（不阻断）：title/detail 无
  长度上限（与外部 handoff 同类低危，GP-32 遗留观察项合并跟踪）。
- **合并**：零冲突（AD-39 与任务路由不同区段）；master **336/336**。
- **真实冒烟（零花销 dry-run）**：建卡 201 → IDEA→READY→QUEUED 合法迁移
  200 → QUEUED→DONE 非法迁移 400 带原因 → 带 task_id 派发 → 任务记录
  含 dispatch_id（回链闭环）。gp-import dry-run 解析 32 项 GP。
- **验收**：GOAL-019A **AUTO_ACCEPTED**（deepseek-dsh，g019a @ 866b750，
  owner 手开窗口投喂线）。worktree/分支已清理（kimi-f/g020 在途保留）。
- **前端消费面**：GOAL-020 B5（kimi 已开工 g020 worktree）。
