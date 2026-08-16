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
