# src/loop — 归档说明（D80，2026-08-22）

> **身份：M1 奠基参照 / 离线机检 fixture 资产。非生产执行链路。**

## 定性

本目录是 mush M1 时期的治理组件奠基实现（LoopStateMachine、审批门、机检审核门、
扫描器、closure 门、role-swap），测试覆盖完整，但**生产派发链路从不调用**。
真实治理由 `src/web/dispatch.ts` 的 DispatchPipeline 承担：

| 治理关切 | loop 版（本目录，fixture） | 生产版（DispatchPipeline） |
| --- | --- | --- |
| 状态机 | epoch-state-machine + LoopStateMachine | DispatchRecord 生命周期事件 + DEF-05 回放 |
| 审批 | approval-gate 写 budget-gate-*.json | dispatch-<id>.json 审批卡 + GP-32 一次性令牌（rename 读即焚） |
| 机检审核 | review.machineReview（nonce + sha256 双校验） | cli.ts review 判定（简化版）+ verifier-loop |

## 处置（DECISIONS.md D80）

- **不删除、不合流**：保留全部文件与对应测试（loop-*.test.ts），作为 M1 设计
  参照与离线机检资产；二者规则分叉就此封账，不再投入合流成本。
- **禁止新代码 import 本目录用于生产路径**；新治理能力一律进 DispatchPipeline。
- 若未来需要重启"独立状态机内核"路线，以 D80 为起点重新立项。
