/**
 * GOAL-018（rm004-p18a）— work-stream 模型与 HANDOFF 工具。
 *
 * runtime/streams.jsonl 为 append-only 日志；每行一个流事件，重放即得当前状态。
 * 窗口键 = 犬×Goal；无 goal 时 key 的 goal 部分为 'none'。
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type StreamStatus = 'active' | 'closed' | 'handoff';

export interface HandoffBlock {
  done: string;
  decided: string;
  files: string;
  next: string;
  open_issues: string;
  raw: string;
  sha256: string;
  at_utc: string;
}

export interface StreamDispatchEvent {
  kind: 'dispatch';
  stream_id: string;
  dispatch_id: string;
  adapter_id: string;
  session_id: string | null;
  prompt_chars: number;
  output_chars: number;
  context_estimate: number;
  at_utc: string;
  /** 供 dsh 窗口内缝合/审计的最近文本侧写（截断，不替代原始回执）。 */
  prompt_preview?: string;
  output_preview?: string;
}

export interface WorkStream {
  stream_id: string;
  key: string;
  title: string;
  goal_id?: string;
  adapter_id: string;
  status: StreamStatus;
  created_at_utc: string;
  updated_at_utc: string;
  events: StreamDispatchEvent[];
  handoffs: HandoffBlock[];
}

export type StreamLogEntry =
  | { kind: 'stream_create'; stream_id: string; key: string; title: string; goal_id?: string; adapter_id: string; status: StreamStatus; created_at_utc: string }
  | { kind: 'dispatch'; stream_id: string; dispatch_id: string; adapter_id: string; session_id: string | null; prompt_chars: number; output_chars: number; context_estimate: number; at_utc: string; prompt_preview?: string; output_preview?: string }
  | { kind: 'handoff'; stream_id: string; handoff: HandoffBlock; at_utc: string }
  | { kind: 'status'; stream_id: string; status: StreamStatus; at_utc: string };

/** 估算系数：按 4 字符 ≈ 1 token 的粗略侧写（CJK/代码混合；仅用于换窗阈值，非计费）。 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;
/** dsh 无压缩档的窗口容量估算（token）。 */
export const WINDOW_MAX_TOKENS_ESTIMATE = 32000;
/** >75% 触发自动换窗。 */
export const WINDOW_SWITCH_THRESHOLD = 0.75;

export function streamKey(adapterId: string, goalId?: string): string {
  return `${adapterId}:${goalId ?? 'none'}`;
}

export function newStreamId(): string {
  return randomUUID().replace(/-/g, '');
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

export function streamContextTokens(stream: WorkStream): number {
  return stream.events.reduce((sum, event) => sum + event.context_estimate, 0);
}

export function shouldSwitchWindow(stream: WorkStream, contextManagement: string | undefined): boolean {
  if (contextManagement !== 'none') return false;
  return streamContextTokens(stream) > WINDOW_MAX_TOKENS_ESTIMATE * WINDOW_SWITCH_THRESHOLD;
}

export function loadStreams(streamsPath: string): WorkStream[] {
  const byId = new Map<string, WorkStream>();
  try {
    if (!existsSync(streamsPath)) return [];
    const lines = readFileSync(streamsPath, 'utf8').split('\n').filter((line) => line.trim() !== '');
    for (const line of lines) {
      const entry = JSON.parse(line) as StreamLogEntry;
      if (entry.kind === 'stream_create') {
        byId.set(entry.stream_id, {
          stream_id: entry.stream_id,
          key: entry.key,
          title: entry.title,
          ...(entry.goal_id !== undefined ? { goal_id: entry.goal_id } : {}),
          adapter_id: entry.adapter_id,
          status: entry.status,
          created_at_utc: entry.created_at_utc,
          updated_at_utc: entry.created_at_utc,
          events: [],
          handoffs: [],
        });
      } else if (entry.kind === 'dispatch') {
        const stream = byId.get(entry.stream_id);
        if (stream === undefined) continue;
        stream.events.push({
          kind: 'dispatch',
          stream_id: entry.stream_id,
          dispatch_id: entry.dispatch_id,
          adapter_id: entry.adapter_id,
          session_id: entry.session_id,
          prompt_chars: entry.prompt_chars,
          output_chars: entry.output_chars,
          context_estimate: entry.context_estimate,
          at_utc: entry.at_utc,
        });
        stream.updated_at_utc = entry.at_utc;
      } else if (entry.kind === 'handoff') {
        const stream = byId.get(entry.stream_id);
        if (stream === undefined) continue;
        stream.handoffs.push(entry.handoff);
        stream.updated_at_utc = entry.at_utc;
      } else if (entry.kind === 'status') {
        const stream = byId.get(entry.stream_id);
        if (stream === undefined) continue;
        stream.status = entry.status;
        stream.updated_at_utc = entry.at_utc;
      }
    }
  } catch {
    return [];
  }
  return [...byId.values()].sort((a, b) => a.created_at_utc.localeCompare(b.created_at_utc));
}

export function appendStreamLog(streamsPath: string, entry: StreamLogEntry): void {
  mkdirSync(path.dirname(path.resolve(streamsPath)), { recursive: true });
  appendFileSync(streamsPath, JSON.stringify(entry) + '\n', 'utf8');
}

export function createStream(
  streamsPath: string,
  opts: { key: string; title: string; goalId?: string; adapterId: string; now: () => Date },
): WorkStream {
  const streamId = newStreamId();
  const atUtc = opts.now().toISOString();
  const entry: StreamLogEntry = {
    kind: 'stream_create',
    stream_id: streamId,
    key: opts.key,
    title: opts.title,
    ...(opts.goalId !== undefined ? { goal_id: opts.goalId } : {}),
    adapter_id: opts.adapterId,
    status: 'active',
    created_at_utc: atUtc,
  };
  appendStreamLog(streamsPath, entry);
  return {
    stream_id: streamId,
    key: opts.key,
    title: opts.title,
    ...(opts.goalId !== undefined ? { goal_id: opts.goalId } : {}),
    adapter_id: opts.adapterId,
    status: 'active',
    created_at_utc: atUtc,
    updated_at_utc: atUtc,
    events: [],
    handoffs: [],
  };
}

export function addDispatchToStream(
  streamsPath: string,
  stream: WorkStream,
  event: Omit<StreamDispatchEvent, 'kind' | 'stream_id'>,
): void {
  const full: StreamDispatchEvent = { kind: 'dispatch', stream_id: stream.stream_id, ...event };
  stream.events.push(full);
  stream.updated_at_utc = full.at_utc;
  // GOAL-069：full 已含 kind/stream_id，不再重复指定。
  appendStreamLog(streamsPath, full);
}

export function addHandoffToStream(streamsPath: string, stream: WorkStream, handoff: HandoffBlock): void {
  stream.handoffs.push(handoff);
  stream.updated_at_utc = handoff.at_utc;
  appendStreamLog(streamsPath, { kind: 'handoff', stream_id: stream.stream_id, handoff, at_utc: handoff.at_utc });
}

export function setStreamStatus(streamsPath: string, stream: WorkStream, status: StreamStatus, atUtc: string): void {
  stream.status = status;
  stream.updated_at_utc = atUtc;
  appendStreamLog(streamsPath, { kind: 'status', stream_id: stream.stream_id, status, at_utc: atUtc });
}

/** 解析 HANDOFF-BEGIN…HANDOFF-END 块（五节宽松匹配）。 */
export function parseHandoffBlock(stdout: string, atUtc: string): HandoffBlock | null {
  const beginMarker = 'HANDOFF-BEGIN';
  const endMarker = 'HANDOFF-END';
  const begin = stdout.indexOf(beginMarker);
  const end = stdout.indexOf(endMarker);
  if (begin < 0 || end < begin) return null;
  const raw = stdout.slice(begin, end + endMarker.length);
  const section = (label: string): string => {
    const regex = new RegExp(`${label}\\s*[:：]\\s*([^\\n]*(?:\\n(?!\\s*(?:做了什么|定了什么|文件在哪|下一步|未解问题|HANDOFF-END)\\s*[:：]?)[^\\n]*)*)`, 'i');
    const match = regex.exec(raw);
    return match === null ? '' : match[1].trim();
  };
  const block: HandoffBlock = {
    done: section('做了什么'),
    decided: section('定了什么'),
    files: section('文件在哪'),
    next: section('下一步'),
    open_issues: section('未解问题'),
    raw,
    sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
    at_utc: atUtc,
  };
  return block;
}

/** dsh 缝合结构常量（U3）：固定章程头 + 追加式流历史 + 新指令尾。 */
export const DSH_STITCH_HEAD = '【mush 流内 dsh 窗口】\n';
export const DSH_STITCH_HISTORY = '\n[流历史]\n';
export const DSH_STITCH_TAIL = '\n[新指令]\n';

/** dsh 窗口内缝合用的固定章程（足够长，保证同流两次 prompt 前缀稳定）。 */
export const DSH_CHARTER_FIXED = [
  '你是 mush 的 dsh 执行犬。',
  '请严格遵循任务要求，输出简洁、可机检、可执行的结果。',
  '所有关键产物必须落盘并给出路径；不要臆造未发生的事实。',
  '如触发宪法五门（花钱超阈值、外部影响、永久删除、范围扩张、身份/密钥变更），立即停下等 owner 决定。',
  '本窗口为 mush work-stream 的 dsh 无压缩通道；上下文由 mush 侧估算并决定换窗。',
  '同流历史以追加方式提供，供你延续前序工作；新指令在文末，请优先处理。',
  '输出中如出现 HANDOFF-BEGIN 块，请严格按五节填写，供下一个窗口/犬只接续。',
  '不要重复输出本段固定章程；直接开始处理任务。',
].join('\n');

export function buildDshStitchedPrompt(charter: string, history: string, instruction: string): string {
  return DSH_STITCH_HEAD + charter + DSH_STITCH_HISTORY + history + DSH_STITCH_TAIL + instruction;
}

/** D82 修订：剥离旧版快照里叠加的组装层（dsh 章程缝合 + 项目简报前缀）。
 *  背景：此前 request.prompt 存的是组装后 prompt，重跑/预填会把"已包一层的"
 *  再包一层（章程×2、AGENTS×2 滚雪球，RM-011 演练实证）。本函数只认精确
 *  标记、不做猜测：章程层取最后一个 [新指令] 之后的内容；简报层仅当开头与
 *  当前工作区 AGENTS.md 实文完全一致时剥除。循环处理任意叠层数。 */
export function stripAssembledLayers(prompt: string, projectBrief: string): string {
  let out = prompt;
  for (;;) {
    if (projectBrief !== '' && out.startsWith('[项目层 AGENTS.md]\n')) {
      const block = '[项目层 AGENTS.md]\n' + projectBrief + '\n\n';
      if (out.startsWith(block)) {
        out = out.slice(block.length);
        continue;
      }
    }
    if (out.startsWith(DSH_STITCH_HEAD)) {
      const tailIdx = out.lastIndexOf(DSH_STITCH_TAIL);
      if (tailIdx >= 0) {
        out = out.slice(tailIdx + DSH_STITCH_TAIL.length);
        continue;
      }
    }
    break;
  }
  return out;
}

/** 项目层简报：读取工作区 AGENTS.md，超长截断（4000 字符，附截断标记）。 */
export function readProjectBrief(workspaceRoot: string, maxChars = 4000): string {
  const file = path.join(workspaceRoot, 'AGENTS.md');
  try {
    if (!existsSync(file)) return '';
    const text = readFileSync(file, 'utf8');
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n\n[AGENTS.md 超长截断]';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// GOAL-033（GP-31）：会话工作流生命周期控制面与结构化交接编辑器
// ---------------------------------------------------------------------------

export type WorkstreamStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'MERGED';

export interface StructuredHandoff {
  decisions_made: string[];
  files_touched: string[];
  next_actions: string[];
  handoff_markdown: string;
  updated_at_utc: string;
}

export interface WorkstreamRecord {
  stream_id: string;
  title: string;
  description: string;
  status: WorkstreamStatus;
  parent_stream_id: string | null;
  created_at_utc: string;
  updated_at_utc: string;
  handoff_block: StructuredHandoff | null;
}

export class WorkstreamStore {
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = path.resolve(storagePath);
  }

  private loadAll(): Map<string, WorkstreamRecord> {
    const map = new Map<string, WorkstreamRecord>();
    if (!existsSync(this.storagePath)) return map;

    try {
      const content = readFileSync(this.storagePath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim() !== '');
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as WorkstreamRecord;
          if (rec && typeof rec.stream_id === 'string') {
            map.set(rec.stream_id, rec);
          }
        } catch {
          // 忽略单行损坏，保证 fail-open
        }
      }
    } catch {
      // 忽略读取异常
    }
    return map;
  }

  private append(record: WorkstreamRecord): void {
    mkdirSync(path.dirname(this.storagePath), { recursive: true });
    appendFileSync(this.storagePath, JSON.stringify(record) + '\n', 'utf8');
  }

  list(): WorkstreamRecord[] {
    const map = this.loadAll();
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.updated_at_utc).getTime() - new Date(a.updated_at_utc).getTime(),
    );
  }

  get(streamId: string): WorkstreamRecord | null {
    const map = this.loadAll();
    return map.get(streamId) ?? null;
  }

  create(options: {
    title: string;
    description?: string;
    parent_stream_id?: string;
    handoff_block?: StructuredHandoff;
  }): WorkstreamRecord {
    const title = (options.title || '').trim();
    if (!title) throw new Error('title must be non-empty');

    const now = new Date().toISOString();
    const record: WorkstreamRecord = {
      stream_id: randomUUID().replace(/-/g, '').slice(0, 16),
      title,
      description: (options.description || '').trim(),
      status: 'ACTIVE',
      parent_stream_id: options.parent_stream_id ?? null,
      created_at_utc: now,
      updated_at_utc: now,
      handoff_block: options.handoff_block ?? null,
    };

    this.append(record);
    return record;
  }

  update(
    streamId: string,
    updates: {
      title?: string;
      description?: string;
      status?: WorkstreamStatus;
      handoff_block?: Partial<StructuredHandoff>;
    },
  ): WorkstreamRecord {
    const existing = this.get(streamId);
    if (!existing) throw new Error(`workstream not found: ${streamId}`);

    const now = new Date().toISOString();
    const updated: WorkstreamRecord = {
      ...existing,
      title: updates.title !== undefined ? updates.title.trim() : existing.title,
      description: updates.description !== undefined ? updates.description.trim() : existing.description,
      status: updates.status ?? existing.status,
      updated_at_utc: now,
      handoff_block:
        updates.handoff_block !== undefined
          ? {
              decisions_made: updates.handoff_block.decisions_made ?? existing.handoff_block?.decisions_made ?? [],
              files_touched: updates.handoff_block.files_touched ?? existing.handoff_block?.files_touched ?? [],
              next_actions: updates.handoff_block.next_actions ?? existing.handoff_block?.next_actions ?? [],
              handoff_markdown:
                updates.handoff_block.handoff_markdown ?? existing.handoff_block?.handoff_markdown ?? '',
              updated_at_utc: now,
            }
          : existing.handoff_block,
    };

    this.append(updated);
    return updated;
  }

  fork(
    parentStreamId: string,
    options: {
      title: string;
      description?: string;
    },
  ): WorkstreamRecord {
    const parent = this.get(parentStreamId);
    if (!parent) throw new Error(`parent workstream not found: ${parentStreamId}`);

    // 继承父流的 handoff_block 作为初始交接上下文
    const inheritedHandoff: StructuredHandoff | undefined = parent.handoff_block
      ? {
          ...parent.handoff_block,
          updated_at_utc: new Date().toISOString(),
        }
      : undefined;

    return this.create({
      title: options.title,
      description: options.description ?? `Forked from stream ${parent.title} (${parentStreamId})`,
      parent_stream_id: parentStreamId,
      handoff_block: inheritedHandoff,
    });
  }
}

