# GOAL-063: 核心安全闸门闭环与零信任鉴权加固 (Zero-Trust Auth & Sandbox Hardening)

- 状态：`DONE`
- 来源：商业化安全审计 (P0) / owner 决策 D79
- 优先级：高
- 依赖：GOAL-062

---

## 1. 目标与价值

彻底修补当前看板与 API 层暴露的严重安全漏洞，将系统由“内部弱口令”提升为“生产级零信任沙箱”：
1. **强制 Caller-Token 鉴权**：看板启动强制生成并校验 Token，拒绝任何未授权的写请求（POST/PUT/PATCH/DELETE）；
2. **废除匿名 Token 领取**：删除 `GET /api/session/token` 的无门槛下发；
3. **CSRF / Origin 防御**：严格校验 `Origin` / `Sec-Fetch-Site` 与 `Content-Type`；
4. **路径沙箱白名单化**：`POST /api/chat/mention-file` 与 `POST /api/context/assemble` 严格限定在已登记工作区内，彻底杜绝读取系统私钥与敏感配置文件；
5. **Session ID 强格式校验**：在 `chat.ts` 与 `server.ts` 中全面拦截反斜杠路径穿越；
6. **XSS 净化与 SVG 沙箱**：在 ELO 战绩等客户端脚本中补齐 `esc()` 转义，为 SVG 附件增加 CSP 沙箱响应头。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/cli.ts` [MODIFY] — 启动 board 默认传入随机 `callerToken` 并开启 `enforceCallerToken: true`
- `src/web/server.ts` [MODIFY] — 移除/保护 `/api/session/token`，增加 Origin/Sec-Fetch-Site 校验与严格路径白名单
- `src/web/chat.ts` [MODIFY] — 对 `sessionId` / `resume` 进行 `^[A-Za-z0-9_-]{1,64}$` 正则强校验
- `src/web/ui/client-scripts.ts` [MODIFY] — 为 ELO 榜单等 innerHTML 插入点增加 `esc()` 净化
- `src/web/attachments.ts` [MODIFY] — 限制附件类型，SVG 附件输出时增加 CSP sandbox 与 download 响应头

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g063-security-hardening.test.ts`
- [ ] 验证未携带 Token 的写操作 100% 返回 401 Unauthorized
- [ ] 验证跨域/非同源请求被 CSRF 校验拦截
- [ ] 验证跨目录越权读取（如读取 `.ssh/id_rsa` 或绝对路径）被严格拒绝 403/400
- [ ] 验证包含 `<script>` 的 ELO 榜单数据被安全转义为 HTML 实体
- [ ] 全量 534+ 测试套件保持 100% 绿灯
