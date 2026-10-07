/**
 * mush Board 持久化三件套（GP-03）：
 * 1) 派发记录 runtime/dispatches/<id>.jsonl（header + 生命周期事件增量追加）
 * 2) 事件链 runtime/event-log.jsonl（含 prev_sha256 哈希锚点）
 * 3) 预算台账 runtime/budget-ledger.jsonl（每行 sha256/prev_sha256 链式）
 * 4) 单实例锁 runtime/board.lock（F-42；陈锁接管；释放写 released_at 不删文件）
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

/** D95 漂移依据读回守卫：四字段全为字符串才认，坏形态按缺失处理（不编造、不炸）。 */
function isClaudeBindingDrift(value: unknown): value is NonNullable<DispatchRecord['version_drift_accepted']> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.decision === 'string'
    && typeof v.accepted_by === 'string'
    && typeof v.frozen_native_version === 'string'
    && typeof v.observed_native_version === 'string';
}

/**
 * 原子替换（GOAL-084 收口）：同目录临时文件 + rename，读者永不看到被截断的首行。
 * 并发读（API/桌面端）在此期间读到的是旧完整内容或新完整内容，二选一。
 * 只用于 header 重写；事件行仍走 appendFileSync 增量追加。
 */
function writeAtomic(file: string, text: string): void {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* 清不掉临时文件也不能掩盖原始错误 */ }
    throw error;
  }
}

export class BoardPersistence {
  readonly runtimeRoot: string;
  private readonly isAlive: (pid: number, port?: number) => boolean;

  constructor(runtimeRoot: string, opts: { isAlive?: (pid: number, port?: number) => boolean } = {}) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.isAlive = opts.isAlive ?? isProcessReallyActive;
  }

  private ensureDir(): void {
    mkdirSync(this.runtimeRoot, { recursive: true });
    mkdirSync(path.join(this.runtimeRoot, 'dispatches'), { recursive: true });
  }

  dispatchPath(dispatchId: string): string {
    return path.join(this.runtimeRoot, 'dispatches', `${dispatchId}.jsonl`);
  }

  /** 首行 header 写入/重写。
   *
   *  证据边界（GOAL-084 收口）：本文件有两种行，语义不同——
   *  1) 首行 header 是**可变投影**：随 status/stdout_tail/session_id/receipt_path
   *     等记录字段变化而整体重写，供重启后恢复展示与 rerun 快照；
   *  2) 其后的 `kind:"event"` 行是**原始证据链**：只追加，header 重写不得改动它们。
   *  header 不承载 `structured_output`（完整对象在回执 JSON，见 tests/persistence.test.ts）。
   *  重写走同目录临时文件 + rename，读者不会看到被截断的首行。 */
  saveDispatchHeader(record: DispatchRecord): void {
    this.ensureDir();
    const file = this.dispatchPath(record.dispatch_id);
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
      // GOAL-085 D95 收口（2026-10-05 交接 §4.1）：审计字段必须随 header 落盘——
      // version_drift_accepted 是放行依据（D95 声称"写入派发记录"），observed_model_id
      // 是运行时观测身份。缺省时省略键，不编造。
      ...(record.observed_model_id !== undefined ? { observed_model_id: record.observed_model_id } : {}),
      ...(record.version_drift_accepted !== undefined ? { version_drift_accepted: record.version_drift_accepted } : {}),
      ...(record.stream_id !== undefined ? { stream_id: record.stream_id } : {}),
      ...(record.task_id !== undefined ? { task_id: record.task_id } : {}),
      ...(record.carveout_id !== undefined ? { carveout_id: record.carveout_id } : {}),
      ...(record.request !== undefined ? { request: record.request } : {}),
    };
    if (!existsSync(file)) {
      writeFileSync(file, JSON.stringify(header) + '\n', 'utf8');
      return;
    }
    // 更新语义：REPORT 后 record 获得 stdout_tail/session_id/receipt_path——
    // 回写首行 header 使派发输出可事后核验；事件行保持 append-only 不动。
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    // catch 范围只覆盖"首行解析"（GOAL-084 复核修正）：写入/rename 失败必须上抛，
    // 否则会被误判成"首行损坏"而走前置补头，产出 header,header,event 双头文件。
    let existing: { kind?: string; dispatch_id?: string } | null = null;
    try {
      existing = JSON.parse(lines[0] ?? '') as { kind?: string; dispatch_id?: string };
    } catch { existing = null; /* 首行损坏 → 退回前置补头 */ }
    if (existing !== null && existing.kind === 'header' && existing.dispatch_id === record.dispatch_id) {
      lines[0] = JSON.stringify(header);
      writeAtomic(file, lines.join('\n'));
      return;
    }
    // 首行不是本单 header（缺头/损坏）：补头而不是丢弃既有事件行，同样原子落盘。
    writeAtomic(file, JSON.stringify(header) + '\n' + text);
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
        ...(typeof header.observed_model_id === 'string' ? { observed_model_id: header.observed_model_id } : {}),
        ...(isClaudeBindingDrift(header.version_drift_accepted) ? { version_drift_accepted: header.version_drift_accepted } : {}),
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
      const port = typeof existing.port === 'number' && existing.port > 0 ? existing.port : undefined;
      const released = existing.released_at_utc !== undefined && existing.released_at_utc !== null;
      // 同进程重入（测试/嵌入宿主可并行多个 server）；跨进程才是 F-42 防线。
      if (!released && pid === process.pid) {
        return existing as unknown as LockState;
      }
      if (!released && Number.isInteger(pid) && pid > 0 && this.isAlive(pid, port)) {
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
      // 陈锁：PID 已不存在、非 node 进程或监听端口已关闭（Windows PID 复用） → 接管。
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

function isProcessNode(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'win32') {
    try {
      const res = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 1000,
        windowsHide: true,
      });
      if (res.error || res.status !== 0) return true; // fail-safe: don't mistakenly takeover on command error
      const stdout = (res.stdout || '').trim();
      if (!stdout || stdout.startsWith('INFO:')) return false;
      const match = stdout.match(/^"([^"]+)"/);
      if (!match) return true;
      const imageName = match[1].toLowerCase();
      return imageName.startsWith('node') || imageName.startsWith('electron');
    } catch {
      return true;
    }
  } else if (process.platform === 'linux') {
    try {
      const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase();
      return comm.includes('node') || comm.includes('electron') || comm.includes('tsx');
    } catch {
      return true;
    }
  } else {
    // macOS / BSD
    try {
      const res = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 1000,
      });
      if (res.error || res.status !== 0) return true;
      const comm = (res.stdout || '').trim().toLowerCase();
      return comm.includes('node') || comm.includes('electron') || comm.includes('tsx');
    } catch {
      return true;
    }
  }
}

function isPortListening(pid: number, port: number): boolean {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
  if (process.platform === 'win32') {
    try {
      const res = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        timeout: 1500,
        windowsHide: true,
      });
      if (res.error || res.status !== 0) return true; // fail-safe
      const lines = (res.stdout || '').split('\n');
      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        if (fields[0]?.toUpperCase() === 'TCP' && fields[1]?.endsWith(`:${port}`) &&
            fields[3]?.toUpperCase() === 'LISTENING' && Number(fields[4]) === pid) {
          return true;
        }
      }
      return false;
    } catch {
      return true;
    }
  } else if (process.platform === 'linux') {
    try {
      const res = spawnSync('ss', ['-tlpn'], { encoding: 'utf8', timeout: 1000 });
      if (!res.error && res.status === 0) {
        return (res.stdout || '').split('\n').some((line) => {
          const fields = line.trim().split(/\s+/);
          if (fields[0] !== 'LISTEN' || !fields[3]?.endsWith(`:${port}`)) return false;
          const owners = [...line.matchAll(/\bpid=(\d+)/g)];
          return owners.length === 0 || owners.some((owner) => Number(owner[1]) === pid);
        });
      }
    } catch {}
    try {
      const res = spawnSync('netstat', ['-tlpn'], { encoding: 'utf8', timeout: 1000 });
      if (!res.error && res.status === 0) {
        return (res.stdout || '').split('\n').some((line) => {
          const fields = line.trim().split(/\s+/);
          return fields[3]?.endsWith(`:${port}`) && fields[5] === 'LISTEN' &&
            (fields[6] === '-' || fields[6]?.startsWith(`${pid}/`));
        });
      }
    } catch {}
    return true;
  } else {
    // macOS / BSD
    try {
      const res = spawnSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 1000 });
      if (res.error || res.status === null || (res.status !== 0 && res.status !== 1) || res.stderr?.trim()) return true;
      return res.status === 0 && (res.stdout || '').trim().length > 0;
    } catch {
      return true;
    }
  }
}

export function isProcessReallyActive(pid: number, port?: number): boolean {
  if (!processAlive(pid)) return false;
  if (!isProcessNode(pid)) return false;
  if (typeof port === 'number' && port > 0) {
    if (!isPortListening(pid, port)) return false;
  }
  return true;
}
