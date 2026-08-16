/**
 * mush 聊天服务（GOAL-011）— 头犬对话：POST /api/chat → head-dog dispatch，
 * 会话续跑（resume_session）；对话持久化 runtime/chat/<session>.jsonl。
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

  async post(input: { message: string; resume?: string }): Promise<ChatPostResult> {
    const message = String(input.message ?? '').trim();
    if (message === '') throw new Error('message must be non-blank');
    const sessionId = input.resume && input.resume.trim() !== '' ? input.resume.trim() : randomUUID().replace(/-/g, '');
    this.append(sessionId, { role: 'user', text: message, at_utc: new Date().toISOString() });

    const record = await this.pipeline.dispatch({
      adapter_id: 'head-dog',
      prompt: HEAD_DOG_CHARTER + '\n\nOwner: ' + message,
      resume_session: sessionId,
      effort: 'HIGH',
    });
    const headText = record.stdout_tail?.text ?? `[dry-run ${record.status}]`;
    this.append(sessionId, {
      role: 'head',
      text: headText,
      at_utc: new Date().toISOString(),
      dispatch_id: record.dispatch_id,
    });
    return { session_id: sessionId, role: 'head', dispatch_id: record.dispatch_id, status: record.status };
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
