/**
 * GOAL-061: 子级工犬会话持久化与智能 Auto-Resume 注册表
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ChildSession {
  session_id: string;
  dog: string;
  workspace: string;
  goal_id?: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  total_tokens: number;
  last_receipt_id?: string;
}

export class ChildSessionRegistry {
  private sessions = new Map<string, ChildSession>();
  private storePath: string;

  constructor(storePath: string = path.resolve('runtime/child-sessions.jsonl')) {
    this.storePath = storePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const lines = readFileSync(this.storePath, 'utf8').split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
        try {
          const sess = JSON.parse(line) as ChildSession;
          if (sess && sess.session_id) {
            this.sessions.set(sess.session_id, sess);
          }
        } catch { /* skip corrupted lines */ }
      }
    } catch { /* fail-open */ }
  }

  public getOrCreate(dog: string, workspace: string, goal_id?: string): ChildSession {
    // 查找同一工作区 + 同一犬种 + 同一 Goal 的现有活跃 Session
    for (const sess of this.sessions.values()) {
      if (sess.dog === dog && sess.workspace === workspace && (!goal_id || sess.goal_id === goal_id)) {
        return sess;
      }
    }

    // 创建全新 Session
    const newSession: ChildSession = {
      session_id: `csess_${dog.replace(/[^a-z0-9]/gi, '_')}_${randomUUID().slice(0, 8)}`,
      dog,
      workspace,
      goal_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      turn_count: 0,
      total_tokens: 0,
    };

    this.sessions.set(newSession.session_id, newSession);
    this.save(newSession);
    return newSession;
  }

  public recordTurn(session_id: string, tokens: number = 0, receipt_id?: string): ChildSession | null {
    const sess = this.sessions.get(session_id);
    if (!sess) return null;

    sess.turn_count += 1;
    sess.total_tokens += tokens;
    sess.updated_at = new Date().toISOString();
    if (receipt_id) sess.last_receipt_id = receipt_id;

    this.save(sess);
    return sess;
  }

  public get(session_id: string): ChildSession | undefined {
    return this.sessions.get(session_id);
  }

  public list(workspace?: string): ChildSession[] {
    const list = [...this.sessions.values()];
    if (workspace) return list.filter(s => s.workspace === workspace);
    return list;
  }

  private save(session: ChildSession): void {
    try {
      mkdirSync(path.dirname(path.resolve(this.storePath)), { recursive: true });
      appendFileSync(this.storePath, JSON.stringify(session) + '\n', 'utf8');
    } catch { /* fail-open */ }
  }
}

export const globalChildSessionRegistry = new ChildSessionRegistry();
