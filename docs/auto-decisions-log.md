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
