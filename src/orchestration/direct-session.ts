/**
 * GOAL-037: 犬只直连会话管理器 (Dog Direct Session Manager)
 */

import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface DirectMessage {
  message_id: string;
  sender: 'human' | 'dog' | 'system';
  content: string;
  at_utc: string;
  metadata?: Record<string, unknown>;
}

export interface DirectSessionRecord {
  session_id: string;
  adapter_id: string;
  model_id?: string;
  status: 'ACTIVE' | 'IDLE' | 'CLOSED';
  messages: DirectMessage[];
  created_at_utc: string;
  last_active_at_utc: string;
}

export class DirectSessionManager {
  private runtimeRoot: string;
  private logPath: string;
  private sessions: Map<string, DirectSessionRecord> = new Map();

  constructor(runtimeRoot: string) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.logPath = path.join(this.runtimeRoot, 'direct-sessions.jsonl');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.logPath)) return;
    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as DirectSessionRecord;
          this.sessions.set(record.session_id, record);
        } catch {}
      }
    } catch {}
  }

  private persistSession(session: DirectSessionRecord): void {
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    // 重写/更新单会话镜像并追加
    fs.appendFileSync(this.logPath, JSON.stringify(session) + '\n', 'utf-8');
  }

  /** 创建新直连会话 */
  public createSession(adapterId: string, modelId?: string): DirectSessionRecord {
    const sessionId = `dsess-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const session: DirectSessionRecord = {
      session_id: sessionId,
      adapter_id: adapterId,
      model_id: modelId,
      status: 'ACTIVE',
      messages: [],
      created_at_utc: now,
      last_active_at_utc: now,
    };
    this.sessions.set(sessionId, session);
    this.persistSession(session);
    return session;
  }

  /** 发送消息 */
  public postMessage(sessionId: string, sender: 'human' | 'dog' | 'system', content: string): DirectMessage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Direct session not found: ${sessionId}`);
    }
    const now = new Date().toISOString();
    const msg: DirectMessage = {
      message_id: `dmsg-${Date.now()}-${randomUUID().slice(0, 6)}`,
      sender,
      content,
      at_utc: now,
    };
    session.messages.push(msg);
    session.last_active_at_utc = now;
    session.status = 'ACTIVE';
    this.persistSession(session);
    return msg;
  }

  /** 续接会话 */
  public resumeSession(sessionId: string): DirectSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Direct session not found: ${sessionId}`);
    }
    session.status = 'ACTIVE';
    session.last_active_at_utc = new Date().toISOString();
    this.persistSession(session);
    return session;
  }

  /** 获取单个会话 */
  public getSession(sessionId: string): DirectSessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** 列出指定犬或全部犬的直连会话 */
  public listSessions(adapterId?: string): DirectSessionRecord[] {
    const list = Array.from(this.sessions.values());
    if (adapterId) {
      return list.filter((s) => s.adapter_id === adapterId);
    }
    return list;
  }

  /** 读取犬只 transcript 日志 */
  public getTranscript(adapterId: string, limit = 50): DirectMessage[] {
    const sessions = this.listSessions(adapterId);
    const msgs: DirectMessage[] = [];
    for (const s of sessions) {
      msgs.push(...s.messages);
    }
    msgs.sort((a, b) => new Date(a.at_utc).getTime() - new Date(b.at_utc).getTime());
    return msgs.slice(-limit);
  }
}
