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

export interface ChatPostResult {
  session_id: string;
  role: 'head';
  dispatch_id: string;
  status: string;
  /** GOAL-012B / D3：头犬回复文本（同步返回，前端直渲气泡）。 */
  reply: string;
}

export class ChatService {
  private readonly pipeline: DispatchPipeline;
  private readonly runtimeRoot: string;

  constructor(opts: { pipeline: DispatchPipeline; runtimeRoot: string }) {
    this.pipeline = opts.pipeline;
    this.runtimeRoot = path.resolve(opts.runtimeRoot);
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

  async post(input: { message: string; resume?: string; adapter_id?: string; effort?: string }): Promise<ChatPostResult> {
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
    this.append(sessionId, { role: 'user', text: message, at_utc: new Date().toISOString() });

    // F-48 修复：dsh headless 无 --resume——多轮上下文改为 prompt 缝合
    // （近 N 轮对话织入，任何通道可用）；恢复通道支持后可切回 resume_session。
    const prior = (await this.history(sessionId, 12)).turns.filter((t) => t.text && !t.text.startsWith('[dry-run'));
    const transcript = prior.length > 1
      ? '\n\n[对话历史（最近，供上下文）]\n' + prior.slice(0, -1).map((t) => (t.role === 'user' ? 'Owner: ' : '头犬: ') + t.text).join('\n') + '\n'
      : '';
    const record = await this.pipeline.dispatch({
      adapter_id: adapterId,
      prompt: HEAD_DOG_CHARTER + transcript + '\n\nOwner: ' + message,
      effort,
      real: true, // 聊天即真实执行；GP-32/D30：owner 亲自敲字即批准（originOwner
      // 内部通道，公开 /api/dispatch 不接受该语义——代理发起仍停审批卡）
      timeout_s: 300,
    }, { originOwner: true });
    const headText = record.stdout_tail?.text ?? `[dry-run ${record.status}]`;
    this.append(sessionId, {
      role: 'head',
      text: headText,
      at_utc: new Date().toISOString(),
      dispatch_id: record.dispatch_id,
    });
    // GOAL-012B / D3：同步语义——响应体携 reply，前端无需等 SSE 回填。
    return { session_id: sessionId, role: 'head', dispatch_id: record.dispatch_id, status: record.status, reply: headText };
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
