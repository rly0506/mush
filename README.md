# mush

> **开发已停止（2026-10-11）。** 本仓库保留源码、阶段成果和历史记录，供研究、参考与自行修改；不再主动维护，也不保证兼容当前各 harness 或开箱即用。停止开发的原因与道别见 [再见，mush](再见，mush.md)。
>
> 已有真实双模型讨论记录不代表所有通道、模型或版本均已验证。`scripts/claude-compat-check.mjs` 等兼容检查工作保留为**未收口实验**，仍有拒绝判定、超限采信和进程退出边界，不应直接用于自动版本放行。历史 Goal 的验收状态保留，不统一改为 DONE。
>
> 源码沿用仓库现有的 **Apache-2.0** 许可证。个人配置、凭据、运行账本、原生轨迹和未跟踪的审批记录不属于公开交付。

个人跨 harness 多 agent 协作编排工具。

> Mush!——雪橇队启跑的号令。

## 它是什么

把多个 agent harness（每个模型配它的"专属武器"：opus→claude code、gpt→codex、
glm→zcode、deepseek→dsh/pi，另有 opencode、pi 等普适 harness）联通成一支雪橇队：

- **头犬（parent）**：做计划、审核、调度——自动探测可用模型（cc-switch / 环境变量 /
  探测），按任务推荐犬只组合；
- **雪橇犬（executor）**：接手具体任务，完成后回报，接受审查，继续修正；
- **loop 模式**：派发 → 执行 → 回报 → 审核 → 修正 → 验收，全程留痕。

## 当前状态

奠基于 2026-08-15。前身是意向项目（`D:\意向项目`）内的 agent-bridge
（RM065-GOAL-010，已完成并闭环验证一次真实多 agent loop）；mush 是它的独立化、
Node/TS 重写与产品化续篇。

| 文档 | 内容 |
| --- | --- |
| `DECISIONS.md` | 奠基决议记录（append-only） |
| `CONSTITUTION.md` | 轻量宪法：双模式治理与红线 |
| `docs/rm-001-dogfood-bootstrap.md` | 首个路线图：移植 + dogfood 自举 |
| `docs/migration-checklist.md` | 从 agent-bridge 迁移的清单与前置条件 |

## 三条原则

1. **证据链是内核能力**，不是流程税：默认轻量、自动留痕、不阻断。
2. **用户显式接受才 DONE**：模型不自行宣布完成。
3. **默认不无人值守**：按需拉起，常驻开关默认关闭。

## 开发验证

在仓库根目录运行，要求 Node.js >=24。Windows 使用 `npm.cmd` 避开 PowerShell 脚本执行策略：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:isolated
```

两个测试入口均通过 `tests/setup.ts` 隔离用户配置和主预算账本，产物保留在 `.test-fixtures/test-env/`。单文件测试也应携带预加载参数，避免写入真实用户账本：

```powershell
node --import ./tests/setup.ts --test --test-isolation=none D:\mush\tests\persistence.test.ts
node --import ./tests/setup.ts D:\mush\scripts\g076-board-regression-baseline.cjs
```
