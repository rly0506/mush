# GOAL-075: 头犬对话体验升级——分通道思维链采集与派发计划门 (Head-Dog CoT & Dispatch Plan Gate)

- 状态：`IN_PROGRESS`（owner 2026-08-24 批准开工；首个切片 = opencode `--thinking` CoT 采集实证）
- 来源：owner 实战反馈（RM-011 演练期间三轮）：①"和头犬对话看不到思维链"；②"不知道也无法控制头犬何时派子级、派几个、用哪个 harness"；③总体诉求对齐 claude code / codex 级成熟 agent 对话体验
- 优先级：高
- 依赖：无硬依赖（建议在 RM-011 M1 演练收官后动工，避免演练基线漂移）

---

## 1. 目标与价值

当前头犬对话是"黑盒单帧"：owner 只能看到最终回复（或超时失败），看不到推理过程，也拦不进头犬的派发决策。本 Goal 把对话体验从"等结果"升级为"看过程、能干预"：

1. **思维链分级可见**：按通道能力透传推理增量（claude-code stream-json 有 thinking 块可采；**2026-08-24 更新：opencode `run --help` 实证存在 `--thinking`（show thinking blocks）与 `--format json`（原始 JSON 事件流）——opencode 并非"无 CoT 输出"，此前判断有误；施工时以 `--thinking` 实测输出形态为准，dsh/kimi 待查**）；
2. **派发计划门（Plan Gate）**：头犬执行多步任务前先输出结构化派发计划（子级数量 × 各自 harness/模型 × 任务摘要 × 预算），owner 批准后才落派发——把 D30 的"每单审批"前置为"每计划审批"，保留单发 Tasklet 直通；
3. **会话流 UI 对齐成熟 agent 产品**：思考态/工具活动/回复三段式气泡 + 计划卡确认件。

价值：owner 从"盲等 + 事后审"变为"过程可视 + 决策前置"，这是无人值守（RM-011 M3）之前必要的人机信任基建。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/adapters/claude.ts` [MODIFY] — stream-json 路径解析 thinking 增量块，经新 `onThinking` 回调外泄
- `src/adapters/t1-runner.ts` [MODIFY] — `T1RunOptions.onThinking` 增量钩子（与 onStdout/onStderr 同构）
- `src/web/chat.ts` [MODIFY] — 头犬 charter 增加计划协议段；EXECUTE 帧新增 `thinking` 类型；REPORT 前置 PLAN_WAIT 门状态机
- `src/web/dispatch.ts` [MODIFY] — `DispatchLifecycleEvent` 增量 payload 增加 `progress: 'thinking'`；计划门挂起点
- `src/web/page.ts` [MODIFY] — 聊天气泡三段式（思考折叠区/工具活动区/正文）；计划卡组件（批准/修改后批准/否决）
- `src/web/api-contract.md` [MODIFY] — chat 帧契约 v1.13：thinking 帧、plan 卡帧、plan 决断端点

### 2.2 关键接口与数据契约
- SSE chat 帧新增：`{ phase: 'EXECUTE', kind_hint: 'thinking', stream_text }` 与 `{ phase: 'PLAN_WAIT', plan: { steps: [{dog, model, task_summary, cap_usd}], total_cap_usd, plan_id } }`
- `POST /api/chat/plan/:plan_id/decide`：`{ decision: 'approve' | 'reject' | 'amend', amended_plan? }`；approve 后头犬继续执行，reject/amend 回给头犬重排
- 通道能力位：合同增加 `cot_support: 'stream-json' | 'none'`，前端据此决定渲染折叠思维链还是"该通道不支持思维链"角标（诚实原则，不做假思考）

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g075-cot-and-plan-gate.test.ts`：claude stream-json thinking 解析、计划门 approve/reject/amend 三路状态机、T1 通道诚实降级标注
- [ ] 端到端：claude-code 头犬多步任务 → 计划卡弹出 → amend 一处 → 批准 → 子级按修正后计划派发，全程聊天流可见思考与工具活动
- [ ] opencode 免费档作头犬时显示"该通道不支持思维链"角标而非空白等待（f62c928f 教训：300s 黑盒等待已由本批次超时修复先行缓解）
- [ ] 严格遵守宪法红线：零凭据泄露、零外部 CDN、D30 审批语义不被绕过（计划门是前置增强不是替代）

---

## 附：与本批已完成修复的边界

本 Goal 不覆盖以下已在本批落地项：spawn 双根因修复（ENOENT/stdin 恒开）、任务池重执行与 CANCELLED 复活、直连抽屉实时终端（stdout+stderr 双通道）、聊天超时可配（300→900s）、快照防叠套。上述为本 Goal 的地基。
