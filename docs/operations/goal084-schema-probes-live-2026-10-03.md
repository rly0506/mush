# GOAL-084：C6/A6 实弹格式探针与修复（2026-10-03，Codex）

C6、A6 格式探针均 PASS。Owner 本轮明确授权“修复+你可以自主操作浏览器审批”；Codex 依此逐卡批准，审批记录注明委托执行，不记 owner 对 Goal 的正式验收。Goal 仍 PROPOSED，五维隔离与真实七调用双模型会话尚未验证。

## 实际执行与边界

- 已按授权复位 2026-09-06 遗留的全局熔断；复位、逐单审批、模型执行各有独立记录。未以 originOwner 绕过 D30，未重用不同配置的旧批准。
- 每次真实尝试均先核查在途（4790）。固定模型：C6 gpt-5.5 / LOW；A6 gemini-3.7-flash-high / HIGH。180 秒、cap_usd=0.10 保持不变；金额是准入阈值，实际费用 UNKNOWN。
- 同一包仅走看板。准备、审批和实弹都没有更换 provider、凭据或用户级配置。活动工作区仍为 D:\mush；模型 cwd 为宿主 runtime 下独立合成目录。
- 初始看板受沙箱权限限制，已批准 C6 的预算账本锁 EPERM，尚未产生新运行记录；仅停止确认无在途的看板并以宿主权限重启，沿用原账本和配置，未绕过预算门。测试仍预加载 tests/setup.ts 隔离用户目录和账本。

## 实弹发现并修复的三项

| 失败派发 | 真实错误 | 修复 |
| --- | --- | --- |
| 174d9be432bc492880bfe24aa30fea69 / C6 | Invalid override (missing '='): low | effort 注入增加 config_key，生成 --config model_reasoning_effort=low；只匹配自己的键，保留其他 --config |
| 65627be68822416ab65a91a524f056d8 / A6 | --json-schema requires json or stream-json output | schema 激活时注入合同 output_schema_args=[--output-format,json]；不请求 schema 的普通输出不改变 |
| 4fcd72e7708544e19217c5563acbe592 / A6 | high 模型与 --effort low 冲突 | 固定 A6 档位为 HIGH，待批准包复用条件也核对档位 |

旧失败回执及旧卡保留。修复后的配置通过新审批卡执行，未自动无限重试。首次两张卡 70e4…/d816… 与修正卡 19f35…/d357… 均已被相应获批重跑取代。

## 成功证据

| 包 | 批准卡 / 实际执行 | 完整输出与判定 |
| --- | --- | --- |
| C6 | 19f35c0a0c404cb79efaaa6926423848 / 62906017698442c2a3bbf3c29337f135 | 裸 JSON，body=PROBE_SCHEMA_OK、stance=support；exit 0，PASS |
| A6 | eee088b52345411ea250b5faab71b71e / aab924a1435649eabc47a7fad41c2878 | 包装 JSON，显式 structured_output 满足同一 schema；派发记录和回执一致，exit 0，PASS |

产物目录：.test-fixtures/g084-live-2026-10-03/。schema-probe-results.json、C6/A6.stdout.log、C6/A6.receipt.json 保存完整证据。stdout 从持久化流事件重建，与原回执 stdout_sha256 逐字校验一致；不依赖 2048 字符 tail。

- C6 stdout sha256：12e653473667c42a39e284dadc5eb14b577f00a97fccf4bbc0ccbd6c65c5b00f；回执 sha256：0f6313975615f7567e42c17121425d0bca52b0453c808746fd545362d17d5c2e。
- A6 stdout sha256：8a36cde2a5aa6c527b618cf9ea2d5262210acadd751df6300c536e039f9cc458；回执 sha256：50212b294d5515f496d6f393fb7712071374c2b321fb4f254d963d0632580647。
- 原回执：runtime/collab-probes/<C6|A6>/workspace/.mush-receipts/dispatch-<实际执行ID>.json。Codex 当前没有 output_parser，structured_output 缺失符合 C6 判定；已实测裸 JSON 可供协调器完整 stdout 解析，不为此猜加解析器。
- Browser：实际内联卡核对模型/档位/限制/schema/哈希/合同指纹后逐卡点击批准；delegate note 落 append-only owner-response。browser-after-probes.png 为执行后视口，不作为隔离权限证明。

## 当前验证

最终源代码（含 A6 HIGH 修复）：npm.cmd test 与 test:isolated 均 828/828、exit 0；typecheck exit 0；g076 HTTP/DOM 冒烟 7/7；docs-reconcile PASS（47 映射/v1.53/D87）；git diff --check exit 0。完整日志在上述目录 final/，无 tail 截断。此前参数修复轮的 828/828 日志保留在上一级，不覆盖。

最终全量 stdout sha256：46b8dfcc71d2ee08915c2e8f13a96497bd9d5679ddfc0e513a6024ae402d4106；独立 stdout sha256：2c644da60556d51b9f7f02381efebc8e045e78ef7b177e21d55f0307e852bf6f。

## 剩余工作与实测限制

1. 五维仍未准入：write_protection / tool_scope / read_scope / mcp_scope / recursion。本轮仅验证格式与参数生效，不把任何一维登记成 live_verified。生产受控证据库装配及逐维登记尚待完成。
2. C6 stderr 可观察到 MCP 客户端初始化/关闭告警；未观察到 MCP 工具调用。它不能证明 MCP 禁用，后续需探针对照或等效执行配置。
3. A6 usage 报 input_tokens=30464、output_tokens=5186（含 thinking_tokens=5143）、total_tokens=35650。短 prompt 不代表低 token 成本；其额外 harness 上下文来源尚未归因，也不是材料 ACL 生效证据。实际费用仍 UNKNOWN。
4. 后续按既有权限探针计划先确认可观察、可隔离的具体配置再逐包执行；不为使 Goal 收口放宽准入，不启动真实七调用讨论。Owner 已委托浏览器审批，本次不再次索要 C6/A6 批准。

未提交、未推送。历史 Windows persistence/pi-rpc 失败没有因本轮全绿而被判已解决。
