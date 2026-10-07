import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, symlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FileCollaborationEvidenceStore } from '../src/orchestration/collaboration-evidence-store.ts';
import { ISOLATION_DIMENSIONS, type EvidenceRecord } from '../src/orchestration/collaboration-blackboard.ts';
import { startBoardServer } from '../src/web/server.ts';
import { buildCodexContract } from '../src/adapters/codex.ts';
import { buildAgyContract } from '../src/adapters/agy.ts';
import { contractPermissionFingerprint } from '../src/adapters/contract.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { fixtureDiscussionInputs } from './fixtures/discussion-profile.ts';

const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = mkdtempSync(path.resolve('.test-fixtures/g084-evidence-'));
  return { root, store: new FileCollaborationEvidenceStore(root) };
}
function record(artifact: Buffer, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return { source: 'probe://synthetic/one', adapter_id: 'codex', dimension: 'tool_scope',
    method: 'behavior_test', subject: 'synthetic test only', coverage: 'behavior',
    tool_version: 'fixture', config_fingerprint: 'a'.repeat(64), verification: 'behavior',
    artifact_sha256: hash(artifact), result: 'pass', recorded_at_utc: new Date().toISOString(), ...overrides };
}

test('persisted evidence survives reopen; no cached objects and no overwrite of a source', () => {
  const { root, store } = fixture(); const artifact = Buffer.from('synthetic behavior report');
  const item = record(artifact); store.register(item, artifact);
  const reopened = new FileCollaborationEvidenceStore(root);
  assert.deepEqual(reopened.resolve(item.source), item);
  reopened.resolve(item.source)!.result = 'fail';
  assert.equal(reopened.resolve(item.source)!.result, 'pass');
  store.register(item, artifact);
  assert.throws(() => store.register({ ...item, result: 'fail' }, artifact), /already registered/);
  assert.equal(reopened.resolve(item.source)!.result, 'pass');
});

test('artifact tampering or deletion invalidates every subsequent lookup and candidate list', () => {
  const { root, store } = fixture(); const artifact = Buffer.from('synthetic');
  const item = record(artifact); store.register(item, artifact);
  const file = path.join(root, 'collaboration', 'evidence', 'artifacts', item.artifact_sha256);
  writeFileSync(file, 'changed');
  assert.equal(store.resolve(item.source), undefined);
  assert.deepEqual(store.forParticipant('codex', item.config_fingerprint), []);
});

test('unregistered sources cannot become arbitrary file reads; malformed records remain unverified', () => {
  const { root, store } = fixture();
  assert.equal(store.resolve('../outside.json'), undefined);
  assert.equal(existsSync(path.join(root, 'collaboration', 'evidence')), false);
  const artifact = Buffer.from('synthetic'); const item = record(artifact);
  assert.throws(() => store.register({ ...item, artifact_sha256: 'b'.repeat(64) }, artifact), /artifact hash/);
  assert.throws(() => store.register({ ...item, method: 'help' }, artifact), /invalid evidence/);
  store.register(item, artifact);
  const directory = path.join(root, 'collaboration', 'evidence', 'records');
  writeFileSync(path.join(directory, hash(item.source) + '.json'), JSON.stringify({ ...item, source: 'other' }));
  assert.equal(store.resolve(item.source), undefined);
  writeFileSync(path.join(directory, hash(item.source) + '.json'), '{bad json');
  assert.deepEqual(store.forParticipant('codex', item.config_fingerprint), []);
});

test('GOAL-084: evidence level follows the explicit verification field, never the prose', () => {
  const { store } = fixture(); const artifact = Buffer.from('classification fixture');
  // 同样写着"行为级"文案，但显式分类不同 → 等级必须不同（文案不参与判定）。
  store.register(record(artifact, { source: 'probe://explicit-behavior', dimension: 'tool_scope',
    coverage: '行为级观察（合成）', verification: 'behavior' }), artifact);
  store.register(record(artifact, { source: 'probe://declared-with-behavior-wording', dimension: 'read_scope',
    coverage: '行为级观察（合成，但实际未演练）', verification: 'declared' }), artifact);
  // 缺 verification 字段的历史记录：按保守规则记 declared，绝不因文案升级。
  const legacy = record(artifact, { source: 'probe://legacy-keyword-only', dimension: 'recursion', coverage: '行为级原生拒绝轨迹' });
  delete (legacy as { verification?: string }).verification;
  store.register(legacy, artifact);
  const candidates = store.forParticipant('codex', 'a'.repeat(64));
  assert.equal(candidates.find(e => e.dimension === 'tool_scope')!.status, 'live_verified');
  assert.equal(candidates.find(e => e.dimension === 'read_scope')!.status, 'declared', '文案含"行为"但显式 declared 不得升级');
  assert.equal(candidates.find(e => e.dimension === 'recursion')!.status, 'declared', '缺字段的历史记录保守记 declared');
  // verification 取值非法 → 记录整体不合法，注册被拒。
  assert.throws(() => store.register({ ...record(artifact, { source: 'probe://bad-verification' }),
    verification: 'verified' } as unknown as EvidenceRecord, artifact), /invalid evidence/);
});

test('candidate evidence respects adapter/config; failures and model reports never become live proof', () => {
  const { store } = fixture(); const artifact = Buffer.from('synthetic');
  store.register(record(artifact), artifact);
  store.register(record(artifact, { source: 'probe://fail', dimension: 'read_scope', result: 'fail' }), artifact);
  store.register(record(artifact, { source: 'probe://self-report', dimension: 'recursion',
    method: 'dispatch_receipt', coverage: 'model self-report only', verification: 'declared' }), artifact);
  const candidates = store.forParticipant('codex', 'a'.repeat(64));
  assert.equal(candidates.find(e => e.dimension === 'tool_scope')!.status, 'live_verified');
  assert.equal(candidates.find(e => e.dimension === 'read_scope')!.status, 'unmet');
  assert.equal(candidates.find(e => e.dimension === 'recursion')!.status, 'declared');
  assert.deepEqual(store.forParticipant('agy', 'a'.repeat(64)), []);
  assert.deepEqual(store.forParticipant('codex', 'b'.repeat(64)), []);
});

test('default board loads local host evidence; changed artifact rejects approval before execution', async () => {
  const { root, store } = fixture(); let runs = 0;
  const artifact = Buffer.from('SYNTHETIC_FIXTURE_NOT_REAL_CHANNEL_EVIDENCE');
  const server = await startBoardServer({ workspaceRoot: root, runtimeRoot: path.join(root, 'runtime'),
    approvalRoot: path.join(root, 'approvals'), runId: 'evidence-fixture', assignmentEpoch: 1,
    ...fixtureDiscussionInputs(root),
    runAdapter: async () => { runs++; throw new Error('must not run'); } });
  const post = async (url: string, body: object) => {
    const response = await fetch('http://127.0.0.1:' + server.port + url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  try {
    const activated = await post('/api/collaboration/profiles/activate', {});
    assert.equal(activated.status, 200);
    for (const adapterId of ['codex','agy']) for (const dimension of ISOLATION_DIMENSIONS) {
      store.register(record(artifact, { source:'fixture://'+adapterId+'/'+dimension,
        adapter_id:adapterId,dimension,config_fingerprint:String(activated.body[adapterId+'_fingerprint']) }), artifact);
    }
    const created = await post('/api/collaboration/sessions', { topic: 'synthetic',
      participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5' }, { adapter_id: 'agy' }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal((created.body.authorization_readiness as Record<string, unknown>).ready, true);
    const detail = await post('/api/collaboration/sessions/detail', { session_id: created.body.session_id });
    assert.equal(((detail.body.snapshot as Record<string, unknown>).capability_evidence as unknown[]).length, 10);
    writeFileSync(path.join(root, 'collaboration', 'evidence', 'artifacts', hash(artifact)), 'tampered');
    const approved = await post('/api/collaboration/sessions/approve', { session_id: created.body.session_id });
    assert.equal(approved.status, 409); assert.equal(runs, 0);
    assert.equal(existsSync(path.join(root, 'goals', 'receipts', 'approval-requests',
      String(created.body.request_file) + '.owner-response.json')), false);
    assert.equal((await post('/api/collaboration/sessions/detail', { session_id: created.body.session_id })).body.call_count, 0);
  } finally { await server.close(); }
});

test('junction escaping the data root is rejected before creating any evidence directories', () => {
  const { root, store } = fixture(); const outside = mkdtempSync(path.resolve('.test-fixtures/g084-evidence-outside-'));
  symlinkSync(outside, path.join(root, 'collaboration'), process.platform === 'win32' ? 'junction' : 'dir');
  const artifact = Buffer.from('synthetic');
  assert.throws(() => store.register(record(artifact), artifact), /escapes data root/);
  assert.deepEqual(readdirSync(outside), []);
});

test('reviewed failure for the same configuration/dimension invalidates an older positive source', () => {
  const { store } = fixture(); const artifact = Buffer.from('synthetic');
  const positive = record(artifact); store.register(positive, artifact);
  store.register(record(artifact, { source: 'probe://counterexample', result: 'fail' }), artifact);
  assert.equal(store.resolve(positive.source), undefined);
  assert.equal(store.resolve('probe://counterexample')!.result, 'fail');
  assert.ok(store.forParticipant('codex', positive.config_fingerprint).every(e => e.status !== 'live_verified'));
});

test('append-only withdrawal retires a specific positive source without touching the original record', () => {
  const { root, store } = fixture(); const artifact = Buffer.from('synthetic outcome observation');
  const positive = record(artifact, { coverage: '行为级结果观察（fixture 合成）' });
  store.register(positive, artifact);
  const originalBytes = root; // 原始登记文件在撤回后必须逐字节保留
  const recordsDir = path.join(root, 'collaboration', 'evidence', 'records');
  const before = Object.fromEntries(readdirSync(recordsDir).map(name => [name, readFileSync(path.join(recordsDir, name), 'utf8')] as const));
  store.register(record(artifact, {
    source: 'probe://withdrawal/tool_scope', result: 'withdrawn', method: 'dispatch_receipt',
    subject: 'withdrawn:' + positive.source, coverage: '登记更正（合成用例）：原 pass 记录的行为级证据不足，退出准入；原始记录保留不改写。' }), artifact);
  assert.equal(store.resolve(positive.source), undefined, 'withdrawn source no longer grants');
  assert.equal(store.resolve('probe://withdrawal/tool_scope')!.result, 'withdrawn');
  const statuses = store.forParticipant('codex', positive.config_fingerprint);
  assert.equal(statuses.find(e => e.dimension === 'tool_scope')!.status, 'unmet');
  const after = Object.fromEntries(readdirSync(recordsDir).map(name => [name, readFileSync(path.join(recordsDir, name), 'utf8')] as const));
  for (const [name, content] of Object.entries(before)) assert.equal(after[name], content, 'original record untouched');
  void originalBytes;
});

test('withdrawal is source-targeted: a fresh independent positive source in the same dimension still resolves', () => {
  const { store } = fixture(); const artifact = Buffer.from('synthetic');
  const old = record(artifact, { source: 'probe://old/observation' });
  store.register(old, artifact);
  store.register(record(artifact, { source: 'probe://withdrawal/tool_scope', result: 'withdrawn', method: 'dispatch_receipt',
    subject: 'withdrawn:' + old.source, coverage: '登记更正（合成用例）' }), artifact);
  const fresh = record(artifact, { source: 'probe://fresh/native-deny', coverage: '行为级原生拒绝轨迹（fixture 合成）' });
  store.register(fresh, artifact);
  assert.equal(store.resolve(fresh.source)!.result, 'pass', 'new independent evidence is not collateral damage');
  const toolScope = store.forParticipant('codex', fresh.config_fingerprint).filter(e => e.dimension === 'tool_scope');
  assert.ok(toolScope.some(e => e.status === 'live_verified'), 'fresh independent source stays live_verified');
  assert.ok(toolScope.some(e => e.status === 'unmet'), 'the withdrawn entry is visible as unmet');
});

test('production-shaped regression: withdrawn outcome observations reject new isolated sessions while mcp_scope stays valid', async () => {
  const { root, store } = fixture(); let runs = 0;
  const artifact = Buffer.from('A9B_ARCHIVED_OUTCOME_BYTES');
  const server = await startBoardServer({ workspaceRoot: root, runtimeRoot: path.join(root, 'runtime'),
    approvalRoot: path.join(root, 'approvals'), runId: 'evidence-withdraw-fixture', assignmentEpoch: 1,
    ...fixtureDiscussionInputs(root), runAdapter: async () => { runs++; throw new Error('must not run'); } });
  const post = async (url: string, body: object) => {
    const response = await fetch('http://127.0.0.1:' + server.port + url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  try {
  const activated = await post('/api/collaboration/profiles/activate', {});
  assert.equal(activated.status, 200);
  const codexFingerprint = String(activated.body.codex_fingerprint);
  const agyFingerprint = String(activated.body.agy_fingerprint);
  // agy 生产形态复刻（真实合同指纹）：mcp_scope 原生拒绝实证保留，其余四维为
  // "未观察到执行"的结果观察登记后被更正撤回。
  const dims = ISOLATION_DIMENSIONS.filter(d => d !== 'mcp_scope');
  for (const dimension of dims) {
    const source = 'g084://admission-2026-10-04/agy/a9b-' + dimension;
    store.register(record(artifact, { source, adapter_id: 'agy', dimension, method: 'dispatch_receipt',
      coverage: '行为级结果观察（合成复刻）：无执行痕迹（fixture）', config_fingerprint: agyFingerprint }), artifact);
    store.register(record(artifact, { source: 'g084://admission-2026-10-04/agy/withdrawal/' + dimension,
      adapter_id: 'agy', dimension, method: 'dispatch_receipt', result: 'withdrawn',
      subject: 'withdrawn:' + source, coverage: '登记更正（合成复刻）：行为级证据不足退出准入', config_fingerprint: agyFingerprint }), artifact);
  }
  store.register(record(artifact, { source: 'g084://admission-2026-10-04/agy/a9b-native-mcp-deny', adapter_id: 'agy',
    dimension: 'mcp_scope', method: 'dispatch_receipt', coverage: '行为级原生硬拒绝轨迹（fixture 复刻）',
    config_fingerprint: agyFingerprint }), artifact);
  const candidates = store.forParticipant('agy', agyFingerprint);
  assert.deepEqual(candidates.filter(e => e.status === 'live_verified').map(e => e.dimension), ['mcp_scope']);
  assert.equal(candidates.filter(e => e.status === 'unmet').length, dims.length);
  for (const dimension of ISOLATION_DIMENSIONS) {
    store.register(record(artifact, { source: 'fixture://codex/' + dimension, adapter_id: 'codex',
      dimension, config_fingerprint: codexFingerprint }), artifact);
  }
    const created = await post('/api/collaboration/sessions', { topic: 'withdrawn regression',
      participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5' }, { adapter_id: 'agy' }] });
    assert.equal(created.status, 409, JSON.stringify(created.body));
    const readiness = created.body.check as { ready: boolean; reason?: string };
    assert.equal(readiness.ready, false, 'withdrawn agy dimensions must block new sessions');
    assert.match(String(readiness.reason ?? ''), /write_protection|read_scope|tool_scope|recursion/);
    assert.equal(runs, 0);
  } finally { await server.close(); }
});
