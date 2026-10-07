/**
 * GOAL-085 owner 复核边界（2026-10-05）：**通道答案信封**提取。
 *
 * 受控通道的 stdout 既是**事件流**（claude stream-json 的 system/assistant/result、
 * agy 的 event/step_update）也是**答案运输**。合法答案只可能出现在三处：
 *   1. 事件行的显式 `structured_output`（通道解析器原生提取——最高优先，与
 *      `record.structured_output` 同源）；
 *   2. **成功终局事件**（`type/event === 'result'`）的答案文本字段
 *      （`result`/`response`/`text`/`output`）内嵌的 JSON 对象；
 *   3. 无包装的裸 JSON 对象（fixture、未声明解析器的通道、schema 生效后的整段输出）。
 *
 * 本模块把"一行原生输出 → 答案对象"的判定收成唯一实现：此前 agy 通道解析器与
 * 协调器倒序扫描各写一套，协调器只跳过"同时带 type 与 subtype"的行，于是
 * （a）有效答案放在 `result` 字符串里时整行被跳过、（b）只带 `type` 的元事件
 * （system/assistant）反而被当成观点对象——两条都会让合法输出连吃两次拒绝、
 * 耗尽共享重试后把会话打成 failed。**拒绝性终局不冒充观点**：失败终局事件的
 * 文本不是答案；其余原生事件一律不得整对象当作观点。
 */

/** 答案文本包装字段（与 agy 通道解析器的文本候选同表，两处必须一致）。 */
export const ANSWER_TEXT_KEYS = ['response', 'result', 'text', 'output'] as const;

/** 原生事件信封标记字段——出现即视为**事件**（不是观点对象），只能按信封解码。 */
const EVENT_ENVELOPE_KEYS = ['type', 'event', 'step_update'] as const;

/** 终局成功状态（agy 单对象/NDJSON 的 status 语义；与 parseAgyOutput 同表）。 */
const SUCCESS_STATUSES = ['SUCCESS', 'OK', 'COMPLETED', 'DONE'];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 行内显式结构化结果（仅对象形态——标量不是观点）。 */
export function structuredOutputOf(record: Record<string, unknown> | undefined): unknown | undefined {
  if (record === undefined) return undefined;
  const value = record.structured_output;
  return isPlainObject(value) ? value : undefined;
}

/** 文本候选 → 答案对象：整段 JSON，或**唯一且互不冲突**的 Markdown 围栏块
 *  （原生 CLI 偶尔把同一答案包进 ```json；多块不一致或夹杂散文即视为未验证）。 */
export function parseAnswerText(candidate: string): unknown | undefined {
  try {
    const inner: unknown = JSON.parse(candidate);
    if (isPlainObject(inner)) return inner;
  } catch {
    const pattern = /```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/g;
    const blocks = [...candidate.matchAll(pattern)];
    if (blocks.length === 0 || candidate.replace(pattern, '').trim() !== '') return undefined;
    try {
      const values = blocks.map((block) => JSON.parse(block[1]) as unknown);
      if (values.some((value) => !isPlainObject(value))) return undefined;
      if (values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))) return values[0];
    } catch {
      // 不完整或损坏的围栏块保持未验证。
    }
  }
  return undefined;
}

/** 原生事件信封判定：带 type/event/step_update 的对象不是观点对象本身。 */
export function isNativeEventEnvelope(record: Record<string, unknown>): boolean {
  return EVENT_ENVELOPE_KEYS.some((key) => typeof record[key] === 'string' || isPlainObject(record[key]));
}

/** 失败终局判定：subtype 非 success、或 status 非成功态、或 is_error=true。 */
export function isFailedTerminal(record: Record<string, unknown>): boolean {
  if (record.is_error === true) return true;
  if (typeof record.subtype === 'string') return record.subtype !== 'success';
  if (typeof record.status === 'string') {
    return !SUCCESS_STATUSES.includes(record.status.trim().toUpperCase());
  }
  return false;
}

/** 事件行 → 答案对象：显式 structured_output 最优先（任何事件行），其次**成功终局**
 *  事件的答案文本内嵌 JSON（含 agy `event:'result'` 把结果对象嵌在 `result` 里的形状）。
 *  元事件、失败终局一律返回 undefined——不得冒充观点。 */
export function extractAnswerFromEvent(record: Record<string, unknown>): unknown | undefined {
  const payload = isPlainObject(record.result) ? record.result : undefined;
  if (isFailedTerminal(record) || (payload !== undefined && isFailedTerminal(payload))) return undefined;
  const explicit = structuredOutputOf(record) ?? structuredOutputOf(payload);
  if (explicit !== undefined) return explicit;
  if (record.type !== 'result' && record.event !== 'result') return undefined;
  for (const source of [payload, record]) {
    if (source === undefined) continue;
    for (const key of ANSWER_TEXT_KEYS) {
      const candidate = source[key];
      if (typeof candidate === 'string') {
        const inner = parseAnswerText(candidate);
        if (inner !== undefined) return inner;
      }
    }
  }
  return undefined;
}
