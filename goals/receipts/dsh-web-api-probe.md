# dsh web API 只读探测（GOAL-018 U6）

日期：2026-08-17
执行：deepseek-dsh（只读源码探测，不接管线）

## 结论

**可行，但不是“简单 HTTP REST 端点”**：dsh Web 对既有会话程序化发消息的能力存在，
入口是内部 Typert RPC 客户端 API（`Session.prompt(content, mode)`），不是从
`dsh-host-webserver` 路由表直接暴露的公开 REST 接口。mush 若要走这条路径，需要实现
或复用 dsh 的 client-connection / API gateway 协议客户端；当前 headless 侧更稳妥的
既有会话续跑入口仍是各 CLI 的 `--resume/-r`（本 Goal U2 已接 kimi/claude/zcode）。

## 证据（本机 bundle 源码）

- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`
  - 通用 HTTP/WS 路由注册与 fallback；只服务前端静态与已注册 route，未发现
    “向 session 发消息”的公开 REST 路由。
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-web-app/lib/index.js`
  - 仅装配前端静态、web 运行时 URL 与 surface prompt；不承载会话消息 API。
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-connection/lib/types/client/api.d.ts`
  - 导出 `IApiClient`、`SessionsApi`、`EventsApi`、`MuxFrame` 等；传输为
    RPC/stream（`api.events.mux` / `api.events.host`）。
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/sessions/session.d.ts`
  - **关键证据**：`Session.prompt(content: PromptContentPart[], mode: 'queue' | 'steer')`
    即向既有会话发送消息的程序化入口；另有 `create/fork/rename/cancel/command`。
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-gateway/lib/types/index.d.ts`
  - `TypertGatewayService.invoke(request)`：通用 Remote 方法调用网关，是 RPC 执行面。

## 对 mush 的意义

- 若后续要“向既有 dsh web 会话发消息”，应新开池项实现 dsh client RPC 协议
  （或等 dsh 暴露稳定的 HTTP API），本 Goal 不做管线接入。
- 当前 U2 的真续跑路径（kimi `-r`、claude `--resume`、zcode `--resume`）已覆盖
  headless 场景，与本次探测结论一致。
