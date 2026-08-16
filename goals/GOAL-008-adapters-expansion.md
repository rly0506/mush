---
goal_id: MUSH-GOAL-008
status: AUTO_ACCEPTED（D15 非阻断验收，2026-08-17；DONE 待 owner 转正）
mode: LIGHT（触发门照常生效；codex/opencode nonce 探测一揽子预授权已含）
rm: RM-002 / GOAL-008
executor_model_profile: deepseek-dsh（后端）
per_actor_budget_usd: 5
created: 2026-08-17
owner_decision: D22（2026-08-17 grilling 定稿；预授权原文"a，codex和opencode
  我都是通过cc-switch第三方密钥使用，没有登录"）
---

# MUSH-GOAL-008：犬队扩编三连（codex / opencode / zcode headless）

## 任务

1. **codex 适配器**（`src/adapters/codex.ts`）：`codex exec` T1 单发起步
   （合同：executable+参数+协议，参照 deepseek.ts 模式）；身份证据解析
   （codex exec 的 JSONL 输出含模型信息，解析进 NonceProbeResult 同构结构）；
   nonce 注册：**预授权已给（D22）**，跑一次有界真实 dispatch，证据落
   `goals/receipts/dispatch-events/codex-real-001.json`；渠道异常（403/欠费）
   记 finding 停，不烧第二次。
2. **opencode 适配器**（`src/adapters/opencode.ts`）：T1（`opencode run`）
   起步；nonce 注册同上（`opencode-real-001.json`）；ACP/HTTP 通道记为
   后续升级项不实现。
3. **zcode headless 修复尝试**（F-30 三关：3.7.7 无 --json、~/.zcode EPERM、
   ZCODE_STORAGE_DIR 重定向后 SQLite readonly）：逐关排查（版本升级查询/
   存储目录重定向/只读开关），每关 ≤3 次环境失败即停记 finding；成功标准 =
   `zcode --prompt` headless 完成 nonce 探测；失败兜底 = zcode 保持交互式
   在册（已有 zcode-identity-probe 实证），不阻塞本 Goal 其他项。
4. **能力注册表更新**：扩编犬 capability record 入册（含 D20 档位字段、
   通道 T1/T2、身份证明路径）。

## 凭据边界（重要）

- codex/opencode 均经 **cc-switch 第三方 profile**（无官方登录）：凭据由
  CLI 自身从其配置读取，mush **不注入、不读取、不存储**任何密钥材料；
  adapter 只调 executable。
- 五门照常：若真实 dispatch 需要的凭据不存在/失效 → BLOCKED_ENV 记录，
  不代登录、不碰 cc-switch 配置。

## 分批纪律

小步 TDD；path-limited commit（含 G8-Unit 号）；每批 BATCH-NN 回报；199
tests 保持全绿；与 GOAL-006 文件面不相交（本 Goal 限 src/adapters/、tests/
adapters-*）；D15 验收。

## DoD

- `npm test` 全绿（含 codex/opencode 适配器合同与解析测试，fake/录制级）；
- codex/opencode 各一次 nonce 注册结果落盘（PASS 或诚实 BLOCKED/FAIL）；
- zcode headless 三关排查记录 + 结果（修复或 UNKNOWN 兜底）；
- 能力注册表含新犬记录；完成回报 `goals/receipts/GOAL-008-completion.json`。
