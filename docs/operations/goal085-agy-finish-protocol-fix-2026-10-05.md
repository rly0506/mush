# GOAL-085：agy 结束协议提示修复与复测准备

执行／核验：Codex。Owner 要求「继续」处理上一场失败；本轮先做本地修复与零模型准备，不将夹具结果冒充原生模型验证。

## 证据与最小修复

上一场两个 agy 输出的原生 init 工具目录均含 `finish`；当前受控 hook 只允许 `finish`，所有资源与递归工具仍拒绝。两次原生轨迹均未调用它，最终 response 拼入四个不同 JSON。后续输出回应「继续调用工具／finish」提示，不能由 D92 的单答案解析接受。

协调器现为 agy 席位逐轮添加结束协议：只通过已有原生 `finish` 把本阶段唯一 JSON 作为最终答复，不先输出正文再调用，不生成多份答案；其它工具仍全部禁止，`finish` 不可用或被拒不得以其它工具替代。非 agy 席位不增加该段。

仅改 `src/orchestration/collaboration-coordinator.ts` 及相关测试；不改 agy 合同、模型／强度、gate、agent、项目 Deny、证据或 D92 终局采信规则。三份席位指纹与此前批准值相同。这里补的是提示中的已有结束协议，**真实模型是否遵循仍待新场验证**；没有选择早期或末条草稿凑成功。

## 机检范围

新增真实 DispatchPipeline → T1 子进程夹具：缺少结束提示时模拟原生继续循环，返回多份 JSON 聚合，红灯稳定复现共享重试耗尽；加入提示后七轮完成、零重试，agy 三轮均收到结束说明，其它通道不注入。另断言缓存草稿不能绕过不可解析的最后终局，既有 hook 用例确认仍只允许 finish。

- 相关测试 25/25（其中七轮闭环用本地子进程模拟，没有真实 agy 模型）。
- 默认与独立进程全量各 **954/954 exit 0**。测试预加载 `tests/setup.ts` 隔离 CLI、用户目录和账本，在宿主运行；PowerShell 执行策略仅测试进程设置，不改变系统配置。
- 日志：`.test-fixtures/g085-real-triple-codex-2026-10-05/finish-default-host.log`、`finish-isolated-host.log`。
- 看板空闲重载 PID1816→35476，重载后零派发激活三份原档案，三份指纹逐字不变。Claude 原生仍 2.1.289，在 D95 明确接受名单内。未复位熔断、未提高 cap。

## 新场可审阅范围

- 新会话 `81e32fe2-0768-4d83-88c0-6d6a0e1a713b`，授权快照哈希 `a5c0ab61cf1799c0b422035de6ea7e404fe2e827dfb337b14d45a2e8396cf799`，`pending_approval`、`ready=true`、0 调用。
- 沿用原五份材料的冻结正文与哈希，没有重新读当前源码替换旧材料；模型／强度为 Codex gpt-5.5 LOW、agy gemini-3.7-flash-high HIGH、Claude claude-sonnet-5 LOW。只有议题补复测说明、约束补明已有 finish 协议。
- 正常13+全场共享重试1，整场40分钟、单次180秒。新场未批准、未启动。旧场已4次；若批准本场，两场最多18次，不隐式复用旧终态卡授权。
- 拟继续沿用$4可见 CLI 费用停止阈值（单次可见申报>$1也停止），不提高既有 cap。Codex／agy 的费用 UNKNOWN，不承诺总账单硬限$4。
- 幂等准备脚本 `.test-fixtures/g085-prepare-finish-retest-2026-10-05.mjs` 仅创建待批会话，不批准、不启动；状态与完整详情落 `.test-fixtures/g085-agy-finish-fix-2026-10-05/prepared-room.json` / `prepared-detail.json`。材料仅从原会话只读查询，经原哈希逐项比对。

本轮零真实模型调用。旧场失败证据原样保留，Goal仍PROPOSED，不记AUTO_ACCEPTED或DONE，不提交、不推送。下一步是批准新场并验证原生 finish 是否被实际调用、唯一成功终局及六条互评／三份修订是否齐备。

## 真实复测追记：原生版本门再次停止（追加，取代上文待批状态）

Owner 另行明确答复「授权新场复测」后，Codex 经看板批准81e32fe2并启动。实际仅2次正常调用（Codex协调、提案均PASS），随后派发agy的预检报 `agy discussion native version mismatch`，整场failed，未占第三次额度；agy与Claude均未执行。因此 **finish提示尚未得到本场原生验证**，本地测试通过不等于真实修法成立。

零模型核查确认 `agy --version=1.2.17`，冻结manifest仍 `nativeVersion=1.2.16`；可执行文件mtime为2026-10-05T14:14:50Z。确认的是本机版本已变化，不在本轮断言升级执行者／自动更新的因果。本次预检遗漏由Codex承担：批准前复核了Claude但未单独核对agy实时版本，浪费两次无法确认费用的Codex调用。

已补独立只读脚本 `check-native-before-approval.mjs`：以原卡冻结证据／manifest为依据，零模型执行三通道--version，Claude仅认可已有D95名单，其它不擅免；当前输出codex ready、claude ready、agy not ready并exit2。该脚本要在任何下一场批准之前运行，不改owner此前暂缓的产品readiness行为。

首场4次＋本场2次＝目前真实调用6次，费用都UNKNOWN。若再开完整复测，最多新增14次、累计20次，会超出刚才两场最多18次的授权；需另批。D95只接受Claude版本，不能套给agy。

本场outcome的dispatch_ids为空（预检异常的既有收口路径），但execution_log、monitor与两份物理回执均完整保留，不能据空数组说未调用。未顺手改异常结果投影。新失败证据根：`.test-fixtures/g085-agy-finish-fix-2026-10-05/real/`，final-detail SHA256 `648860f6c31468434c691364db6108a75f5c23e399a2430549d1bf13e58a45f1`。

版本接受提案只放在 `.test-fixtures/g085-agy-finish-fix-2026-10-05/agy-version-drift-acceptance.proposed.json`，明确pending-owner，没有写入运行政策，没有降级/升级全局CLI，没有更改指纹／证据／预算，也未启动第三场。
