/** Synthetic persisted three-seat history. Never calls the current creation/approval API. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { type CollaborationBlackboard, type CollabStatus, deriveReviewRelations } from '../../src/orchestration/collaboration-blackboard.ts';
import { collabSkillRegistrySha256 } from '../../src/orchestration/collaboration-skills.ts';

export function seedTripleHistory(board: CollaborationBlackboard, workspace: string, status: CollabStatus = 'completed'): string {
  if (!path.resolve(board.databasePath).startsWith(path.resolve('.test-fixtures') + path.sep)) {
    throw new Error('history fixture refuses a production database');
  }
  const id = randomUUID(), at = '2026-10-01T00:00:00.000Z';
  const snapshot = {
    topic: '历史三席位夹具', workspace_root: workspace,
    participants: (['A', 'B', 'C'] as const).map(seat => ({ seat, adapter_id: 'fixture', model_id: 'fixture-model', ...(seat === 'A' ? { is_coordinator: true } : {}) })),
    materials: [], isolation_required: true, capability_evidence: [],
    review_relations: deriveReviewRelations(['A', 'B', 'C']),
    skill_registry_sha256: collabSkillRegistrySha256(3),
    call_limit: 13, retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 40,
  };
  const json = JSON.stringify(snapshot), hash = createHash('sha256').update(json).digest('hex');
  const db = new DatabaseSync(board.databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO sessions (id,topic,workspace_root,status,phase,call_count,retry_count,call_limit,retry_limit,authorization_hash,session_timeout_min,created_at_utc) VALUES (?,?,?,?,?,0,0,13,1,?,40,?)')
      .run(id, snapshot.topic, workspace, status, 'revision', hash, at);
    for (const p of snapshot.participants) {
      db.prepare('INSERT INTO participants (session_id,seat,adapter_id,model_id,is_coordinator,run_instance) VALUES (?,?,?,?,?,?)')
        .run(id, p.seat, p.adapter_id, p.model_id, p.seat === 'A' ? 1 : 0, 'history-' + p.seat);
      db.prepare('INSERT INTO viewpoints (id,session_id,author_seat,author_instance,phase,kind,version,body,created_at_utc) VALUES (?,?,?,?,?,?,1,?,?)')
        .run('vp_' + randomUUID(), id, p.seat, 'history-' + p.seat, 'proposal', 'proposal', p.seat + ' 的历史提案正文', at);
    }
    db.prepare('INSERT INTO authorizations (session_id,snapshot_json,sha256,created_at_utc) VALUES (?,?,?,?)').run(id, json, hash, at);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
  return id;
}
