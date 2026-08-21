# GOAL-XXX: 目标中文简短标题 (English Title in Parentheses)

- 状态：`PROPOSED`（可选值：PROPOSED / READY / IN_PROGRESS / DONE / BLOCKED / CANCELLED）
- 来源：owner 规划 / 头犬提案 / 业务需求来源
- 优先级：高 / 中 / 低
- 依赖：GOAL-AAA, GOAL-BBB（若无前置依赖则填“无”）

---

## 1. 目标与价值

[简明阐述本 Goal 的核心业务目标、解决的痛点以及预期达成的业务价值。此处内容将由任务池引擎自动抽取作为看板卡片与抽屉的目标简报。建议 1~3 段，保持纯粹精炼。]

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/foo/bar.ts` [NEW] — 模块功能描述
- `src/web/page.ts` [MODIFY] — 修改点说明

### 2.2 关键接口与数据契约
- 契约端点 / 类型定义 / 数据流转说明

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/gxxx-feature.test.ts`
- [ ] 验证端到端业务流转闭环与异常边界兜底
- [ ] 严格遵守宪法红线：零凭据泄露、零外部 CDN 依赖、Windows 路径安全
