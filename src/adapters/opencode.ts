/**
 * mush 适配器层（GOAL-008 U1）— opencode 适配器（T1 `opencode run`）。
 *
 * 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md
 *   opencode run headless T1；ACP/HTTP 为后续升级项（本 Goal 不实现）。
 * 凭据边界：只调 executable；cc-switch profile 自理，不注入/不读取/不存储密钥。
 * GOAL-070：模型选型接入——`-m provider/model` 注入（缺省 free 档，零成本执行）；
 *   真实可选清单来自 `opencode models` 实测枚举（parseOpencodeModelsList），
 *   经 probeLiveModels 同步进合同 variants。
 */

import { validateAdapterContract, type AdapterContract } from './contract.ts';
import { calculateTokenCostAndSavings } from '../core/budget.ts';

/** GOAL-070：opencode 缺省模型——free 档（本机实测在册，provider/model 全格式），链路验证/演练零成本。 */
export const OPENCODE_DEFAULT_MODEL = 'opencode/x-preview-f-free';

/** GOAL-070：本机 `opencode models` 实测在册清单的静态种子（探测后动态刷新）。 */
export const OPENCODE_NATIVE_MODELS: readonly string[] = [
  'opencode/big-pickle',
  'opencode/hy3-free',
  'opencode/mimo-v2.5-free',
  'opencode/muse-spark-1.2-contributor-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/x-preview-f-free',
  'botcf/kimi-k3',
  'pixel/grok-4.5',
  'tbtk/glm-5.3',
];

export function buildOpencodeContract(): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'opencode',
    executable: 'opencode',
    // GOAL-075 切片1+2：--thinking 思维链内联；--format json 结构化事件流
    // （NDJSON：text/reasoning part + sessionID + tokens 统计），由 runner
    // 归一化为人类可读输出并回填会话锚点与真实 token 计量。
    arguments: ['run', '--thinking', '--format', 'json', '-m', OPENCODE_DEFAULT_MODEL],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'opencode',
    expected_model_id: OPENCODE_DEFAULT_MODEL,
    variants: [...OPENCODE_NATIVE_MODELS],
    model_flag: '-m',
    // D82 修订（DEF-14）：opencode 实证无视进程 cwd（空目录报 20/32 条）——
    // 显式 --dir 钉死工作目录，跨工作区文件面操作不再落错根。
    cwd_flag: '--dir',
    // GOAL-075 切片2：stdout 为 NDJSON 事件流，runner 归一化并回填会话/计量。
    output_format: 'ndjson-events',
    effort_levels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'MAX'],
    effort_injection: { kind: 'flag', name: '--variant' },
    // GOAL-018 U3：未列入本批自动压缩/续跑主路径，暂按 none。
    context_management: 'none',
  });
}

export interface ParsedModelList {
  /** provider -> 全量 model id 列表（如 "opencode" -> ["opencode/hy3-free", …]）。 */
  grouped: Record<string, string[]>;
  models: string[];
}

/** GOAL-070：解析 `opencode models [provider]` 输出——每行一个 "provider/model"。 */
export function parseOpencodeModelsList(stdout: string): ParsedModelList {
  const grouped: Record<string, string[]> = {};
  const models: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const slash = line.indexOf('/');
    if (slash <= 0 || slash === line.length - 1) continue;
    const provider = line.slice(0, slash);
    if (!/^[A-Za-z0-9._-]+$/.test(provider)) continue;
    (grouped[provider] ??= []).push(line);
    models.push(line);
  }
  return { grouped, models };
}

export interface OpencodeOutput {
  parsed: boolean;
  modelId: string;
  text: string;
}

/** GOAL-075 切片2：--format json NDJSON 事件流解析产物。 */
export interface OpencodeEventTokens {
  input: number;
  output: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
}

export interface ParsedOpencodeEvents {
  isEvents: boolean;
  /** text part 全量拼接（最终回答）。 */
  text: string;
  /** reasoning/thinking part 拼接（CoT，模型支持且 --thinking 时出现）。 */
  reasoning: string;
  sessionId?: string;
  tokens?: OpencodeEventTokens;
}

/** 解析 --format json 的 NDJSON 事件流（实测形态：{"type":"step_start|text|
 * step_finish", part:{...}, sessionID:"ses_…"}；step_finish.part.tokens 含
 * input/output/reasoning/cache 统计）。非事件流（纯文本/普通 JSON 回答）原样
 * 返回 isEvents=false，调用方回退旧解析——只认"有 type 且带 sessionID/part"的行，
 * 不误吞模型输出的普通 JSON。 */
export function parseOpencodeEvents(stdout: string): ParsedOpencodeEvents {
  const result: ParsedOpencodeEvents = { isEvents: false, text: '', reasoning: '' };
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const type = rec.type;
    const part = rec.part;
    if (typeof type !== 'string' || typeof rec.sessionID !== 'string') continue;
    result.isEvents = true;
    if (result.sessionId === undefined) result.sessionId = rec.sessionID as string;
    if ((type === 'text' || type === 'reasoning') && part !== null && typeof part === 'object') {
      const pText = (part as Record<string, unknown>).text;
      if (typeof pText === 'string' && pText !== '') {
        if (type === 'reasoning') result.reasoning += (result.reasoning ? '\n' : '') + pText;
        else result.text += (result.text ? '\n' : '') + pText;
      }
    }
    if (type.startsWith('step_finish') || type.startsWith('step-finish')) {
      const pTokens =
        part !== null && typeof part === 'object' ? (part as Record<string, unknown>).tokens : undefined;
      if (pTokens !== null && typeof pTokens === 'object') {
        const t = pTokens as Record<string, unknown>;
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const cache = t.cache !== null && typeof t.cache === 'object' ? (t.cache as Record<string, unknown>) : {};
        result.tokens = {
          input: num(t.input),
          output: num(t.output),
          reasoning: num(t.reasoning),
          cache_read: num(cache.read),
          cache_write: num(cache.write),
        };
      }
    }
  }
  return result;
}

/** GOAL-075 切片2：把 NDJSON 事件流归一化为 runner 可用的形态——
 * 思维块前置（对齐 CLI 观感）、sessionId 回填、tokens→真实计量。 */
export function normalizeOpencodeEvents(
  raw: string,
  modelId: string,
): { text: string; thinking: string; sessionId?: string; telemetry?: import('./t1-runner.ts').OutputNormalization['telemetry'] } {
  const ev = parseOpencodeEvents(raw);
  if (!ev.isEvents) return { text: raw, thinking: '' };
  let telemetry: import('./t1-runner.ts').OutputNormalization['telemetry'] = undefined;
  if (ev.tokens !== undefined) {
    const cost = calculateTokenCostAndSavings(
      {
        input_tokens: ev.tokens.input,
        output_tokens: ev.tokens.output,
        cache_creation_tokens: ev.tokens.cache_write,
        cache_read_tokens: ev.tokens.cache_read,
      },
      modelId,
    );
    telemetry = {
      input_tokens: ev.tokens.input,
      output_tokens: ev.tokens.output,
      cache_creation_tokens: ev.tokens.cache_write,
      cache_read_tokens: ev.tokens.cache_read,
      total_cost_usd: cost.total_cost_usd,
      cache_savings_usd: cost.cache_savings_usd,
    };
  }
  return { text: ev.text, thinking: ev.reasoning, sessionId: ev.sessionId, telemetry };
}

/** 解析 opencode run 输出（NDJSON 事件流优先，其次整段 JSON/首条 JSON 行；容忍纯文本）。 */
export function parseOpencodeOutput(stdout: string): OpencodeOutput {
  // GOAL-075 切片2：--format json NDJSON 形态——回答取 text part 拼接；
  // 事件流不携带模型 id（保持 UNKNOWN 与旧行为同口径）。
  const events = parseOpencodeEvents(stdout);
  if (events.isEvents) {
    const text = events.text !== '' ? events.text : stdout.trim();
    return { parsed: true, modelId: 'UNKNOWN', text };
  }
  let record: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(stdout);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      record = value as Record<string, unknown>;
    }
  } catch {
    for (const line of stdout.split(/\r?\n/)) {
      try {
        const value: unknown = JSON.parse(line);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          record = value as Record<string, unknown>;
          break;
        }
      } catch {
        // continue
      }
    }
  }
  if (record === null) return { parsed: false, modelId: 'UNKNOWN', text: stdout };
  const model = record.model ?? record.model_id ?? record.modelId;
  const text = record.text ?? record.result ?? record.output ?? '';
  return {
    parsed: true,
    modelId: typeof model === 'string' && model.trim() !== '' ? model.trim() : 'UNKNOWN',
    text: typeof text === 'string' ? text : '',
  };
}

export interface OpencodeIdentity {
  provider: string;
  modelId: string;
  proven: boolean;
}

export function evaluateOpencodeIdentity(stdout: string): OpencodeIdentity {
  const parsed = parseOpencodeOutput(stdout);
  return {
    provider: parsed.parsed ? 'opencode' : 'UNKNOWN',
    modelId: parsed.modelId,
    proven: parsed.parsed && parsed.modelId !== 'UNKNOWN',
  };
}
