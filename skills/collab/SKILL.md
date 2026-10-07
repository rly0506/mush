---
name: mush-collab
description: 用 mush 受控双模型讨论（Codex／Claude Code／agy 席位）发起议题、等待 owner 看板批准、读取结果与停止。适用于需要两个模型互评并保留可核查记录的场景；权限与执行完全由 mush 看板控制。
---

# mush 受控双模型讨论（薄入口指引）

本 skill 只是指引：**权限与执行完全由 mush 看板控制**。所有命令都是 `node bin/mush`（仓库本地入口，**不全局安装**）的薄客户端，底层复用看板的审批、编排、停止与账本。示例均为单行命令，PowerShell 与 Bash 均可直接执行。

## 前置条件

1. mush 看板已运行：仓库根目录 `powershell -NoProfile -File scripts/board-up.ps1`（幂等）；或 `node bin/mush board --port 4790`。默认 `http://127.0.0.1:4790`，`--board-url` 可覆盖（**只允许本机回环地址**）。
2. 讨论档案已激活：看板重启后需要 `POST /api/collaboration/profiles/activate` 与 `/activate-claude`（零派发零成本），否则创建会因合同指纹不匹配被拒——如实报告，不要绕过。

## 流程（按顺序，不要跳步）

### 1. 检查组合准入（只读，零模型调用）

```bash
node bin/mush collab check --adapter-a codex --model-a gpt-5.5 --effort-a LOW --adapter-b agy --model-b gemini-3.7-flash-high --effort-b HIGH
```

- `ready:true` = 当前准入满足（仍需会话批准）；`ready:false` = 阻断事实，**把 `reason` 原样报告给用户**，不要重试绕过。
- `real_reproduction.status` 区分"有已核实记录"与"未实测"；`account_quota` 字段表示账号额度（当前恒为 UNKNOWN——额度未知不等于没有权益）。
- **模型与强度遵从用户**：用户指定什么就提交什么（`--effort-a/--effort-b` 可省略，省略时用服务端冻结默认）；不存在的组合会被准入拒绝（fail-closed 设计），原样报告即可。

### 2. 提交议题与材料（只创建待批准会话）

```bash
node bin/mush collab create --topic "<议题>" --adapter-a codex --model-a gpt-5.5 --effort-a LOW --adapter-b agy --model-b gemini-3.7-flash-high --effort-b HIGH --material "材料名=本地文件路径" --constraints "<公共约束>"
```

- 输出含 `approval:"PENDING_OWNER_APPROVAL"`、审批卡路径 `request_file` 与会话号 `session_id`。**这一步没有开始任何讨论（批准前零模型调用）**。
- **把审批卡路径和会话号交还给用户**，等待 owner 在看板审批卡上批准——批准只能由 owner 完成，CLI/MCP/skill 都没有批准入口。除非用户明确要求跟进，不要自行等待。
- 也可用 `--request <json文件>` 提交结构化请求（含 `workspace_root` 与材料的 `allowed_seats` 席位权限）。

### 3. 查询批准与执行状态（设上限的轮询）

```bash
node bin/mush collab status --session <session_id>
```

- 状态机：`pending_approval → authorized → in_progress → completed/failed/cancelled/interrupted`；执行状态（`execution`）与授权状态分开显示。
- **审批以 `owner_decision` 字段为准**（`APPROVED`/`REJECTED`/null）——authorized 是短暂中间态，不必等待采样到它。
- 轮询必须设上限（例如不超过 10 次、间隔不低于 30 秒，或用户给定的时间上限）：达到上限即如实报告当前 `status` 与 `owner_decision` 并交还用户，不要无限等待。

### 4. 读取结果

```bash
node bin/mush collab result --session <session_id> --format markdown --out 结果文件.md
```

- `--format json|markdown`；`--out` 原子排他创建（**已存在文件拒绝覆盖**）。
- 如实转述：结果按席位逐个呈现观点原文，**mush 不合成"共同结论"**；互评中的缺陷/建议是模型观点、未经核实。
- **费用按实际结果报告三态**：`DECLARED`（全部派发有申报，`total_declared_usd` 为申报合计）、`PARTIAL`（部分申报——合计只是已知申报小计，整场费用不完整）、`UNKNOWN`（无任何申报记录，**不是 0**）。三者都是**台账/回执申报口径**，既不是账号额度、也不是真实账单硬上限；账号额度以 `collab check` 的 `account_quota` 为准（当前恒 UNKNOWN）。

### 5. 停止（可选）

```bash
node bin/mush collab stop --session <session_id>
```

- 只发停止请求；终态以 `collab status` 为准，不提前显示为已停止。终态会话再 stop 会 exit 2。

## 退出码

`0` 成功（含 check 的 `ready:false`——那是查询结果不是错误）；`2` 看板业务拒绝（409：准入/版本/状态机，原因已原样给出）；`3` 看板不可达；`64` 用法错误；`1` 其它失败。**失败时把原始 error 报告给用户，不要猜测原因或重试绕过。**

## MCP 备选（跨 harness 调用面）

```bash
node bin/mush mcp --board-url http://127.0.0.1:4790
```

stdio JSON-RPC（MCP 2024-11-05）：`collab_check/collab_create/collab_status/collab_result/collab_stop` 五工具，语义与 CLI 相同；board URL 在启动参数固定，工具入参不暴露；工具面不含文件系统（材料只收 `content` 正文，结果只返回文本）。**无 approve/reject 工具。**

## 红线（不可违反）

- **批准只能由 owner 在看板完成**——不要寻找或尝试自动批准入口；`pending_approval` 就是等待态，把审批卡与会话号交还用户。
- **不在失败后自动换道**：席位派发失败/超时/版本漂移拒绝时，如实报告失败与原因，等用户决定；**不修改已批准配置**（批准后改强度/模型会被拒绝）。初始的模型与强度选择遵从用户输入。
- 准入拒绝（409）是 fail-closed 的设计行为，不绕过。
- 讨论结果验证的是真实协作链路与所提供材料，**不构成对任何 Goal 的全量源码审计或正式验收**。
