/** GOAL-084 §3.3：单场会话授权——审批卡复用、隔离准入门、原子额度占用、撤销、
 * 边界变化、预算拒绝不占额、旧 D30 派发不受影响。本地 fixture，零模型调用。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import {
  CollaborationBlackboard,
  ISOLATION_DIMENSIONS,
  type CollabCapabilityEvidence,
  type CollabParticipantInput,
  type EvidenceStoreLike,
} from '../src/orchestration/collaboration-blackboard.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { COLLAB_SKILL_TEMPLATES, collabSkillRegistrySha256 } from '../src/orchestration/collaboration-skills.ts';

test('session effort is frozen per seat; higher or omitted effort never starts a runner or occupies quota', async () => {
  const root = fixtureRoot('effort-binding'), bb = CollaborationBlackboard.open(root);
  const created = bb.createSession({ topic: 'fixture', workspace_root: root, participants: [
    { seat: 'A', adapter_id: 'unapproved', model_id: 'm1', effort: 'LOW', is_coordinator: true },
    { seat: 'B', adapter_id: 'unapproved', model_id: 'm1', effort: 'HIGH' },
  ] });
  bb.authorizeSession(created.session_id); let runs = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root,'approvals'), ledgerPath: path.join(root,'ledger'),
    collabBlackboard: bb, contracts: { unapproved: unapprovedContract(root) }, runAdapter: async () => { runs++; return {
      exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }; } });
  for (const effort of ['HIGH', undefined]) {
    await assert.rejects(() => pipeline.dispatch({ adapter_id: 'unapproved', model_id: 'm1', prompt: 'fixture', real: true, ...(effort ? { effort } : {}) },
      { collab: { session_id: created.session_id, seat: 'A' } }), /effort.*approved/);
  }
  assert.equal(runs, 0); assert.equal(bb.getSession(created.session_id).call_count, 0);
  const passed = await pipeline.dispatch({ adapter_id:'unapproved',model_id:'m1',effort:'LOW',prompt:'fixture',real:true },
    { collab:{session_id:created.session_id,seat:'A'} });
  assert.equal(passed.status, 'PASS'); assert.equal(runs, 1);
});

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g084-auth-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function echoFixture(root: string): string {
  const script = path.join(root, 'echo-argv.mjs');
  writeFileSync(script, [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(path.join(root, 'spawned.marker'))}, 'spawned');`,
    'const args = process.argv.slice(2);',
    "console.log('ARGV ' + JSON.stringify(args));",
    '',
  ].join('\n'), 'utf8');
  return script;
}

function claudeEchoContract(root: string): AdapterContract {
  const base = buildClaudeContract('claude-sonnet-4-5');
  return validateAdapterContract({
    ...base,
    executable: process.execPath,
    arguments: [echoFixture(root), ...base.arguments],
  });
}

function unapprovedContract(root: string): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'unapproved',
    executable: process.execPath,
    arguments: [echoFixture(root)],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: 'm1',
    model_flag: '-m',
    variants: ['m1', 'm2'],
    tool_restriction_args: ['--restricted'],
  });
}

function makePipeline(root: string, bb?: CollaborationBlackboard): DispatchPipeline {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb,
    contracts: { 'claude-code': claudeEchoContract(root), unapproved: unapprovedContract(root) },
  });
}

function participants(): Array<{ seat: 'A' | 'B'; adapter_id: string; is_coordinator?: boolean }> {
  return [
    { seat: 'A', adapter_id: 'claude-code', is_coordinator: true },
    { seat: 'B', adapter_id: 'claude-code' },
  ];
}

/** 两通道 × 五隔离维度的行为级证据（合成，授权快照冻结后由 owner 批准）。 */
function liveEvidence(
  adapters: string[],
  configFingerprint = 'cfg-test',
  method = 'live_probe',
): CollabCapabilityEvidence[] {
  return adapters.flatMap((adapter_id) =>
    ISOLATION_DIMENSIONS.map((dimension) => ({
      adapter_id,
      dimension,
      subject: 'fixture flags',
      method,
      coverage: 'behavior',
      tool_version: 'fixture',
      config_fingerprint: configFingerprint,
      source: `fixture://behavior-probe/${adapter_id}/${dimension}`,
      verification: 'behavior' as const,
      status: 'live_verified' as const,
    })));
}

/** 合成受控证据库：按证据条目登记逐字段匹配的记录（owner 指定的测试姿势）。 */
function makeEvidenceStore(entries: CollabCapabilityEvidence[], overrides?: Partial<Record<string, { result: 'pass' | 'fail' } | undefined>>): EvidenceStoreLike {
  const map = new Map<string, NonNullable<ReturnType<EvidenceStoreLike['resolve']>>>();
  for (const e of entries) {
    const key = e.source ?? '';
    const override = overrides?.[key];
    map.set(key, {
      source: key,
      adapter_id: e.adapter_id,
      dimension: e.dimension,
      method: e.method,
      subject: e.subject,
      coverage: e.coverage,
      tool_version: e.tool_version ?? '',
      config_fingerprint: e.config_fingerprint ?? '',
      verification: e.verification,
      artifact_sha256: 'a'.repeat(64),
      result: override?.result ?? 'pass',
      recorded_at_utc: '2026-10-01T00:00:00Z',
    });
  }
  return {
    resolve: (source) => map.get(source),
    // D89 必要条件：与 resolve 同一口径列出同通道+指纹+维度的反例。
    failuresFor: (adapterId, configFingerprint, dimension) => [...map.values()].filter((r) =>
      r.result === 'fail' && r.adapter_id === adapterId && r.config_fingerprint === configFingerprint && r.dimension === dimension),
  };
}

function makeBlackboard(root: string, evidence?: CollabCapabilityEvidence[]): CollaborationBlackboard {
  return CollaborationBlackboard.open(root, evidence === undefined ? undefined : { evidenceStore: makeEvidenceStore(evidence) });
}

test('隔离会话准入门：席位未声明指纹即拒；缺任一维度行为级证据即拒；非隔离会话正常授权', () => {
  const root = fixtureRoot('isolation-gate');
  const bb = makeBlackboard(root, liveEvidence(['claude-code']));
  const fingerprinted = [
    { seat: 'A' as const, adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: 'cfg-test' },
    { seat: 'B' as const, adapter_id: 'claude-code', config_fingerprint: 'cfg-test' },
  ];
  const isolated = bb.createSession({
    topic: '隔离议题', workspace_root: root, participants: fingerprinted, isolation_required: true,
  });
  assert.throws(() => bb.authorizeSession(isolated.session_id), /isolation admission.*缺行为级（live_verified）证据/);
  const mixed = [
    { seat: 'A' as const, adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: 'cfg-test' },
    { seat: 'B' as const, adapter_id: 'codex', config_fingerprint: 'cfg-codex' },
  ];
  const partial = bb.createSession({
    topic: '部分证据', workspace_root: root, participants: mixed, isolation_required: true,
    capability_evidence: liveEvidence(['claude-code']),
  });
  assert.throws(() => bb.authorizeSession(partial.session_id), /isolation admission.*席位 B/);
  const plain = bb.createSession({ topic: '模拟会话', workspace_root: root, participants: participants() });
  bb.authorizeSession(plain.session_id);
  assert.equal(bb.getSession(plain.session_id).status, 'authorized');
});

test('隔离会话证据齐备（每席位×五维 live_verified）→ 授权通过', () => {
  const root = fixtureRoot('isolation-ok');
  const bb = makeBlackboard(root, liveEvidence(['claude-code', 'codex']));
  const { session_id } = bb.createSession({
    topic: '隔离议题', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: 'cfg-test' },
      { seat: 'B', adapter_id: 'codex', config_fingerprint: 'cfg-test' },
    ],
    isolation_required: true,
    capability_evidence: liveEvidence(['claude-code', 'codex']),
  });
  bb.authorizeSession(session_id);
  assert.equal(bb.getSession(session_id).status, 'authorized');
});

test('会话授权卡：复用审批目录、重复创建拒绝、APPROVED/REJECTED 状态机、重复应答拒绝', () => {
  const root = fixtureRoot('session-card');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({ topic: '待批会话', workspace_root: root, participants: participants() });
  const { request_file } = pipeline.createSessionAuthorizationRequest({ session_id });
  const cardPath = path.join(root, 'goals', 'receipts', 'approval-requests', request_file);
  assert.ok(existsSync(cardPath), 'session card lives in the shared approval-requests dir');
  const card = JSON.parse(readFileSync(cardPath, 'utf8')) as Record<string, unknown>;
  assert.equal(card.kind, 'collab-session');
  assert.equal(card.gate, 'GOAL-084-session-authorization');
  // 卡片字段全部来自冻结快照（所见即所批）：议题/参与者/边界/快照哈希。
  assert.equal(card.topic, '待批会话');
  assert.deepEqual(card.participants, participants());
  assert.equal(card.single_call_timeout_s, 180);
  assert.equal(card.call_limit, 7);
  assert.equal(card.authorization_hash, bb.getSession(session_id).authorization_hash);
  assert.throws(() => pipeline.createSessionAuthorizationRequest({ session_id }), /already exists/);
  assert.deepEqual(pipeline.respondSessionApproval(session_id, 'APPROVED'), { session_id, status: 'authorized' });
  assert.throws(() => pipeline.respondSessionApproval(session_id, 'APPROVED'), /status authorized/);
  const second = bb.createSession({ topic: '否决会话', workspace_root: root, participants: participants() });
  pipeline.respondSessionApproval(second.session_id, 'REJECTED');
  assert.equal(bb.getSession(second.session_id).status, 'cancelled');
});

test('collab 派发：单场授权替代 D30 卡，原子占额并如实结算执行记录', async () => {
  const root = fixtureRoot('collab-dispatch');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({ topic: '执行会话', workspace_root: root, participants: participants() });
  bb.authorizeSession(session_id);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'long task', real: true, timeout_s: 30 },
    { collab: { session_id, seat: 'A' } },
  );
  assert.equal(record.status, 'PASS', 'session-authorized dispatch runs without a D30 card');
  const session = bb.getSession(session_id);
  assert.equal(session.status, 'in_progress');
  assert.equal(session.call_count, 1);
  const log = bb.getExecutionLog(session_id);
  assert.equal(log.length, 1);
  assert.equal(log[0].status, 'pass');
  assert.equal(log[0].seat, 'A');
  const approvalDir = path.join(root, 'goals', 'receipts', 'approval-requests');
  const dispatchCards = existsSync(approvalDir)
    ? readdirSync(approvalDir).filter((f) => f.startsWith('dispatch-'))
    : [];
  assert.deepEqual(dispatchCards, [], 'collab dispatch must not create a per-dispatch D30 card');
});

test('会话额度：8 次调用占满后 collab 派发拒绝（正常 7 + 共享重试 1）', async () => {
  const root = fixtureRoot('quota-exhaust');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({ topic: '额度会话', workspace_root: root, participants: participants() });
  bb.authorizeSession(session_id);
  const kinds: Array<'normal' | 'retry'> = [
    'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'retry',
  ];
  for (const kind of kinds) {
    await pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'round', real: true, timeout_s: 30 },
      { collab: { session_id, seat: 'A', kind } },
    );
  }
  assert.equal(bb.getSession(session_id).call_count, 8);
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'round', real: true, timeout_s: 30 },
      { collab: { session_id, seat: 'B', kind: 'normal' } },
    ),
    /collab session quota/,
  );
});

test('撤销与终态：已取消会话拒绝 collab 派发；工作区绑定不可迁移', async () => {
  const root = fixtureRoot('revoke');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const cancelled = bb.createSession({ topic: '取消会话', workspace_root: root, participants: participants() });
  bb.authorizeSession(cancelled.session_id);
  bb.closeSession(cancelled.session_id, 'cancelled');
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'round', real: true, timeout_s: 30 },
      { collab: { session_id: cancelled.session_id, seat: 'A' } },
    ),
    /collab session quota/,
  );
  const elsewhere = fixtureRoot('revoke-other');
  const migrated = bb.createSession({ topic: '跨区会话', workspace_root: elsewhere, participants: participants() });
  bb.authorizeSession(migrated.session_id);
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'round', real: true, timeout_s: 30 },
      { collab: { session_id: migrated.session_id, seat: 'A' } },
    ),
    /bound to its creation workspace/,
  );
});

test('预算拒绝不占额：cap 校验失败发生在会话占额之前', async () => {
  const root = fixtureRoot('budget-refuse');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({ topic: '预算会话', workspace_root: root, participants: participants() });
  bb.authorizeSession(session_id);
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'round', real: true, timeout_s: 30, cap_usd: 9999 },
      { collab: { session_id } },
    ),
    /cannot exceed server configured budget cap/,
  );
  assert.equal(bb.getSession(session_id).call_count, 0, '预算拒绝不得消耗会话额度');
});

test('旧 D30 派发不受影响：无 collab/originOwner 的 real 派发仍逐单停卡', async () => {
  const root = fixtureRoot('d30-intact');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'ordinary task', real: true, timeout_s: 30 },
    {},
  );
  assert.equal(record.status, 'BLOCKED_WAITING_OWNER', 'D30 gate must stay in force for non-session dispatches');
  const approvalDir = path.join(root, 'goals', 'receipts', 'approval-requests');
  assert.ok(readdirSync(approvalDir).some((f) => f.startsWith('dispatch-')), 'D30 card created as before');
});

// ---- 2026-10-01 Codex 复核轮三（owner 转呈）：授权范围四处负向回归 ----
// （复现脚本 .test-fixtures/g084-authorization-scope-review.mjs；重点断言：
//   越界请求在启动子进程【spawned.marker 不出现】和占用会话额度【call_count=0】之前被拒绝。）

test('席位/通道/模型绑定：缺席位、越权适配器、换模型、未批准选模型全部拒绝且零副作用', async () => {
  const root = fixtureRoot('seat-binding');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({
    topic: '绑定会话', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'claude-code', model_id: 'claude-sonnet-4-5', is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code', model_id: 'claude-sonnet-4-5' },
    ],
  });
  bb.authorizeSession(session_id);
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 30 },
      { collab: { session_id } },
    ),
    /explicit seat/,
  );
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'unapproved', prompt: 'x', real: true, timeout_s: 30 },
      { collab: { session_id, seat: 'A' } },
    ),
    /not authorized for seat A \(approved: claude-code\)/,
  );
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', prompt: 'x', real: true, timeout_s: 30 },
      { collab: { session_id, seat: 'A' } },
    ),
    /not the approved model for seat A/,
  );
  const noModelSeat = bb.createSession({
    topic: '未批准选模型', workspace_root: root, participants: participants(),
  });
  bb.authorizeSession(noModelSeat.session_id);
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', prompt: 'x', real: true, timeout_s: 30 },
      { collab: { session_id: noModelSeat.session_id, seat: 'A' } },
    ),
    /model selection was not approved for this seat/,
  );
  assert.equal(bb.getSession(session_id).call_count, 0, '越界请求不得占用会话额度');
  assert.equal(bb.getSession(noModelSeat.session_id).call_count, 0);
  assert.ok(!existsSync(path.join(root, 'spawned.marker')), '越界请求不得启动子进程');
});

test('隔离会话执行配置从冻结授权派生：遗漏 restrictTools 仍强制注入限制参数', async () => {
  const root = fixtureRoot('isolation-force');
  const approvedFingerprint = contractPermissionFingerprint(claudeEchoContract(root));
  const evidence = liveEvidence(['claude-code'], approvedFingerprint, 'behavior_test');
  const bb = makeBlackboard(root, evidence);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({
    topic: '强制隔离', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: approvedFingerprint },
      { seat: 'B', adapter_id: 'claude-code', config_fingerprint: approvedFingerprint },
    ],
    isolation_required: true,
    capability_evidence: evidence,
  });
  bb.authorizeSession(session_id);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 30 },
    { collab: { session_id, seat: 'A' } }, // 不带 restrictTools
  );
  assert.equal(record.status, 'PASS');
  const argvLine = (record.stdout_tail?.text ?? '').split(/\r?\n/).find((l) => l.startsWith('ARGV '));
  assert.ok(argvLine, 'fixture echoed argv');
  const argv = JSON.parse(argvLine.slice('ARGV '.length)) as string[];
  const toolsAt = argv.indexOf('--tools');
  assert.notEqual(toolsAt, -1, '隔离会话的限制参数必须强制下发');
  assert.equal(argv[toolsAt + 1], '');
  assert.notEqual(argv.indexOf('--strict-mcp-config'), -1);
});

test('单次超时上限：显式超出冻结授权即拒（零副作用）；缺省回落到授权上限', async () => {
  const root = fixtureRoot('timeout-cap');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  const { session_id } = bb.createSession({
    topic: '超时上限', workspace_root: root, participants: participants(), single_call_timeout_s: 1,
  });
  bb.authorizeSession(session_id);
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 30 },
      { collab: { session_id, seat: 'A' } },
    ),
    /exceeds the session single-call limit 1s/,
  );
  assert.equal(bb.getSession(session_id).call_count, 0);
  assert.ok(!existsSync(path.join(root, 'spawned.marker')));
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'x', real: true },
    { collab: { session_id, seat: 'A' } },
  );
  assert.equal(record.status, 'PASS', '缺省超时回落到授权上限后正常执行');
  assert.equal(record.request?.timeout_s, 1, '快照记录实际生效的超时');
});

test('证据硬化：help 方法/声明覆盖/指纹不匹配的 live_verified 标签不构成准入', () => {
  const root = fixtureRoot('evidence-hardening');
  const matching = ISOLATION_DIMENSIONS.map((dimension) => ({
    adapter_id: 'claude-code', dimension, subject: 'behavior probe', method: 'behavior_test',
    coverage: 'behavior enforced', tool_version: '2.1.281', config_fingerprint: 'cfg-A',
    source: `fixture://behavior-probe/${dimension}`, verification: 'behavior' as const, status: 'live_verified' as const,
  }));
  const bb = makeBlackboard(root, matching);
  const contradictory = ISOLATION_DIMENSIONS.map((dimension) => ({
    adapter_id: 'claude-code', dimension, subject: 'help only', method: 'help',
    coverage: 'declaration', tool_version: 'old-unrelated', config_fingerprint: 'old-unrelated',
    verification: 'behavior' as const, status: 'live_verified' as const,
  }));
  const mismatched = ISOLATION_DIMENSIONS.map((dimension) => ({
    adapter_id: 'claude-code', dimension, subject: 'behavior probe', method: 'behavior_test',
    coverage: 'behavior enforced', tool_version: '2.1.281', config_fingerprint: 'other-config',
    verification: 'behavior' as const, status: 'live_verified' as const,
  }));
  const withFingerprint = [
    { seat: 'A' as const, adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: 'cfg-A' },
    { seat: 'B' as const, adapter_id: 'claude-code', config_fingerprint: 'cfg-A' },
  ];
  const s1 = bb.createSession({
    topic: '矛盾证据', workspace_root: root, participants: withFingerprint,
    isolation_required: true, capability_evidence: contradictory,
  });
  assert.throws(() => bb.authorizeSession(s1.session_id), /isolation admission/);
  const s2 = bb.createSession({
    topic: '指纹不匹配', workspace_root: root, participants: withFingerprint,
    isolation_required: true, capability_evidence: mismatched,
  });
  assert.throws(() => bb.authorizeSession(s2.session_id), /isolation admission/);
  const s3 = bb.createSession({
    topic: '指纹一致', workspace_root: root, participants: withFingerprint,
    isolation_required: true, capability_evidence: matching,
  });
  bb.authorizeSession(s3.session_id);
  assert.equal(bb.getSession(s3.session_id).status, 'authorized');
});

test('执行配置指纹：派发时换限制配置（同适配器同模型）即拒——不 spawn 不占额', async () => {
  const root = fixtureRoot('config-fingerprint');
  const approvedFingerprint = contractPermissionFingerprint(claudeEchoContract(root));
  const evidence = liveEvidence(['claude-code'], approvedFingerprint, 'behavior_test');
  const bb = makeBlackboard(root, evidence);
  const { session_id } = bb.createSession({
    topic: '指纹会话', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: approvedFingerprint },
      { seat: 'B', adapter_id: 'claude-code', config_fingerprint: approvedFingerprint },
    ],
    isolation_required: true,
    capability_evidence: liveEvidence(['claude-code'], approvedFingerprint, 'behavior_test'),
  });
  bb.authorizeSession(session_id);
  const approvedPipeline = makePipeline(root, bb);
  const okRecord = await approvedPipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 30 },
    { collab: { session_id, seat: 'A' } },
  );
  assert.equal(okRecord.status, 'PASS', '批准配置下正常执行');
  const changedContract = validateAdapterContract({
    ...claudeEchoContract(root),
    tool_restriction_args: ['--sandbox', 'danger-full-access'],
  });
  const changedPipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb,
    contracts: { 'claude-code': changedContract },
  });
  await assert.rejects(
    changedPipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 30 },
      { collab: { session_id, seat: 'A' } },
    ),
    /does not match the approved config/,
  );
  assert.equal(bb.getSession(session_id).call_count, 1, '换配置派发不占额（仅首次已占 1 次）');
  assert.equal(bb.getExecutionLog(session_id).length, 1);
});

test('证据按席位核验：同适配器两席位不同指纹，仅 A 有证据 → 席位 B 被拒', () => {
  const root = fixtureRoot('per-seat-evidence');
  const bb = makeBlackboard(root, liveEvidence(['claude-code'], 'cfg-A', 'behavior_test'));
  const { session_id } = bb.createSession({
    topic: '双席位双配置', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: 'cfg-A' },
      { seat: 'B', adapter_id: 'claude-code', config_fingerprint: 'cfg-B' },
    ],
    isolation_required: true,
    capability_evidence: liveEvidence(['claude-code'], 'cfg-A', 'behavior_test'),
  });
  assert.throws(() => bb.authorizeSession(session_id), /席位 B/);
});

test('整场截止时间：首次占额确定 deadline，过期后拒绝派发且不占额不结算', async () => {
  const root = fixtureRoot('session-deadline');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = makePipeline(root, bb);
  // 1.2s 会话：首次调用（~0.2s）在截止前完成，二次派发前已过期。
  const { session_id } = bb.createSession({
    topic: '短会话', workspace_root: root, participants: participants(), session_timeout_min: 0.02,
  });
  bb.authorizeSession(session_id);
  assert.equal(bb.getSession(session_id).deadline_utc, null, '截止时间在首次占额前未确定');
  const first = await pipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 5 },
    { collab: { session_id, seat: 'A' } },
  );
  assert.equal(first.status, 'PASS');
  const deadline = bb.getSession(session_id).deadline_utc;
  assert.ok(typeof deadline === 'string' && deadline.length > 0, '首次成功占额确定整场截止时间');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'claude-code', prompt: 'x', real: true, timeout_s: 5 },
      { collab: { session_id, seat: 'A' } },
    ),
    /deadline exceeded/,
  );
  assert.equal(bb.getSession(session_id).call_count, 1, '过期派发不占额');
  assert.equal(bb.getExecutionLog(session_id).length, 1, '过期派发不产生执行记录');
});

// ---- 2026-10-01 Codex 复核轮四（owner 转呈）：证据来源必须可在受控证据库核验 ----
// （复现脚本 .test-fixtures/g084-evidence-source-review.mjs：source 只查非空，
//   不存在的回执路径也能授权。）

test('证据来源核验：来源未登记、登记结果 fail、无证据库三种情形均保持未验证', () => {
  const root = fixtureRoot('evidence-source');
  const evidence = liveEvidence(['claude-code'], 'cfg-test', 'behavior_test');
  const participantsWithFp: CollabParticipantInput[] = [
    { seat: 'A', adapter_id: 'claude-code', is_coordinator: true, config_fingerprint: 'cfg-test' },
    { seat: 'B', adapter_id: 'claude-code', config_fingerprint: 'cfg-test' },
  ];
  // 来源已在受控证据库登记且逐字段匹配 → 授权通过。
  const withStore = makeBlackboard(root + '-with-store', evidence);
  const s1 = withStore.createSession({
    topic: '已登记证据', workspace_root: root, participants: participantsWithFp,
    isolation_required: true, capability_evidence: evidence,
  });
  withStore.authorizeSession(s1.session_id);
  assert.equal(withStore.getSession(s1.session_id).status, 'authorized');

  // 来源未登记（解析不到记录）→ 拒绝。
  const unregistered = makeEvidenceStore(evidence.slice(0, 4)); // 少登记 1 个维度
  const bbUnregistered = CollaborationBlackboard.open(root + '-unregistered', { evidenceStore: unregistered });
  const s2 = bbUnregistered.createSession({
    topic: '来源未登记', workspace_root: root, participants: participantsWithFp,
    isolation_required: true, capability_evidence: evidence,
  });
  assert.throws(() => bbUnregistered.authorizeSession(s2.session_id), /isolation admission/);

  // 登记记录验证结果为 fail → 该配置已被证伪：D89 下创建即拒（政策不能覆盖失败反例）。
  const overrides: Record<string, { result: 'fail' }> = {};
  for (const e of evidence) overrides[e.source!] = { result: 'fail' };
  const bbFailed = CollaborationBlackboard.open(root + '-failed', { evidenceStore: makeEvidenceStore(evidence, overrides) });
  assert.throws(() => bbFailed.createSession({
    topic: '验证未通过', workspace_root: root, participants: participantsWithFp,
    isolation_required: true, capability_evidence: evidence,
  }), /已有失败反例|isolation admission/);

  // 完全没有证据库（宿主未注入）→ 隔离会话无法准入（fail-closed）：创建后批准被拒。
  const bbNoStore = CollaborationBlackboard.open(root + '-no-store');
  const s4 = bbNoStore.createSession({
    topic: '无证据库', workspace_root: root, participants: participantsWithFp,
    isolation_required: true, capability_evidence: evidence,
  });
  assert.throws(() => bbNoStore.authorizeSession(s4.session_id), /isolation admission/);
});

test('§3.4 skill 模板：四种版本固定模板，注册表哈希冻结进授权快照', () => {
  const root = fixtureRoot('skills');
  assert.deepEqual(COLLAB_SKILL_TEMPLATES.map((t) => t.kind), ['coordination', 'proposal', 'review', 'revision']);
  for (const t of COLLAB_SKILL_TEMPLATES) {
    assert.match(t.sha256, /^[0-9a-f]{64}$/);
    assert.match(t.body, /只输出一个 JSON 对象/, '每份模板带机器可检的输出契约');
    assert.match(t.body, /【禁止】/, '每份模板声明执行边界');
    assert.doesNotMatch(t.body, /允许执行脚本|可运行脚本/, '首版不执行 skill 附带脚本');
  }
  const bb = CollaborationBlackboard.open(root + '-skills');
  const { session_id } = bb.createSession({
    topic: '模板哈希', workspace_root: root, participants: participants(),
  });
  assert.equal(bb.getAuthorizationSnapshot(session_id).skill_registry_sha256, collabSkillRegistrySha256());
});


test('collaboration rounds never inherit ordinary work-stream history, project text or native resume', async () => {
  for (const mode of ['none', 'auto-compact'] as const) {
    const root = fixtureRoot('no-ambient-' + mode), bb = makeBlackboard(root);
    writeFileSync(path.join(root, 'AGENTS.md'), 'UNAPPROVED_PROJECT_TEXT');
    const calls: Array<{ prompt: string; args: readonly string[] }> = [];
    const contract = validateAdapterContract({ ...claudeEchoContract(root), context_management: mode });
    const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'approvals'),
      ledgerPath: path.join(root, 'ledger'), collabBlackboard: bb, contracts: { 'claude-code': contract },
      runAdapter: async (c, prompt) => { calls.push({ prompt, args: [...c.arguments] }); return {
        exitCode: 0, stdout: 'UNAPPROVED_OTHER_ROOM_OUTPUT', stderr: '', timedOut: false, childKilled: false,
        sessionId: 'foreign-native-session' }; } });
    await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'ordinary room', goal_id: 'GOAL-084', real: true }, { originOwner: true });
    const session = bb.createSession({ topic: 'new room', workspace_root: root, participants: participants() });
    bb.authorizeSession(session.session_id);
    const result = await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'COORDINATOR_CONTEXT_ONLY', goal_id: 'GOAL-084', real: true },
      { collab: { session_id: session.session_id, seat: 'A' } });
    assert.equal(result.status, 'PASS');
    assert.equal(calls[1].prompt, 'COORDINATOR_CONTEXT_ONLY');
    assert.ok(!calls[1].args.includes('foreign-native-session'));
    assert.equal(result.request?.resume_session, undefined);
    const before = bb.getSession(session.session_id).call_count;
    for (const field of [{ resume_session: 'foreign-native-session' }, { stream_id: 'foreign-stream' }, { new_stream: true }]) {
      await assert.rejects(() => pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'round', real: true, ...field },
        { collab: { session_id: session.session_id, seat: 'A' } }), /collab.*(resume|stream|context)/i);
    }
    assert.equal(calls.length, 2, 'invalid context controls never execute');
    assert.equal(bb.getSession(session.session_id).call_count, before);
    bb.close();
  }
});
