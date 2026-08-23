# GOAL-073: 无人值守分级授权与失控熔断 (Unattended Tiered Authorization & Runaway Circuit-Breaker)

- 状态：`READY`（RM-011 M3）
- 来源：头犬提案（D8 无人值守调度器默认关的放闸前置工程），owner 规划会批准
- 优先级：高
- 依赖：GOAL-072（熔断阈值需 chaos 与 soak 数据定标）

---

## 1. 目标与价值

无人值守自动编排是个人开发者付费的核心理由，但 D8 至今默认关——缺的不是调度器，而是**可信的授权分级与失控保险丝**。本 Goal 交付三档授权模型与多重熔断机制：低额任务可自动批、异常行为自动停机、全程审计可回放，让「敢开」有工程底座。

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/core/unattended-policy.ts` [NEW] — 分级档位引擎：L0 全弹卡（现状默认）/ L1 低额自动批·超额弹卡 / L2 任务型白名单自动批；档位持久化 `<runtime>/unattended-policy.json`
- `src/web/dispatch.ts` [MODIFY] — admission 接入档位仲裁；自动批走一次性令牌 + 台账留痕 `auto_approved`
- `src/core/budget-master.ts` [MODIFY] — master gate 联动硬顶：档位额度上限不得超过 master cap
- `src/core/circuit-breaker.ts` [NEW] — 失控熔断：连败 N 次 / 预算斜率异常 / 单任务超时 → 自动停机 + 审计回放包导出
- `src/web/page.ts` [MODIFY] — 档位配置面板与熔断状态灯

### 2.2 关键接口与数据契约
- `GET/PUT /api/unattended/policy`；`GET /api/unattended/breaker`；契约升版记录 api-contract.md；
- 默认档位恒为 L0——任何档位提升必须 owner 显式操作留痕。

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g073-unattended-policy.test.ts`
- [ ] L1 下低额自动批全程无人工、台账 auto_approved 可追溯；超额必弹卡
- [ ] 三类熔断场景注入即停机，停机后审计回放包完整可导出
- [ ] 默认 L0 断言（重启/升级不改默认档）
- [ ] 严格遵守宪法红线：自动批总额受 master cap 硬约束，零凭据泄露
