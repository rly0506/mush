/** GOAL-084 D89 条件化准入 + 显式证据分类（2026-10-04 owner 裁定）。
 *  本地 fixture，零模型调用：验证"已知缺口"只在宿主政策逐条接受时才放行，
 *  缺口集合随快照冻结并在审批卡可见，且证据等级不因政策分支改变。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import {
  CollaborationBlackboard,
  ISOLATION_DIMENSIONS,
  type CollabCapabilityEvidence,
  type EvidenceStoreLike,
  type EvidenceRecord,
} from '../src/orchestration/collaboration-blackboard.ts';
import {
  AdmissionPolicyError,
  loadAdmissionPolicy,
  policyGapFor,
  type AdmissionPolicy,
} from '../src/orchestration/collaboration-admission-policy.ts';
import { contractPermissionFingerprint, validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { collectBoardSnapshot } from '../src/web/sources.ts';
import { renderBoardPage } from '../src/web/page.ts';

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const HEX = (n: string): string => n.repeat(64).slice(0, 64);

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g084-policy-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function fakeFixture(root: string): AdapterContract {
  const script = path.join(root, 'echo-fixture.mjs');
  writeFileSync(script, "console.log('{}');\n", 'utf8');
  return validateAdapterContract({
    adapter_id: 'fake-policy', executable: process.execPath, arguments: [script],
    protocol: 't1', prompt_transport: 'argument', expected_provider: 'fake',
    expected_model_id: 'm1', tool_restriction_args: ['--restricted'],
  });
}

/** 只含 tool_scope + mcp_scope 的行为级证据；其余三维留作缺口。 */
function syntheticStore(options: { counterexampleDimension?: string } = {}): EvidenceStoreLike {
  const artifacts = new Map<string, EvidenceRecord>();
  const records: EvidenceRecord[] = [];
  for (const dimension of ['tool_scope', 'mcp_scope']) {
    records.push({
      source: `fixture://fake-policy/${dimension}`, adapter_id: 'fake-policy', dimension,
      method: 'dispatch_receipt', subject: `${dimension} synthetic`, coverage: 'synthetic behavior fixture',
      tool_version: 'fixture', config_fingerprint: FP_A, verification: 'behavior',
      artifact_sha256: HEX('c'), result: 'pass', recorded_at_utc: new Date().toISOString(),
    });
  }
  if (options.counterexampleDimension !== undefined) {
    records.push({
      source: `fixture://fake-policy/${options.counterexampleDimension}-counterexample`,
      adapter_id: 'fake-policy', dimension: options.counterexampleDimension,
      method: 'dispatch_receipt', subject: 'reviewed failure for the same configuration',
      coverage: 'synthetic reviewed counterexample', tool_version: 'fixture', config_fingerprint: FP_A,
      verification: 'declared', artifact_sha256: HEX('d'), result: 'fail', recorded_at_utc: new Date().toISOString(),
    });
  }
  for (const record of records) artifacts.set(record.source, record);
  return {
    resolve: (source: string) => artifacts.get(source),
    failuresFor: (adapterId: string, configFingerprint: string, dimension: string) => [...artifacts.values()].filter((r) =>
      r.result === 'fail' && r.adapter_id === adapterId && r.config_fingerprint === configFingerprint && r.dimension === dimension),
  };
}

function evidenceFor(store: EvidenceStoreLike): CollabCapabilityEvidence[] {
  return ['tool_scope', 'mcp_scope'].map((dimension) => {
    const record = store.resolve(`fixture://fake-policy/${dimension}`)!;
    return {
      source: record.source, adapter_id: record.adapter_id, dimension, subject: record.subject,
      method: record.method, coverage: record.coverage, tool_version: record.tool_version,
      config_fingerprint: record.config_fingerprint, verification: 'behavior' as const, status: 'live_verified' as const,
    };
  });
}

type GapOverride = Partial<AdmissionPolicy['accepted_gaps'][number]> & { dimension: string };

/** 默认接受 write_protection/read_scope/recursion 三维缺口（合成依据）。
 *  fingerprint 可按调用方合同动态传入（派发类用例需要与管线合同一致）。 */
function policy(overrides: GapOverride[] = [], fingerprint: string = FP_A): AdmissionPolicy {
  const specs: GapOverride[] = overrides.length > 0
    ? overrides
    : ['write_protection', 'read_scope', 'recursion'].map((dimension) => ({ dimension }));
  return {
    schema_version: 1,
    decision_ref: 'D88/D89 synthetic fixture',
    accepted_gaps: specs.map((entry) => ({
      adapter_id: entry.adapter_id ?? 'fake-policy',
      dimension: entry.dimension,
      config_fingerprint: entry.config_fingerprint ?? fingerprint,
      reason: entry.reason ?? 'synthetic structural equivalence fixture',
      equivalence: entry.equivalence ?? {
        gate_sha256: HEX('1'), hooks_sha256: HEX('2'), project_sha256: HEX('3'),
        differing: '--agent value only', reference: 'fixture',
      },
      decided_by: entry.decided_by ?? 'D88/D89 synthetic fixture',
    })),
  };
}

function seatInputs(): Parameters<CollaborationBlackboard['createSession']>[0]['participants'] {
  return [
    { seat: 'A', adapter_id: 'fake-policy', provider_id: 'fake', model_id: 'm1', config_fingerprint: FP_A, is_coordinator: true },
    { seat: 'B', adapter_id: 'fake-policy', provider_id: 'fake', model_id: 'm1', config_fingerprint: FP_A },
  ];
}

function board(root: string, store: EvidenceStoreLike, admissionPolicy?: AdmissionPolicy): CollaborationBlackboard {
  return CollaborationBlackboard.open(root, { evidenceStore: store, ...(admissionPolicy !== undefined ? { admissionPolicy } : {}) });
}

test('D98: scoped missing-evidence acceptance freezes bounds and refuses another pair or expanded limits', () => {
  const root = fixtureRoot('scoped'); const store = syntheticStore(); const scoped = policy();
  for (const gap of scoped.accepted_gaps) gap.session_scope = {
    adapter_ids: ['fake-policy', 'fake-policy'], call_limit: 7, retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 20,
  };
  const bb = board(root, store, scoped);
  const input = { topic: 'fixture', workspace_root: root, participants: seatInputs(), isolation_required: true, capability_evidence: evidenceFor(store) };
  const created = bb.createSession(input);
  assert.deepEqual(bb.getAuthorizationSnapshot(created.session_id).accepted_gaps?.[0].session_scope, scoped.accepted_gaps[0].session_scope);
  for (const expanded of [{ call_limit: 8 }, { retry_limit: 2 }, { single_call_timeout_s: 181 }, { session_timeout_min: 21 }]) {
    assert.throws(() => bb.createSession({ ...input, ...expanded }), /policy session scope/);
  }
  assert.throws(() => bb.createSession({ ...input, participants: [input.participants[0]!, { ...input.participants[1]!, adapter_id: 'another-harness' }] }), /policy session scope/);
  scoped.accepted_gaps[0]!.session_scope!.call_limit = 8;
  assert.throws(() => bb.authorizeSession(created.session_id), /冻结快照不一致/);
  bb.close();
});

test('D98: malformed scope cannot silently degrade into unbounded acceptance', () => {
  const root = fixtureRoot('bad-scope'), file = path.join(root, 'policy.json');
  for (const scope of [null, {}, { adapter_ids: ['fake-policy'], call_limit: 7, retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 20 },
    { adapter_ids: ['fake-policy', 'fake-policy'], call_limit: '7', retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 20 },
    { adapter_ids: ['fake-policy', 'fake-policy'], call_limit: 7, retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 20, extra: true }]) {
    const value = policy(); Object.assign(value.accepted_gaps[0]!, { session_scope: scope });
    writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadAdmissionPolicy(file), AdmissionPolicyError);
  }
});

test('D89: without an accepted-gap policy every unmet dimension still blocks authorization', () => {
  const root = fixtureRoot('no-policy');
  const store = syntheticStore();
  const bb = board(root, store);
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  });
  const snapshot = bb.getAuthorizationSnapshot(created.session_id);
  assert.equal(snapshot.policy_decision_ref, undefined, '无政策时不得冻结政策依据');
  assert.equal(snapshot.accepted_gaps, undefined);
  assert.throws(() => bb.assertCanAuthorizeSession(created.session_id), /缺行为级（live_verified）证据/);
  assert.throws(() => bb.authorizeSession(created.session_id), /缺行为级（live_verified）证据/);
});

test('D89: policy acceptance authorizes only the frozen gap set, and freezes it for the card', () => {
  const root = fixtureRoot('accept');
  const store = syntheticStore();
  const bb = board(root, store, policy());
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  });
  const snapshot = bb.getAuthorizationSnapshot(created.session_id);
  assert.equal(snapshot.policy_decision_ref, 'D88/D89 synthetic fixture');
  assert.deepEqual(snapshot.accepted_gaps?.map((g) => g.dimension).sort(), ['read_scope', 'recursion', 'write_protection']);
  assert.equal(snapshot.accepted_gaps?.[0].equivalence.differing, '--agent value only');
  // 证据等级不因政策分支改变：缺口条目仍是 declared/unmet 视图。
  assert.equal((snapshot.capability_evidence ?? []).filter((e) => e.verification === 'behavior').length, 2);
  bb.authorizeSession(created.session_id);
  assert.equal(bb.getSession(created.session_id).status, 'authorized');
});

test('D89: a policy that misses one unmet dimension fails closed at creation time', () => {
  const root = fixtureRoot('partial');
  const store = syntheticStore();
  const bb = board(root, store, policy([{ dimension: 'write_protection' }, { dimension: 'read_scope' }]));
  assert.throws(() => bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  }), /维度 recursion 缺行为级（live_verified）证据/);
});

test('D89: a foreign-fingerprint policy entry does not apply to this seat', () => {
  const root = fixtureRoot('wrong-fp');
  const store = syntheticStore();
  const bb = board(root, store, policy([
    { dimension: 'write_protection' }, { dimension: 'read_scope' }, { dimension: 'recursion', config_fingerprint: FP_B },
  ]));
  assert.throws(() => bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  }), /维度 recursion 缺行为级/);
});

test('D89: frozen gaps must still match the evidence at approval time', () => {
  const root = fixtureRoot('drift');
  const store = syntheticStore();
  // 另建一个会话：其 tool_scope 只有"声明级"条目（无行为观察），因此该维也是缺口。
  const declaredEvidence = evidenceFor(store).filter((e) => e.dimension === 'mcp_scope');
  declaredEvidence.push({
    source: 'fixture://fake-policy/tool_scope-declared', adapter_id: 'fake-policy', dimension: 'tool_scope',
    subject: 'declared only', method: 'dispatch_receipt', coverage: 'declaration only',
    tool_version: 'fixture', config_fingerprint: FP_A, verification: 'declared', status: 'declared',
  });
  const bb = board(root, store, policy([{ dimension: 'tool_scope' }, { dimension: 'write_protection' }, { dimension: 'read_scope' }]));
  assert.throws(() => bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: declaredEvidence,
  }), /维度 recursion 缺行为级/, 'recursion 未在政策内 → 创建即拒绝');
  // 政策覆盖四维缺口时创建成功，且冻结集合必须与当前缺口一致。
  const bb2 = board(root, store, policy([{ dimension: 'tool_scope' }, { dimension: 'write_protection' },
    { dimension: 'read_scope' }, { dimension: 'recursion' }]));
  const created = bb2.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: declaredEvidence,
  });
  const frozen = bb2.getAuthorizationSnapshot(created.session_id).accepted_gaps?.map((g) => g.dimension).sort();
  assert.deepEqual(frozen, ['read_scope', 'recursion', 'tool_scope', 'write_protection']);
  bb2.assertCanAuthorizeSession(created.session_id);
});

test('D89: a recorded failure counterexample blocks even when the policy accepts that gap', () => {
  // owner 2026-10-04 复核：政策只接受"未验证"；已证实的失败反例不得被政策覆盖。
  const root = fixtureRoot('counterexample');
  const store = syntheticStore({ counterexampleDimension: 'write_protection' });
  const bb = board(root, store, policy());
  assert.throws(() => bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  }), /已有失败反例.*write_protection/, '创建即拒：失败反例优先于政策缺口');
});

test('D89: a counterexample that appears after creation blocks approval (frozen set mismatch)', () => {
  const root = fixtureRoot('counterexample-drift');
  // 创建时无反例 → 成功冻结；随后同一席位指纹下出现反例 → 批准前必须拒。
  const base = syntheticStore();
  let lateFailure = false;
  const store: EvidenceStoreLike = {
    resolve: (source: string) => base.resolve(source),
    failuresFor: (adapterId: string, fingerprint: string, dimension: string) => [
      ...(base.failuresFor?.(adapterId, fingerprint, dimension) ?? []),
      ...(lateFailure && dimension === 'write_protection' ? [{
        source: 'fixture://fake-policy/late-counterexample', adapter_id: adapterId, dimension,
        method: 'dispatch_receipt', subject: 'late counterexample', coverage: 'late', tool_version: 'fixture',
        config_fingerprint: fingerprint, verification: 'declared' as const, artifact_sha256: HEX('e'),
        result: 'fail' as const, recorded_at_utc: new Date().toISOString(),
      }] : []),
    ],
  };
  const bb = board(root, store, policy());
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  });
  assert.deepEqual(bb.getAuthorizationSnapshot(created.session_id).failure_counterexamples, [],
    '创建时无适用反例 → 冻结为空集合');
  lateFailure = true;
  assert.throws(() => bb.assertCanAuthorizeSession(created.session_id),
    /失败反例集合与冻结快照不一致/);
});

test('D89: an evidence store that cannot enumerate failures fails closed', () => {
  const root = fixtureRoot('no-failure-api');
  const store = syntheticStore();
  // 去掉 failuresFor：存在证据库但无法核验反例 → 拒绝（不得静默当作"无反例"）。
  delete (store as { failuresFor?: unknown }).failuresFor;
  const bb = board(root, store, policy());
  assert.throws(() => bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  }), /证据库无法核验失败反例/);
});

test('D89: approval projection carries policy, gaps and evidence to the visible card', () => {
  // owner 2026-10-04 复核：JSON 卡文件有字段 ≠ 审批者实际看见——
  // sources.ts 的审批投影（看板实际渲染的数据源）必须带出这些字段。
  const root = fixtureRoot('projection');
  const store = syntheticStore();
  const policyFile = path.join(root, 'policy.json');
  writeFileSync(policyFile, JSON.stringify(policy()), 'utf8');
  const bb = board(root, store, loadAdmissionPolicy(policyFile));
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger'),
    collabBlackboard: bb, contracts: { 'fake-policy': fakeFixture(root) },
  });
  const card = pipeline.createSessionAuthorizationRequest({ session_id: created.session_id });
  const cardPath = pipeline.sessionAuthorizationRequestPath(created.session_id);
  const snapshot = collectBoardSnapshot({ approvalRoot: path.dirname(cardPath) });
  const projected = snapshot.approvals.find((a) => a.request_file === card.request_file);
  assert.ok(projected?.session, '会话审批必须进入看板投影：' + JSON.stringify({
    approvalRoot: path.dirname(cardPath), files: snapshot.approvals.map((a) => a.request_file),
  }));
  const session = projected!.session!;
  assert.equal(session.policy_decision_ref, 'D88/D89 synthetic fixture');
  assert.deepEqual(session.accepted_gaps.map((g) => (g as { dimension: string }).dimension).sort(),
    ['read_scope', 'recursion', 'write_protection'], '缺口逐条进入投影');
  assert.equal(session.capability_evidence.length, 2, '五维证据逐条进入投影');
  assert.deepEqual(session.failure_counterexamples, []);
  const page = renderBoardPage();
  assert.match(page, /已接受的已知缺口/, '常用审批卡渲染缺口标题');
  assert.match(page, /失败反例（禁止批准）/, '常用审批卡渲染反例提示');
  assert.match(page, /隔离维度证据/, '常用审批卡渲染证据等级');
});

test('D89: a counterexample registered after approval blocks every later call before quota occupation', () => {
  // owner 2026-10-04 二次复核：批准后出现反例仍能占额（复现脚本实测 call_count=1）。
  const root = fixtureRoot('late-counterexample-quota');
  const base = syntheticStore();
  let lateFailure = false;
  const store: EvidenceStoreLike = {
    resolve: (source: string) => base.resolve(source),
    failuresFor: (adapterId: string, fingerprint: string, dimension: string) => [
      ...(base.failuresFor?.(adapterId, fingerprint, dimension) ?? []),
      ...(lateFailure && dimension === 'write_protection' ? [{
        source: 'fixture://fake-policy/late-quota-counterexample', adapter_id: adapterId, dimension,
        method: 'dispatch_receipt', subject: 'late counterexample', coverage: 'late', tool_version: 'fixture',
        config_fingerprint: fingerprint, verification: 'declared' as const, artifact_sha256: HEX('f'),
        result: 'fail' as const, recorded_at_utc: new Date().toISOString(),
      }] : []),
    ],
  };
  const bb = board(root, store, policy());
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  });
  bb.authorizeSession(created.session_id);
  // 批准后登记反例：占额与 spawn 之前必须被拦下（本轮与后续每一轮/重试同一条路径）。
  lateFailure = true;
  assert.throws(() => bb.occupyCall(created.session_id, 'normal', 'A'), /失败反例集合已变更/);
  assert.equal(bb.getSession(created.session_id).call_count, 0, '拒绝时不得占用额度');
  assert.throws(() => bb.occupyCall(created.session_id, 'retry', 'B'), /失败反例集合已变更/, '重试同样受拦');
  assert.equal(bb.getSession(created.session_id).call_count, 0);
});

test('D89: dispatch refuses to occupy quota when the frozen counterexample set drifted', async () => {
  // 端到端：管线 internal.collab 路径在占额前走 blackboard.assertSessionAdmissible。
  const root = fixtureRoot('dispatch-drift');
  const base = syntheticStore();
  let lateFailure = false;
  const store: EvidenceStoreLike = {
    resolve: (source: string) => base.resolve(source),
    failuresFor: (adapterId: string, fingerprint: string, dimension: string) => [
      ...(base.failuresFor?.(adapterId, fingerprint, dimension) ?? []),
      ...(lateFailure && dimension === 'tool_scope' ? [{
        source: 'fixture://fake-policy/dispatch-counterexample', adapter_id: adapterId, dimension,
        method: 'dispatch_receipt', subject: 'late counterexample', coverage: 'late', tool_version: 'fixture',
        config_fingerprint: fingerprint, verification: 'declared' as const, artifact_sha256: HEX('a'),
        result: 'fail' as const, recorded_at_utc: new Date().toISOString(),
      }] : []),
    ],
  };
  const dispatchContract = fakeFixture(root);
  const dispatchFingerprint = contractPermissionFingerprint(dispatchContract);
  // 该指纹下没有任何行为级证据 → 政策需覆盖全部五维缺口（本用例只测派发前反例硬前置）。
  const bb = board(root, store, policy(ISOLATION_DIMENSIONS.map((dimension) => ({ dimension })), dispatchFingerprint));
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'fake-policy', provider_id: 'fake', model_id: 'm1', config_fingerprint: dispatchFingerprint, is_coordinator: true },
      { seat: 'B', adapter_id: 'fake-policy', provider_id: 'fake', model_id: 'm1', config_fingerprint: dispatchFingerprint },
    ],
    isolation_required: true,
    // 该指纹下没有行为级证据 → 由政策接受四维缺口（本用例只测派发前反例硬前置）。
    capability_evidence: [],
  });
  bb.authorizeSession(created.session_id);
  let runs = 0;
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger'),
    collabBlackboard: bb, contracts: { 'fake-policy': dispatchContract },
    runAdapter: async () => { runs += 1; return { exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }; },
  });
  lateFailure = true;
  await assert.rejects(() => pipeline.dispatch(
    { adapter_id: 'fake-policy', model_id: 'm1', effort: 'LOW', prompt: 'fixture', real: true },
    { collab: { session_id: created.session_id, seat: 'A' } },
  ), /失败反例集合已变更/);
  assert.equal(runs, 0, '未 spawn');
  assert.equal(bb.getSession(created.session_id).call_count, 0, '未占额');
});

test('policy loader rejects malformed files and ignores a missing one', () => {
  const root = fixtureRoot('loader');
  assert.deepEqual(loadAdmissionPolicy(path.join(root, 'absent.json')).accepted_gaps, []);
  const bad = path.join(root, 'bad.json');
  writeFileSync(bad, JSON.stringify({ schema_version: 1, decision_ref: 'x', accepted_gaps: [{ dimension: 'tool_scope' }] }), 'utf8');
  assert.throws(() => loadAdmissionPolicy(bad), AdmissionPolicyError);
  const good = path.join(root, 'good.json');
  writeFileSync(good, JSON.stringify(policy()), 'utf8');
  const loaded = loadAdmissionPolicy(good);
  assert.equal(loaded.accepted_gaps.length, 3);
  assert.equal(policyGapFor(loaded, 'fake-policy', FP_A, 'recursion')?.dimension, 'recursion');
  assert.equal(policyGapFor(loaded, 'fake-policy', FP_A, 'tool_scope'), undefined, '已被行为证据覆盖的维度不需要缺口条款');
});

test('D89: accepted gaps reach the session authorization card verbatim', () => {
  const root = fixtureRoot('card');
  const store = syntheticStore();
  const policyFile = path.join(root, 'policy.json');
  writeFileSync(policyFile, JSON.stringify(policy()), 'utf8');
  const admissionPolicy = loadAdmissionPolicy(policyFile);
  const bb = board(root, store, admissionPolicy);
  const created = bb.createSession({
    topic: 'fixture', workspace_root: root, participants: seatInputs(),
    isolation_required: true, capability_evidence: evidenceFor(store),
  });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger'),
    collabBlackboard: bb, contracts: { 'fake-policy': fakeFixture(root) },
  });
  const card = pipeline.createSessionAuthorizationRequest({ session_id: created.session_id });
  const cardPath = pipeline.sessionAuthorizationRequestPath(created.session_id);
  const body = JSON.parse(readFileSync(cardPath, 'utf8')) as {
    policy_decision_ref?: string;
    accepted_gaps?: Array<{ dimension: string; reason: string; decided_by: string }>;
  };
  assert.equal(card.request_file, path.basename(cardPath));
  assert.equal(body.policy_decision_ref, 'D88/D89 synthetic fixture');
  assert.deepEqual((body.accepted_gaps ?? []).map((g) => g.dimension).sort(), ['read_scope', 'recursion', 'write_protection']);
  assert.ok((body.accepted_gaps ?? []).every((g) => g.reason !== '' && g.decided_by !== ''), '缺口必须带依据与决策来源');
});

test('D89: evidence status is driven by the explicit classification only', () => {
  // 与 g084-evidence-store 的分类用例互补：这里断言准入维度枚举完整且不被文案影响。
  assert.deepEqual([...ISOLATION_DIMENSIONS].sort(), ['mcp_scope', 'read_scope', 'recursion', 'tool_scope', 'write_protection']);
});
