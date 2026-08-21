# GOAL-031: RM-004 M1 实战运营与 agy 旗舰真实闭环 (Flagship Realwork Operations with AGY Executor)

- 状态：`DONE`（2026-08-19 交付，基于 GP-41 / RM-004 M1；全量 428 tests 全绿）
- 依据：`CONSTITUTION.md`（红线与证据纪律）、`DECISIONS.md`（D14/D28/D30/D31）与 `docs/rm-004-realwork-streaming.md`。

---

## 1. 目标与价值

实现 RM-004 M1「实战运营」的完整交付与验证闭环：
1. **执行犬就绪**：以本地可用且额度充裕的在册旗舰执行犬 `agy`（默认 `gemini-3.7-flash-high`）作为核心工作犬；
2. **声明式写面隔离**：严格要求任务在已授权的 `carve-out` 路径白名单内执行，越权直接熔断；
3. **组织拓扑与异构验证**：结合 `GOAL-028` 的流水线（Pipeline SOP）或陪审制（Committee Debate），由独立 Verifier 犬实施切片审查；
4. **人类单次消费审批卡**：真实写操作前自动拦截生成审批请求卡，人类放行后方可落地生效；
5. **事件链与凭据留痕**：全生命周期事件上链，生成权威 `receipts`。

---

## 2. 核心实施与测试矩阵

1. **工作区 Carve-out 声明式授权验证**：
   - 确保 `agy` 在执行真实改动时，受控于 `runtime/carveouts.jsonl`；
2. **AGY 真实/仿真派发管线跑通**：
   - 验证 `agy`（携带 `--dangerously-skip-permissions`、`--model gemini-3.7-flash-high`、`-p`）的 T1 协议管线正确承接任务；
3. **独立 Verifier 审判与解耦约束**：
   - 验证生成者 `agy` 与独立验证者（如 `zcode`）的审查解耦矩阵；
4. **端到端测试覆盖**：
   - 新建测试文件 [`tests/g031-flagship-agy-realwork.test.ts`](file:///D:/mush/tests/g031-flagship-agy-realwork.test.ts)。

---

## 3. 验收规格 (DoD)

- [ ] 新建自动化测试 `tests/g031-flagship-agy-realwork.test.ts`；
- [ ] 验证 `agy` 派发在有/无 carve-out 授权下的安全行为；
- [ ] 验证 `agy` 产出工件经独立 Verifier 审判（PASS / WARN / FAIL 阻断）；
- [ ] 验证人类审批卡单次放行与 receipts 落盘；
- [ ] 全量 `npm test` 100% 保持全绿。
