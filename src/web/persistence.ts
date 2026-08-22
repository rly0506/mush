/**
 * mush Board 持久化三件套（GP-03）：
 * 1) 派发记录 runtime/dispatches/<id>.jsonl（header + 生命周期事件增量追加）
 * 2) 事件链 runtime/event-log.jsonl（含 prev_sha256 哈希锚点）
 * 3) 预算台账 runtime/budget-ledger.jsonl（每行 sha256/prev_sha256 链式）
 * 4) 单实例锁 runtime/board.lock（F-42；陈锁接管；释放写 released_at 不删文件）
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DispatchLifecycleEvent, DispatchRecord } from './dispatch.ts';
import type { EventLogEntry } from '../core/event-log.ts';
import { canonicalJson, sha256Hex } from '../core/event-log.ts';

export interface LockState {
  pid: number;
  acquired_at_utc: string;
  released_at_utc: string | null;
  /** DEF-06：监听端口（listen 后回填），供第二实例拒绝时提示访问地址。 */
  port?: number;
}

export class LockError extends Error {}

/**
 * 逐行容错解析（GOAL-067）：appendFileSync 非原子，进程写入中途被杀会留下
 * 撕裂半行 JSON——回放必须跳过坏行并告警，而不是让看板永久起不来。
 */
function parseJsonLineSafe(line: string, source: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    process.stderr.write(
      `[mush:persistence] torn line skipped in ${source}: ${line.slice(0, 120)}\n`,
    );
    return null;
  }
}

export class BoardPersistence {
  readonly runtimeRoot: string;
  private readonly isAlive: (pid: number) => boolean;

  constructor(runtimeRoot: string, opts: { isAlive?: (pid: number) => boolean } = {}) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.isAlive = opts.isAlive ?? processAlive;
  }

  private ensureDir(): void {
    mkdirSync(this.runtimeRoot, { recursive: true });
    mkdirSync(path.join(this.runtimeRoot, 'dispatches'), { recursive: true });
  }

  dispatchPath(dispatchId: string): string {
    return path.join(this.runtimeRoot, 'dispatches', `${dispatchId}.jsonl`);
  }

  /** header 一次性写入（append-only：文件存在则不重写）。 */
  saveDispatchHeader(record: DispatchRecord): void {
    this.ensureDir();
    const file = this.dispatchPath(record.dispatch_id);
    if (existsSync(file)) return;
    const header = {
      kind: 'header',
      schema_version: 1,
      dispatch_id: record.dispatch_id,
      adapter_id: record.adapter_id,
      status: record.status,
      receipt_path: record.receipt_path,
      admission: record.admission,
      error: record.error,
      stdout_tail: record.stdout_tail,
      stderr_tail: record.stderr_tail,
      session_id: record.session_id,
      ...(record.stream_id !== undefined ? { stream_id: record.stream_id } : {}),
      ...(record.task_id !== undefined ? { task_id: record.task_id } : {}),
      ...(record.carveout_id !== undefined ? { carveout_id: record.carveout_id } : {}),
      ...(record.request !== undefined ? { request: record.request } : {}),
    };
    writeFileSync(file, JSON.stringify(header) + '\n', 'utf8');
  }

  /** 生命周期事件增量追加（一行一事件，不重写历史）。 */
  appendDispatchEvent(record: DispatchRecord, event: DispatchLifecycleEvent): void {
    this.ensureDir();
    appendFileSync(
      this.dispatchPath(record.dispatch_id),
      JSON.stringify({ ...event, kind: 'event' }) + '\n',
      'utf8',
    );
  }

  loadDispatchRecords(): DispatchRecord[] {
    this.ensureDir();
    const dir = path.join(this.runtimeRoot, 'dispatches');
    const records: DispatchRecord[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const lines = readFileSync(path.join(dir, name), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '');
      if (lines.length === 0) continue;
      let header: Record<string, unknown> | null = null;
      const events: DispatchLifecycleEvent[] = [];
      for (const line of lines) {
        const parsed = parseJsonLineSafe(line, name);
        if (parsed === null) continue;
        if (parsed.kind === 'header') header = parsed;
        else if (parsed.kind === 'event') events.push(parsed as unknown as DispatchLifecycleEvent);
      }
      if (header === null) continue;
      records.push({
        dispatch_id: String(header.dispatch_id),
        adapter_id: String(header.adapter_id),
        status: String(header.status) as DispatchRecord['status'],
        receipt_path: typeof header.receipt_path === 'string' ? header.receipt_path : null,
        admission: (header.admission as DispatchRecord['admission']) ?? null,
        error: typeof header.error === 'string' ? header.error : null,
        stdout_tail: (header.stdout_tail as DispatchRecord['stdout_tail']) ?? null,
        stderr_tail: (header.stderr_tail as DispatchRecord['stderr_tail']) ?? null,
        session_id: typeof header.session_id === 'string' ? header.session_id : null,
        ...(typeof header.stream_id === 'string' ? { stream_id: header.stream_id } : {}),
        ...(typeof header.task_id === 'string' ? { task_id: header.task_id } : {}),
        ...(typeof header.carveout_id === 'string' ? { carveout_id: header.carveout_id } : {}),
        ...(header.request !== undefined && header.request !== null
          ? { request: header.request as DispatchRecord['request'] }
          : {}),
        events,
      });
    }
    records.sort((a, b) => a.dispatch_id.localeCompare(b.dispatch_id));
    return records;
  }

  eventLogPath(runId: string): string {
    const safe = runId.replace(/[^A-Za-z0-9._-]+/g, '_');
    return path.join(this.runtimeRoot, `event-log-${safe}.jsonl`);
  }

  appendEventLog(runId: string, entry: EventLogEntry): void {
    this.ensureDir();
    appendFileSync(
      this.eventLogPath(runId),
      JSON.stringify({
        kind: 'event',
        sequence: entry.sequence,
        event_id: entry.event_id,
        sha256: entry.sha256,
        previous_sha256: entry.previous_sha256,
        event: entry.event,
      }) + '\n',
      'utf8',
    );
  }

  loadEventLogLines(runId: string): Array<{
    sequence: number;
    event_id: string;
    sha256: string;
    previous_sha256: string | null;
    event: unknown;
  }> {
    const file = this.eventLogPath(runId);
    if (!existsSync(file)) return [];
    const parsed: Array<{
      sequence: number;
      event_id: string;
      sha256: string;
      previous_sha256: string | null;
      event: unknown;
    }> = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const row = parseJsonLineSafe(line, path.basename(file));
      if (row === null) continue;
      parsed.push(row as {
        sequence: number;
        event_id: string;
        sha256: string;
        previous_sha256: string | null;
        event: unknown;
      });
    }
    return parsed;
  }

  private cachedLedgerSha: string | null | undefined = undefined;

  appendLedger(entry: {
    atUtc: string;
    actorId: string;
    decision: string;
    amountUsd: number;
    capUsd: number;
    spentBeforeUsd: number;
    remainingUsd: number;
    meta: Record<string, unknown>;
  }): void {
    this.ensureDir();
    if (this.cachedLedgerSha === undefined) {
      this.cachedLedgerSha = this.lastLedgerSha256();
    }
    const previous = this.cachedLedgerSha;
    const body = {
      at_utc: entry.atUtc,
      actor_id: entry.actorId,
      decision: entry.decision,
      amount_usd: entry.amountUsd,
      cap_usd: entry.capUsd,
      spent_before_usd: entry.spentBeforeUsd,
      remaining_usd: entry.remainingUsd,
      meta: entry.meta,
      previous_sha256: previous,
    };
    const sha256 = sha256Hex(canonicalJson(body));
    this.cachedLedgerSha = sha256;
    appendFileSync(
      path.join(this.runtimeRoot, 'budget-ledger.jsonl'),
      JSON.stringify({ ...body, sha256 }) + '\n',
      'utf8',
    );
  }

  lastLedgerSha256(): string | null {
    const lines = this.loadLedgerLines();
    if (lines.length === 0) return null;
    const last = lines[lines.length - 1];
    return typeof last.sha256 === 'string' ? last.sha256 : null;
  }

  loadLedgerLines(): Array<Record<string, unknown>> {
    const file = path.join(this.runtimeRoot, 'budget-ledger.jsonl');
    if (!existsSync(file)) return [];
    const parsed: Array<Record<string, unknown>> = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const row = parseJsonLineSafe(line, 'budget-ledger.jsonl');
      if (row !== null) parsed.push(row);
    }
    return parsed;
  }

  verifyLedgerChain(): void {
    let previous: string | null = null;
    for (const line of this.loadLedgerLines()) {
      if (line.previous_sha256 !== previous) throw new Error('ledger chain anchor broken');
      const body = { ...line };
      delete body.sha256;
      if (sha256Hex(canonicalJson(body)) !== line.sha256) throw new Error('ledger chain hash mismatch');
      previous = line.sha256 as string;
    }
  }

  lockPath(): string {
    return path.join(this.runtimeRoot, 'board.lock');
  }

  acquireLock(): LockState {
    this.ensureDir();
    const file = this.lockPath();
    const now = new Date().toISOString();
    if (existsSync(file)) {
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      } catch {
        existing = {};
      }
      const pid = Number(existing.pid);
      const released = existing.released_at_utc !== undefined && existing.released_at_utc !== null;
      // 同进程重入（测试/嵌入宿主可并行多个 server）；跨进程才是 F-42 防线。
      if (!released && pid === process.pid) {
        return existing as LockState;
      }
      if (!released && Number.isInteger(pid) && pid > 0 && this.isAlive(pid)) {
        // DEF-06：拒绝时带上旧实例的监听端口（若可得）与处置指引——
        // owner 曾因旧实例残留误以为看板坏了。
        let portHint = '';
        if (typeof existing.port === 'number' && existing.port > 0) {
          portHint = `, serving http://127.0.0.1:${existing.port}`;
        }
        throw new LockError(
          `board server already running (pid ${pid}${portHint}); refusing second instance` +
            ` — 用已有实例，或结束旧进程（taskkill /PID ${pid} /F）后重启`,
        );
      }
      // 陈锁：PID 已不存在 → 接管。
    }
    const lock: LockState = { pid: process.pid, acquired_at_utc: now, released_at_utc: null };
    writeFileSync(file, JSON.stringify(lock) + '\n', 'utf8');
    return lock;
  }

  /** DEF-06：listen 后回填端口到锁文件（原子重写，保留其余字段）。 */
  recordLockPort(port: number): void {
    const file = this.lockPath();
    try {
      const existing = JSON.parse(readFileSync(file, 'utf8')) as LockState;
      writeFileSync(file, JSON.stringify({ ...existing, port }) + '\n', 'utf8');
    } catch {
      // 锁不可读/不存在：静默跳过（提示功能尽力而为，不阻塞服务）。
    }
  }

  releaseLock(): void {
    const file = this.lockPath();
    if (!existsSync(file)) return;
    let lock: LockState;
    try {
      lock = JSON.parse(readFileSync(file, 'utf8')) as LockState;
    } catch {
      // 锁文件损坏：不阻塞关闭流程（close() 不应因锁异常失败）。
      return;
    }
    if (lock.pid !== process.pid) return;
    writeFileSync(
      file,
      JSON.stringify({ ...lock, released_at_utc: new Date().toISOString() }) + '\n',
      'utf8',
    );
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
