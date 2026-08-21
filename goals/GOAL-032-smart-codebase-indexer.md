# GOAL-032: 轻量 AST 依赖分析与上下文自动装配器 (Smart Codebase Indexer & Context Assembler)

- 状态：`DONE`（2026-08-19 交付，基于 GP-19；全量 433 tests 全绿）
- 依据：`CONSTITUTION.md`（证据纪律与红线）、`DECISIONS.md` 与 API 契约演进。

---

## 1. 目标与价值

在向犬队派发任务或对话协同前，模型往往因缺少目标文件的关联上下文（如依赖模块导出的接口签名、对应的数据模型定义、关联的单元测试）而产生幻觉或修改偏差；或者因全盘喂入大文件导致 Token 预算浪费。

本目标旨在构建 **零外部依赖、纯本地 Node/TS 驱动的轻量 AST 依赖解析与智能上下文装配引擎**：
1. **依赖拓扑提取**：自动解析目标文件的 `import`/`export`/`interface`/`type` 依赖图；
2. **测试用例关联查找**：根据文件命名规律自动搜寻对应的单元测试文件；
3. **精准上下文打包**：按 Token 预算限制组装高信息密度的提示词上下文块 (`ContextPacket`)；
4. **服务端与看板接口集成**：暴露 `POST /api/context/assemble`，支持派发前自动/手动装配。

---

## 2. 核心架构设计

### 1. 索引引擎 (`src/orchestration/indexer.ts`)
- `extractModuleSymbols(code: string)`: 提取导出函数、接口、类、类型签名与导入依赖；
- `resolveDependencyTree(workspaceRoot: string, entryFile: string, maxDepth?: number)`: 递归解析本地导入依赖树（防御循环引用与路径穿越）；
- `findAssociatedTests(workspaceRoot: string, sourceFile: string)`: 自动探测关联测试文件（如 `tests/<basename>.test.ts`, `tests/gXXX-<basename>.test.ts`）；
- `assembleContext(options: ContextAssembleOptions)`: 打包生成结构化上下文包。

### 2. 服务端 API 与契约 (`src/web/server.ts`, `src/web/api-contract.md`)
- `POST /api/context/assemble`: 接收 `{ workspace, files, max_tokens }`，返回装配好的上下文块与估算 token 数。

---

## 3. 验收规格

- [ ] 新建自动化测试 [`tests/g032-smart-codebase-indexer.test.ts`](file:///D:/mush/tests/g032-smart-codebase-indexer.test.ts)；
- [ ] 验证依赖拓扑解析、符号提取与循环引用安全拦截；
- [ ] 验证关联测试查找与 Token 预算截断逻辑；
- [ ] 验证 `POST /api/context/assemble` 端点鉴权与响应契约；
- [ ] `npm test` 保持 100% 全绿。
