# GOAL-085 成果审核材料（供第三方独立审核）

- 提交人：DeepSeek（受 Owner 委托执行）
- 日期：2026-10-05
- 范围：`D:\mush` 仓库内 GOAL-085「Claude Code 接入与双／三模型讨论」的已实施部分
- 用途：请独立审核方（GPT）核查事实、证据强度与遗留问题；**本文不是 Owner 正式验收**
- 审核须知：**所有结论都按"已证 / 未证 / 未知"三级标注**；请优先质疑标注为"已证"的条目，并核查"未证"是否被我在别处当成了"已证"

---

## 0. 一句话现状

受控 Claude 通道与双／三模型编排**已实现并通过全部机检与隔离验收**（两模式各 921/921）；真实 Chromium 浏览器验收通过；**codex 席位五维证据已按 owner 裁定复跑并重新登记为行为级**。但 **Claude 席位在隔离准入上仍五维未证**，因此计划中的两场真实讨论（Codex＋Claude、Codex＋agy＋Claude）**目前无法创建**（会被准入拒绝）。这是**证据门未满足**，不是执行失败。

---

## 1. 交付物清单（请按此核查文件是否存在、内容是否与描述一致）

### 1.1 新增源码

| 文件 | 作用 |
| --- | --- |
| `src/adapters/claude-discussion-profile.ts` | Claude 受控讨论档案：参数集冻结、空 MCP/空 settings 资产、版本规范化、绑定进指纹、漂移复核、只读版本探测、宿主登记文件 |
| `src/orchestration/collaboration-admission-policy.ts` | D89 准入政策文件加载与校验（缺口条目须带 gate/hooks/project 哈希+差异+归档+决策来源） |
| `tests/fixtures/claude-probe-assets/fake-claude.mjs` | 隔离假后端（本地假 CLI，零账户/零网络/零模型） |

> `src/orchestration/collaboration-blackboard.ts`、`collaboration-coordinator.ts`、`collaboration-skills.ts`、`collaboration-evidence-store.ts`、`src/web/collaboration-probes.ts` 显示为 `??`（untracked），因为 GOAL-084 起就在途未提交；本轮的改动叠加在其上。

### 1.2 新增测试

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/g085-claude-profile.test.ts` | 6 | 参数集与顺序、资产哈希入绑定、模型/版本/参数/资产四类漂移 fail-closed、非本地目录与异内容资产拒绝、契约校验、登记文件不含凭据 |
| `tests/g085-claude-native.test.ts` | 5 | 真实 spawn 假后端：受控 argv 实际下发、inline schema、结构化输出入记录与回执、工具请求可见但零执行痕迹、超时结算 |
| `tests/g085-api-sessions.test.ts` | 5 | 2/3 席位、服务端派生关系与额度、拒绝客户端注入、审批卡字段、准入拒绝回 409 |
| `tests/g085-e2e-session.test.ts` | 3 | 真实管线+fake runner：三模型恰好 13 次调用与六条互评、双模型恰好 7 次、快照冻结 |
| `tests/g085-triple-model.test.ts` | 18 | 席位与协调者、默认边界、关系冻结与注入拒绝、视图唯一性与三重拒绝、关系门、跨会话回应、材料三边界、13/14 额度账目、提示隔离、模板分版、迁移幂等与回滚 |

### 1.3 文档与回执

- `goals/GOAL-085-claude-and-triple-model-discussion.md`（含 §5 强制型探针设计与 §5.1/5.2 实测与费用）
- `goals/receipts/GOAL-085-receipt.json`（机检/验收回执，status=IN_PROGRESS）
- `src/web/api-contract.md` v1.59、`DECISIONS.md` D90、`docs/goal-pool.md` GOAL-085 行

---

## 2. 机检结果（请独立复跑核对）

| 命令 | 结果 | 日志（含 sha256） |
| --- | --- | --- |
| `npm.cmd run typecheck` | exit 0 | — |
| `npm.cmd test` | **921/921 exit 0** | `.test-fixtures/g085-deepseek-final/r5-full-default.log` `37e5c34a…` |
| `npm.cmd run test:isolated` | **921/921 exit 0** | `.test-fixtures/g085-deepseek-final/r5-full-isolated.log` `166f0182…` |
| `node scripts/docs-reconcile.cjs` | PASS（契约 v1.59、DECISIONS 至 D90、目标池 47 条映射） | — |
| `git diff --check` | exit 0 | — |

> 术语提醒：921 是**当前代码**的实测数，不是沿用历史 884 的宣称。

---

## 3. 隔离验证（零真实账户、零真实模型）

### 3.1 codex 席位行为复跑（owner 2026-10-04 裁定：复跑后重新登记）

- 脚本 `.test-fixtures/g085-codex-seat-behavior-2026-10-04/codex-behavior-rerun.mjs`：本地假 provider（127.0.0.1 随机端口）+ 独立 HOME + 删除全部凭据类环境变量。
- 产物 `codex-behavior/native-request-surface.json` sha256 `22107a50…`。
- 读数：`surface` 原生工具面**仅 `request_user_input`**；`force-apply_patch/exec_command/view_image/spawn_agent/get_goal` **五类强制调用全被 native 路由器拒绝**；`file_created=false`；生产口径指纹 `8194bb67…` **与 GOAL-084 登记时逐字一致（未漂移）**。
- 登记脚本 `.test-fixtures/g085-codex-seat-behavior-2026-10-04/register-codex-behavior.mjs`：新 source 前缀 `g085://codex-seat-behavior-2026-10-04/…`、**显式 `verification:'behavior'`**；未改写任何历史记录。
- 复核 `.test-fixtures/g085-codex-seat-behavior-2026-10-04/check-seat-admission.mjs`：**codex 五维全部 `live_verified`**、失败反例 0。

### 3.2 Claude 受控通道隔离验证

`tests/g085-claude-native.test.ts` 用**真实 spawn 的本地假 CLI**（零网络/零账户）验证：受控 argv 实际下发（含空 `--tools`、空 mcp-config、空 settings、`dontAsk`、不持久化，prompt 居尾，cwd 从绑定派生）、inline schema 运输、stream-json 解析、结构化输出进回执、工具请求可见但**零执行痕迹**、超时结算 TIMEOUT。

---

## 4. 浏览器验收（真实 Chromium + fixture 看板 + fake runner）

产物 `.test-fixtures/g085-browser-2026-10-04/browser-acceptance.json` sha256 `f6f9804b…`。读数：

| 项 | 结果 |
| --- | --- |
| 双席位会话 | `completed`，**恰好 7 次调用**，关系 `A→B,B→A`，结果**两列** |
| 三席位会话 | `completed`，**恰好 13 次调用**，`retry_count=0`，六条关系齐全，详情「参会者 3 位」，`data-seats="3"`、**3 个席位块**、1440px **三个等宽列** |
| 窄屏 390×844 | 同一网格**塌为单列**、无横向溢出 |
| 停止 | 在途点「停止整场讨论」→ 终态 `interrupted`（2 次后中止） |
| 常用审批卡 | 参会者与全部模型/强度、评审关系、`7+1`/`20min`/`180s`、证据状态、**8 条缺口条目**、四维维度名、批准按钮可见可用 |

**浏览器验收发现并修掉的真实 UI 缺陷**：`.collab-form-grid label { display:flex }` 覆盖 HTML `hidden` 属性，双模型模式下**第三席位控件实际仍可见**；修复后 `third_seat_hidden_by_default` / `after_dual` 由 False → **True**。此缺陷用 HTML 断言与源码检查都看不出来——**这正是"UI 改动必须浏览器实测"的例证**。

---

## 5. 已证 / 未证 / 未知（请重点核查本节）

### 5.1 已证（有可复现证据）

1. 双／三模型编排按规格工作：13 次 vs 7 次调用、六条两两互评关系、关系门、视图唯一性、迁移幂等与回滚（`g085-triple-model` 18/18 + `g085-e2e-session` 3/3）。
2. Claude 受控参数集**真的下发**到 `claude` CLI，且 inline schema 与结构化输出通路可用（C8 回执 + 假后端测试）。
3. codex 席位五维行为级证据**在当前指纹下**成立（隔离假后端复跑）。
4. 准入设计与实现一致：缺口未被政策接受 → 创建即拒（**409 + 原样原因**）；`codex+agy` 双席位在生产证据下创建成功（`ready=true`）。
5. UI：双／三模式切换、第三席位显隐、材料白名单按席位重建、两列/三列与窄屏、停止、常用卡逐项展示。

### 5.2 未证（明确没有证据，不得当作已证）

1. **Claude 五维隔离维度全部未证。** C9 五维自报 `BLOCKED`（**未发起请求**）；C11 变体自报 `read/shell=AVAILABLE`、`write/recursion=BLOCKED`，但**零落地副作用**（无 `probe-write.txt`、canary 未泄露、目录只多回执）。**回执字段无法区分"真做了/尝试被拒/只是描述能力"**，故 C11 也**不能**登记任何维度。
2. **运行时模型身份未证。** C8 只证明 schema 通路；讨论派发路径**不比对**运行时上报身份（合成实验：假后端宣称其它模型仍 PASS）。身份证明应走 nonce 探针，**本轮未做**。
3. 未演练边界保持不变：`invoke_subagent` 的 `Subagents` 非空、真实子模型、真实 MCP 服务器、真实文件写入。
4. 三席协调模板在**真实模型**下的输出质量未验证（仅 fixture 验证）。

### 5.3 未知

1. **费用**：账本记 `claude-code` 累计 **`0.447195`**（C8 `0.0376` + C9 `0.0212` + **C11 `0.3434`**）。**C11 单次实际支出 `0.343` 是卡上 `cap_usd=0.10` 的约 3.4 倍**——cap 不是账单硬上限，此为实证。**在澄清该差额前，我已停止发起新的 Claude 真实调用。**
2. token 计数为 0（stream-json 用量字段未解析，既有边界）。

---

## 6. 需要审核方重点挑战的三点

1. **探针归因缺陷**：C11 的 schema 只有五维枚举，未要求模型回附**可核验载体**（读到的内容哈希、被拒错误原文、副作用探针文件）。请判断：这版结果是否**确实**不能登记？我按"不能"处理（D90(5)：自报不登记）。若要可登记，探针需带载体——**我已设计但未实现/未执行**。
2. **C10 未执行的处理是否正确**：同一 `prompt+schema+指纹` 已被 C9 响应，`prepareSchemaProbe` 判 `reused=true`（防重复派发），故 C10 没有新执行。我**没有**擅自改提示来绕过，而是留待 owner 处置。请判断该处置是否恰当。
3. **准入拒绝的 HTTP 语义**：我把 `BlackboardAccessError`（隔离证据不足/缺口未被政策接受/失败反例）从 **500 改为 409 + 原样原因**，理由是"设计内 fail-closed 不应冒充服务端故障"。请判断是否恰当（是否应保留 500、或改用 403/422）。

---

## 7. 已知的流程与卫生问题（我主动列出）

1. **生产黑板库曾被迁移**（GOAL-084 收尾期间，触发者未确证）：`viewpoints` 改四元唯一键、`user_version=1`，留有备份 `blackboard.sqlite.backup-20261004T145505096Z`。独立只读核对：8 会话/7 观点/8 授权与备份**逐行逐字一致**、FK 0 违规，故未回滚。迁移纪律（先 fixture 后空闲迁移）**被绕过**，已记录。
2. **批准必须与"准备"同进程**：我两次批准了上一个看板进程准备的卡，被按 `SUPERSEDED` 处理（**未执行、未占额**）。已记录并改用同进程流程。
3. **我上一轮误报"目标池被删"**：实为我用 `-like '| GOAL-*'` 过滤漏掉历史行格式（`| **GP-xx / GOAL-yyy**`），文件完好（135 行、48 条引用、reconcile 47 条映射）。已在 Goal 记录纠正。
4. **改动未提交、未推送**：64 modified / 136 untracked（含 GOAL-084 在途改动）。按要求不自动提交。

---

## 8. 请审核方回答的问题

1. §5.1 的"已证"条目是否有任何一条**证据不足**？特别是：浏览器验收用 fixture 看板 + fake runner，能否支撑"UI 已验收"？若不能，缺什么？
2. §5.2 的"未证"是否有被我**隐式当成已证**的地方？（请重点查 Goal 文档的结论句与 `docs/goal-pool.md` 的状态描述）
3. 探针归因缺陷的修法：要求模型回附**读到的内容哈希**是否足够？还是必须外部可观测（副作用文件 / CLI 侧工具通告清单）？
4. 费用 cap 与账面不符：应如何口径化（停机阈值？事后告警？强制上限？）——这是 owner 的决定，但请给出审核意见。
5. Claude 席位准入的三条路径（改探针再跑 / 写进 D89 政策 / 两场改用 codex+agy），哪条最符合既有证据纪律？

---

## 9. 复跑入口（审核方自查用）

```powershell
cd D:\mush
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:isolated
node scripts/docs-reconcile.cjs
# 聚焦用例
node --import ./tests/setup.ts --test --test-isolation=none tests/g085-claude-profile.test.ts
node --import ./tests/setup.ts --test --test-isolation=none tests/g085-claude-native.test.ts
node --import ./tests/setup.ts --test --test-isolation=none tests/g085-api-sessions.test.ts
node --import ./tests/setup.ts --test --test-isolation=none tests/g085-e2e-session.test.ts
node --import ./tests/setup.ts --test --test-isolation=none tests/g085-triple-model.test.ts
# 席位准入读数（只读）
node --import ./tests/setup.ts .test-fixtures/g085-codex-seat-behavior-2026-10-04/check-seat-admission.mjs
# 浏览器验收（真实 Chromium + fixture，零真实模型）
node --import ./tests/setup.ts .test-fixtures/g085-browser-2026-10-04/run-browser-acceptance.mjs
```
