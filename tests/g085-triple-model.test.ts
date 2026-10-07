/** D97: retain historical schema migration tests; live three-seat execution is covered as a refusal in g085-dual-only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CollaborationBlackboard,
  BlackboardAccessError,
  BlackboardQuotaError,
  COLLAB_BLACKBOARD_SCHEMA_VERSION,
  DEFAULT_CALL_LIMIT,
  DEFAULT_REVIEW_RELATIONS_THREE,
  DEFAULT_REVIEW_RELATIONS_TWO,
  DEFAULT_SESSION_TIMEOUT_MIN,
  MIGRATION_BACKUP_PREFIX,
  TRIPLE_CALL_LIMIT,
  TRIPLE_SESSION_TIMEOUT_MIN,
  deriveReviewRelations,
  inspectViewpointsSchema,
  migrateViewpointsUniqueKey,
  type CollabMaterialInput,
  type CollabParticipantInput,
  type CollabSeat,
} from '../src/orchestration/collaboration-blackboard.ts';
import {
  CollaborationCoordinator,
  type CollaborationDispatchFn,
  type CollaborationDispatchResultLike,
} from '../src/orchestration/collaboration-coordinator.ts';
import {
  COLLAB_SKILL_SCHEMAS,
  COLLAB_SKILL_TEMPLATES,
  COLLAB_TRIPLE_COORDINATION_SCHEMA,
  COLLAB_TRIPLE_COORDINATION_TEMPLATE,
  collabSkillRegistrySha256,
  collabSkillSchemasFor,
  collabSkillTemplate,
} from '../src/orchestration/collaboration-skills.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';

function fixtureRoot(tag: string): string {
  const root = path.resolve('.test-fixtures', 'g085-history-' + tag, process.pid + '-' + Date.now() + '-' + Math.random());
  mkdirSync(root, { recursive: true }); return root;
}

test('D97: dual defaults and frozen review relations stay unchanged', () => {
  const root = fixtureRoot('defaults'); const bb = CollaborationBlackboard.open(root);
  try {
    const created = bb.createSession({ topic: 'dual', workspace_root: root,
      participants: [{ seat: 'A', adapter_id: 'fixture-a', is_coordinator: true }, { seat: 'B', adapter_id: 'fixture-b' }] });
    const snapshot = bb.getAuthorizationSnapshot(created.session_id);
    assert.deepEqual([snapshot.call_limit, snapshot.retry_limit, snapshot.single_call_timeout_s, snapshot.session_timeout_min], [7, 1, 180, 20]);
    assert.deepEqual(snapshot.review_relations, [...DEFAULT_REVIEW_RELATIONS_TWO]);
    assert.equal(snapshot.skill_registry_sha256, collabSkillRegistrySha256(2));
    assert.deepEqual(deriveReviewRelations(['A', 'B', 'C']), [...DEFAULT_REVIEW_RELATIONS_THREE], 'historical relation decoding remains supported');
    bb.authorizeSession(created.session_id);
    for (let i = 0; i < 7; i++) bb.occupyCall(created.session_id, 'normal', 'A');
    bb.occupyCall(created.session_id, 'retry', 'B');
    assert.throws(() => bb.occupyCall(created.session_id, 'normal', 'A'));
    assert.throws(() => bb.occupyCall(created.session_id, 'retry', 'B'));
    assert.deepEqual([bb.getSession(created.session_id).call_count, bb.getSession(created.session_id).retry_count], [8, 1]);
  } finally { bb.close(); }
});

/** GOAL-084 旧库（viewpoints 无 target 列），含一个完整的双席会话历史。 */
function legacyDatabase(root: string): {
  dataDir: string; dbPath: string; sessionId: string; proposalId: string;
  snapshotJson: string; viewpointBody: string; createdAt: string;
} {
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'collaboration', 'blackboard.sqlite');
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, topic TEXT NOT NULL, workspace_root TEXT NOT NULL, constraints TEXT,
      status TEXT NOT NULL, phase TEXT NOT NULL, call_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0, call_limit INTEGER NOT NULL, retry_limit INTEGER NOT NULL,
      authorization_hash TEXT NOT NULL, session_timeout_min REAL NOT NULL, deadline_utc TEXT,
      created_at_utc TEXT NOT NULL
    );
    CREATE TABLE participants (
      session_id TEXT NOT NULL REFERENCES sessions(id), seat TEXT NOT NULL, adapter_id TEXT NOT NULL,
      provider_id TEXT, model_id TEXT, is_coordinator INTEGER NOT NULL DEFAULT 0, run_instance TEXT,
      PRIMARY KEY (session_id, seat)
    );
    CREATE TABLE materials (
      session_id TEXT NOT NULL REFERENCES sessions(id), material_id TEXT NOT NULL, name TEXT NOT NULL,
      source TEXT NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL, allowed_seats TEXT NOT NULL,
      created_at_utc TEXT NOT NULL, PRIMARY KEY (session_id, material_id)
    );
    CREATE TABLE authorizations (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      snapshot_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_at_utc TEXT NOT NULL
    );
    CREATE TABLE viewpoints (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), author_seat TEXT NOT NULL,
      author_instance TEXT NOT NULL, phase TEXT NOT NULL, kind TEXT NOT NULL, responds_to TEXT,
      version INTEGER NOT NULL, body TEXT NOT NULL, stance TEXT, evidence_json TEXT NOT NULL DEFAULT '[]',
      reserved_disagreements TEXT, material_manifest_json TEXT NOT NULL DEFAULT '[]',
      created_at_utc TEXT NOT NULL, UNIQUE (session_id, author_seat, kind)
    );
    CREATE TABLE session_outcomes (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id), outcome_json TEXT NOT NULL, recorded_at_utc TEXT NOT NULL
    );
    CREATE TABLE execution_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      call_index INTEGER NOT NULL, kind TEXT NOT NULL, seat TEXT, status TEXT NOT NULL DEFAULT 'started',
      started_at_utc TEXT NOT NULL, ended_at_utc TEXT, error TEXT
    );
  `);
  const sessionId = 'legacy-session-0001';
  const proposalId = 'vp_legacy_proposal';
  const reviewId = 'vp_legacy_review';
  const createdAt = '2026-10-01T00:00:00.000Z';
  // 旧快照就是 GOAL-084 双席快照（无 review_relations 字段）。
  const snapshotJson = JSON.stringify({
    topic: '旧双席会话',
    workspace_root: path.join(root, 'ws'),
    participants: [
      { seat: 'A', adapter_id: 'codex', is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code' },
    ],
    materials: [{ material_id: 'm1', name: '旧材料', source: 'owner', sha256: 'a'.repeat(64), allowed_seats: ['A', 'B'] }],
    call_limit: 7, retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 20,
    skill_registry_sha256: collabSkillRegistrySha256(2),
  });
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    sessionId, '旧双席会话', path.join(root, 'ws'), null, 'completed', 'revision', 7, 0, 7, 1,
    'deadbeef', 20, null, createdAt,
  );
  db.prepare('INSERT INTO participants VALUES (?,?,?,?,?,?,?)').run(sessionId, 'A', 'codex', null, null, 1, 'run-A');
  db.prepare('INSERT INTO participants VALUES (?,?,?,?,?,?,?)').run(sessionId, 'B', 'claude-code', null, null, 0, 'run-B');
  db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?)').run(
    sessionId, 'm1', '旧材料', 'owner', '旧材料内容', 'a'.repeat(64), JSON.stringify(['A', 'B']), createdAt,
  );
  db.prepare('INSERT INTO authorizations (session_id, snapshot_json, sha256, created_at_utc) VALUES (?,?,?,?)')
    .run(sessionId, snapshotJson, 'snapshothash', createdAt);
  db.prepare('INSERT INTO viewpoints VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    proposalId, sessionId, 'A', 'run-A', 'proposal', 'proposal', null, 1, '旧提案正文', 'support', '[]', null, '[]', createdAt,
  );
  db.prepare('INSERT INTO viewpoints VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    reviewId, sessionId, 'B', 'run-B', 'review', 'review', proposalId, 1, '旧评审正文', 'qualified', '[]', null, '[]', createdAt,
  );
  db.close();
  return { dataDir, dbPath, sessionId, proposalId, snapshotJson, viewpointBody: '旧提案正文', createdAt };
}

test('迁移：旧库备份后原子重建唯一键，历史 ID/正文/快照/时间戳逐字保留', () => {
  const root = fixtureRoot('migrate');
  const legacy = legacyDatabase(root);
  const before = (() => {
    const db = new DatabaseSync(legacy.dbPath, { readOnly: true });
    const rows = db.prepare('SELECT * FROM viewpoints ORDER BY id').all() as Array<Record<string, unknown>>;
    const auth = db.prepare('SELECT * FROM authorizations ORDER BY seq').all() as Array<Record<string, unknown>>;
    db.close();
    return { rows, auth };
  })();

  const bb = CollaborationBlackboard.open(legacy.dataDir);
  const record = bb.migrationRecord;
  assert.ok(record !== null, '旧库打开即迁移');
  assert.equal(record!.ran, true);
  assert.equal(record!.rows_before, 2);
  assert.equal(record!.rows_after, 2);
  assert.equal(record!.from_version, 0);
  assert.equal(record!.to_version, COLLAB_BLACKBOARD_SCHEMA_VERSION);
  // 备份与库同目录、带时间戳前缀。
  assert.ok(record!.backup_path !== undefined);
  assert.equal(path.dirname(record!.backup_path!), path.dirname(legacy.dbPath));
  assert.ok(path.basename(record!.backup_path!).startsWith(MIGRATION_BACKUP_PREFIX));
  assert.ok(existsSync(record!.backup_path!));
  const backups = readdirSync(path.dirname(legacy.dbPath)).filter((f) => f.startsWith(MIGRATION_BACKUP_PREFIX));
  assert.equal(backups.length, 1, '恰好一个备份，不重复');

  // 历史数据逐字保留：id/正文/时间戳/授权快照。
  const after = (() => {
    const db = new DatabaseSync(legacy.dbPath, { readOnly: true });
    const rows = db.prepare('SELECT * FROM viewpoints ORDER BY id').all() as Array<Record<string, unknown>>;
    const auth = db.prepare('SELECT * FROM authorizations ORDER BY seq').all() as Array<Record<string, unknown>>;
    const check = inspectViewpointsSchema(db);
    db.close();
    return { rows, auth, check };
  })();
  assert.deepEqual(after.rows.map((r) => r.id), before.rows.map((r) => r.id));
  assert.deepEqual(after.rows.map((r) => r.body), before.rows.map((r) => r.body));
  assert.deepEqual(after.rows.map((r) => r.created_at_utc), before.rows.map((r) => r.created_at_utc));
  assert.deepEqual(after.rows.map((r) => r.version), before.rows.map((r) => r.version));
  assert.ok(after.rows.every((r) => r.target === ''), '历史观点 target 一律空串');
  assert.deepEqual(after.auth, before.auth, 'authorizations 行（含原快照与回执）逐字不变');
  assert.equal(after.check.has_target_column, true);
  assert.equal(after.check.has_new_unique_key, true);
  assert.equal(after.check.has_legacy_unique_key, false);
  assert.equal(after.check.user_version, COLLAB_BLACKBOARD_SCHEMA_VERSION);
  assert.deepEqual(after.check.foreign_key_violations, []);

  // 旧会话迁移后仍可读；旧快照无 review_relations → 按参与者派生 A→B/B→A。
  const session = bb.getSession(legacy.sessionId);
  assert.equal(session.status, 'completed');
  const snapshot = bb.getAuthorizationSnapshot(legacy.sessionId);
  assert.equal(snapshot.topic, '旧双席会话');
  assert.equal(snapshot.review_relations, undefined, '旧快照内容不得被改写');
  assert.deepEqual(bb.reviewRelationsFor(legacy.sessionId), [{ author: 'A', target: 'B' }, { author: 'B', target: 'A' }]);
  const aContext = bb.getVisibleContext(legacy.sessionId, 'A');
  assert.equal(aContext.own.find((v) => v.kind === 'proposal')!.body, legacy.viewpointBody);
  assert.equal(aContext.own.find((v) => v.kind === 'proposal')!.id, legacy.proposalId);

  // 迁移后视图能容纳同作者多条评审（目标不同），同时仍拒绝重复目标与第二条提案/修订。
  const raw = new DatabaseSync(legacy.dbPath);
  const insert = raw.prepare('INSERT INTO viewpoints (id, session_id, author_seat, author_instance, phase, kind, responds_to, target, version, body, stance, evidence_json, reserved_disagreements, material_manifest_json, created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const now = new Date().toISOString();
  insert.run('vp_review_2', legacy.sessionId, 'B', 'run-B', 'review', 'review', null, 'C', 1, '第二条评审（不同目标）', 's', '[]', null, '[]', now);
  assert.throws(() => insert.run(
    'vp_review_dup', legacy.sessionId, 'B', 'run-B', 'review', 'review', null, 'C', 1, '重复目标', 's', '[]', null, '[]', now,
  ), /UNIQUE constraint failed/, '同作者同目标的第二条评审必须被唯一键拒绝');
  assert.throws(() => insert.run(
    'vp_proposal_dup', legacy.sessionId, 'A', 'run-A', 'proposal', 'proposal', null, '', 1, '第二条提案', 's', '[]', null, '[]', now,
  ), /UNIQUE constraint failed/, '每席位一条提案仍被拒绝重复');
  raw.close();
});

test('迁移幂等：再次打开已迁移库不重复迁移、不新增备份、不报错', () => {
  const root = fixtureRoot('idempotent');
  const legacy = legacyDatabase(root);
  const first = CollaborationBlackboard.open(legacy.dataDir);
  const firstBackup = first.migrationRecord?.backup_path;
  assert.ok(firstBackup !== undefined);
  const phaseBefore = first.getSession(legacy.sessionId).phase;
  first.close();

  const second = CollaborationBlackboard.open(legacy.dataDir);
  assert.equal(second.migrationRecord, null, '已迁移库再次打开不再迁移');
  assert.equal(second.getSession(legacy.sessionId).phase, phaseBefore);
  assert.deepEqual(second.reviewRelationsFor(legacy.sessionId), [{ author: 'A', target: 'B' }, { author: 'B', target: 'A' }]);
  second.close();
  const backups = readdirSync(path.dirname(legacy.dbPath)).filter((f) => f.startsWith(MIGRATION_BACKUP_PREFIX));
  assert.equal(backups.length, 1, '幂等：备份不增加');

  // 显式再跑一次迁移函数也必须是 no-op（幂等的第二重保证）。
  const db = new DatabaseSync(legacy.dbPath);
  const result = migrateViewpointsUniqueKey(db, legacy.dbPath);
  assert.equal(result.ran, false);
  assert.equal(result.to_version, COLLAB_BLACKBOARD_SCHEMA_VERSION);
  db.close();
});

test('迁移回滚：用备份恢复后回到 GOAL-084 结构、历史数据与旧语义仍可用', () => {
  const root = fixtureRoot('rollback');
  const legacy = legacyDatabase(root);
  const backupDir = path.join(root, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const bb = CollaborationBlackboard.open(legacy.dataDir, { migration: { backupDir } });
  const backupPath = bb.migrationRecord!.backup_path!;
  assert.equal(path.dirname(backupPath), backupDir, '备份目录可配置');
  bb.close();

  // 回滚前先确认已迁移。
  const migrated = new DatabaseSync(legacy.dbPath, { readOnly: true });
  assert.equal(inspectViewpointsSchema(migrated).has_target_column, true);
  migrated.close();

  const restored = CollaborationBlackboard.restoreFromBackup(legacy.dbPath, backupPath);
  assert.equal(restored.restored_from, path.resolve(backupPath));
  assert.ok(existsSync(restored.preserved_path), '回滚前保留迁移后现场副本');
  // 回滚入口 fail-closed：备份缺失或指向库自身都拒绝，不做半套覆盖。
  assert.throws(() => CollaborationBlackboard.restoreFromBackup(legacy.dbPath, path.join(root, 'nope.sqlite')), /回滚备份不存在/);
  assert.throws(() => CollaborationBlackboard.restoreFromBackup(legacy.dbPath, legacy.dbPath), /不可指向库文件自身/);

  const rolledBack = new DatabaseSync(legacy.dbPath, { readOnly: true });
  const check = inspectViewpointsSchema(rolledBack);
  assert.equal(check.has_target_column, false, '回滚后回到无 target 列的旧结构');
  assert.equal(check.has_legacy_unique_key, true);
  assert.equal(check.rows, 2, '历史行数不变');
  const rows = rolledBack.prepare('SELECT id, body, created_at_utc FROM viewpoints ORDER BY id').all() as Array<Record<string, unknown>>;
  rolledBack.close();
  assert.deepEqual(rows.map((r) => r.id), ['vp_legacy_proposal', 'vp_legacy_review']);
  assert.equal(rows[0].body, legacy.viewpointBody);
  assert.equal(rows[0].created_at_utc, legacy.createdAt);

  // 回滚后的旧库可再次被自动迁移（迁移-回滚-再迁移闭环）。
  const again = CollaborationBlackboard.open(legacy.dataDir);
  assert.equal(again.migrationRecord?.ran, true, '旧结构应再次触发迁移');
  assert.equal(again.getSession(legacy.sessionId).status, 'completed');
  again.close();
});

test('迁移不触碰生产库：测试库路径不指向 collaboration/blackboard.sqlite 之外的用户数据面', () => {
  const root = fixtureRoot('touch');
  const legacy = legacyDatabase(root);
  // 生产库位于仓库内 collaboration/blackboard.sqlite；本用例的所有输入输出都在 .test-fixtures 下。
  const production = path.resolve(process.cwd(), 'collaboration', 'blackboard.sqlite');
  assert.equal(path.resolve(legacy.dbPath) === production, false);
  assert.ok(path.resolve(root).startsWith(path.resolve(process.cwd(), '.test-fixtures')));
  const bb = CollaborationBlackboard.open(legacy.dataDir);
  assert.ok(bb.databasePath.startsWith(process.cwd()));
  assert.equal(path.resolve(bb.databasePath) === production, false);
  bb.close();
});
