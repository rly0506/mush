# GOAL-062: 代码库模块化解耦与 DoD 一键收官工具 (Codebase Modular Decoupling & DoD Closer)

- 状态：`DONE`
- 来源：owner 深度探讨与规划 (RM-009)
- 优先级：高
- 依赖：GOAL-055, GOAL-057, GOAL-058

---

## 1. 目标与价值

消除 `src/web/page.ts` (3750+ 行) 与 `src/web/server.ts` (2500+ 行) 单体文件膨胀的技术债，并解决“代码完成但文档状态未改导致任务池停滞”的治理痛点。

本 Goal 旨在实现：
1. **前端与后端模块化解耦**：拆分样式、子组件与路由控制器，保持零外部依赖；
2. **DoD 一键收官脚本 (`scripts/close-goal.cjs`)**：自动化运行测试、合规更新 Goal 状态为 `DONE`、生成回执并秒级触发任务池对账。
