/** GOAL-085 端到端 fixture：三模型会话走完整 13 次调用（协调1＋提案3＋互评6＋修订3），
 *  以及双模型 7 次调用；注入 fake runner（只 spawn 本地脚本），数据根独立，不触生产库、不派发真实模型。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CollaborationCoordinator } from '../src/orchestration/collaboration-coordinator.ts';
import { CollaborationBlackboard, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const DIMENSIONS = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-e2e-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** 阶段感知假 runner 脚本：按提示里的【阶段】【席位】与会话席位数返回符合该场 schema 的 JSON。 */
function emitScript(root: string): string {
  const script = path.join(root, 'emit.mjs');
  writeFileSync(script, [
    "const prompt = process.argv.at(-1) ?? '';",
    "const phase = prompt.match(/【阶段】(\\w+)/)?.[1];",
    "const seat = prompt.match(/【席位】([A-C])/)?.[1] ?? 'A';",
    "// 协调轮：本场共 N 席：A、B(、C)", 
    "const seatList = (prompt.match(/【席位】本场共 \\d+ 席：([A-C、]+)/)?.[1] ?? 'A、B').split('、').filter(Boolean);",
    "const target = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1];",
    "const materialIds = (prompt.match(/^m[0-9]+:/gm) ?? ['m1:']).map((s) => s.slice(0, -1));",
    "const plan = {}; for (const s of seatList) plan[s] = materialIds;",
    "const focus = {}; for (const s of seatList) focus[s.toLowerCase() + '_focus'] = s + ' focus';",
    "const base = {",
    "  coordination: { ...focus, material_plan: plan, notes: '' },",
    "  proposal: { body: 'proposal-' + seat, stance: 'support', evidence: materialIds, reserved_disagreements: '' },",
    "  review: { body: 'review-' + seat, stance: 'qualified', responds_to: target, evidence: [], flaws: ['gap'], suggestions: ['fix'], reserved_disagreements: '' },",
    "  revision: { body: 'revision-' + seat, stance: 'revised', changes: ['adopt'], reserved_disagreements: 'keep' },",
    "};",
    "const out = base[phase] ?? {};",
    "process.stdout.write(JSON.stringify(out));",
    '',
  ].join('\n'), 'utf8');
  return script;
}

function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (a: string, f: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] => DIMENSIONS.map((dimension) => {
    const source = `fixture://g085e2e/${adapterId}/${fingerprint}/${dimension}`;
    records.set(source, {
      source, adapter_id: adapterId, dimension, method: 'dispatch_receipt', subject: 'synthetic', coverage: 'synthetic',
      tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior',
      artifact_sha256: 'b'.repeat(64), result: 'pass', recorded_at_utc: new Date().toISOString(),
    });
    return { source, adapter_id: adapterId, dimension, subject: 'synthetic', method: 'dispatch_receipt', coverage: 'synthetic',
      tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior' as const, status: 'live_verified' as const };
  });
  return { store: { resolve: (s: string) => records.get(s), failuresFor: () => [] }, forParticipant };
}

function contracts(root: string, script: string): { codex: AdapterContract; claude: AdapterContract } {
  const base = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'a'), ledgerPath: path.join(root, 'l.jsonl') });
  const codex = buildCodexDiscussionProfile({
    directory: path.join(root, 'codex-profile'), contract: base.getContractMap().codex!, modelId: 'gpt-5.5',
    catalog: { models: [{ slug: 'gpt-5.5' }] }, nativeVersion: '0.160.0', mcpNames: [],
  }).contract;
  const claude = buildClaudeDiscussionProfile({
    workspace: path.join(root, 'claude-workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(root, 'claude-profile'),
  }).contract;
  // runner 注入不需要改合同；脚本仅用于记录阶段。
  writeFileSync(path.join(root, 'stage.log'), '', 'utf8');
  void script;
  return { codex, claude };
}

async function runSession(tag: string, seatCount: 2 | 3): Promise<{
  status: string; callCount: number; retryCount: number; phases: string[]; runnerCalls: number;
  perSeat: Record<string, string[]>; reviewTargets: string[]; reviewRelations: string[];
}> {
  const root = fixtureRoot(`${tag}-${seatCount}`);
  const script = emitScript(root);
  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(path.join(root, 'data'), { evidenceStore: store });
  const { codex, claude } = contracts(root, script);
  const adapterFor = (index: number): string => (index === 0 ? 'codex' : 'claude-code');
  const modelOf = (adapterId: string): string => (adapterId === 'codex' ? 'gpt-5.5' : 'claude-sonnet-5');
  const phaseLog: string[] = [];
  const runnerCalls = { n: 0 };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts: { codex, 'claude-code': claude },
    // 原生探测注入：fixture 不调用真实 codex/claude CLI（零真实账户）；返回值与装配档案一致。
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => '2.1.286 (Claude Code)',
    runAdapter: async (_contract, prompt, runOptions) => {
      runnerCalls.n += 1;
      const phase = /【阶段】(\w+)/.exec(prompt)?.[1] ?? 'unknown';
      phaseLog.push(phase);
      const { spawnSync } = await import('node:child_process');
      const child = spawnSync(process.execPath, [script, prompt], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      // 与生产同构：原生流以 `system/init` 开头并上报模型身份。GOAL-085 起受控讨论席位会
      // 比对这一身份，"缺它就等于身份不可证 → 拒绝"（这正是真实链路的行为，
      // 见 tests/g085-claude-native.test.ts 的身份用例）。
      const initLine = JSON.stringify({ type: 'system', subtype: 'init', model: _contract.expected_model_id, session_id: 'fixture-session' });
      const stdout = initLine + '\n' + (child.stdout ?? '');
      // 与真实 runner 同构：流式输出经 onStdout 汇入协调器的累积 stdout；请求了 schema 时
      // 另把结构化对象放进 structured_output（协调器优先读它，stdout_tail 只有 2048 字符）。
      runOptions?.onStdout?.(stdout);
      let structured: unknown;
      try { structured = JSON.parse((child.stdout ?? '').trim()); } catch { structured = undefined; }
      return {
        exitCode: child.status ?? 1, stdout, stderr: child.stderr ?? '',
        timedOut: false, childKilled: false,
        ...(structured !== undefined ? { structured_output: structured } : {}),
      };
    },
  });
  // 席位指纹必须取"管线口径"（applyModelVariant 之后），与派发时核对的指纹一致；
  // 否则会撞上"批准配置已变更须重新授权"。
  const fingerprintOf = (adapterId: string): string =>
    contractPermissionFingerprint(pipeline.collaborationContract(adapterId, modelOf(adapterId)));
  const participants = Array.from({ length: seatCount }, (_, i) => {
    const adapterId = adapterFor(i);
    return {
      seat: (['A', 'B', 'C'] as const)[i]!, adapter_id: adapterId,
      provider_id: (adapterId === 'codex' ? codex : claude).expected_provider, model_id: modelOf(adapterId), effort: 'LOW',
      config_fingerprint: fingerprintOf(adapterId),
      ...(i === 0 ? { is_coordinator: true } : {}),
    };
  });
  const capabilityEvidence = participants.flatMap((p) => forParticipant(p.adapter_id, p.config_fingerprint));
  const created = board.createSession({
    topic: `${seatCount} 模型端到端`, workspace_root: root, participants,
    materials: [{ material_id: 'm1', name: '材料', source: 'owner', content: '内容', allowed_seats: participants.map((p) => p.seat) }],
    isolation_required: true, capability_evidence: capabilityEvidence,
  });
  board.authorizeSession(created.session_id);
  const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(created.session_id);
  const session = board.getSession(created.session_id);
  const status = String((outcome as { status?: string }).status ?? session.status);
  const sessionOutcome = board.getSessionOutcome(created.session_id);
  if (status !== 'completed') {
    const log = board.getExecutionLog(created.session_id).map((row) => `${row.kind}/${row.status}${row.error ? ' err=' + String(row.error) : ''}`).join(' | ');
    throw new Error(`会话未完成：status=${status} phases=${phaseLog.join(',')} 执行日志：${log}`);
  }
  const viewpoints = participants.flatMap((p) => board.getVisibleContext(created.session_id, p.seat).own);
  const perSeat: Record<string, string[]> = {};
  for (const v of viewpoints) {
    perSeat[v.author_seat] = perSeat[v.author_seat] ?? [];
    perSeat[v.author_seat]!.push(v.kind);
  }
  const reviewTargets = viewpoints.filter((v) => v.kind === 'review').map((v) => String(v.responds_to));
  // 两两互评的"关系"口径：评审作者 → 被评审提案的所属席位（按 proposal 观点 ID 反查），
  // 这样六条关系的**关系集合**可核（同一提案的 responds_to 本就相同 ID，按 ID 计数不等价于关系数）。
  const proposalOwner = new Map<string, string>();
  for (const v of viewpoints) if (v.kind === 'proposal') proposalOwner.set(v.id, v.author_seat);
  const reviewRelations = viewpoints.filter((v) => v.kind === 'review')
    .map((v) => `${v.author_seat}->${proposalOwner.get(String(v.responds_to)) ?? '?'}`);
  return { status, callCount: session.call_count, retryCount: session.retry_count, phases: phaseLog, runnerCalls: runnerCalls.n, perSeat, reviewTargets, reviewRelations };
}

test('端到端：三席位新建在 runner 前拒绝', async () => {
  await assert.rejects(() => runSession('triple-refused', 3), /仅支持双模型/);
});

test('端到端：双模型会话恰好 7 次调用、两条互评（与三模型共用同一编排）', async () => {
  const result = await runSession('dual', 2);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.callCount, 7);
  assert.equal(result.retryCount, 0);
  assert.equal(result.runnerCalls, 7);
  assert.equal(result.phases.filter((p) => p === 'review').length, 2);
  assert.deepEqual([...result.reviewRelations].sort(), ['A->B', 'B->A'], '双模型互评关系 A→B、B→A，实际=' + JSON.stringify(result.reviewRelations));
  for (const seat of ['A', 'B']) {
    assert.deepEqual((result.perSeat[seat] ?? []).filter((k) => k !== 'assignment').sort(), ['proposal', 'review', 'revision'],
      `${seat} 应有 1 提案 + 1 评审 + 1 修订，实际=${JSON.stringify(result.perSeat[seat])}`);
  }
});

test('端到端：会话授权快照冻结评审关系与额度（7+1 / 20min）', async () => {
  const root = fixtureRoot('snapshot');
  const { store } = syntheticEvidence();
  const board = CollaborationBlackboard.open(path.join(root, 'data'), { evidenceStore: store });
  const { codex, claude } = contracts(root, emitScript(root));
  const created = board.createSession({
    topic: '快照', workspace_root: root,
    participants: [
      { seat: 'A', adapter_id: 'codex', provider_id: 'openai', model_id: 'gpt-5.5', effort: 'LOW', config_fingerprint: contractPermissionFingerprint(codex), is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code', provider_id: 'anthropic', model_id: 'claude-sonnet-5', effort: 'LOW', config_fingerprint: contractPermissionFingerprint(claude) },
    ],
    materials: [{ material_id: 'm1', name: '材料', source: 'owner', content: '内容', allowed_seats: ['A', 'B'] }],
    isolation_required: true, capability_evidence: [],
  });
  const snapshot = board.getAuthorizationSnapshot(created.session_id) as unknown as Record<string, unknown>;
  assert.deepEqual((snapshot.review_relations as Array<{ author: string; target: string }>).map((r) => `${r.author}->${r.target}`),
    ['A->B', 'B->A']);
  assert.equal(snapshot.call_limit, 7);
  assert.equal(snapshot.retry_limit, 1);
  assert.equal(snapshot.session_timeout_min, 20);
  assert.equal(snapshot.single_call_timeout_s, 180);
  // 快照落盘可读（重启恢复路径）
  const persisted = readFileSync(path.join(root, 'data', 'collaboration', 'blackboard.sqlite'));
  assert.ok(persisted.length > 0);
});
