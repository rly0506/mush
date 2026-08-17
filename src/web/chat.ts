/**
 * mush 聊天服务（GOAL-011）— 头犬对话：POST /api/chat → 任意 verified harness，
 * 会话续跑（resume_session）；对话持久化 runtime/chat/<session>.jsonl。
 *
 * GOAL-017A U2：头犬即角色——role 与 harness 解耦；任何 roster 在册且 verified
 * 的 harness 都可任头犬；head-dog 继续可用（deepseek 别名）。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DispatchPipeline } from './dispatch.ts';
import { HEAD_DOG_CHARTER } from '../adapters/head-dog.ts';

export interface ChatTurn {
  role: 'user' | 'head';
  text: string;
  at_utc: string;
  dispatch_id?: string;
}

/** GOAL-021 U1：POST /api/chat 202 即返 ack（不再同步等待回复）。 */
export interface ChatAck {
  session_id: string;
  role: 'head';
  dispatch_id: string;
  status: 'PENDING';
  /** 提示已受理，回复将经 GET /api/stream 的 chat 帧流式到达。 */
  note: string;
}

/** GOAL-021 U2：chat 阶段帧（进 /api/stream，kind='chat'）。
 *  阶段序：ADMITTED → EXECUTE(增量) → HEARTBEAT(耗时) → REPORT(含回复全文)。 */
export interface ChatStreamEvent {
  kind: 'chat';
  phase: 'ADMITTED' | 'EXECUTE' | 'HEARTBEAT' | 'REPORT';
  session_id: string;
  dispatch_id: string;
  at_utc: string;
  payload: Record<string, unknown>;
}

export class ChatService {
  private readonly pipeline: DispatchPipeline;
  private readonly runtimeRoot: string;
  private onEvent: (event: ChatStreamEvent) => void;
  /** GOAL-021 U1：在途后台执行（dispatch_id → Promise）。测试/对账可 await。 */
  private readonly pending = new Map<string, Promise<void>>();

  constructor(opts: { pipeline: DispatchPipeline; runtimeRoot: string; onEvent?: (event: ChatStreamEvent) => void }) {
    this.pipeline = opts.pipeline;
    this.runtimeRoot = path.resolve(opts.runtimeRoot);
    this.onEvent = opts.onEvent ?? (() => {});
  }

  /** GOAL-021 U1：等待指定派发后台执行结束（对账/测试用；无在途则立即 resolve）。 */
  whenSettled(dispatchId: string): Promise<void> {
    return this.pending.get(dispatchId) ?? Promise.resolve();
  }

  private emit(phase: ChatStreamEvent['phase'], sessionId: string, dispatchId: string, payload: Record<string, unknown>): void {
    this.onEvent({
      kind: 'chat',
      phase,
      session_id: sessionId,
      dispatch_id: dispatchId,
      at_utc: new Date().toISOString(),
      payload,
    });
  }

  private chatDir(): string {
    return path.join(this.runtimeRoot, 'chat');
  }

  private append(sessionId: string, turn: ChatTurn): void {
    mkdirSync(this.chatDir(), { recursive: true });
    appendFileSync(path.join(this.chatDir(), `${sessionId}.jsonl`), JSON.stringify(turn) + '\n', 'utf8');
  }

  /** GOAL-017A U2：头犬候选 = roster 在册且 verified 的 harness；codex 明确拒绝。 */
  private resolveHeadAdapter(adapterId: string): { adapterId: string; effortLevels: string[] } {
    const entry = this.pipeline.roster().find((item) => item.adapter_id === adapterId);
    if (entry === undefined) {
      throw new Error(`adapter_id must be a verified harness in roster (got: ${adapterId})`);
    }
    if (entry.verified !== true) {
      if (adapterId === 'codex') {
        throw new Error('codex is UNVERIFIED (F-50) and cannot be head-dog');
      }
      throw new Error(`adapter_id must be a verified harness in roster (got: ${adapterId}; verified=false)`);
    }
    const effortLevels = (entry.effort_levels ?? ['LOW', 'HIGH', 'XHIGH']).map((level) => level.toUpperCase());
    return { adapterId, effortLevels };
  }

  /** GOAL-021 U1：异步受理——校验通过即 202 返 ack（dispatch_id/session_id），
   *  真实派发在后台执行；回复经 onEvent（SSE chat 帧）流式推送，落盘照旧。
   *  校验错误（空消息/未知/未验证 adapter/非法 effort）仍同步抛（HTTP 400）。 */
  async post(input: { message: string; resume?: string; adapter_id?: string; effort?: string }): Promise<ChatAck> {
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
    const sessionId = input.resume && input.resume.trim() !== '' ? input.resume.trim() : randomUUID().replace(/-/g, '');
    const dispatchId = randomUUID().replace(/-/g, '');
    this.append(sessionId, { role: 'user', text: message, at_utc: new Date().toISOString() });

    // 后台执行：ADMITTED → EXECUTE(增量) → HEARTBEAT → REPORT。
    const run = this.execute(adapterId, effort, sessionId, dispatchId, message);
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
  ): Promise<void> {
    const startedAt = Date.now();
    this.emit('ADMITTED', sessionId, dispatchId, { status: 'ADMITTED' });
    // F-48 修复：dsh headless 无 --resume——多轮上下文改为 prompt 缝合。
    const prior = (await this.history(sessionId, 12)).turns.filter((t) => t.text && !t.text.startsWith('[dry-run'));
    const transcript = prior.length > 1
      ? '\n\n[对话历史（最近，供上下文）]\n' + prior.slice(0, -1).map((t) => (t.role === 'user' ? 'Owner: ' : '头犬: ') + t.text).join('\n') + '\n'
      : '';
    // 累加增量文本作为回复全文（REPORT 用）；若通道未给增量，回退 stdout_tail。
    let replyAccum = '';
    try {
      const record = await this.pipeline.dispatch({
        adapter_id: adapterId,
        prompt: HEAD_DOG_CHARTER + transcript + '\n\nOwner: ' + message,
        effort,
        real: true, // 聊天即真实执行；GP-32/D30：owner 亲自敲字即批准（originOwner）
        timeout_s: 300,
      }, {
        originOwner: true,
        dispatchId,
        onStdout: (chunk) => {
          replyAccum += chunk;
          // 心跳（耗时）随增量帧同出：前端实时看生成进度 + 已耗时。
          this.emit('HEARTBEAT', sessionId, dispatchId, { elapsed_ms: Date.now() - startedAt });
          this.emit('EXECUTE', sessionId, dispatchId, { stream_text: chunk });
        },
      });
      const headText = replyAccum !== '' ? replyAccum : record.stdout_tail?.text ?? `[dry-run ${record.status}]`;
      this.append(sessionId, {
        role: 'head',
        text: headText,
        at_utc: new Date().toISOString(),
        dispatch_id: record.dispatch_id,
      });
      this.emit('REPORT', sessionId, dispatchId, {
        status: record.status,
        elapsed_ms: Date.now() - startedAt,
        reply: headText,
      });
    } catch (error) {
      const text = `[error] 头犬回复失败：${error instanceof Error ? error.message : String(error)}`;
      this.append(sessionId, { role: 'head', text, at_utc: new Date().toISOString(), dispatch_id: dispatchId });
      this.emit('REPORT', sessionId, dispatchId, {
        status: 'FAIL',
        elapsed_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        reply: text,
      });
    }
  }

  async history(sessionId: string, limit = 50): Promise<{ turns: ChatTurn[] }> {
    const file = path.join(this.chatDir(), `${sessionId}.jsonl`);
    if (!existsSync(file)) return { turns: [] };
    const turns = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as ChatTurn);
    return { turns: turns.slice(-Math.max(1, Math.floor(limit))) };
  }
}
