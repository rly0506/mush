# 派发包 rm004-p21b — Kimi 执行 GOAL-022（任务池人因 UX 批，D36 首批）

你是 mush 项目的前端执行者（kimi-k3，thinking high）。完整任务包。
**本单同时作为 kimi 会话重启载荷**——与此前会话无关，自包含。

## 第一步：按序读取

1. `AGENTS.md`（转义铁律/DEF-07）→ `goals/GOAL-022-taskpool-human-ux.md`
   → `DECISIONS.md` D36 条目（人话原则，本批的宪法依据）
2. `src/web/page.ts`（雪原体系 + 任务池 B5 既有实现——注意主仓已修
   迁移按钮 {to}→{status}，以 master 为准）

## F-45 工作方式

`git worktree add runtime/worktrees/kimi-f -b g022`（基于当前 master）。
零后端改动；仅 page.ts + 测试 + 冒烟脚本。

## 任务（详见 Goal 文件）

中文化状态/按钮 → 机器语言折叠（ID→#序号）→ 泳道排序（优先级>时间，
同 Goal 聚簇）→ 泳道内滚动（页面不拉长）→ 多选批量派发（逐单审批卡）。

## 纪律与验收

342+ tests 全绿 + 结构断言 + 冒烟（34 张真卡实测排序/滚动/中文化）。
path-limited commit（G22B-*）；批次回执 BATCH-NN 从 46 起，-kimi 后缀。
终止：DoD 全满足 + GOAL-022B-completion.json 落盘。
