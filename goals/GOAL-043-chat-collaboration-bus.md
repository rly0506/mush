# GOAL-043: 聊天底栏协作模式快捷开关与调度总线 (Chat Collaboration Bus)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；协作总线在库（src/orchestration/collaboration-bus.ts），专测 tests/g043-*.test.ts 通过；目标池 RM-005 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + RM-005 路线图
- 优先级：最高（首发 M1 先置）
- 依赖：GOAL-028 (多组织拓扑), GOAL-039 (智能路由画像), GOAL-042 (协作总线基础)

---

## 1. 目标与价值

在日常对话与任务下发中，人类面临不同认知复杂度的需求：有的只需普通单犬快答，有的需要双犬深度辩论，有的需要严格流水线交付。

本目标旨在将复杂的社会化协作机制转化为**极简的“按需开启（Optional on Demand）”产品体验**：
1. **聊天底栏快捷胶囊（Mode Capsules）**：在聊天输入框下方常设协作模式切换器：`[ 💬 自由对话 ]`、`[ ⚔️ 圆桌辩论 ]`、`[ ⛓️ SOP 流水 ]`、`[ 🛡️ 红蓝对抗 ]`；
2. **智能对席推荐与快速微调**：点击辩论/协作模式时，结合 GOAL-039 智能画像自动推荐最佳异构犬阵容（如架构辩论默认推荐 Claude vs DeepSeek），底栏展示参战犬只头像并支持一键微调；
3. **协作调度总线（Collaboration Bus）**：将模式参数、对席犬对与议题格式化注入后端协作调度接口，实现无缝拉起协作流程。

---

## 2. 核心架构设计

### 2.1 协作协议与调度核心 (`src/orchestration/collaboration-bus.ts` [NEW])
- `CollaborationMode = 'free' | 'debate' | 'pipeline' | 'verify' | 'bounty'`
- `recommendCollaborationPair(taskPrompt: string, mode: CollaborationMode): { primaryDog: string; opposingDog: string; reason: string }`
- `buildCollaborationPacket(params: CollaborationRequest): CollaborationPacket`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/collaboration/recommend-pair`：根据议题自动推荐最佳协同犬对
- `POST /api/collaboration/dispatch`：统一接收协作派发请求（Caller Token 鉴权保护）

### 2.3 前端组件与交互 (`src/web/ui/chat-bar.ts`)
- 聊天输入框下方常驻模式选择胶囊与参战犬头像 Badge
- 切换模式时实时高亮并联动主视窗排版

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g043-chat-collaboration-bus.test.ts`
- [ ] 验证 4 种协作模式胶囊状态机与参数装配
- [ ] 验证基于议题特征的最佳对立犬组合自动推荐算法
- [ ] 验证 `POST /api/collaboration/dispatch` 状态变更鉴权与参数校验
- [ ] 验证前端底栏 HTML 渲染正确且零违禁词/零外部 CDN
- [ ] API 契约升级，全量测试保持 100% 全绿
