/**
 * mush 适配器层（M3）— D5 适配器合同：executable + 参数 + 协议（语言无关）。
 *
 * 通道选档依据：
 *   docs/capability-probes/harness-landscape-2026-08-16.md（T1/T2/T3 三档）
 *   T1 单发 headless（通用底座）｜ pi-rpc（黄金参照，src/core 已覆盖）｜
 *   stream-json（claude -p --output-format stream-json）
 */

export type AdapterProtocol = 't1' | 'pi-rpc' | 'stream-json';
export type PromptTransport = 'stdin' | 'argument' | 'rpc';
export type EffortInjectionKind = 'flag' | 'env' | 'none';
export type ContextManagement = 'auto-compact' | 'none' | 'unknown';

export interface EffortInjection {
  readonly kind: EffortInjectionKind;
  /** CLI 旗标名（kind=flag）或环境变量名（kind=env）；kind=none 时缺省。 */
  readonly name?: string;
}

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
  /** D82 修订（DEF-14）：工作目录注入旗标（如 opencode 的 '--dir'）。缺省 =
   * 通道继承进程 cwd——实证部分 CLI 会自行解析项目根而忽略 cwd（opencode
   * 两次实测：空目录报 20/32 条），声明本旗标的通道由 runner 显式钉死工作目录。 */
  readonly cwd_flag?: string;
  /** GP-22：该通道真实可用的 effort 档位（大写规范；UI 按此渲染）。
   * 缺省 = 旧通用三档 LOW|HIGH|XHIGH（仅测试/未声明的兼容通道）。 */
  readonly effort_levels?: readonly string[];
  /** GP-22：effort 的 CLI/env 注入方式；kind=none 表示通道无注入入口。
   * 本批只做合同与校验层，不实现各通道注入逻辑（M3+ 按通道逐个接）。 */
  readonly effort_injection?: EffortInjection;
  /** GOAL-018 U3：上下文管理档位（auto-compact/none/unknown）。 */
  readonly context_management?: ContextManagement;
}

const PROTOCOLS: readonly string[] = ['t1', 'pi-rpc', 'stream-json'];
const PROMPT_TRANSPORTS: readonly string[] = ['stdin', 'argument', 'rpc'];
const EFFORT_INJECTION_KINDS: readonly string[] = ['flag', 'env', 'none'];
const CONTEXT_MANAGEMENTS: readonly string[] = ['auto-compact', 'none', 'unknown'];

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
  if (record.cwd_flag !== undefined && (typeof record.cwd_flag !== 'string' || record.cwd_flag.trim() === '')) {
    throw new Error("adapter contract 'cwd_flag' must be a non-blank string when present");
  }
  if (record.effort_levels !== undefined) {
    if (
      !Array.isArray(record.effort_levels) ||
      record.effort_levels.length === 0 ||
      record.effort_levels.some((level) => typeof level !== 'string' || level.trim() === '')
    ) {
      throw new Error("adapter contract 'effort_levels' must be a non-empty array of non-blank strings");
    }
  }
  if (record.effort_injection !== undefined) {
    const injection = record.effort_injection as Record<string, unknown>;
    if (injection === null || typeof injection !== 'object' || Array.isArray(injection)) {
      throw new Error("adapter contract 'effort_injection' must be an object when present");
    }
    if (typeof injection.kind !== 'string' || !EFFORT_INJECTION_KINDS.includes(injection.kind)) {
      throw new Error(`adapter contract 'effort_injection.kind' must be one of ${EFFORT_INJECTION_KINDS.join('|')}`);
    }
    if (injection.name !== undefined && (typeof injection.name !== 'string' || injection.name.trim() === '')) {
      throw new Error("adapter contract 'effort_injection.name' must be a non-blank string when present");
    }
  }
  if (record.context_management !== undefined) {
    if (typeof record.context_management !== 'string' || !CONTEXT_MANAGEMENTS.includes(record.context_management)) {
      throw new Error(`adapter contract 'context_management' must be one of ${CONTEXT_MANAGEMENTS.join('|')}`);
    }
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
    ...(record.cwd_flag !== undefined ? { cwd_flag: (record.cwd_flag as string).trim() } : {}),
    ...(record.effort_levels !== undefined ? { effort_levels: [...(record.effort_levels as string[])] } : {}),
    ...(record.effort_injection !== undefined
      ? {
          effort_injection: {
            kind: (record.effort_injection as { kind: EffortInjectionKind }).kind,
            ...((record.effort_injection as { name?: string }).name !== undefined
              ? { name: (record.effort_injection as { name: string }).name.trim() }
              : {}),
          },
        }
      : {}),
    ...(record.context_management !== undefined
      ? { context_management: record.context_management as ContextManagement }
      : {}),
  };
}
