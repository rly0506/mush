# 派发包 006 — Kimi 执行 GOAL-007-B：看板前端错误排查与优化（owner 实测反馈）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。本文件是完整任务包。
背景：owner 已实际操作看板派发（RM-002 G009 试验田阶段），回报四类问题。
头犬已完成代码级定位（下述根因均经代码核实，含行号），你的任务是修复+优化。
自主会话适用：无人应答，按包推进，疑问记 findings。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md`（红线）→ `docs/rm-002-mobilization.md`
2. `src/web/page.ts`（你的主战场）+ `src/web/server.ts` + `src/web/dispatch.ts`
3. `src/web/api-contract.md`（v1；本包含向后兼容的小幅扩展，见下）
4. `tests/web-board-page.test.ts`、`tests/web-board-e2e.test.ts`（既有测试模式）

## 确诊缺陷清单（逐项修复）

### D1 workspace 选择后无反馈（owner 报告①）

- **根因（两层）**：
  a) `dispatch.ts listWorkspaces()` 返回的 `WorkspaceInfo` **没有 `selected` 字段**
     （只有 path/is_git/mush_managed），而 `page.ts renderWorkspaces()`（约 L233-242）
     依赖 `w.selected` 标记选中项——永远无选中标记，下拉回显第一项
     `（默认：当前已选）`，header 恒显示"服务 cwd"。
  b) 该空值首项文案本身歧义："（默认：当前已选）"既非路径也非状态。
- **修复**：
  - server/管线：`listWorkspaces()` 返回值增加 `selected: candidate === this.selectedWorkspace`
    （向后兼容新增字段）；
  - 前端：删除歧义空项或改为明确的 `（未选择，默认服务目录）`；选中项
    `selected` 属性 + header 高亮联动；`POST select` 成功后立即重拉
    `GET /api/workspaces` 并重渲染（当前 select 处理器见约 L474-505 区域）。
  - **注意**：`D:\mush-playground` 已在 `.mush/known-workspaces.json`，列表应有它。

### D2 派发后状态停滞在 ADMITTED，无进行中/完成反馈（owner 报告③，核心）

- **根因（已核实）**：
  a) `page.ts trackDispatch()`（约 L277-283）对已存在 dispatch_id **直接 return**
     （dedupe 只增不改）——SSE 后续帧（EXECUTE/REPORT/PASS）永远不更新卡片状态。
  b) POST `/api/dispatch` 在 server 端 `await dispatch.dispatch(...)` 完整执行后
     才响应（server.ts 约 L213）：real 派发要等全程（数十秒），期间页面**零反馈**
     ——没有"执行中"卡片、没有 spinner、没有耗时显示。
  c) 卡片 detail 需手动点击才拉取，且只有状态/回执路径/事件表——**没有任务输出
     内容**（stdout 摘要后端未提供，见"后端小改"）。
- **修复**：
  1. `trackDispatch` 改为 upsert：已存在则更新 status/at_utc 并重渲染；
  2. 提交表单后**立即**生成本地卡片（状态 `RUNNING`，视觉区分：呼吸点/进度
     提示"执行中…"），SSE 帧与轮询到达后刷新为真实状态；
  3. 卡片增加已耗时计时（本地时钟，无需后端）；
  4. detail 扩展（配合后端小改 E1）：显示 stdout 摘要（尾行 N 行）与完整
     事件时间线（kind + at_utc 列表，已有）；
  5. 完成时 toast 明确"完成：PASS/FAIL"（当前 toast 只有受理）。

### D3 犬队状态不反映派发活动（owner 报告④）

- **根因**：roster 回退视图（G009 加的）只显示静态合同；actors 投影要等
  EventLog 事件流入，而 dispatch 生命周期事件**没有**进 EventLog（两套系统，
  深度整合属后端 M5+）。
- **修复（纯前端可做）**：roster 回退视图每行增加"最近派发"列——从
  `snapshot.dispatches` 按 adapter_id 聚合（次数 + 最近状态 + 最近时间）；
  有活动后该行显示活动徽章，无活动保持"（未活动，注册在册）"。

### D4 模型变体只有合同静态声明（owner 报告②）

- **定性：这不是前端缺陷，是后端 D20 能力注册的实测枚举未完成**（cc-switch
  provider/model 全量拉取是 deepseek 后端任务，另立 goal）。
- **你的部分（小）**：变体下拉支持 `variants` 数组的完整渲染（已支持）+
  当 roster 将来返回更多变体时 UI 不需要再改（确认分页/长列表样式可容纳
  ≥10 项即可）；在 UI 上对"变体=身份期望，非实时清单"加一行 hint 文案，
  避免 owner 误读。**不要**自行实现 cc-switch 读取（后端范畴+凭据红线）。

## 后端小改（允许的最小 server 变更，超出即记 finding 停）

- **E1**：`GET /api/dispatch/:id` 响应增加 `stdout_tail`（末 2KB，截断标记）
  与 `stderr_tail`（256B）——只读补充字段，不改管线语义；
- **E2**：`listWorkspaces()` 增加 `selected` 字段（D1a）。
- 契约文档 `api-contract.md` 同步这两项（标注 v1.1 向后兼容扩展）。

## 验收（DoD）

- 223+ tests 全绿（含新增：trackDispatch upsert 单测/结构断言、workspaces
  selected 字段、detail stdout_tail 存在性断言——按现有 web 测试模式）；
- 手动冒烟脚本化（写进 BATCH 回报，真实执行）：
  1. 选 workspace=playground → header/下拉立即高亮该路径；
  2. fake-t1 dry-run 派发 → 卡片立即出现 RUNNING → 终态 DRY_RUN/PASS；
     detail 展开 stdout_tail 可见；
  3. 派发后犬队状态 roster 行出现"最近派发"计数与状态。
- 每批 BATCH-NN 回报 + path-limited commit（G7B-* 号）；D15 验收语义。

## 边界（硬红线）

- 只写 `D:\mush`；主战场 `src/web/page.ts` + 上述两项 server 小改 + 测试 +
  api-contract.md；不动管线/预算/审批逻辑；
- 零依赖/零外链/127.0.0.1 不变；凭据材料永不渲染；
- per-actor cap $5；五触发门照常；kimi 自身花费按批回报估算。

## 终止条件

DoD 全满足 + `goals/receipts/GOAL-007B-completion.json` 落盘（D15 请求
AUTO_ACCEPTED）/ 预算逼近 / 仅剩 finding 阻塞项。
