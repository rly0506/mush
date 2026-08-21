# GOAL-037: 犬只直连会话控制台 (Dog Direct Console)

- 状态：`DONE`（2026-08-19 交付，基于 D37 / D38-L3；测试全绿）
- 来源：D37（GP-36 犬只直连窗口）、D38 信息披露架构·透镜三
- 优先级：中
- 依赖：GP-29 pi-rpc 通道已贯通

---

## 1. 目标与价值

当前 owner 与犬只的交互必须经由头犬中转（聊天 → 头犬编排 → 派发 → 执行犬），无法直接与特定犬只进行低延迟调试对话。D37 决议明确了"点击 harness 图标进入对应子级窗口"的交互需求。

本目标旨在构建 **看板犬只直连会话控制台**：
1. **犬只入口**：看板右侧犬队栏中，点击犬只头像/名称，滑出该犬的专属会话面板；
2. **会话视图**：展示该犬最近工作流时间线（关联派发记录、receipt 摘要），支持 transcript 历史回看；
3. **续话入口**：owner 可直接向该犬发起新会话或续接中断的会话（走 resume 派发通道，逐单审批卡不变）；
4. **多通道适配**：
   - **pi-rpc 通道犬**（pi、deepseek-dsh）：通过已验证的 pi-rpc runner 直连；
   - **CLI 通道犬**（claude-code、agy、kimi-code）：通过标准 T1 argument/stdin 传输；
   - **Typert RPC 候选**：dsh-web Typert 通道（G018-U6 已探明可行）作为备选管线。

### 预期收益
- 从"中转调度"到"直连对话"，大幅降低人机交互延迟
- 中断会话可重连，避免上下文丢失
- 为后续 C2 成员直连协作协议奠定前端基础

---

## 2. 核心架构设计

### 2.1 直连会话管理 (`src/orchestration/direct-session.ts` [NEW])
- `DirectSessionManager`：维护每只犬的活跃/历史会话状态
- `startDirectSession(adapterId, options)`: 创建直连会话（分配 session_id，绑定通道）
- `resumeSession(sessionId)`: 续接已有会话（注入 HANDOFF 上下文）
- `listSessionHistory(adapterId)`: 返回该犬的会话时间线

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/dogs/:adapter_id/sessions`：获取该犬会话列表
- `POST /api/dogs/:adapter_id/sessions`：创建新直连会话（触发审批卡）
- `POST /api/dogs/:adapter_id/sessions/:id/resume`：续接会话
- `GET /api/dogs/:adapter_id/transcript`：获取 transcript 历史

### 2.3 前端渲染 (`src/web/page.ts`)
- 犬队栏犬只卡片增加 `点击 → 滑出直连面板` 交互
- 直连面板布局：上方工作流时间线 + 下方对话输入框
- 消息流复用现有 SSE 打字机渲染能力（GOAL-029 已交付）
- 续话按钮（`🔄 续接上次会话`）在有中断会话时自动显示

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g037-dog-direct-console.test.ts`
- [ ] 验证直连会话创建、续接与历史查询
- [ ] 验证多通道适配（至少 pi-rpc + T1 CLI 两种通道）
- [ ] 验证前端面板滑出/收起与 SSE 消息流渲染
- [ ] 验证审批卡在直连会话中仍正常触发
- [ ] API 契约升级，`npm test` 保持 100% 全绿
