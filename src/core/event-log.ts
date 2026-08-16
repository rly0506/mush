/**
 * mush 核心（M2）— append-only 事件日志与哈希链锚点。
 *
 * PS 源（黄金参照，只读）：
 *   start-goal-orchestrator.ps1 L1824-L1843（events/active 槽位命名与 append-only 落盘）
 *   start-goal-orchestrator.ps1 L1858-L1868（schema/run/epoch/sequence/capability 绑定校验）
 *   start-goal-orchestrator.ps1 L1540-L1541（sequence = State.sequence + 1）
 *
 * 说明：PS 版哈希锚点是落盘文件的 Get-FileHash；本实现把哈希链锚在事件的
 * canonical JSON 内容上（append-only + 可重建审计链），文件字节级哈希由回放
 * 清单另行锚定（U4）。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseBridgeEventV2, type BridgeEventV2 } from '../schema/events.ts';

/** SHA-256（大写十六进制，与 PS Get-FileHash 大小写习惯一致）。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

/** 递归键排序的 canonical JSON（哈希链确定性锚点；undefined 可选字段省略）。 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
}

export function canonicalEventJson(event: BridgeEventV2): string {
  return canonicalJson(event);
}

export function eventSha256(event: BridgeEventV2): string {
  return sha256Hex(canonicalEventJson(event));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export interface EventLogEntry {
  readonly sequence: number;
  readonly event_id: string;
  readonly event: BridgeEventV2;
  readonly sha256: string;
  readonly previous_sha256: string | null;
}

/**
 * 单 epoch 的 append-only 事件日志：
 * - 每个 entry 冻结，内容不可变；
 * - sequence 严格单调递增；
 * - 每个 entry 的哈希锚定前一个 entry（genesis 为 null）。
 */
export class EventLog {
  readonly runId: string;
  readonly assignmentEpoch: number;
  private readonly _entries: EventLogEntry[] = [];

  constructor(runId: string, assignmentEpoch: number) {
    if (typeof runId !== 'string' || runId.trim() === '') throw new Error('event log run_id must be non-empty');
    if (!Number.isInteger(assignmentEpoch) || assignmentEpoch < 1) {
      throw new Error('event log assignment_epoch must be an integer >= 1');
    }
    this.runId = runId;
    this.assignmentEpoch = assignmentEpoch;
  }

  static fromJsonl(jsonl: string, runId: string, assignmentEpoch: number): EventLog {
    const log = new EventLog(runId, assignmentEpoch);
    for (const line of jsonl.split('\n')) {
      if (line.trim() === '') continue;
      log.append(JSON.parse(line) as unknown);
    }
    return log;
  }

  append(input: unknown): EventLogEntry {
    const event = parseBridgeEventV2(input);
    if (event.run_id !== this.runId) {
      throw new Error(`event run_id mismatch: got ${event.run_id}, expected ${this.runId}`);
    }
    if (event.assignment_epoch !== this.assignmentEpoch) {
      throw new Error(
        `event assignment_epoch mismatch: got ${event.assignment_epoch}, expected ${this.assignmentEpoch}`,
      );
    }
    const previous = this._entries[this._entries.length - 1];
    const expectedSequence = previous === undefined ? 1 : previous.sequence + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `event sequence must be contiguous (state.sequence + 1): got ${event.sequence}, expected ${expectedSequence}`,
      );
    }
    const frozenEvent = deepFreeze(event);
    const entry = Object.freeze<EventLogEntry>({
      sequence: frozenEvent.sequence,
      event_id: frozenEvent.event_id,
      event: frozenEvent,
      sha256: eventSha256(frozenEvent),
      previous_sha256: previous === undefined ? null : previous.sha256,
    });
    this._entries.push(entry);
    return entry;
  }

  get length(): number {
    return this._entries.length;
  }

  head(): EventLogEntry | null {
    return this._entries[this._entries.length - 1] ?? null;
  }

  events(): readonly EventLogEntry[] {
    return Object.freeze([...this._entries]);
  }

  chainHead(): string | null {
    const head = this.head();
    return head === null ? null : head.sha256;
  }

  /** 全链重算：锚点、哈希、连续 sequence；可传期望链头做失败快速断言。 */
  verifyChain(expectedHead?: string): void {
    let previousSha: string | null = null;
    let expectedSequence = 1;
    for (const entry of this._entries) {
      if (entry.previous_sha256 !== previousSha) {
        throw new Error(`chain anchor broken at sequence ${entry.sequence}`);
      }
      const recomputed = eventSha256(entry.event);
      if (recomputed !== entry.sha256) {
        throw new Error(`chain hash mismatch at sequence ${entry.sequence}`);
      }
      if (entry.sequence !== expectedSequence) {
        throw new Error(`chain sequence not contiguous at ${entry.sequence}, expected ${expectedSequence}`);
      }
      previousSha = entry.sha256;
      expectedSequence += 1;
    }
    const head = this.chainHead();
    if (expectedHead !== undefined && expectedHead !== head) {
      throw new Error(`chain head mismatch: expected ${expectedHead}, got ${head ?? 'null'}`);
    }
  }

  toJsonl(): string {
    return this._entries.map((entry) => canonicalEventJson(entry.event) + '\n').join('');
  }
}

/** 从已录事件文件重建日志（文件字节哈希由外部清单锚定）。 */
export function loadEventLogFromFiles(
  runId: string,
  assignmentEpoch: number,
  filePaths: string[],
): EventLog {
  const parsed = filePaths
    .map((filePath) => parseBridgeEventV2(JSON.parse(readFileSync(filePath, 'utf8')) as unknown))
    .sort((a, b) => a.sequence - b.sequence);
  const log = new EventLog(runId, assignmentEpoch);
  for (const event of parsed) log.append(event);
  return log;
}
