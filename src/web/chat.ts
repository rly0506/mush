/**
 * mush 看板会话流式服务（GOAL-021）
 *
 * 核心职责：
 *  1. 接收前端消息（POST /api/chat），立即返回 202 异步受理 {dispatch_id, session_id}；
 *  2. 驱动头犬执行，并经 EventEmitter 产生会话阶段事件（ADMITTED, EXECUTE, HEARTBEAT, REPORT）；
 *  3. 会话记录以 JSONL 格式持久化在 runtime/chat/<session_id>.jsonl；
 *  4. 支持历史回溯（GET /api/chat/history?session=<id>）。
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { DispatchPipeline } from './dispatch.ts';
import { saveAttachment, type AttachmentInput, type StoredAttachment } from './attachments.ts';

export interface ChatTurn {
  role: 'user' | 'head';
  text: string;
  at_utc: string;
  dispatch_id?: string;
  attachments?: StoredAttachment[];
}

export interface ChatAck {
  session_id: string;
  role: 'head';
  dispatch_id: string;
  status: 'PENDING';
  note: string;
}

export interface ChatFrameEvent {
  kind: 'chat';
  session_id: string;
  dispatch_id: string;
  phase: 'ADMITTED' | 'EXECUTE' | 'HEARTBEAT' | 'REPORT';
  payload: Record<string, unknown>;
}

export const HEAD_DOG_CHARTER = `[系统角色设定]
你处于 mush 多 Agent 编排体系中的【头犬（Head Dog）】角色。
你的常设职责是：
  1. 需求澄清与方案架构：与人类 Owner 对话，拆解任务，输出清晰的实施规格；
  2. 队列与犬只编排：向工犬派发具体任务（通过派发机制），组织流水线或攻防协作；
  3. 安全与质量把关：严格执行单机安全红线，审查工犬回执，给出明确的验收裁决。
请用专业、精炼、清晰的中文回复人类 Owner。`;

export const SOLO_HEAD_DOG_CHARTER = `[系统角色设定：独奏直聊模式（Solo Direct Mode）]
你与人类 Owner 处于 1 对 1 沉浸式直聊模式。
在此模式下：
  1. 你全权负责当前需求的一切思考、方案规划、代码生成与答疑；
  2. 严禁向外部工犬派发子任务或转交第三方 Agent；
  3. 请直接输出完整、详尽、高质量的解决方案和代码实现。`;


export class ChatService extends EventEmitter {
  private readonly runtimeRoot: string;
  private readonly pipeline: DispatchPipeline;
  private readonly onEvent?: (event: ChatFrameEvent) => void;
  private readonly pending = new Map<string, Promise<void>>();

  constructor(options: { runtimeRoot: string; pipeline: DispatchPipeline; onEvent?: (event: ChatFrameEvent) => void }) {
    super();
    this.runtimeRoot = options.runtimeRoot;
    this.pipeline = options.pipeline;
    this.onEvent = options.onEvent;
  }

  private chatDir(): string {
    const dir = path.join(this.runtimeRoot, 'chat');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private append(sessionId: string, turn: ChatTurn): void {
    const s = sessionId.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
      throw new Error('invalid session_id format (must match ^[A-Za-z0-9_-]{1,64}$)');
    }
    const file = path.join(this.chatDir(), `${s}.jsonl`);
    appendFileSync(file, JSON.stringify(turn) + '\n', 'utf8');
  }

  private emitFrame(
    phase: 'ADMITTED' | 'EXECUTE' | 'HEARTBEAT' | 'REPORT',
    sessionId: string,
    dispatchId: string,
    payload: Record<string, unknown>,
  ): void {
    const frame: ChatFrameEvent = {
      kind: 'chat',
      session_id: sessionId,
      dispatch_id: dispatchId,
      phase,
      payload,
    };
    this.emit(phase, frame);
    this.emit('frame', frame);
    if (this.onEvent) {
      try {
        this.onEvent(frame);
      } catch (err) {
        console.warn('[chat] onEvent callback error:', err);
      }
    }
  }

  /** 解析头犬适配器与档位（缺省 head-dog / HIGH；支持已验证执行犬）。 */
  private resolveHeadAdapter(adapterId: string): { adapterId: string; effortLevels: string[] } {
    const target = adapterId.trim() !== '' ? adapterId.trim() : 'head-dog';
    let adapters: any[] = [];
    if (typeof (this.pipeline as any).listAdapters === 'function') {
      adapters = (this.pipeline as any).listAdapters();
    } else if (typeof (this.pipeline as any).roster === 'function') {
      adapters = (this.pipeline as any).roster();
    }
    const found = adapters.find((a) => a.adapter_id === target);
    if (!found) {
      throw new Error(`adapter ${target} is UNVERIFIED or unknown, only verified adapters can serve as head-dog`);
    }
    if (found.role !== 'head' && !found.verified) {
      throw new Error(`adapter ${target} is UNVERIFIED and cannot serve as head-dog`);
    }
    const effortLevels = (found.effort_levels ?? ['LOW', 'MEDIUM', 'HIGH']).map((l: string) => l.toUpperCase());
    return { adapterId: target, effortLevels };
  }

  /**
   * POST /api/chat 入口（GOAL-021 U1）：
   *  立即返回 202 异步受理回执；后台异步执行并通过 SSE chat 帧流式推送；
   *  校验错误（空消息/未知/未验证 adapter/非法 effort）仍同步抛（HTTP 400）。
   */
  async post(input: { message: string; resume?: string; adapter_id?: string; effort?: string; attachments?: AttachmentInput[]; solo?: boolean }): Promise<ChatAck> {
    const message = String(input.message ?? '').trim();
    if (message === '') throw new Error('message must be non-blank');
    const requestedAdapter =
      input.adapter_id !== undefined && input.adapter_id.trim() !== '' ? input.adapter_id.trim() : 'head-dog';
    const { adapterId, effortLevels } = this.resolveHeadAdapter(requestedAdapter);
    const defaultEffort = effortLevels.includes('HIGH') ? 'HIGH' : effortLevels.includes('LOW') ? 'LOW' : effortLevels[0];
    const effort = input.effort !== undefined && input.effort.trim() !== '' ? input.effort.trim().toUpperCase() : defaultEffort;
    if (!effortLevels.includes(effort)) {
      throw new Error(`effort must be one of ${effortLevels.join('|')} (got: ${input.effort})`);
    }
    let sessionId: string;
    if (input.resume && input.resume.trim() !== '') {
      const r = input.resume.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(r)) {
        throw new Error('invalid resume session_id format (must match ^[A-Za-z0-9_-]{1,64}$)');
      }
      sessionId = r;
    } else {
      sessionId = randomUUID().replace(/-/g, '');
    }
    const dispatchId = randomUUID().replace(/-/g, '');
    let storedAttachments: StoredAttachment[] = [];
    if (Array.isArray(input.attachments) && input.attachments.length > 0) {
      storedAttachments = input.attachments.map((att) => saveAttachment(this.runtimeRoot, att));
    }
    this.append(sessionId, {
      role: 'user',
      text: message,
      at_utc: new Date().toISOString(),
      attachments: storedAttachments.length > 0 ? storedAttachments : undefined,
    });

    // 后台执行：ADMITTED → EXECUTE(增量) → HEARTBEAT → REPORT。
    const run = this.execute(adapterId, effort, sessionId, dispatchId, message, storedAttachments, input.solo === true);
    this.pending.set(dispatchId, run);
    void run.finally(() => this.pending.delete(dispatchId));

    return {
      session_id: sessionId,
      role: 'head',
      dispatch_id: dispatchId,
      status: 'PENDING',
      note: 'accepted; reply streams over GET /api/stream (kind=chat)',
    };
  }

  /** GOAL-021 U1/U2/U3：真实派发后台执行 + chat 帧推送 + 回复落盘。 */
  private async execute(
    adapterId: string,
    effort: string,
    sessionId: string,
    dispatchId: string,
    message: string,
    attachments: StoredAttachment[] = [],
    solo: boolean = false,
  ): Promise<void> {
    const startedAt = Date.now();
    this.emitFrame('ADMITTED', sessionId, dispatchId, { status: 'ADMITTED' });
    // F-48 修复：dsh headless 无 --resume——多轮上下文改为 prompt 缝合。
    const prior = (await this.history(sessionId, 12)).turns.filter((t) => t.text && !t.text.startsWith('[dry-run'));
    const transcript = prior.length > 1
      ? '\n\n[对话历史（最近，供上下文）]\n' + prior.slice(0, -1).map((t) => (t.role === 'user' ? 'Owner: ' : '头犬: ') + t.text).join('\n') + '\n'
      : '';
    // 累加增量文本作为回复全文（REPORT 用）；若通道未给增量，回退 stdout_tail。
    let replyAccum = '';
    const activeCharter = solo ? SOLO_HEAD_DOG_CHARTER : HEAD_DOG_CHARTER;
    try {
      const record = await this.pipeline.dispatch({
        adapter_id: adapterId,
        prompt: activeCharter + transcript + (attachments.length > 0 ? '\n\n[附加本地图片/多模态视觉文件]:\n' + attachments.map((a, i) => `  ${i + 1}. ${a.name} -> ${a.localPath}`).join('\n') : '') + '\n\nOwner: ' + message,
        effort,
        real: true, // 聊天即真实执行；GP-32/D30：owner 亲自敲字即批准（originOwner）
        timeout_s: 300,
      }, {
        originOwner: true,
        dispatchId,
        onStdout: (chunk) => {
          replyAccum += chunk;
          // 心跳（耗时）随增量帧同出：前端实时看生成进度 + 已耗时。
          this.emitFrame('HEARTBEAT', sessionId, dispatchId, { elapsed_ms: Date.now() - startedAt });
          this.emitFrame('EXECUTE', sessionId, dispatchId, { stream_text: chunk });
        },
      });
      const headText = replyAccum !== '' ? replyAccum : record.stdout_tail?.text ?? `[dry-run ${record.status}]`;
      this.append(sessionId, {
        role: 'head',
        text: headText,
        at_utc: new Date().toISOString(),
        dispatch_id: record.dispatch_id,
      });
      this.emitFrame('REPORT', sessionId, dispatchId, {
        status: record.status,
        elapsed_ms: Date.now() - startedAt,
        reply: headText,
      });
    } catch (error) {
      const text = `[error] 头犬回复失败：${error instanceof Error ? error.message : String(error)}`;
      this.append(sessionId, { role: 'head', text, at_utc: new Date().toISOString(), dispatch_id: dispatchId });
      this.emitFrame('REPORT', sessionId, dispatchId, {
        status: 'FAIL',
        elapsed_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        reply: text,
      });
    }
  }

  async whenSettled(dispatchId?: string): Promise<void> {
    if (dispatchId !== undefined) {
      await (this.pending.get(dispatchId) ?? Promise.resolve());
      return;
    }
    await Promise.all(Array.from(this.pending.values()));
  }

  async history(sessionId: string, limit = 50): Promise<{ turns: ChatTurn[] }> {
    const s = String(sessionId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
      throw new Error('invalid session_id format (must match ^[A-Za-z0-9_-]{1,64}$)');
    }
    const file = path.join(this.chatDir(), `${s}.jsonl`);
    if (!existsSync(file)) return { turns: [] };
    const turns = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as ChatTurn);
    return { turns: turns.slice(-Math.max(1, Math.floor(limit))) };
  }
}
