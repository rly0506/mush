# GOAL-084：生产证据库接线（2026-10-03）

已补宿主本地证据库与默认看板接线；这不代表 Codex + Antigravity 已满足真实讨论准入。Goal 保持 PROPOSED，本轮没有新增模型调用、提交或推送。

## 本轮改动

`src/orchestration/collaboration-evidence-store.ts` 实现既有 EvidenceStoreLike。宿主代码登记已经审核的记录及产物字节，保存到各工作区数据面 `collaboration/evidence`；无 HTTP 登记接口。source 哈希只用作库内索引，不作为外部路径；记录/产物独占创建，同 source 不可改写。真实路径越出数据面时拒绝，包含 Windows junction；创建目录前检查父目录，避免先写后拒绝。

创建会话按当前通道与合同指纹取候选；批准时 resolve 再读登记及产物、校验 SHA-256，损坏、缺失、越界、未知方法/维度或不匹配均保持未验证。已有显式宿主注入接口不变；工作区切换仍按 D86 数据面隔离。失败为 unmet，只有已审核行为覆盖且 pass 的记录作为 live_verified 候选；模型自报为 declared。库核验字节与适用字段，不代替宿主判断验证结论是否正确。

## C7 登记与边界

对既有 C7（83ce4c0cd99e450fb6955414516de2fd）归档核对 stdout 与回执哈希后，五项登记均为 **declared**，没有新增 live_verified。产物为 C7.result.json，sha256 `8645eeda355e9ce3ff4413b6a162f29b2336221f03062cfbc211a1de713d6567`；来源为 `dispatch://<id>/self-report/<dimension>`。这五项只记录模型自报，不能填补权限准入。

登记脚本 `.test-fixtures/g084-register-c7-reports.mjs`；登记摘要 `.test-fixtures/g084-tool-surface-2026-10-03/C7.evidence-registration.json`。本地库在 gitignore 内，无原始用户配置或凭据复制。

看板旧进程已退出，本轮恢复 4790；浏览器协作视图可见，会话列表为空、无待批准按钮。重启恢复原 Codex 合同，C7 旧指纹不匹配时库不返回其证据；没有借重启自动重派或批准旧会话。

本机 `agy --help`、`agy mcp add --help` 本轮仅确认帮助未声明会话级 MCP 配置入口，不能据此证明不存在其他等效机制。没有修改用户 MCP 配置，AGY MCP 与自动上下文边界继续未验证。

## 验证

- 新增 6 条：跨实例恢复及拒绝覆盖；产物损坏后解析/筛选失效；未知来源及坏记录不放行；通道/指纹筛选与自报不晋级；默认 HTTP 创建取证且产物变更后批准 409（零执行、零占额、零批准回执）；junction 在写目录前拒绝。
- 新模块缺失时先观察到加载失败；之后默认看板用例发现必须显式选择 Codex 模型，按真实协作合同解析修正测试。junction 用例曾观测到先创建目录后拒绝，修正父目录前检后通过。不把前述缺模块的红灯称为边界缺陷复现。
- 聚焦：`node --import ./tests/setup.ts --test --test-isolation=none tests/g084-evidence-store.test.ts tests/g084-board.test.ts tests/g084-session-authorization.test.ts`，38/38、exit 0；typecheck exit 0。
- 默认全量首轮 **842/846，exit 1**：persistence Windows launcher/监听端口/PID 锁检查四处失败；相关文件单跑 **14/14**、exit 0；单独复跑默认全量 **846/846**、exit 0。独立全量 **846/846**、exit 0。首轮与独立全量存在部分时间重叠，但负载或本轮改动是否造成失败未证明，不写“无关”或“已修复”。原始失败保留。
- 完整日志 `.test-fixtures/g084-evidence-store-2026-10-03/final` 和 `default-retry`。默认首轮 stdout sha256 `54c7fea20808414b1fae32178d0804b77a92c0cafb4552327d1c65960c8e25b9`；默认复跑 `0fe477911e43119f0f75a9b2245d696baed9362a89e362e1c675d4f084187209`；独立全量 `974dd19f2b3da79840fb398998c84c553c33622537c8aa2b4b664f3323d96186`。
- 契约 v1.56，文档对账 PASS；git diff --check exit 0。

## 未完成

库已能承接正式证据，仍须审核并登记覆盖精确的权限行为证明、确认模型运行身份。Codex 原生测试与 C7 自报不可混为完整准入；C7 配置重启恢复尚需处理。Antigravity 的命令/写入/MCP/递归、每席位获准材料范围及自动上下文来源尚未闭合。未启动真实七调用双模型讨论，未改 Goal 状态或降低隔离要求。

## 追加复核：同配置反例阻断旧正证据

第七条回归先复现同通道/同配置/同维度的 fail 与旧 pass 并存时，旧来源仍可解析。已改为登记 fail 阻断相同范围的旧正证据；失败产物不可访问也不自动恢复旧通过。所有原始登记保留，不覆盖历史。

最终聚焦（证据库 + 会话授权）25/25、typecheck exit 0。最终代码默认全量 **847/847**、独立全量 **847/847**，均 exit 0；g076 7/7、对账及补丁检查通过。日志另存 `conflict-final/`，默认 stdout sha256 `389fc9c6f4ca158d2c7dab1d2809b545c72b2d1087cd30ad7c9a94a49e0c6ff1`，独立 stdout sha256 `a62dfd011bd5212373d8443cdf73ec3c97712d705d79cf04c4c4477acd631d1a`。上文 846 轮记录保留；Windows 首轮失败根因仍未确认。

核对看板 PID 和无在途状态后已重载最终代码；浏览器协作视图可见，列表 HTTP 200、会话数 0，没有触发模型或批准动作。
