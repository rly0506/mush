# GOAL-048: 跨 Harness 技能双向转译与统一热挂载引擎 (Cross-Harness Skills Federation)

- 状态：`PROPOSED`（RM-006 M1 核心规划，2026-08-19 立项）
- 来源：2026-08-19 owner `/grill-me` 深度访谈裁决 + RM-006 路线图
- 优先级：高（RM-006 M1）
- 依赖：D12 (技能治理), GOAL-043 (协作总线)

---

## 1. 目标与价值

当前各模型生态的技能格式割裂（Claude Code Skills、Codex Markdown Skills、Antigravity Builtin Skills、dsh-tui Skills 各有各的格式与存放路径），导致用户在某处编写的技能无法在其他 Harness 中直接复用。

本目标旨在构建 **跨 Harness 技能联邦与双向转译引擎**：
1. **统一技能 AST 模型（Unified Skill Schema）**：抽象技能名称、描述、参数契约、执行指令与前置条件；
2. **双向格式自动转译器**：支持 YAML Frontmatter、Markdown Commands、JSON Hooks 在 Claude/Codex/AGY/dsh 之间的无缝自动互转；
3. **全局热挂载与按需注入（Hot-Reloading Skills Loader）**：看板支持一键扫描并热挂载本地所有技能目录（`~/.gemini/config/skills`、`D:\ponytail\skills`、`~/.claude/skills`），自动为当前派发犬按需注入对应格式的 Skill 定义；
4. **技能安全沙箱**：自动扫描技能脚本，拦截非授权网络请求、路径越界与凭据读取。

---

## 2. 核心架构设计

### 2.1 技能联邦转译内核 (`src/orchestration/skills-federation.ts` [NEW])
- `UnifiedSkill`: `{ name, description, arguments, runtime_type, content, target_harness_map }`
- `transpileSkill(skill: UnifiedSkill, targetHarness: string): string`
- `scanAndFederateSkills(roots: string[]): UnifiedSkill[]`

### 2.2 服务端接口 (`src/web/server.ts`)
- `GET /api/skills`：返回全量联邦技能清单与适配状态
- `POST /api/skills/mount`：热挂载外部技能目录（Caller Token 鉴权）

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g048-cross-harness-skills-federation.test.ts`
- [ ] 验证 Claude / Codex / AGY 三种格式技能的 AST 解析与双向转译正确性
- [ ] 验证热挂载扫描与沙箱路径越界拦截
- [ ] 验证 API 契约与全量测试 100% 全绿
