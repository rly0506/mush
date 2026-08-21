/**
 * mush 适配器层（GOAL-013 U3）— Kimi Code 犬：kimi -p 单发（T1）。
 *
 * 通道依据：docs/capability-probes/kimi-2026-08-17.md
 *   kimi --help 实测（2026-08-17）：
 *     -p, --prompt <prompt>  Run one prompt non-interactively and print the response.
 *   T1 起步；--output-format stream-json / acp 为后续升级项。
 * 凭据边界：mush 只调 executable；凭据由 kimi provider 配置自理，不注入、不读取、不存储。
 * D13：运行时模型身份待 nonce 实测，注册前 expected_model_id 保持 UNKNOWN。
 * GOAL-018 U2：kimi 输出形态 "To resume this session: kimi -r session_xxx"；
 *   合同声明 resume_flag=-r 供同流续跑。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

export function buildKimiContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'kimi-code',
    executable: 'kimi',
    arguments: ['-p'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'kimi',
    expected_model_id: 'UNKNOWN',
    role: 'executor',
    // GP-22：kimi --help 无 effort 旗标；本仓 ~/.kimi-code/config.toml 实证
    //   [models.*] supportEfforts = [ "low", "medium", "high" ]
    //   [thinking] effort = "medium"
    // 该档位经配置层生效，CLI 无独立注入入口 → kind=none 占位（M3+ 通道接入时实现）。
    effort_levels: ['LOW', 'MEDIUM', 'HIGH'],
    effort_injection: { kind: 'none' },
    // GOAL-018 U2/U3：kimi 支持 -r 续跑；自动压缩能力待实测 → unknown。
    resume_flag: '-r',
    context_management: 'unknown',
  });
}


