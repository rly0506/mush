# GOAL-059: 多厂商思维链能力规格动态驱动引擎 (Dynamic Thinking Capability Spec Engine)

- 状态：`DONE`
- 来源：owner 深度探讨与规划 (RM-009)
- 优先级：高
- 依赖：GOAL-017B, GOAL-022, GOAL-056

---

## 1. 目标与价值

当前思维链强度硬编码为通用的 3 档（low/medium/high），无法适配 Claude 3.7 Token 预算、DeepSeek 原生思考开关或多厂商 5 档思维强度。

本 Goal 旨在构建**动态 Thinking Capability Spec 引擎**：
1. **统一能力模式定义**：定义 `ThinkingCapabilitySpec`（支持 `categorical` 5档/多档、`token_budget` 连续数值、`toggle` 开关及 `none`）；
2. **前端自适应渲染**：切换模型时，思维链选择器根据该模型声明的 spec 自动变更为对应的预设档位、滑块或开关，无能力模型自动置灰。
