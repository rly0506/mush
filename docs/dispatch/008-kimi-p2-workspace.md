# 派发包 008 — Kimi 执行 GP-02（P2 前端批：workspace 自主登记 + 路径归一）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。本文件是你的完整任务包。
自主会话适用：无人应答，按包推进，疑问记 findings。

## 第一步：按序读取

1. `AGENTS.md` → `CONSTITUTION.md` → `docs/goal-pool.md`（GP-02 = 你的任务）
2. `src/web/page.ts`（主战场）+ `src/web/dispatch.ts`（F-41 白名单已上线：
   dispatch 只接受已登记 workspace——**你的 UI 是登记入口**）+
   `src/web/api-contract.md`（v1.1）
3. `tests/web-security.test.ts`（F-41/F-39 白名单与归一语义，前端需对齐）

## 任务

1. **F-40 workspace 自主登记**：workspace 区域增加路径输入框 + "登记"按钮：
   - 提交 `POST /api/workspaces/select {path}`（后端本就接受任意存在路径）；
   - 成功：刷新列表、选中新项、header 高亮；
   - 路径不存在：弹出**显式确认对话框**（"目录不存在，是否新建并登记？"
     ——新建 = 前端调 `POST /api/workspaces/create`，见下）；
2. **后端小改（授权范围内唯一新增）**：`POST /api/workspaces/create`：
   body `{path}` → mkdirSync(recursive) + 记入 known-workspaces + 返回
   WorkspaceInfo；路径穿越校验（resolve 后必须仍在其盘符根下且非 UNC 特殊
   路径）；**不提供 git init**（工作区初始化留给 owner/犬的正式流程）；
   契约文档同步 v1.2。
3. **F-39 显示归一**：workspaces 下拉/犬队视图中的路径显示统一为反斜杠
   形态（或统一正斜杠，选一致即可）；后端 `listWorkspaces()` 返回时统一
   `path.resolve` 归一并去重（同路径双条目消除）。
4. **安全对齐（头犬安全审查要求）**：登记/新建的确认对话框文案明示
   "登记后此目录将对犬队开放写入"；新建路径在 `D:\意向项目` 子树时
   **前端直接拒绝**并提示（黄金参照冻结区；纵深防御，后端白名单之外的
   又一道提示层——后端硬拦截属 GP-14 范围不在本包）。

## 工作纪律（惯例）

小步 TDD；239 tests 保持全绿；path-limited commit（G-P2-* 号）；每批
BATCH-NN 回报 + 真实测试输出；D15 验收语义；push origin master 常规同步
（失败不阻塞）。

## 边界（硬红线）

- 只写 `D:\mush`；限 page.ts + dispatch.ts 的 listWorkspaces/selectWorkspace
  段 + api-contract.md + 测试；零依赖/零外链/127.0.0.1 不变；
- 意向项目子树拒绝（上述 4）；凭据永不渲染；
- per-actor cap $5；五触发门照常。

## 终止条件

DoD：239+ 全绿（含 create 端点测试、归一去重测试、前端结构断言）；脚本化
冒烟（输入 D:/mush-playground 登记→高亮；输入不存在路径→确认框→create→
登记成功；意向项目路径→拒绝提示）；`goals/receipts/BATCH-NN-completion.json`
+ `GP-02-completion.json` 落盘。
