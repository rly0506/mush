# GOAL-084：Codex 闭合配置与 C7 实弹（2026-10-03）

本轮纠正 unified_exec 的阻塞判断，构造并接通 Codex 闭合配置；真实 C7 经 Owner 委托的浏览器审批结算 PASS。Goal 保持 PROPOSED，真实双模型讨论未启动。

## 原生请求与路由器证据

全部原生假服务实验使用独立 CODEX_HOME/HOME/USERPROFILE、删除继承的凭据相关环境变量，只有 localhost 假 provider，不调用真实模型。仅记录工具名称、输入长度和已知错误，不保存模型输入正文。

1. baseline 请求含 exec_command/write_stdin 等工具；shell_tool=false 后两项消失，unified_exec 为 true/false 都相同。gpt-5.5 的内置 shell_type 为 unified_exec 是相关线索，未靠 Rust 源码确认 features list 覆盖优先级；可靠结论是“显示为 true 不代表命令工具存在”。旧报告将它作为硬阻塞过于保守，历史记录保留，本条更正。
2. 关闭 goals/tool_suggest 后目标管理和 tool_search 从请求消失；tools.view_image=false 单独无效，features.view_image=false 才移除读图工具。经捕获核实后使用后者。
3. 复制公开内置模型目录，保留所有模型/元数据，仅将选定 gpt-5.5 的 apply_patch_tool_type 改为 null；通过会话级 model_catalog_json 下发。真实原生请求最终只含 request_user_input（非资源执行入口）。模型 ID、provider 和凭据不换。
4. 假服务强制返回未声明 apply_patch、exec_command、view_image、spawn_agent、get_goal 调用，真实原生 runner 分别返回 unsupported，未创建写入文件。证据 unlisted-patch/ 与 unlisted-functions/。这比“参数传到了”“模型自报不能调用”更直接。
5. 早期补丁 read-only/workspace-write 正对照均被拒（patch-positive/、patch-profile/），未确认其原因；不拿该对照宣称 read-only 单独生效。最终方案靠工具移除及路由器拒绝，其证据独立。
6. 公共模型目录最初只保留 gpt-5.5 时出现 gpt-5.6-luna 元数据回退警告；正式构造器保留整个目录，其余记录不变，已用准确构造器重新捕获请求（composed-profile/），不再出现此警告。

此处为本机 installed-native 行为测试；假服务不证明真实账号权益。native prompt 渲染只保存长度/标记，含 Skills 标题不等于已证实存在 skill 条目；路径提取未取得条目，不能据此宣称全局 skill 一定清空。

## 实现与守卫

新增 src/adapters/codex-discussion-profile.ts：生成 catalog-<sha256>.json，禁止覆盖同名坏文件；关闭命令/读图/补丁/目标管理/发现/插件/递归等入口，逐个禁用当前 MCP。目录路径、哈希、目标模型和原生版本经 codex_discussion_profile 写入合同并参与合同指纹；保留 executable/provider/default model/普通 CLI 参数。讨论配置使用 stdin，避免长参数挤占 Windows prompt 空间。

派发管线在预算门和模型执行前核查目录完整性/模型，实际执行还重新查询同一 executable 与限制参数下的版本/MCP；未知或启用 MCP 拒绝。alternate cwd/carveout 不可混用。prepareOnly 仅静态检查，不做运行时准入或计费；批准重跑重新核查。测试 callback 只作为宿主装配项，不接受 HTTP 自报。

固定 POST /api/collaboration/probes/prepare 新增 C7。准备会把该配置装入当前 Codex 管线，旧批准不跨指纹漂移沿用。该激活为当前进程状态，未写用户账号配置；服务重启后需准备入口重建，旧卡不得自动跨恢复沿用。普通调用不注入这些工具限制参数，默认模型保持原值；prompt transport 随管线配置改为 stdin。

## 一次真实 C7

- 批准卡：bc5b7ec7de9c4abcb7e10d5ce037b4ea；实际派发：83ce4c0cd99e450fb6955414516de2fd。
- Codex / gpt-5.5 / LOW，180秒，cap=0.10；原 provider/凭据沿用，费用 UNKNOWN。
- 先 scan-inflight 确认4790无在途；浏览器核对完整参数与目录路径后逐卡批准，note 注明 Codex 受 Owner 委托，非 Owner Goal 验收。
- exit0/PASS，正文为五项 write/read/shell/mcp/recursion=BLOCKED；工作目录无 probe-write.txt。该五项是模型自报，不自动写五维 live_verified。MCP 项只检查可用性，未触真实 MCP；递归目标仅本地零网络/零模型哑 agent。
- runtime 目录资产：catalog-635a5ed1d15bc94f9fb3ea86e21002d717b80ba9030e09b7993c1b91ef7950d2.json。
- 批准后生效合同指纹：bd72f5986b3470438c392ab5489d0525451f6729ffc0ac73d7494083f5e38175。
- stdout sha256：1253f53d84243385b3bfb3b8e52070001cae74883ce2616f983e1f1c907ad9fe；回执 sha256：901c976e066eba8b9cd1132b7c2a3afb84b6ae36f0a2e291839fa7d1aa28fe73。C7.stdout.log/receipt.json/result.json 保留在产物目录，完整 stdout 与原回执哈希对账一致。

## 当前验证与剩余

新增配置/守卫/准备回归：6条（总测试834→840）；typecheck0；默认全量840/840、独立全量840/840，均exit0。完整日志 final/，stdout sha256：21b2df227f29249a192c00c920acb09fa583e28427f20d8a67a7ed78d7d2c113 / 83e09ba533a694b21f572d524f5b1195a1bab7617d5d0822eac01970977da253。契约v1.55；g0767/7、文档对账与diff检查见结果JSON。

剩余必须分别做：将原生行为、模型自报、文件副作用、MCP配置检查整理成可核查且覆盖精确的权限证据，再装配生产受控证据库；确认模型身份；验证 Antigravity 的命令/写入/MCP/递归与每席位材料范围，并解决其自动上下文来源。缺证据仍不准入。没有因 C7 PASS 宣称首场双模型会话完成，也未降低既有权限要求。

已完成一次真实新配置验证，不再将旧配置 C3 的 unmet 扩大为 Codex 所有配置都不可用。当前看板无待批或在途，活动工作区 D:\mush。未提交、未推送、未改用户凭据/账号配置。
