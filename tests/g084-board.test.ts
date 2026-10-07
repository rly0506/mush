/** GOAL-084 §3.5：受控会话看板接入——HTTP 层创建/审批/进度/结果/失败/停止闭环。
 *  startBoardServer 注入带黑板与阶段感知 fixture 合同的管线；零模型调用。 */

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import { renderBoardPage } from '../src/web/page.ts';
import { withFixtureDiscussionProfile, fixtureDiscussionInspector } from './fixtures/discussion-profile.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, ISOLATION_DIMENSIONS, type EvidenceRecord, type EvidenceStoreLike, type CollabParticipantInput, type CollabCapabilityEvidence } from '../src/orchestration/collaboration-blackboard.ts';
import { validateAdapterContract, contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const servers: BoardServer[] = [];

const evidenceRecords = new Map<string, EvidenceRecord>();
const evidenceStore: EvidenceStoreLike = {
  resolve: (source) => evidenceRecords.get(source),
  failuresFor: (adapterId, configFingerprint, dimension) => [...evidenceRecords.values()].filter((r) =>
    r.result === 'fail' && r.adapter_id === adapterId && r.config_fingerprint === configFingerprint && r.dimension === dimension),
};

function fixtureEvidence(participant: CollabParticipantInput, contract: AdapterContract): CollabCapabilityEvidence[] {
  const fingerprint = contractPermissionFingerprint(contract);
  return ISOLATION_DIMENSIONS.map(dimension => {
    const source = 'fixture://g084/' + participant.adapter_id + '/' + fingerprint + '/' + dimension;
    const evidence: CollabCapabilityEvidence = {
      adapter_id: participant.adapter_id, dimension,
      subject: 'synthetic fixture configuration', method: 'behavior_test', coverage: 'behavior',
      tool_version: 'fixture', config_fingerprint: fingerprint, source, verification: 'behavior', status: 'live_verified',
    };
    evidenceRecords.set(source, {
      ...evidence, source, tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior',
      artifact_sha256: 'a'.repeat(64), result: 'pass', recorded_at_utc: new Date().toISOString(),
    });
    return evidence;
  });
}

function fixtureOutput(prompt: string): object {
  const phase = prompt.match(/【阶段】(\w+)/)?.[1];
  const seat = prompt.match(/【席位】(\w+)/)?.[1];
  const respondsTo = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1];
  switch (phase) {
    case 'coordination': return { a_focus: 'A', b_focus: 'B', material_plan: { A: ['m1'], B: ['m2'] }, notes: '' };
    case 'proposal': return { body: 'proposal-' + seat, stance: 'support', evidence: [seat === 'A' ? 'm1' : 'm2'], reserved_disagreements: '' };
    case 'review': return { body: 'review-' + seat, stance: 'support', responds_to: respondsTo, evidence: [], flaws: [], suggestions: [], reserved_disagreements: '' };
    case 'revision': return { body: 'revision-' + seat, stance: 'support', changes: [], reserved_disagreements: '' };
    default: throw new Error('unknown fixture phase');
  }
}


afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g084-board-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function phaseAwareFixture(root: string, scenario: string): { script: string; paths: { script: string; scenarioFile: string; counterFile: string } } {
  const script = path.join(root, `emit-${scenario}.mjs`);
  const scenarioFile = path.join(root, `scenario-${scenario}.txt`);
  const counterFile = path.join(root, `counts-${scenario}.json`);
  writeFileSync(script, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    'const prompt = args[args.length - 1];',
    'const marker = (re) => { const m = prompt.match(re); return m ? m[1] : ""; };',
    'const phase = marker(/【阶段】(\\w+)/);',
    'const seat = marker(/【席位】(\\w+)/);',
    'const respondTo = marker(/【回应对象】(vp_[0-9a-f-]+)/);',
    'const base = {',
    '  coordination: { a_focus: "A focus", b_focus: "B focus", material_plan: { A: ["m1"], B: ["m2"] }, notes: "" },',
    '  proposal: { body: "proposal-" + seat, stance: "support", evidence: seat === "A" ? ["m1"] : ["m2"], reserved_disagreements: "" },',
    '  review: { body: "review-" + seat, stance: "qualified", responds_to: respondTo, evidence: [], flaws: ["gap"], suggestions: ["fix"], reserved_disagreements: "" },',
    '  revision: { body: "revision-" + seat, stance: "revised", changes: ["adopt"], reserved_disagreements: "keep" },',
    '};',
    "console.log(JSON.stringify(base[phase] ?? {}));",
    '',
  ].join('\n'), 'utf8');
  writeFileSync(scenarioFile, scenario);
  return { script, paths: { script, scenarioFile, counterFile } };
}

function fixtureContract(adapterId: string, paths: { script: string; scenarioFile: string; counterFile: string }): AdapterContract {
  return withFixtureDiscussionProfile(validateAdapterContract({
    adapter_id: adapterId,
    executable: process.execPath,
    arguments: [paths.script, paths.scenarioFile, paths.counterFile],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: `${adapterId}-model`,
    tool_restriction_args: ['--restricted'],
  }), path.dirname(paths.script));
}

function bootWithFixture(root: string, withEvidence = true): { blackboard: CollaborationBlackboard; pipeline: DispatchPipeline } {
  const { paths } = phaseAwareFixture(root, 'happy');
  const blackboard = CollaborationBlackboard.open(path.join(root, 'data'), withEvidence ? { evidenceStore } : undefined);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approval-requests'),
    approvalRequestRoot: path.join(root, 'approval-requests'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: blackboard,
    codexDiscussionInspector: fixtureDiscussionInspector,
    contracts: {
      'codex': fixtureContract('codex', paths),
    },
  });
  return { blackboard, pipeline };
}

async function startWithPipeline(root: string, pipeline: DispatchPipeline): Promise<{ base: string }> {
  const server = await startBoardServer({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approval-requests'),
    runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    runId: 'g084-board-run',
    assignmentEpoch: 1,
    dispatch: pipeline,
    collaborationEvidenceStore: evidenceStore,
    collaborationEvidence: fixtureEvidence,
    runAdapter: async (_contract, prompt) => {
      const output = fixtureOutput(prompt);
      return { exitCode: 0, stdout: JSON.stringify(output), stderr: '', timedOut: false, childKilled: false, structuredOutput: output };
    },
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}` };
}

async function post(base: string, url: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function waitFor(base: string, sessionId: string, want: string[], timeoutMs = 20000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await post(base, '/api/collaboration/sessions/detail', { session_id: sessionId });
    const status = detail.body.status as string;
    if (want.includes(status)) return detail.body;
    if (Date.now() > deadline) throw new Error(`timeout waiting ${want.join('|')}, last=${status}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

test('看板协作闭环：创建→审批卡→批准自动获准执行→7 调用完成→详情可见观点与材料清单', async () => {
  const root = fixtureRoot('happy');
  const wired = bootWithFixture(root);
  const { base } = await startWithPipeline(root, wired.pipeline);

  // 看板页面带协作视图入口（UI 渲染安全在浏览器实测中验证）。
  const page = await fetch(base + '/');
  const html = await page.text();
  assert.match(html, /data-view="collab"/, 'board page must expose the collab view');
  assert.match(html, /function loadCollab/, 'collab view renderer must be present');

  const created = await post(base, '/api/collaboration/sessions', {
    topic: '看板闭环议题',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [
      { name: '材料一', content: '材料一正文' },
      { name: '材料二', content: '材料二正文' },
    ],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'pending_approval', '创建只生成待批准会话');
  const sessionId = created.body.session_id as string;
  const requestFile = created.body.request_file as string;
  assert.ok(existsSync(path.join(root, 'approval-requests', requestFile)), '授权卡落盘');

  const before = await post(base, '/api/collaboration/sessions/detail', { session_id: sessionId });
  assert.equal(before.body.approved, false);
  assert.equal(before.body.execution, 'not_started');
  assert.ok((before.body.snapshot as Record<string, unknown>).authorization_hash);

  const approved = await post(base, '/api/collaboration/sessions/approve', { session_id: sessionId });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approved, true, '已批准');

  const done = await waitFor(base, sessionId, ['completed']) as Record<string, unknown>;
  assert.equal(done.status, 'completed');
  assert.equal(done.approved, true);
  assert.equal(done.execution, 'settled');
  assert.equal(done.call_count, 7, '恰好 7 次调用（复用会话额度）');
  const viewpoints = done.viewpoints as Record<string, Array<Record<string, unknown>>>;
  assert.equal(viewpoints.A.length, 4);
  assert.equal(viewpoints.B.length, 3);
  const revisionA = viewpoints.A.find((v) => v.kind === 'revision') as Record<string, unknown>;
  assert.deepEqual((revisionA.material_manifest as Array<Record<string, unknown>>).map((m) => m.material_id), ['m1'], 'manifest 与实际发送一致');
});

test('看板失败闭环：runner 失败场景经共享重试耗尽后会话转 failed 并可查询', async () => {
  const root = fixtureRoot('failed');
  const { script, paths } = phaseAwareFixture(root, 'failed');
  writeFileSync(script, readFileSync(script, 'utf8').replace('console.log(JSON.stringify(base[phase] ?? {}));', 'console.log(JSON.stringify(base[phase] ?? {}));\nif (phase === "proposal" && seat === "A") process.exit(1);'));
  const blackboard = CollaborationBlackboard.open(path.join(root, 'data'), { evidenceStore });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approval-requests'),
    approvalRequestRoot: path.join(root, 'approval-requests'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: blackboard,
    codexDiscussionInspector: fixtureDiscussionInspector,
    contracts: {
      'codex': fixtureContract('codex', paths),
    },
  });
  const { base } = await startWithPipeline(root, pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: '失败闭环议题',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [
      { name: '材料一', content: '材料一正文' },
      { name: '材料二', content: '材料二正文' },
    ],
  });
  const sessionId = created.body.session_id as string;
  await post(base, '/api/collaboration/sessions/approve', { session_id: sessionId });
  const done = await waitFor(base, sessionId, ['failed'], 20000) as Record<string, unknown>;
  assert.equal(done.status, 'failed');
  assert.equal(done.call_count, 3, '协调 1 + 提案 A 正常 1 + 重试 1');
  assert.match(String((done.outcome as Record<string, unknown>)?.reason), /阶段 proposal.*runner exit 1/);
  const prior = servers.pop()!;
  await prior.close();
  const restarted = await startWithPipeline(root, pipeline);
  const restored = await post(restarted.base, '/api/collaboration/sessions/detail', { session_id: sessionId });
  assert.deepEqual(restored.body.outcome, done.outcome, 'failure evidence remains visible after restart');
});

test('整场停止：先阻止后续调用再取消在途派发；取消请求不提前显示为已停止', async () => {
  const root = fixtureRoot('stop');
  const { script, paths } = phaseAwareFixture(root, 'hang');
  writeFileSync(script, readFileSync(script, 'utf8').replace(
    'console.log(JSON.stringify(base[phase] ?? {}));',
    'if (phase === "coordination") await new Promise(r => setTimeout(r, 1500));\nconsole.log(JSON.stringify(base[phase] ?? {}));',
  ));
  const blackboard = CollaborationBlackboard.open(path.join(root, 'data'), { evidenceStore });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approval-requests'),
    approvalRequestRoot: path.join(root, 'approval-requests'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: blackboard,
    codexDiscussionInspector: fixtureDiscussionInspector,
    contracts: {
      'codex': fixtureContract('codex', paths),
    },
  });
  const { base } = await startWithPipeline(root, pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: '停止闭环议题',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [],
  });
  const sessionId = created.body.session_id as string;
  await post(base, '/api/collaboration/sessions/approve', { session_id: sessionId });
  // 等待首轮真实派发在途（会话 in_progress）。
  for (let i = 0; i < 100; i++) {
    const detail = await post(base, '/api/collaboration/sessions/detail', { session_id: sessionId });
    if (detail.body.status === 'in_progress') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const cancelled = await post(base, '/api/collaboration/sessions/cancel', { session_id: sessionId });
  assert.equal(cancelled.status, 202);
  assert.equal(cancelled.body.stop_requested, true, '停止已请求');
  assert.equal(cancelled.body.cancel_requested, true, '在途派发取消已发出');
  assert.equal(cancelled.body.status, 'in_progress', '取消请求不提前显示为已停止');
  const done = await waitFor(base, sessionId, ['interrupted'], 15000);
  assert.equal(done.status, 'interrupted');
  // 结算后停止标记被协调器清理（finally），详情以终态为准。
});

test('隔离会话在无证据库时批准被诚实拒绝（409，不静默放行）', async () => {
  const root = fixtureRoot('isolation');
  const wired = bootWithFixture(root, false);
  const contract = wired.pipeline.collaborationContract('codex');
  const legacy = wired.blackboard.createSession({ topic: '历史缺证会话', workspace_root: root, isolation_required: true,
    participants: [{ seat: 'A', adapter_id: 'codex', model_id: contract.expected_model_id, is_coordinator: true,
      config_fingerprint: contractPermissionFingerprint(contract) }, { seat: 'B', adapter_id: 'codex', model_id: contract.expected_model_id,
      config_fingerprint: contractPermissionFingerprint(contract) }] });
  wired.pipeline.createSessionAuthorizationRequest(legacy);
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: '隔离议题',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [],
    isolation_required: true,
  });
  assert.equal(created.status, 409, JSON.stringify(created.body));
  const sessionId = legacy.session_id;
  const approved = await post(base, '/api/collaboration/sessions/approve', { session_id: sessionId });
  assert.equal(approved.status, 409);
  assert.match(String(approved.body.error), /isolation admission/);
  const detail = await post(base, '/api/collaboration/sessions/detail', { session_id: sessionId });
  assert.equal(detail.body.status, 'pending_approval', '未授权会话保持待批准');
});


test('production collaboration cannot opt out of isolation through HTTP', async () => {
  const root = fixtureRoot('required-isolation');
  const wired = bootWithFixture(root);
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'default isolation',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [],
  });
  const detail = await post(base, '/api/collaboration/sessions/detail', { session_id: created.body.session_id });
  assert.equal((detail.body.snapshot as Record<string, unknown>).isolation_required, true);
  const optOut = await post(base, '/api/collaboration/sessions', {
    topic: 'not allowed',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    isolation_required: false,
  });
  assert.equal(optOut.status, 400);
});

test('rejected session is not shown as approved and has an immutable owner response', async () => {
  const root = fixtureRoot('rejected-state');
  const wired = bootWithFixture(root);
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'reject me',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [],
  });
  await post(base, '/api/collaboration/sessions/reject', { session_id: created.body.session_id });
  const detail = await post(base, '/api/collaboration/sessions/detail', { session_id: created.body.session_id });
  assert.equal(detail.body.status, 'cancelled');
  assert.equal(detail.body.approved, false);
  const responsePath = path.join(root, 'approval-requests', String(created.body.request_file) + '.owner-response.json');
  assert.ok(existsSync(responsePath));
  assert.equal(JSON.parse(readFileSync(responsePath, 'utf8')).owner_decision, 'REJECTED');
});

test('server restart retains persisted pending sessions without dispatching them', async () => {
  const root = fixtureRoot('restore');
  const wired = bootWithFixture(root);
  const first = await startWithPipeline(root, wired.pipeline);
  const created = await post(first.base, '/api/collaboration/sessions', {
    topic: 'persisted session',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [],
  });
  const prior = servers.pop()!;
  await prior.close();
  const next = await startWithPipeline(root, wired.pipeline);
  const list = await (await fetch(next.base + '/api/collaboration/sessions')).json() as { sessions: Array<{ session_id: string }> };
  assert.ok(list.sessions.some(s => s.session_id === created.body.session_id));
  const detail = await post(next.base, '/api/collaboration/sessions/detail', { session_id: created.body.session_id });
  assert.equal(detail.body.status, 'pending_approval');
  assert.equal(detail.body.call_count, 0);
});


test('board inline scripts remain syntactically valid after collaboration UI changes', () => {
  const scripts = [...renderBoardPage().matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Script(script[1]));
});



test('common approval endpoint shares the immutable session response and start path', async () => {
  const root = fixtureRoot('shared-approval');
  const wired = bootWithFixture(root);
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'common approval',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [{ name: 'one', content: 'first' }, { name: 'two', content: 'second' }],
  });
  const approved = await post(base, '/api/approvals/respond', {
    request_file: created.body.request_file, decision: 'APPROVED',
  });
  assert.equal(approved.status, 201);
  const done = await waitFor(base, String(created.body.session_id), ['completed']);
  assert.equal(done.call_count, 7);
  const again = await post(base, '/api/collaboration/sessions/approve', { session_id: created.body.session_id });
  assert.equal(again.status, 409);
});

test('startup marks unconfirmed persisted calls interrupted and never replays them', async () => {
  const root = fixtureRoot('orphan');
  const wired = bootWithFixture(root);
  const { session_id } = wired.blackboard.createSession({
    topic: 'orphan', workspace_root: root,
    participants: [{ seat: 'A', adapter_id: 'codex', is_coordinator: true }, { seat: 'B', adapter_id: 'codex' }],
  });
  wired.blackboard.authorizeSession(session_id);
  wired.blackboard.occupyCall(session_id, 'normal', 'A');
  const { base } = await startWithPipeline(root, wired.pipeline);
  const detail = await post(base, '/api/collaboration/sessions/detail', { session_id });
  assert.equal(detail.body.status, 'interrupted');
  assert.equal(detail.body.call_count, 1);
  assert.equal((detail.body.execution_log as Array<Record<string, unknown>>)[0].status, 'interrupted');
  assert.equal(detail.body.execution, 'settled');
});

test('stop during async preflight prevents the first model call', async () => {
  const root = fixtureRoot('preflight-stop');
  const wired = bootWithFixture(root);
  const script = wired.pipeline.getContractMap()['codex'].arguments[0];
  const marker = path.join(root, 'model-spawned');
  writeFileSync(script, "import { writeFileSync as writeSpawnMarker } from 'node:fs';\nwriteSpawnMarker(" + JSON.stringify(marker) + ", 'yes');\n" + readFileSync(script, 'utf8'));
  const { base } = await startWithPipeline(root, wired.pipeline);
  let release!: () => void, reached!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const result = { adapter_id: 'codex', level_reached: 0 as const, ok: true, label: 'PROCESS_ONLY' as const, detail: 'fixture', checked_at_utc: new Date().toISOString() };
  wired.pipeline.setLivenessGate({
    check: async () => { reached(); await waiting; return result; },
    refresh: async () => result, snapshot: () => [],
  });
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'cancel before spawn', participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [{ name: 'one', content: 'first' }, { name: 'two', content: 'second' }],
  });
  try {
    await post(base, '/api/collaboration/sessions/approve', { session_id: created.body.session_id });
    await entered;
    await post(base, '/api/collaboration/sessions/cancel', { session_id: created.body.session_id });
  } finally { release(); }
  const done = await waitFor(base, String(created.body.session_id), ['interrupted']);
  assert.deepEqual({ calls: done.call_count, spawned: existsSync(marker) }, { calls: 0, spawned: false }, 'stopped preflight must not occupy or spawn');
});

test('approval refuses a changed execution contract before recording an owner response', async () => {
  const root = fixtureRoot('stale-contract');
  const wired = bootWithFixture(root);
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'stale contract', participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
  });
  const contracts = wired.pipeline.getContractMap();
  contracts['codex'] = validateAdapterContract({ ...contracts['codex'], tool_restriction_args: ['--unrestricted'] });
  const approval = await post(base, '/api/collaboration/sessions/approve', { session_id: created.body.session_id });
  assert.equal(approval.status, 409);
  assert.match(String(approval.body.error), /configuration|fingerprint/);
  assert.equal(existsSync(path.join(root, 'approval-requests', String(created.body.request_file) + '.owner-response.json')), false);
  assert.equal(wired.blackboard.getSession(String(created.body.session_id)).call_count, 0);
});

test('common approval endpoint resolves the session original approval root after a workspace switch', async () => {
  const root = fixtureRoot('cross-workspace-approval');
  const target = path.join(root, 'external');
  mkdirSync(target);
  const wired = bootWithFixture(root);
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'pending across switch', participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [{ name: 'one', content: 'first' }, { name: 'two', content: 'second' }],
  });
  assert.equal((await post(base, '/api/workspaces/select', { path: target })).status, 201);
  const approved = await post(base, '/api/approvals/respond', { request_file: created.body.request_file, decision: 'APPROVED' });
  assert.equal(approved.status, 201);
  const done = await waitFor(base, String(created.body.session_id), ['completed']);
  assert.equal(done.call_count, 7);
  assert.equal((done.snapshot as Record<string, unknown>).workspace_root, root);
  assert.deepEqual(readdirSync(target), []);
});

test('workspace switch preserves active session binding and keeps external folder untouched', async () => {
  const root = fixtureRoot('workspace-binding');
  const target = path.join(root, 'external-workspace');
  mkdirSync(target);
  const wired = bootWithFixture(root);
  const script = wired.pipeline.getContractMap()['codex'].arguments[0];
  writeFileSync(script, readFileSync(script, 'utf8').replace(
    'console.log(JSON.stringify(base[phase] ?? {}));',
    'if (phase === "coordination") await new Promise(r => setTimeout(r, 1500));\nconsole.log(JSON.stringify(base[phase] ?? {}));',
  ));
  const { base } = await startWithPipeline(root, wired.pipeline);
  const created = await post(base, '/api/collaboration/sessions', {
    topic: 'bound to original workspace',
    participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
    materials: [{ name: 'one', content: 'first' }, { name: 'two', content: 'second' }],
  });
  await post(base, '/api/collaboration/sessions/approve', { session_id: created.body.session_id });
  await waitFor(base, String(created.body.session_id), ['in_progress']);
  const switched = await post(base, '/api/workspaces/select', { path: target });
  assert.equal(switched.status, 201);
  const original = await waitFor(base, String(created.body.session_id), ['completed']);
  assert.equal((original.snapshot as Record<string, unknown>).workspace_root, root);
  assert.equal(original.call_count, 7);
  const external = await post(base, '/api/collaboration/sessions', {
    topic: 'external metadata belongs on host',
    participants: [{ adapter_id: 'claude-code' }, { adapter_id: 'claude-code' }],
    materials: [{ name: 'one', content: 'first' }, { name: 'two', content: 'second' }],
  });
  assert.equal(external.status, 409, 'new workspace must activate its own discussion profile');
  assert.deepEqual(readdirSync(target), [], 'workspace switching and refused creation leave the external folder untouched');
});
