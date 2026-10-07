# GOAL-044: 圆桌辩论对席排版与自动仲裁工作台 (Debate Arena Studio)

- 状态：`AUTO_ACCEPTED`（2026-09-06 审计追账：此前状态行未随交付更新；圆桌辩论对席在库（debate-engine.ts + debate-view），专测 tests/g044-*.test.ts 通过；目标池 RM-005 表已记完成；按 D15 升 AUTO_ACCEPTED，DONE 与否决权归 owner）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + RM-005 路线图
- 优先级：最高（首发 M1 核心）
- 依赖：GOAL-043 (协作底栏与总线), GOAL-036 (Trace 步骤流), GOAL-042 (P2P 消息总线)

---

## 1. 目标与价值

单模型在面对复杂架构设计与高风险决策时容易陷入认知盲区与自我循环论证。

本目标旨在构建 **自适应圆桌辩论对席排版与自动仲裁工作台**：
1. **就地双栏自适应排版（Layout Morphing）**：点击辩论后，单屏主视窗瞬间横向平滑展开为左右对立对席视窗（左栏 Pro 立论 vs 右栏 Con 驳论）；
2. **结构化固定三阶段辩论流**：
   - Phase 1（独立立论）：双方针对议题独立给出第一代设计方案；
   - Phase 2（交叉质询）：互换方案，专找对方漏洞、死角与极端隐患；
   - Phase 3（反驳修正）：针对对方质询进行补充防御与方案修正；
3. **分歧提纯与一键仲裁卡**：自动提取提纯双方「共识清单（Consensus）」与「核心争议点（Disputes）」，生成仲裁卡，人类一键拍板选定最终决议；
4. **全屏复盘视图**：顶部导航提供「辩论大厅」工作台，支持历史辩论轮次追溯；
5. **前端代码 Ponytail 伴随瘦身**：伴随本 Goal 将 `src/web/page.ts`（3332行巨石）拆分为模块化架构。

---

## 2. 核心架构设计

### 2.1 辩论状态机引擎 (`src/orchestration/debate-engine.ts` [NEW])
- `DebateSession`: 维护 `debate_id`, `topic`, `pro_dog`, `con_dog`, `rounds`, `consensus`, `disputes`, `final_decision`
- `executeDebateRound(sessionId: string, phase: 'PROPOSE' | 'CROSS_EXAMINE' | 'REBUT'): Promise<DebateRoundResult>`
- `distillDebateConsensus(sessionId: string): { consensus: string[]; disputes: string[] }`
- 持久化至 `runtime/debates/<debate_id>.json`

### 2.2 服务端接口 (`src/web/server.ts`)
- `POST /api/debates`：创建并启动辩论对决（Caller Token 鉴权）
- `GET /api/debates` & `GET /api/debates/:id`：查询辩论列表与详情
- `POST /api/debates/:id/arbitrate`：提交人类仲裁决议并闭环归档

### 2.3 前端自适应排版与组件拆分 (`src/web/ui/`)
- `styles.ts`：CSS 主题与双栏对席排版样式
- `icons.ts`：内联 SVG 资产与辩论徽章
- `client-scripts.ts`：辩论流式渲染与动态变形动画脚本
- `views/debate-view.ts`：双栏对立视窗与仲裁收敛卡组件

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g044-debate-arena-studio.test.ts`
- [ ] 验证 3 阶段辩论流状态机推进与轮次流转
- [ ] 验证共识提纯与争议点提取算法的准确性
- [ ] 验证人类仲裁结果归档与事件链哈希记录
- [ ] 验证双栏对席 HTML/CSS 渲染正确，无外部 CDN 泄露
- [ ] 验证 `page.ts` 拆分后原 459 题测试 100% 保持全绿，API 契约升级
