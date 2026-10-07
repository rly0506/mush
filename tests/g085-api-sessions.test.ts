/** GOAL-085（API 层）：创建接口接受 2/3 席位、服务端派生评审关系与额度、拒绝客户端注入。
 *  真实 HTTP + 注入 fake runner；数据根独立，不打开生产黑板库、不派发真实模型。 */

import { seedTripleHistory } from './fixtures/collab-history.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, COLLAB_SEAT_COUNTS, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { loadAdmissionPolicy } from '../src/orchestration/collaboration-admission-policy.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const servers: BoardServer[] = [];
after(async () => { for (const s of servers) await s.close(); });

const SHARED_FP = 'f'.repeat(64);

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-api-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** 合成证据库：所有维度行为级通过（API 层用例只关心席位/关系/额度，不重复考证据语义）。 */
function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085/${adapterId}/${fingerprint}/${dimension}`;
      records.set(source, {
        source, adapter_id: adapterId, dimension, method: 'dispatch_receipt', subject: 'synthetic fixture',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior',
        artifact_sha256: 'a'.repeat(64), result: 'pass', recorded_at_utc: new Date().toISOString(),
      });
      return { source, adapter_id: adapterId, dimension, subject: 'synthetic fixture', method: 'dispatch_receipt',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint,
        verification: 'behavior' as const, status: 'live_verified' as const };
    });
  return {
    store: {
      resolve: (source: string) => records.get(source),
      failuresFor: () => [],
    },
    forParticipant,
  };
}

/** 两个讨论档案合同（用合成资产装配，零原生探测）：codex 与 claude-code。
 *  agy 的档案装配需要项目/agent/hooks/gate 四类真实资产，API 层用例不涉及 agy，故不装配。 */
function discussionContracts(root: string): Record<string, AdapterContract> {
  const codexProfile = buildCodexDiscussionProfile({
    directory: path.join(root, 'codex-profile'), contract: new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'a'), ledgerPath: path.join(root, 'l.jsonl') }).getContractMap().codex!,
    modelId: 'gpt-5.5', catalog: { models: [{ slug: 'gpt-5.5' }] }, nativeVersion: '0.160.0', mcpNames: [],
  }).contract;
  const claude = buildClaudeDiscussionProfile({
    workspace: path.join(root, 'claude-workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(root, 'claude-profile'),
  }).contract;
  return { codex: codexProfile, 'claude-code': claude };
}

/** 夹具准入政策：含一条指向**不存在指纹**的缺口，使准入走"政策已加载"分支；
 *  任何真实席位都不在政策内 → 缺证席位创建即拒（设计内 fail-closed）。
 *  **必须在服务器首次打开黑板之前写好**——黑板按数据根缓存，政策只在 open 时读取。 */
function writeFixturePolicy(runtimeRoot: string): void {
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(path.join(runtimeRoot, 'collaboration-admission-policy.json'), JSON.stringify({
    schema_version: 1,
    decision_ref: 'g085-fixture-policy',
    accepted_gaps: [{
      adapter_id: 'codex', dimension: 'write_protection', config_fingerprint: 'e'.repeat(64),
      reason: '夹具占位：该指纹不存在，因此任何真实席位都不被接受',
      equivalence: { gate_sha256: 'a'.repeat(64), hooks_sha256: 'b'.repeat(64), project_sha256: 'c'.repeat(64), differing: '夹具占位差异', reference: 'fixture://g085/placeholder' },
      decided_by: 'g085 fixture',
    }],
  }, null, 2) + '\n', 'utf8');
}

async function boot(root: string, historyStatus?: 'completed' | 'pending_approval', version: () => string = () => '2.1.286'): Promise<{ base: string; token: string; board: CollaborationBlackboard; historyId?: string; pipeline: DispatchPipeline }> {
  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(root, { evidenceStore: store });
  const contracts = discussionContracts(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts,
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => version(),
    runAdapter: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }),
  });
  const historyId = historyStatus === undefined ? undefined : seedTripleHistory(board, root, historyStatus);
  if (historyId !== undefined) pipeline.createSessionAuthorizationRequest({ session_id: historyId });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-api', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store, collaborationEvidence: (p, c) => forParticipant(p.adapter_id, contractPermissionFingerprint(c)),
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, token: server.callerToken, board, historyId, pipeline };
}

async function post(base: string, token: string, url: string, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('检查零写入；创建前升级被拦；批准前升级不写应答不占额', async () => {
  const root = fixtureRoot('native-check');
  let version = '2.1.286';
  const { base, token, board, pipeline } = await boot(root, undefined, () => version);
  const selection = { workspace_root: root, participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5', effort: 'LOW' },
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW' }] };
  const check = await post(base, token, '/api/collaboration/check', selection);
  assert.equal(check.status, 200); assert.equal(check.body.ready, true);
  assert.equal(check.body.account_quota, 'UNKNOWN');
  assert.equal((check.body.real_reproduction as {status: string}).status, 'UNTESTED');
  assert.equal(board.listSessions().length, 0); assert.equal(pipeline.recent(100).length, 0);
  version = '2.1.999';
  const rejected = await post(base, token, '/api/collaboration/sessions', { ...selection, topic: 'version' });
  assert.equal(rejected.status, 409); assert.equal(board.listSessions().length, 0);
  version = '2.1.286';
  const created = await post(base, token, '/api/collaboration/sessions', { ...selection, topic: 'approve' });
  assert.equal(created.status, 201);
  const id = String(created.body.session_id);
  const card = readFileSync(pipeline.sessionAuthorizationRequestPath(id));
  version = '2.1.999';
  for (const url of ['/api/collaboration/sessions/approve', '/api/approvals/respond']) {
    const body = url.endsWith('/respond') ? { request_file: path.basename(pipeline.sessionAuthorizationRequestPath(id)), decision: 'APPROVED' } : { session_id: id };
    const approval = await post(base, token, url, body);
    assert.equal(approval.status, 409, JSON.stringify(approval.body));
  }
  assert.equal(existsSync(pipeline.sessionAuthorizationRequestPath(id) + '.owner-response.json'), false);
  assert.equal(board.getSession(id).call_count, 0); assert.equal(pipeline.recent(100).length, 0);
  assert.deepEqual(readFileSync(pipeline.sessionAuthorizationRequestPath(id)), card);
});

test('API：参与人数只接受 2（1/3/4 一律拒绝）', async () => {
  const root = fixtureRoot('counts');
  const { base, token } = await boot(root);
  for (const count of [1, 3, 4]) {
    const participants = Array.from({ length: count }, () => ({ adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }));
    const res = await post(base, token, '/api/collaboration/sessions', { topic: 'x', participants });
    assert.equal(res.status, 400, `${count} 位应被拒绝`);
    assert.match(String(res.body.error), /2 位/);
  }
  assert.deepEqual([...COLLAB_SEAT_COUNTS], [2]);
});

test('API：双席位冻结 A→B/B→A 与 7+1/20min；三席位新建被拒', async () => {
  const root = fixtureRoot('relations');
  const { base, token } = await boot(root);
  const two = await post(base, token, '/api/collaboration/sessions', {
    topic: '双模型', participants: [{ adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }, { adapter_id: 'codex', model_id: 'gpt-5.5' }],
    materials: [{ name: 'm', content: 'x', allowed_seats: ['A', 'B'] }],
  });
  assert.equal(two.status, 201, JSON.stringify(two.body));
  const twoDetail = await post(base, token, '/api/collaboration/sessions/detail', { session_id: two.body.session_id });
  const twoSnapshot = twoDetail.body.snapshot as Record<string, unknown>;
  assert.deepEqual((twoSnapshot.review_relations as Array<{ author: string; target: string }>).map((r) => `${r.author}->${r.target}`), ['A->B', 'B->A']);
  assert.equal(twoSnapshot.call_limit, 7);
  assert.equal(twoSnapshot.retry_limit, 1);
  assert.equal(twoSnapshot.session_timeout_min, 20);

  const three = await post(base, token, '/api/collaboration/sessions', {
    topic: '三模型',
    participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5' }, { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }, { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }],
    materials: [{ name: 'm', content: 'x', allowed_seats: ['A', 'B', 'C'] }],
  });
  assert.equal(three.status, 400, JSON.stringify(three.body));
});

test('API：历史三席位 C 正文可读，新双席位不虚构 C', async () => {
  for (const count of [2, 3]) {
    const root = fixtureRoot('viewpoints-' + count);
    const { base, token, board, historyId } = await boot(root, count === 3 ? 'completed' : undefined);
    let sessionId = historyId;
    if (count === 2) {
      const created = await post(base, token, '/api/collaboration/sessions', { topic: 'dual', participants: [{ adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }, { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }] });
      assert.equal(created.status, 201); sessionId = String(created.body.session_id);
      board.authorizeSession(sessionId);
      for (const seat of ['A', 'B'] as const) board.bindRunInstance(sessionId, seat, 'fixture-' + seat);
      board.appendViewpoint({ session_id: sessionId, author_instance: 'fixture-A', body: 'assignment' });
      board.setPhase(sessionId, 'proposal');
      for (const seat of ['A', 'B'] as const) board.appendViewpoint({ session_id: sessionId, author_instance: 'fixture-' + seat, body: seat + ' 的历史提案正文' });
    }
    const detail = await post(base, token, '/api/collaboration/sessions/detail', { session_id: sessionId });
    assert.equal(detail.status, 200);
    const viewpoints = detail.body.viewpoints as Record<string, Array<{ author_seat: string; body: string }>>;
    const seats = ['A', 'B', 'C'].slice(0, count);
    assert.deepEqual(Object.keys(viewpoints), seats);
    for (const seat of seats) {
      assert.ok(viewpoints[seat]?.some(v => v.body === seat + ' 的历史提案正文'));
      assert.ok(viewpoints[seat]?.every(v => v.author_seat === seat));
    }
  }
});

test('API：客户端不得注入执行参数/证据/政策豁免/评审关系', async () => {
  const root = fixtureRoot('injection');
  const { base, token } = await boot(root);
  const participants = [{ adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }, { adapter_id: 'codex', model_id: 'gpt-5.5' }];
  for (const field of ['execution', 'policy', 'review_relations']) {
    const res = await post(base, token, '/api/collaboration/sessions', { topic: 'x', participants, [field]: { evil: true } });
    assert.equal(res.status, 400, `${field} 注入应被拒绝`);
    assert.match(String(res.body.error), /宿主派生/);
  }
  // capability_evidence 老规则仍拒绝（GOAL-084）
  const capability = await post(base, token, '/api/collaboration/sessions', { topic: 'x', participants, capability_evidence: [] });
  assert.equal(capability.status, 400);
});

test('API：历史三席位审批卡与快照原样可读，准入标记不可启动', async () => {
  const root = fixtureRoot('history-card');
  const { base, token, board, historyId, pipeline } = await boot(root, 'pending_approval');
  const cardPath = pipeline.sessionAuthorizationRequestPath(historyId!);
  const before = readFileSync(cardPath);
  const card = JSON.parse(before.toString());
  assert.equal(card.participants.length, 3); assert.equal(card.call_limit, 13); assert.equal(card.session_timeout_min, 40);
  assert.equal(card.review_relations.length, 6);
  const detail = await post(base, token, '/api/collaboration/sessions/detail', { session_id: historyId });
  assert.equal(detail.status, 200); assert.equal(detail.body.status, 'pending_approval');
  assert.equal((detail.body.authorization_readiness as { ready: boolean }).ready, false);
  assert.deepEqual(readFileSync(cardPath), before);
  assert.equal(board.getSession(historyId!).call_count, 0);
});

test('API：准入拒绝回 409 并原样给出原因（不再冒充 500 内部错误）', async () => {
  const root = fixtureRoot('admission-409');
  const runtimeRoot = path.join(root, 'runtime');
  // 政策必须在**两者**打开黑板之前就位：服务器自建的黑板与注入管线自带的黑板
  // 都会各自读一次政策，否则会出现"一边严格、一边政策"的口径分叉。
  writeFixturePolicy(runtimeRoot);
  const { store, forParticipant } = syntheticEvidence();
  const policy = loadAdmissionPolicy(path.join(runtimeRoot, 'collaboration-admission-policy.json'));
  const board = CollaborationBlackboard.open(root, { evidenceStore: store, ...(policy.accepted_gaps.length > 0 ? { admissionPolicy: policy } : {}) });
  const contracts = discussionContracts(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts,
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => '2.1.286',
    runAdapter: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }),
  });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot,
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-api-409', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store,
    // 只给 claude-code 席位登记证据：codex 席位必然缺五维 → 准入拒绝（设计内 fail-closed）。
    collaborationEvidence: (p, c) => (p.adapter_id === 'claude-code' ? forParticipant(p.adapter_id, contractPermissionFingerprint(c)) : []),
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const res = await post(base, server.callerToken, '/api/collaboration/sessions', {
    topic: '缺证席位', participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5' }, { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }],
    materials: [{ name: 'm', content: 'c', allowed_seats: ['A', 'B'] }], isolation_required: true,
  });
  assert.equal(res.status, 409, '准入拒绝应为 409，实际=' + res.status + ' body=' + JSON.stringify(res.body));
  assert.match(String(res.body.error), /isolation admission|缺行为级/, '必须原样保留拒绝原因：' + JSON.stringify(res.body.error));
  assert.doesNotMatch(String(res.body.error), /internal error/, '不得再冒充内部错误');
});
