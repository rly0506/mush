# harness 集成通道全景预探测 · 2026-08-16

性质：M3 适配器选型的预探测（informal，零成本，全部为本机 `--help` 抓取）。
D5 犬队名单：DeepSeek（经 pi/dsh）+ Claude Code 首发；codex/opencode/zcode 陆续接入。

## 三档集成通道（由浅入深）

| 档 | 形态 | 适配器实现成本 |
| --- | --- | --- |
| T1 单发 headless | 给一句、跑完、退出；配文件落盘回报 | 最低，所有犬通用底座 |
| T2 流式 JSON（stdio） | 结构化事件流，边跑边消费 | 中 |
| T3 协议服务器 | 常驻双向协议：自定义 app-server / MCP / ACP / RPC | 高，精细控制 |

## 各 harness 实测（本机 `--help` 证据）

| harness | T1 单发 | T2/T3 协议 | 备注 |
| --- | --- | --- | --- |
| zcode | `--prompt` / `-p`、`--cwd`、`--max-turns`、`--mode yolo` | T3 自定义 `app-server`（信封 `{id,method,params}`，方法清单 UNKNOWN，见 zcode-2026-08-16.md） | `--resume` 会话续命 |
| claude | `-p/--print` 非交互 | T2 `--output-format stream-json`（配 `--print`）；`--agents <json>` 自定义子 agent | `--resume/--continue` |
| codex | `exec`（非交互） | T3 `app-server`（experimental，与 zcode 同名同概念）、`mcp-server`（stdio，把 codex 变成 MCP 服务器）、`exec-server`、`remote-control`（均 experimental） | `resume`；协议细节 UNPROBED |
| opencode | run（headless） | T3 最开放：`serve`（headless HTTP 服务）、`acp`（Agent Client Protocol，开放标准）、`attach`、`export/import` session JSON | 可远程 |
| dsh | `--profile headless "task"`（答完即退，GOAL-001 实证） | —（wrapper 层，协议由下层 pi 提供） | `--dump-config` |
| pi | `--print` / `-p` 非交互 | T3 `--mode rpc`（**黄金参照 bridge-pi-rpc 管理的就是它**：wire codec + 完成状态机 + 会话——M1 已移植为验收规格） | `pi auth` 凭据管理；deepseek 犬的通道 |

## 未装/未测（UNKNOWN 诚实记录）

- gemini、qwen 等本机未装，未探测；
- codex `app-server`/`mcp-server` 与 claude stream-json 的具体协议细节未实测（M3 时按 D13 nonce 惯例补）。

## 对 M3 的结论

1. **T1 + 文件落盘回报**是所有犬的通用底座（deepseek 犬 GOAL-001 已实证）；
2. **T3 已有现成不同协议**：pi-rpc（黄金参照已 Institutionalize，M1/M2 正在移植）、
   zcode/codex app-server、opencode ACP/HTTP——mush 适配器合同（executable+参数+协议，
   D5）天然容纳，按犬选档；
3. MCP 标准值得观察：codex 能把自身暴露为 MCP 服务器，未来或可做一条
   "MCP 通用适配器"（M3 后另议，勿提前产品化——D1）。
