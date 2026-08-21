# GOAL-061: 子级会话持久化与智能 Auto-Resume 降本引擎 (Child Session Persistence & Auto-Resume)

- 状态：`DONE`
- 来源：owner 深度探讨与规划 (RM-009)
- 优先级：高
- 依赖：GOAL-018B, GOAL-056, GOAL-060

---

## 1. 目标与价值

工犬每次派发重开空白窗口会导致全部代码重新读取、打碎 Prompt Cache，造成巨额 Token 浪费与上下文丢失。

本 Goal 旨在构建**子级会话持久化与智能 Auto-Resume 引擎**：
1. **Child Session 注册表**：为每个工犬实例维护持久化的 `child_session_id`；
2. **自动 Resume 接续**：后续派发或直接对话时自动注入 `--resume <child_session_id>`，在原有上下文内接续工作，锁定 90% Prompt Cache 费用节省。
