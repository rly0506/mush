# GOAL-030: 看板调用者身份鉴别与安全握手保护 (Caller Token & Origin Handshake)

- 状态：`DONE`（2026-08-19 交付，基于 GP-40 / GP-32②；全量 424 tests 全绿）
- 依据：`D30`（安全审查线）、`CONSTITUTION.md`（红线防御）与契约 `v1.15`。

---

## 1. 目标与安全价值

目前看板（`127.0.0.1:4790`）的 API 已具备 `Host` 校验（防御 DNS Rebinding）。但处于 Loopback 信任模式下，本机任意未授权第三方进程可能尝试盲调 `POST /api/dispatch` 或 `POST /api/approvals/respond`。

本目标旨在建立：
1. **会话级加密 Caller Token 握手机制**；
2. **状态变更 API（POST/PATCH/DELETE）强制调用者身份鉴别**；
3. **前端看板透明化自动握手与注入**（零用户心智负担，零外部依赖）。

---

## 2. 核心架构与实现设计

### 1. 服务端 Token 机制 ([`src/web/server.ts`](file:///D:/mush/src/web/server.ts))
- 启动时自动生成会话唯一的 256-bit 随机 `callerToken`；
- 提供 `GET /api/session/token` 握手接口（受 Strict Loopback 保护）；
- 拦截所有状态变更 API（`POST /api/dispatch`, `POST /api/chat`, `POST /api/approvals/respond`, `POST /api/workspaces/*`, `POST /api/tasks/*` 等）：
  - 必须提供有效 Header `X-Mush-Caller-Token: <token>`，或 query 参数 `caller_token`；
  - 缺失或错误时直接拦截返回 `401 Unauthorized` / `403 Forbidden` (`{"ok": false, "error": "Invalid or missing caller token"}`)；
  - 程序化内部测试/CLI 调用支持免显式传参（通过内部上下文标记）。

### 2. 前端透明鉴权 ([`src/web/page.ts`](file:///D:/mush/src/web/page.ts))
- 页面加载时在 `<meta name="mush-caller-token" content="...">` 中内联当前会话 Token；
- `postJson()` / `patchJson()` 封装函数自动附加 `X-Mush-Caller-Token` 请求头。

---

## 3. 验收规格

- [ ] 新建自动化测试 [`tests/g030-caller-auth-token.test.ts`](file:///D:/mush/tests/g030-caller-auth-token.test.ts)；
- [ ] 验证未携带 / 伪造 Caller Token 的状态变更 API 严格被拒（401/403）；
- [ ] 验证携带合法 Token 的所有看板与聊天操作畅通；
- [ ] 契约升级至 **`v1.15`** ([`src/web/api-contract.md`](file:///D:/mush/src/web/api-contract.md))；
- [ ] 全量 `npm test` 保持 100% 绿灯。
