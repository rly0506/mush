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
  /** G009：可切换的模型变体（UI 下拉数据源）；缺省 = 仅合同默认模型。 */
  readonly variants?: readonly string[];
  /** G009：变体切换的 CLI 注入旗标（如 claude 的 '--model'）；缺省 = 该通道
   * 不支持命令行变体切换（变体仅作为身份期望记录）。 */
  readonly model_flag?: string;
  /** G011：犬只角色（head/executor）；roster 据此暴露角色列。 */
  readonly role?: 'head' | 'executor';
  /** G011：会话续跑注入旗标（如 dsh 的 '--resume'）。 */
  readonly resume_flag?: string;
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
  if (record.variants !== undefined) {
    if (!Array.isArray(record.variants) || record.variants.some((v) => typeof v !== 'string' || v.trim() === '')) {
      throw new Error("adapter contract 'variants' must be an array of non-blank strings");
    }
  }
  if (record.model_flag !== undefined && (typeof record.model_flag !== 'string' || record.model_flag.trim() === '')) {
    throw new Error("adapter contract 'model_flag' must be a non-blank string when present");
  }
  if (record.role !== undefined && record.role !== 'head' && record.role !== 'executor') {
    throw new Error("adapter contract 'role' must be 'head' or 'executor' when present");
  }
  if (record.resume_flag !== undefined && (typeof record.resume_flag !== 'string' || record.resume_flag.trim() === '')) {
    throw new Error("adapter contract 'resume_flag' must be a non-blank string when present");
  }
  return {
    adapter_id: record.adapter_id as string,
    executable: record.executable as string,
    arguments: [...(record.arguments as string[])],
    protocol: record.protocol as AdapterProtocol,
    prompt_transport: record.prompt_transport as PromptTransport,
    expected_provider: (record.expected_provider as string).trim(),
    expected_model_id: (record.expected_model_id as string).trim(),
    ...(record.variants !== undefined ? { variants: [...(record.variants as string[])] } : {}),
    ...(record.model_flag !== undefined ? { model_flag: (record.model_flag as string).trim() } : {}),
    ...(record.role !== undefined ? { role: record.role } : {}),
    ...(record.resume_flag !== undefined ? { resume_flag: (record.resume_flag as string).trim() } : {}),
  };
}
