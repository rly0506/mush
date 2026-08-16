/**
 * mush 适配器层（M3）— D5 适配器合同：executable + 参数 + 协议（语言无关）。
 *
 * 通道选档依据：
 *   docs/capability-probes/harness-landscape-2026-08-16.md（T1/T2/T3 三档）
 *   T1 单发 headless（通用底座）｜ pi-rpc（黄金参照，src/core 已覆盖）｜
 *   stream-json（claude -p --output-format stream-json）
 */

export type AdapterProtocol = 't1' | 'pi-rpc' | 'stream-json';
export type PromptTransport = 'stdin' | 'argument';

export interface AdapterContract {
  readonly adapter_id: string;
  readonly executable: string;
  readonly arguments: string[];
  readonly protocol: AdapterProtocol;
  readonly prompt_transport: PromptTransport;
  readonly expected_provider: string;
  readonly expected_model_id: string;
}

const PROTOCOLS: readonly string[] = ['t1', 'pi-rpc', 'stream-json'];
const PROMPT_TRANSPORTS: readonly string[] = ['stdin', 'argument'];

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** 合同校验 fail-closed：任一维度无效即抛错（不静默降级）。 */
export function validateAdapterContract(input: unknown): AdapterContract {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('adapter contract must be an object');
  }
  const record = input as Record<string, unknown>;
  if (isBlank(record.adapter_id)) throw new Error("adapter contract 'adapter_id' must be non-blank");
  if (isBlank(record.executable)) throw new Error("adapter contract 'executable' must be non-blank");
  if (!Array.isArray(record.arguments) || record.arguments.some((arg) => typeof arg !== 'string')) {
    throw new Error("adapter contract 'arguments' must be an array of strings");
  }
  if (typeof record.protocol !== 'string' || !PROTOCOLS.includes(record.protocol)) {
    throw new Error(`adapter contract 'protocol' must be one of ${PROTOCOLS.join('|')}`);
  }
  if (typeof record.prompt_transport !== 'string' || !PROMPT_TRANSPORTS.includes(record.prompt_transport)) {
    throw new Error(`adapter contract 'prompt_transport' must be one of ${PROMPT_TRANSPORTS.join('|')}`);
  }
  if (isBlank(record.expected_provider)) throw new Error("adapter contract 'expected_provider' must be non-blank");
  if (isBlank(record.expected_model_id)) throw new Error("adapter contract 'expected_model_id' must be non-blank");
  return {
    adapter_id: record.adapter_id as string,
    executable: record.executable as string,
    arguments: [...(record.arguments as string[])],
    protocol: record.protocol as AdapterProtocol,
    prompt_transport: record.prompt_transport as PromptTransport,
    expected_provider: (record.expected_provider as string).trim(),
    expected_model_id: (record.expected_model_id as string).trim(),
  };
}
