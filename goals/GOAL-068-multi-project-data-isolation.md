# GOAL-068: 多工作区多项目完全数据隔离与即时热切换引擎 (Multi-Project Full Data Isolation & Dynamic Hot-Switching)

- 状态：`AUTO_ACCEPTED`（2026-08-22 owner 批准实施并确认 D1-D4 决策：D1 沿用 runtime/ 沙盒、D2 全局唯一 master ledger、D3 adapter 调参 per-project、D4 在途派发 SSE/toast 全局+列表随活动项目；机检验收全绿 typecheck 零错误 + 575/575；DONE 判定权归 owner/D15）
- 编号备注：commit 前缀 g068-a/g068-b 为 GOAL-067 遗留修复批次标签，与本 Goal 无关；本文件为 GOAL-068 正式实体
- 来源：owner 2026-08-22 明确规划指示（“一个 mush 适配一个项目，切换工作区后任务池、聊天历史、工犬会话、派发追踪等所有项目数据完全切换到对应工作区，严格区分不同 projects”）
- 优先级：高
- 依赖：无

---

## 1. 目标与价值

当前 mush 在切换工作区时仅将工犬调用的执行目录（`cwd`）切换至目标文件夹，但内部状态机（任务池、思维导图、头犬聊天流历史、工犬子会话、派发追踪日志）仍停留在服务启动目录的 `runtime/` 中，导致不同项目之间的数据发生交叉混淆。

本 Goal 旨在构建**工业级「多项目完全数据隔离与动态热切换架构（Multi-Project Full Data Isolation）」**，将 mush 从“单目录开发工具”正式升级为“多工程通用协作总线”：
1. **项目专属沙盒（Project-Scoped State Hub）**：每个被纳入 mush 的工程在自身根目录下拥有独立的 `.mush/`（或 `runtime/`）数据存储，实现 **任务池（Tasks/Goals）、聊天历史（Chat）、派发流（Dispatches）、工犬终端（Child Sessions）与时空快照（Snapshots）的 100% 物理隔离**；
2. **全局总线底座（Global Master Infrastructure）**：全机共享的全局资金限额（USD Master Cap）与 Harness 工具探测（Claude/DeepSeek/Kimi/Codex）保持全局总控，防止跨项目资金超支；
3. **前端零闪烁即时热切（Zero-Flicker Dynamic Hot-Switching）**：用户在看板切换工作区时，前端全自动联动重刷任务池、思维导图、聊天气泡与活动流，实现真正的“秒切项目、全景随动、零数据残留”。

---

## 2. 核心架构设计

### 2.1 双层数据分治模型

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   mush 全局总控台 (127.0.0.1:3000)                        │
│  - 全局资金总钱包与台账 (~/.mush/master-ledger.jsonl)                     │
│  - 全局犬队 Harness 安装与探测 (Claude / DeepSeek / Kimi / Codex)         │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ 【工作区切换总线】
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│     【项目 A: D:\project-a】     │     │     【项目 B: E:\project-b】     │
├─────────────────────────────────┤     ├─────────────────────────────────┤
│ 📁 goals/ (A 项目需求/RFC/文档)   │     │ 📁 goals/ (B 项目需求/RFC/文档)   │
│ 📁 .mush/                       │     │ 📁 .mush/                       │
│   ├── tasks.jsonl (A 的任务池)   │     │   ├── tasks.jsonl (B 的任务池)   │
│   ├── chat/ (与头犬聊 A 的历史)  │     │   ├── chat/ (与头犬聊 B 的历史)  │
│   ├── dispatches/ (A 的派发流)   │     │   ├── dispatches/ (B 的派发流)   │
│   ├── child-sessions.jsonl      │     │   ├── child-sessions.jsonl      │
│   └── snapshots/ (A 的时空回滚)  │     │   └── snapshots/ (B 的时空回滚)  │
└─────────────────────────────────┘     └─────────────────────────────────┘
```

### 2.2 模块与文件变更清单

1. **`src/web/dispatch.ts` [MODIFY]**：
   - 增加动态上下文解析器：`tasksPath`, `chatRoot`, `dispatchesPath`, `childSessionsPath` 依据 `this.selectedWorkspace || this.workspaceRoot` 动态定位；
   - `listTasks()` 动态扫描当前激活工作区的 `goals/` 与 `goals/receipts/` 目录；
   - `createTask()`, `transitionTask()` 写入当前激活工作区的 `.mush/tasks.jsonl`。
2. **`src/web/chat.ts` [MODIFY]**：
   - `ChatService` 增加工作区动态路由能力，`history()`, `appendTurn()` 隔离写入当前工作区的 `.mush/chat/history.jsonl`。
3. **`src/web/server.ts` [MODIFY]**：
   - `POST /api/workspaces/select` 成功后动态重置所有数据服务的工作区上下文；
   - `GET /api/tasks`, `GET /api/chat/history`, `GET /api/snapshot`, `GET /api/activity`, `GET /api/child-sessions` 严格依据当前激活工作区提供过滤后的独占数据。
4. **`src/web/page.ts` [MODIFY]**：
   - 在前端工作区切换监听器（下拉框 `change`、目录树点击、原生浏览登记）中，切换成功后联动调用 `loadWorkspaces()`, `loadTasks()`, `chatRefreshHistory()`, `loadChildSessions()`, `refresh()`。

---

## 3. 验收规格 (DoD)

- [ ] **多工程物理隔离验证**：
  - 在独立目录 A（`D:\fake-ws-a`）中创建任务与聊天记录；
  - 切换到独立目录 B（`D:\fake-ws-b`），验证 B 的任务池、思维导图、聊天历史与工犬会话为空态或仅包含 B 专属数据，A 的数据完全不可见；
  - 切换回 A，验证 A 的全部任务与历史毫秒级恢复，零数据损坏。
- [ ] **全局资金总控与安全验证**：
  - 验证多项目切换下，全局资金花销与单犬 Cap 依然统一受控于 Master Ledger，不存在跨项目逃逸。
- [ ] **自动化测试全绿保障**：
  - 新建专用回归测试 `tests/g068-multi-project-isolation.test.ts`；
  - 保证全库 571+ 项既有测试 100% 通过（24 suites, 0 fail）。
