# GOAL-069: TypeScript 严格类型门禁 (Strict Typecheck Gate)

- 状态：`DONE`（2026-08-23 owner 批复 DONE。机检验收全绿：npm run typecheck 零错误 + 全量测试通过；实施 commit `4311740` 已推私有远端）
- 来源：owner 2026-08-22 批复（C 组独立立项；GOAL-067 深审发现"557 全绿掩盖类型漂移"，实测接入 @types/node 后全仓真实残差仅 78 条）
- 优先级：高
- 依赖：无（先于 GOAL-068 执行，为多项目大重构提供类型安全网）

---

## 1. 目标与价值

项目零依赖、Node 原生 strip-types 跑 TS，运行时不查型，导致接口漂移（如 ChatStreamEvent 改名、record.model_id 幻影属性）长期静默存活。本 Goal 引入 devDependencies 级 typescript + @types/node 与 `npm run typecheck` 门禁，把"编辑器级配置"升级为可执行验收规格。**零运行时依赖红线不破**：devDeps 不进产物、非全局安装。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `package.json` [MODIFY] — devDependencies: typescript@^5.9、@types/node@^24；scripts.typecheck = `tsc -p tsconfig.json --noEmit`
- `src/**/*.ts` / `tests/**/*.ts` [MODIFY] — 清理全部 tsc strict 报错（实测基线 78 条：TS2339×25、TS2345×15、TS2322×7 等，多为松散类型收窄）

### 2.2 关键决策
- tsconfig include 已含 src+tests，不改；
- 类型修复以收窄真实形状为准，禁止用 as any 灭火。

---

## 3. 验收规格

- [ ] `npm run typecheck` 退出码 0（零错误）
- [ ] 全量 npm test 全绿（571+ 只增不减）
- [ ] 后续 CI/pre-commit 挂钩留待 owner 决定（本 Goal 不强制）
