/**
 * mush 适配器层 — Antigravity CLI (agy) 适配器（T1 `agy -p`）。
 *
 * 通道依据：docs/capability-probes/agy-2026-08-18.md；受控讨论配置依据本机
 *   `agy --help` 实录（2026-10-03）：
 *     -p, --print <prompt>        Run a single prompt non-interactively（值参，prompt 必须紧随）
 *     --sandbox                   Run in a sandbox with terminal restrictions enabled（布尔旗标）
 *     --json-schema <schema>      JSON schema string or path to a schema file，enforce
 *                                 structured output（inline 字符串可用 → output_schema_inline）
 *     --disable-slash-commands    Disable slash command and skill expansion in print mode
 *     --mode <mode>               accept-edits | plan（未默认启用，列为探针对照项）
 *     --dangerously-skip-permissions  Auto-approve all tool permission requests
 *   受控化（GOAL-084，2026-10-03）：默认参数移除 `--dangerously-skip-permissions`——
 *   与受控 sandbox 并存的语义未知，且其存在即"自动批准全部工具权限请求"，隔离准入的
 *   write_protection/tool_scope 维度不可核验。受控会话经 tool_restriction_args 注入
 *   `--sandbox --disable-slash-commands`。**移除后普通 agy 派发遇到权限请求的行为
 *   （提示/拒绝/挂起）未知，待权限探针实弹核验**。所有旗标实弹行为未验证。
 * 凭据边界：mush 只调 executable；凭据由 agy 认证环境自理（~/.gemini），不注入、不读取、不存储。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';
import { parseAnswerText } from './answer-envelope.ts';

export const AGY_MODEL_VARIANTS: readonly string[] = [
  'gemini-3.7-flash-high',
  'gemini-3.7-flash-medium',
  'gemini-3.7-flash-low',
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.5-flash-high',
  'gemini-3.5-flash-medium',
  'gemini-3.5-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
];

export function buildAgyContract(expectedModelId: string = 'gemini-3.7-flash-high'): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'agy',
    executable: 'agy',
    // GOAL-084 受控化（2026-10-03）：arguments 只保留身份与 effort 旗标；
    // `-p` 为收尾值参，改经 contract.prompt_flag 声明、由 runner 在能力注入之后
    // 统一拼 `[-p, prompt]`（contract 校验禁止 arguments 再含 prompt_flag）。
    // effort 旗标因此恒在 `-p` 之前——applyEffortInjection 恒走原地改写分支，
    // 不会把 `--effort` 插到 prompt 位（2026-09-06 实弹审计 claude-code 503
    // 故障转移 agy 首跑 exit 2 的教训由 prompt_flag 机制结构性消除）。
    // 未声明 effort 的派发固定按 high 发。
    arguments: ['--model', expectedModelId, '--effort', 'high'],
    protocol: 't1',
    prompt_transport: 'argument',
    prompt_flag: '-p',
    // owner 复核缺口 1（2026-10-03）：声明通道解析器——默认 T1 分支据此把
    // parseAgyOutput 的结构化提取接进派发记录（裸/包装/NDJSON 三形状），
    // 协调器 extractJsonObject 的 structured_output 优先分支因此可用。
    output_parser: 'agy',
    expected_provider: 'google',
    expected_model_id: expectedModelId,
    variants: AGY_MODEL_VARIANTS,
    model_flag: '--model',
    role: 'executor',
    effort_levels: ['LOW', 'MEDIUM', 'HIGH'],
    effort_injection: { kind: 'flag', name: '--effort' },
    resume_flag: '--conversation',
    // GOAL-084 受控讨论配置（本机 help 实录，实弹未验证）：sandbox 终端限制 +
    // 禁 slash 命令/skill 展开（收窄 skill 扩权面）。
    tool_restriction_args: ['--sandbox', '--disable-slash-commands'],
    output_schema_flag: '--json-schema',
    output_schema_inline: true,
    output_schema_args: ['--output-format', 'json'],
    context_management: 'auto-compact',
  });
}

export interface AgyOutput {
  parsed: boolean;
  conversationId: string | null;
  modelId: string;
  status: string | null;
  text: string;
  /** GOAL-084（2026-10-03）：结构化结果提取——record.structured_output 优先，
   *  其次对字符串形态的 response/result 尝试一次内层 JSON 解析（与 claude
   *  structured_output 语义对齐）；讨论响应的权威解析仍是协调器对完整 stdout
   *  的整段 JSON 提取，本字段供身份核验与探针形状分析。 */
  structured?: unknown;
}

/** 解析 agy 输出（整段 JSON、逐行 JSON 或纯文本）。 */
export function parseAgyOutput(stdout: string): AgyOutput {
  let convId: string | null = null;
  let status: string | null = null;
  let modelId = 'UNKNOWN';
  let text = '';
  let structured: unknown = undefined;
  let parsedAny = false;
  const responseSteps = new Map<number, { text: string; done: boolean }>();

  // 每行独立计算结构化结果：行内显式 structured_output > 行内 response 内嵌
  // JSON；后行覆盖前行（流式语义=最终结果行权威）。owner 复核两轮缺口合并：
  // 同行并存显式胜出（一轮）、早行显式 DRAFT 而末行仅 response FINAL 时
  // structured 必须随最终行更新（二轮——"显式无条件+内嵌仅补空"会让
  // structured 停在 DRAFT 而 text 已是 FINAL，两者不一致）。
  const resolveLineStructured = (...sources: Array<Record<string, unknown>>): unknown | undefined => {
    for (const source of sources) {
      const so = source.structured_output;
      if (so !== null && typeof so === 'object' && !Array.isArray(so)) return so;
    }
    // 内嵌 JSON 扫描覆盖全部文本候选包装字段（owner 复核四轮回归）：仅查
    // response 会丢 result/text/output 包装的结构化结果——与 text 提取同列表。
    for (const source of sources) {
      for (const key of ['response', 'result', 'text', 'output'] as const) {
        const candidate = source[key];
        if (typeof candidate === 'string') {
          const inner = parseAnswerText(candidate);
          if (inner !== undefined) return inner;
        }
      }
    }
    return undefined;
  };

  try {
    const value: unknown = JSON.parse(stdout);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      parsedAny = true;
      const c = record.conversation_id ?? record.conversationId;
      if (typeof c === 'string' && c.trim() !== '') convId = c.trim();
      const s = record.status;
      if (typeof s === 'string') status = s;
      const m = record.model ?? record.model_id ?? record.modelId;
      if (typeof m === 'string' && m.trim() !== '') modelId = m.trim();
      // 提取优先级（owner 复核修正，2026-10-03）：行内显式 structured_output
      // 最优先，response 内嵌 JSON 次之；单对象只有一行，无跨行覆盖问题。
      const lineStructured = resolveLineStructured(record);
      if (lineStructured !== undefined) structured = lineStructured;
      const t = record.response ?? record.result ?? record.text ?? record.output;
      if (typeof t === 'string') text = t;
      // 协作形状（schema enforce 后整段输出即响应对象，无包装字段）：对象本身
      // 就是结构化结果——与协调器 extractJsonObject 的整段 parse 语义一致。
      const isEnvelope = ['response', 'result', 'text', 'output', 'structured_output',
        'conversation_id', 'conversationId', 'status', 'json_schema', 'denied_actions',
        'event', 'duration_seconds', 'num_turns', 'usage'].some(key => Object.hasOwn(record, key));
      if (structured === undefined && !isEnvelope) structured = record;
    }
  } catch {
    // 非单体 JSON，走按行解析
  }

  if (!parsedAny) {
    for (const line of stdout.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        const value: unknown = JSON.parse(line);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          parsedAny = true;
          const record = value as Record<string, unknown>;
          const payload = (record.result ?? record.step_update ?? record.init ?? record) as Record<string, unknown>;
          const step = record.step_update as Record<string, unknown> | undefined;
          if (step?.step_type === 'agent_response' && typeof step.step_index === 'number' && Number.isInteger(step.step_index)) {
            const entry = responseSteps.get(step.step_index) ?? { text: '', done: false };
            if (typeof step.text_delta === 'string') entry.text += step.text_delta;
            if (step.state === 'DONE') entry.done = true;
            responseSteps.set(step.step_index, entry);
          }
          const c = payload.conversation_id ?? payload.conversationId ?? record.conversation_id;
          if (typeof c === 'string' && c.trim() !== '') convId = c.trim();
          const s = payload.status ?? record.status;
          if (typeof s === 'string') status = s;
          const m = payload.model ?? payload.model_id ?? payload.modelId ?? record.model;
          if (typeof m === 'string' && m.trim() !== '') modelId = m.trim();
          // 流式分支同语义：每行独立计算（显式 > 内嵌），后行覆盖前行——
          // text 与 structured 一致取"最终结果行"。
          let lineStructured = resolveLineStructured(payload, record);
          const isFinal = record.event === 'result' || record.type === 'result' ||
            (typeof s === 'string' && ['SUCCESS', 'ERROR', 'FAIL', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(s));
          let finalResponse: string | undefined;
          if (isFinal && lineStructured === undefined && typeof payload.response === 'string') {
            const completed = [...responseSteps.entries()].sort(([a],[b])=>a-b).map(([,entry])=>entry);
            if (completed.length > 1 && completed.every(entry=>entry.done) && completed.map(entry=>entry.text).join('') === payload.response) {
              finalResponse = completed[completed.length-1].text;
              lineStructured = parseAnswerText(finalResponse);
              if (lineStructured === undefined) finalResponse = undefined;
            }
          }
          if (lineStructured !== undefined) structured = lineStructured;
          else if (isFinal) structured = undefined; // A denied final action is not an earlier draft answer.
          if (isFinal) text = '';
          const t = finalResponse ?? payload.response ?? payload.result ?? payload.text ?? payload.text_delta ?? record.response ?? record.text;
          if (typeof t === 'string' && t.trim() !== '') text = t;
        }
      } catch {
        // 继续解析下一行
      }
    }
  }

  if (!parsedAny) {
    return {
      parsed: false,
      conversationId: null,
      modelId: 'UNKNOWN',
      status: null,
      text: stdout,
    };
  }

  // 已知文本字段全部缺席（如 schema enforce 后直接输出协作 JSON 对象）时，
  // text 回退原始 stdout，避免"解析成功但文本为空"的假象。
  if (text === '') text = stdout;

  return {
    parsed: true,
    conversationId: convId,
    modelId,
    status,
    text,
    ...(structured !== undefined ? { structured } : {}),
  };
}

export interface AgyIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export function evaluateAgyIdentity(stdout: string): AgyIdentity {
  const parsed = parseAgyOutput(stdout);
  return {
    provider: parsed.parsed ? 'google' : 'UNKNOWN',
    modelId: parsed.modelId,
    proven: parsed.parsed && parsed.modelId !== 'UNKNOWN',
  };
}
