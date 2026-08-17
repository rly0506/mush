/**
 * mush 适配器层（GP-29，owner 2026-08-18 紧急令）— pi 通用 harness 合同。
 *
 * pi = 模型无关编码 harness（read/bash/edit/write 内建工具、任意 provider、
 * 真会话持久化）。通道依据：pi 0.84.1 --help 实测（--mode rpc / --provider /
 * --model / --session-dir / --session-id / -c -r）；RPC 线协议依据黄金参照
 * invoke-managed-pi-agent.ps1 L160-L520（只读）。
 * 凭据边界：mush 只传 provider/model 名；密钥由 pi auth 自管（不注入、
 * 不读取、不存储——红线）。
 * D13：expected_provider/model 注册前 UNKNOWN；每次派发的 get_state 握手
 * 实测运行时身份并记录（GP-35 实测原则的首个内建落地）。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';

export function buildPiContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'pi',
    executable: 'pi',
    arguments: ['--mode', 'rpc'],
    protocol: 'pi-rpc',
    prompt_transport: 'rpc',
    expected_provider: 'UNKNOWN',
    expected_model_id: 'UNKNOWN',
    role: 'executor',
    // pi 有 --thinking 档位（off..max），v1 不注入（默认档），M3+ 接。
    effort_levels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'MAX'],
    effort_injection: { kind: 'none' },
    resume_flag: '--session-id',
  });
}

/** pi get_state 响应 data 形态的防御性读取（字段名跨版本宽容）。 */
export function extractPiIdentity(
  stateData: unknown,
): { provider: string; modelId: string; sessionId: string | null } {
  const data = (stateData ?? {}) as Record<string, unknown>;
  const model = (data.model ?? {}) as Record<string, unknown>;
  const session = (data.session ?? data.sessionInfo ?? {}) as Record<string, unknown>;
  return {
    provider: typeof model.provider === 'string' ? model.provider : '',
    modelId: typeof model.id === 'string' ? model.id : typeof model.model === 'string' ? model.model : '',
    sessionId:
      (typeof data.session_id === 'string' && data.session_id) ||
      (typeof data.sessionId === 'string' && data.sessionId) ||
      (typeof session.id === 'string' && session.id) ||
      null,
  };
}
