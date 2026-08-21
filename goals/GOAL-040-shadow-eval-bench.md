# GOAL-040: 跨 Harness 影子分流评测台 (Shadow Split Evaluation Bench)

- 状态：`DONE`（2026-08-19 交付，基于 GP-01 / D1 设想；测试全绿）
- 来源：GP-01（D1 设想）
- 优先级：低
- 依赖：GP-35/GP-37（四级信度确保犬只可调度）、GOAL-035（Diff 视图用于结果比对）

---

## 1. 目标与价值

mush 管理着 6+ 犬只、20+ 模型变体，但缺少系统化的横向评测能力——无法回答"对于同一任务，Claude vs Gemini vs DeepSeek 谁输出更好"这一核心问题。

本目标构建 **跨 Harness 影子分流评测台**：
1. **影子分流**：将同一 prompt 同时派发给 2~3 只不同犬只（在独立 worktree 中并行执行，互不干扰）；
2. **结果采集**：自动收集每只犬的执行结果（stdout、stderr、exit code、git diff、token 消耗、耗时）；
3. **比对报告**：生成结构化评测报告——
   - 代码 diff 交叉比对（两犬改了哪些相同/不同的文件）
   - Token 效率对比（输出质量 / token 消耗比）
   - 耗时对比
   - 测试通过率（若涉及代码修改，可自动跑测试）
4. **评测历史**：评测报告持久化至 `runtime/evaluations/`，支持回看趋势。

### 预期收益
- 为犬只选型提供数据驱动的决策依据
- 发现不同模型在不同任务类型上的真实差异
- 为 GOAL-039 智能路由提供训练数据

### 安全边界
- 影子分流使用独立 worktree（`git worktree add`），主工作区零污染
- 每只犬的 carve-out 独立校验，互不干扰
- 评测派发仍走逐单审批卡（每只犬各一张，可批量放行）

---

## 2. 核心架构设计

### 2.1 分流调度器 (`src/orchestration/shadow-split.ts` [NEW])
- `createShadowEvaluation(options)`:
  - 接收 prompt + 候选犬只列表（2~3 只）
  - 为每只犬创建独立 worktree（`git worktree add runtime/worktrees/eval-<id>-<dog>`）
  - 并行派发（复用现有 dispatch 管线）
  - 收集结果至统一评测记录
- `generateEvalReport(evalId): EvalReport`:
  - 交叉比对各犬输出
  - 计算效率指标

### 2.2 评测数据模型
```typescript
interface ShadowEvaluation {
  eval_id: string;
  prompt: string;
  prompt_sha256: string;
  candidates: EvalCandidate[];
  created_at_utc: string;
  report?: EvalReport;
}
interface EvalCandidate {
  adapter_id: string;
  model_id: string;
  dispatch_id: string;
  worktree_path: string;
  result: 'PASS' | 'FAIL' | 'TIMEOUT';
  duration_ms: number;
  tokens: { input: number; output: number };
  cost_usd: number;
  diff_summary?: { files_changed: number; insertions: number; deletions: number };
}
```

### 2.3 服务端与前端
- `POST /api/evaluations`：创建影子评测
- `GET /api/evaluations/:id`：获取评测报告
- 看板增加「🧪 评测」Tab，展示评测历史与比对结果

### 附录：GP-28 Linux dsh 凭据容器化
> GP-28 属副线平台特定探索（Linux 环境下 dsh 凭据最小化容器挂载），可作为本评测台的扩展场景——在容器化环境中执行影子分流。当前 Windows 原生已满足日常，暂不单独立项。

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g040-shadow-eval-bench.test.ts`
- [ ] 验证独立 worktree 创建与清理
- [ ] 验证并行派发与结果收集
- [ ] 验证评测报告的交叉比对逻辑
- [ ] 验证前端评测 Tab 渲染
- [ ] 安全校验：worktree 隔离、carve-out 独立、审批卡正常
- [ ] API 契约升级，`npm test` 保持 100% 全绿
