/**
 * mush 适配器层（M3）— D5 适配器合同：executable + 参数 + 协议（语言无关）。
 *
 * 通道选档依据：
 *   docs/capability-probes/harness-landscape-2026-08-16.md（T1/T2/T3 三档）
 *   T1 单发 headless（通用底座）｜ pi-rpc（黄金参照，src/core 已覆盖）｜
 *   stream-json（claude -p --output-format stream-json）
 */

import { createHash } from 'node:crypto';

export type AdapterProtocol = 't1' | 'pi-rpc' | 'stream-json';
export type PromptTransport = 'stdin' | 'argument' | 'rpc';
export type EffortInjectionKind = 'flag' | 'env' | 'none';
export type ContextManagement = 'auto-compact' | 'none' | 'unknown';

/** 未声明 `effort_levels` 的通道的通用档位（旧行为兼容：仅测试/未声明的通道）。
 *  定义在合同层——派发校验与协作席位强度选择共用同一份，避免两处各写一份后漂移。 */
export const DEFAULT_EFFORT_LEVELS: readonly string[] = ['LOW', 'HIGH', 'XHIGH'];

/** GOAL-084 §3.3：执行配置指纹——整份已验证合同的 sha256。派发前比对当前有效
 *  合同与批准快照的指纹：同一适配器/模型换限制配置（如 read-only →
 *  danger-full-access）即指纹不同，批准与证据不再适用。 */
export function contractPermissionFingerprint(contract: AdapterContract): string {
  return createHash('sha256').update(JSON.stringify(contract), 'utf8').digest('hex');
}

/** GOAL-084 §3.2：runner 能力注入请求（由管线 internal 专用通道携带，不来自 HTTP body）。 */
export interface RunnerCapabilityOptions {
  /** 讨论通道工具限制——合同未声明 tool_restriction_args（或为空）即抛错（fail-closed）。 */
  restrictTools?: boolean;
  /** mush 预写的输出 schema 文件路径（file 运输；合同未声明 output_schema_flag 时静默降级）。 */
  outputSchemaPath?: string;
  /** 输出 schema JSON 文本（inline 运输，如 claude `--json-schema '<schema>'`）。 */
  outputSchemaJson?: string;
}

/** GOAL-084 §3.2：按合同声明构造能力注入参数。返回值必须插在合同静态参数之后、
 * 运行时 prompt 之前（flag-before-positional 顺序不变）。工具限制 fail-closed：
 * 协作会话不能在无法落实批准的执行配置的通道上运行。 */
export function capabilityArgs(contract: AdapterContract, options: RunnerCapabilityOptions): string[] {
  const args: string[] = [];
  if (options.restrictTools === true) {
    const restrictionArgs = contract.tool_restriction_args;
    if (restrictionArgs === undefined || restrictionArgs.length === 0) {
      throw new Error(
        `contract ${contract.adapter_id} does not declare tool_restriction_args; discussion execution config cannot be enforced (fail-closed)`,
      );
    }
    args.push(...restrictionArgs);
  }
  if (contract.output_schema_flag !== undefined) {
    if (options.outputSchemaJson !== undefined) {
      args.push(...(contract.output_schema_args ?? []), contract.output_schema_flag, options.outputSchemaJson);
    } else if (options.outputSchemaPath !== undefined) {
      args.push(...(contract.output_schema_args ?? []), contract.output_schema_flag, options.outputSchemaPath);
    }
  }
  return args;
}

export interface EffortInjection {
  readonly kind: EffortInjectionKind;
  /** CLI 旗标名（kind=flag）或环境变量名（kind=env）；kind=none 时缺省。 */
  readonly name?: string;
  /** A config-override flag requires a key=value payload, not a bare effort. */
  readonly config_key?: string;
}

export interface AdapterContract {
  readonly adapter_id: string;
  readonly executable: string;
  readonly arguments: string[];
  readonly protocol: AdapterProtocol;
  readonly prompt_transport: PromptTransport;
  readonly expected_provider: string;
  readonly expected_model_id: string;
  /** GOAL-076+：provider 网关接入——自定义 Anthropic 兼容端点（如 TBTK/New API 中转）。
   *  运行时经 extraEnv 注入 ANTHROPIC_BASE_URL；密钥不入库，由 runner 从宿主环境读
   *  （env 名 = `MUSH_{ADAPTER_ID}_API_KEY`，adapter_id 大写、连字符转下划线）。 */
  readonly provider_base_url?: string;
  /** G009：可切换的模型变体（UI 下拉数据源）；缺省 = 仅合同默认模型。 */
  readonly variants?: readonly string[];
  /** GOAL-080：无副作用鉴权探针声明（L1）；缺省 = 该通道只认 L0 进程探针（诚实降档）。 */
  readonly liveness?: { l1_args?: readonly string[]; l1_expect_stdout?: string };
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
  /** GOAL-075 切片2：stdout 结构化形态声明。'ndjson-events' = 进程输出为
   *  NDJSON 事件流（如 opencode --format json），由 runner 经 outputNormalizer
   *  归一化为人类可读文本并回填 sessionId/tokens；缺省 'text' 原样透传。 */
  readonly output_format?: 'text' | 'ndjson-events';
  /** GOAL-084 §3.2（2026-10-01）：讨论通道工具限制注入声明——按通道实机帮助接线
   *  的参数序列，依次原样注入（支持合法空字符串值，如 claude `--tools ""` 禁用
   *  全部内建工具，及 `--strict-mcp-config` 等组合参数）。限制请求遇到未声明本
   *  字段的通道即 fail-closed 拒绝（"无法落实批准的执行配置的通道不作为会话
   *  参与者"）。旗标已按本机帮助核录，实弹行为未验证。 */
  readonly tool_restriction_args?: readonly string[];
  readonly codex_discussion_profile?: {
    readonly model_id: string; readonly native_version: string;
    readonly catalog_path: string; readonly catalog_sha256: string;
  };
  readonly agy_discussion_profile?: {
    readonly model_id: string; readonly native_version: string; readonly workspace_root: string;
    readonly project_id: string; readonly project_file: string; readonly project_sha256: string;
    readonly agent_file: string; readonly agent_sha256: string;
    readonly hooks_file: string; readonly hooks_sha256: string;
    readonly tool_gate_file: string; readonly tool_gate_sha256: string;
  };
  /** GOAL-085：Claude Code 讨论通道绑定（受控参数 + 宿主自有空 MCP 配置/空 settings 哈希）。
   *  派发前与批准重跑复核；不授予准入。 */
  readonly claude_discussion_profile?: {
    readonly model_id: string; readonly native_version: string; readonly workspace_root: string;
    readonly mcp_config_file: string; readonly mcp_config_sha256: string;
    readonly settings_file: string; readonly settings_sha256: string;
  };
  /** GOAL-084 §3.2：原生输出 schema 旗标（codex `--output-schema <FILE>` 实录）。
   *  file 运输（缺省）：mush 把 schema JSON 写入回执旁文件后下发路径；
   *  inline 运输（output_schema_inline=true，如 claude `--json-schema <schema>`）：
   *  直接下发 schema JSON 文本。通道未声明时静默降级——mush 侧每轮仍自行校验
   *  观点的引用、阶段与语义，不依赖通道能力。 */
  readonly output_schema_flag?: string;
  readonly output_schema_inline?: boolean;
  /** Companion flags required only when native output schema is requested. */
  readonly output_schema_args?: readonly string[];
  /** GOAL-084（2026-10-03）：收尾值参 prompt 旗标（如 agy `-p <prompt>`——help 实录
   *  `--print` 为值参，prompt 必须紧随）。声明后 runner 把能力注入参数（工具限制/
   *  schema）插在该旗标**之前**再拼 `[-p, prompt]`，保证 prompt 恒紧随值参旗标
   *  （2026-09-06 实弹教训：`-p` 与 prompt 之间插入的旗标会被 agy 当作 prompt）。
   *  声明本字段的合同 arguments 不得再含该旗标（由 runner 统一收尾拼接）。 */
  readonly prompt_flag?: string;
  /** GOAL-084（2026-10-03，owner 复核缺口 1）：stdout 结构化结果解析器声明——
   *  默认 T1 分支按此分派通道解析器并把结果透传为 RunAdapterResult.structuredOutput
   *  （协调器 extractJsonObject 的第一优先来源；缺省 = 不解析，仅整段 stdout 兜底）。
   *  值域为解析器标识（非函数——合同必须可 JSON 序列化以参与权限指纹）。 */
  readonly output_parser?: 'agy';
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
  if (
    record.output_format !== undefined &&
    record.output_format !== 'text' &&
    record.output_format !== 'ndjson-events'
  ) {
    throw new Error("adapter contract 'output_format' must be 'text' or 'ndjson-events' when present");
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
  if (record.codex_discussion_profile !== undefined) {
    const p = record.codex_discussion_profile as Record<string, unknown>;
    if (record.adapter_id !== 'codex' || !p || typeof p !== 'object' ||
        typeof p.model_id !== 'string' || !p.model_id.trim() ||
        typeof p.native_version !== 'string' || !p.native_version.trim() ||
        typeof p.catalog_path !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(p.catalog_path) ||
        typeof p.catalog_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.catalog_sha256) ||
        !p.catalog_path.endsWith('catalog-' + p.catalog_sha256 + '.json')) {
      throw new Error('invalid codex discussion profile binding');
    }
  }
  if (record.tool_restriction_args !== undefined) {
    // Profile asset bindings are validated independently of capability injection.
    if (
      !Array.isArray(record.tool_restriction_args) ||
      record.tool_restriction_args.length === 0 ||
      record.tool_restriction_args.some((arg) => typeof arg !== 'string')
    ) {
      // 元素允许空字符串——那是合法的旗标值（claude `--tools ""` 禁用全部内建工具）。
      throw new Error("adapter contract 'tool_restriction_args' must be a non-empty array of strings when present");
    }
  }
  if (record.agy_discussion_profile !== undefined) {
    const p = record.agy_discussion_profile as Record<string, unknown>;
    const absoluteLocal = (value: unknown) => typeof value === 'string' && /^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(value);
    if (record.adapter_id !== 'agy' || !p || typeof p !== 'object' || Array.isArray(p) ||
        typeof p.model_id !== 'string' || !p.model_id.trim() || typeof p.native_version !== 'string' || !p.native_version.trim() ||
        typeof p.project_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(p.project_id) ||
        !absoluteLocal(p.workspace_root) || !absoluteLocal(p.project_file) || !absoluteLocal(p.agent_file) ||
        typeof p.project_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.project_sha256) ||
        typeof p.agent_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.agent_sha256) ||
        !absoluteLocal(p.hooks_file) || !absoluteLocal(p.tool_gate_file) ||
        typeof p.hooks_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.hooks_sha256) ||
        typeof p.tool_gate_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.tool_gate_sha256)) throw new Error('invalid agy discussion profile binding');
  }
  if (record.claude_discussion_profile !== undefined) {
    const p = record.claude_discussion_profile as Record<string, unknown>;
    const absoluteLocal = (value: unknown) => typeof value === 'string' && /^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(value);
    if (record.adapter_id !== 'claude-code' || !p || typeof p !== 'object' || Array.isArray(p) ||
        typeof p.model_id !== 'string' || !p.model_id.trim() ||
        typeof p.native_version !== 'string' || !p.native_version.trim() ||
        !absoluteLocal(p.workspace_root) || !absoluteLocal(p.mcp_config_file) || !absoluteLocal(p.settings_file) ||
        typeof p.mcp_config_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.mcp_config_sha256) ||
        typeof p.settings_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.settings_sha256)) {
      throw new Error('invalid claude discussion profile binding');
    }
  }
  if (
    record.output_schema_flag !== undefined &&
    (typeof record.output_schema_flag !== 'string' || !record.output_schema_flag.startsWith('-'))
  ) {
    throw new Error("adapter contract 'output_schema_flag' must be a CLI flag string starting with '-' when present");
  }
  if (record.output_schema_args !== undefined && (!Array.isArray(record.output_schema_args) || record.output_schema_args.some(arg => typeof arg !== 'string') || record.output_schema_flag === undefined)) {
    throw new Error("adapter contract 'output_schema_args' requires output_schema_flag and string arguments");
  }
  if (record.output_schema_inline !== undefined && typeof record.output_schema_inline !== 'boolean') {
    throw new Error("adapter contract 'output_schema_inline' must be a boolean when present");
  }
  if (record.output_schema_inline === true && record.output_schema_flag === undefined) {
    throw new Error("adapter contract 'output_schema_inline' requires 'output_schema_flag'");
  }
  if (record.prompt_flag !== undefined && (typeof record.prompt_flag !== 'string' || !record.prompt_flag.startsWith('-'))) {
    throw new Error("adapter contract 'prompt_flag' must be a CLI flag string starting with '-' when present");
  }
  if (record.prompt_flag !== undefined && record.arguments.includes(record.prompt_flag)) {
    throw new Error("adapter contract 'prompt_flag' must not also appear in 'arguments' (runner appends it before the prompt)");
  }
  if (record.output_parser !== undefined && record.output_parser !== 'agy') {
    throw new Error("adapter contract 'output_parser' currently only supports 'agy'");
  }
  if (record.effort_injection !== undefined) {
    const injection = record.effort_injection as Record<string, unknown>;
    if (injection === null || typeof injection !== 'object' || Array.isArray(injection)) {
      throw new Error("adapter contract 'effort_injection' must be an object when present");
    }
    if (typeof injection.kind !== 'string' || !EFFORT_INJECTION_KINDS.includes(injection.kind)) {
      throw new Error(`adapter contract 'effort_injection.kind' must be one of ${EFFORT_INJECTION_KINDS.join('|')}`);
    }
    if (injection.config_key !== undefined && (injection.kind !== 'flag' || typeof injection.config_key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(injection.config_key))) {
      throw new Error("adapter contract 'effort_injection.config_key' requires a valid flag config key");
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
  if (record.liveness !== undefined) {
    const lv = record.liveness as Record<string, unknown>;
    if (lv === null || typeof lv !== 'object' || Array.isArray(lv)) {
      throw new Error("adapter contract 'liveness' must be an object when present");
    }
    if (lv.l1_args !== undefined) {
      if (!Array.isArray(lv.l1_args) || lv.l1_args.some((a) => typeof a !== 'string' || (a as string).trim() === '')) {
        throw new Error("adapter contract 'liveness.l1_args' must be an array of non-blank strings when present");
      }
      if ((lv.l1_args as string[]).length === 0) {
        throw new Error("adapter contract 'liveness.l1_args' must be non-empty when present");
      }
    }
    if (lv.l1_expect_stdout !== undefined && (typeof lv.l1_expect_stdout !== 'string' || lv.l1_expect_stdout === '')) {
      throw new Error("adapter contract 'liveness.l1_expect_stdout' must be a non-blank string when present");
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
    ...(record.provider_base_url !== undefined
      ? (() => {
          if (typeof record.provider_base_url !== 'string' || !/^https:\/\//.test(record.provider_base_url)) {
            throw new Error("adapter contract 'provider_base_url' must be an https URL when present");
          }
          return { provider_base_url: record.provider_base_url.trim().replace(/\/+$/, '') };
        })()
      : {}),
    ...(record.variants !== undefined ? { variants: [...(record.variants as string[])] } : {}),
    ...(record.model_flag !== undefined ? { model_flag: (record.model_flag as string).trim() } : {}),
    ...(record.role !== undefined ? { role: record.role } : {}),
    ...(record.resume_flag !== undefined ? { resume_flag: (record.resume_flag as string).trim() } : {}),
    ...(record.cwd_flag !== undefined ? { cwd_flag: (record.cwd_flag as string).trim() } : {}),
    ...(record.output_format !== undefined ? { output_format: record.output_format } : {}),
    ...(record.tool_restriction_args !== undefined
      ? { tool_restriction_args: [...(record.tool_restriction_args as string[])] }
      : {}),
    ...(record.codex_discussion_profile !== undefined
      ? { codex_discussion_profile: { ...(record.codex_discussion_profile as NonNullable<AdapterContract['codex_discussion_profile']>) } }
      : {}),
    ...(record.agy_discussion_profile !== undefined
      ? { agy_discussion_profile: { ...(record.agy_discussion_profile as NonNullable<AdapterContract['agy_discussion_profile']>) } }
      : {}),
    ...(record.claude_discussion_profile !== undefined
      ? { claude_discussion_profile: { ...(record.claude_discussion_profile as NonNullable<AdapterContract['claude_discussion_profile']>) } }
      : {}),
    ...(record.output_schema_flag !== undefined
      ? { output_schema_flag: (record.output_schema_flag as string).trim() }
      : {}),
    ...(record.output_schema_inline !== undefined ? { output_schema_inline: record.output_schema_inline } : {}),
    ...(record.output_schema_args !== undefined ? { output_schema_args: [...(record.output_schema_args as string[])] } : {}),
    ...(record.prompt_flag !== undefined ? { prompt_flag: (record.prompt_flag as string).trim() } : {}),
    ...(record.output_parser !== undefined ? { output_parser: record.output_parser } : {}),
    ...(record.effort_levels !== undefined ? { effort_levels: [...(record.effort_levels as string[])] } : {}),
    ...(record.effort_injection !== undefined
      ? {
          effort_injection: {
            kind: (record.effort_injection as { kind: EffortInjectionKind }).kind,
            ...((record.effort_injection as { name?: string }).name !== undefined
              ? { name: (record.effort_injection as { name: string }).name.trim() }
              : {}),
            ...((record.effort_injection as { config_key?: string }).config_key !== undefined
              ? { config_key: (record.effort_injection as { config_key: string }).config_key } : {}),
          },
        }
      : {}),
    ...(record.context_management !== undefined
      ? { context_management: record.context_management as ContextManagement }
      : {}),
    ...(record.liveness !== undefined
      ? {
          liveness: {
            ...((record.liveness as { l1_args?: string[] }).l1_args !== undefined
              ? { l1_args: [...(record.liveness as { l1_args: string[] }).l1_args] }
              : {}),
            ...((record.liveness as { l1_expect_stdout?: string }).l1_expect_stdout !== undefined
              ? { l1_expect_stdout: (record.liveness as { l1_expect_stdout: string }).l1_expect_stdout }
              : {}),
          },
        }
      : {}),
  };
}
