/** GOAL-085 第二阶段（结果整理与本地导出）聚焦回归：
 *  完整结果 / 缺少修订 / 失败与中断 / 历史三席位只读 / 导出一致性 / 敏感字段排除。
 *  独立 fixture 数据根 + fake runner；零真实模型调用，不打开生产黑板库。 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, deriveReviewRelations, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { CollaborationCoordinator } from '../src/orchestration/collaboration-coordinator.ts';
import { seedTripleHistory } from './fixtures/collab-history.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const servers: BoardServer[] = [];
after(async () => { for (const s of servers) await s.close(); });

/** 原生审计流标记：只出现在 fake runner 的 stdout（派发记录 tail / 回执 raw_stream），
 *  绝不允许进入结果导出——"完整原生审计流不导出"的可断言证据。 */
const NATIVE_MARKER = 'NATIVE_AUDIT_STREAM_MARKER_DO_NOT_EXPORT';
/** 材料正文标记：导出只带材料标识与哈希，不带正文。 */
const MATERIAL_SECRET = 'SECRET_MATERIAL_BODY_DO_NOT_EXPORT';

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-result-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085-result/${adapterId}/${fingerprint}/${dimension}`;
      records.set(source, {
        source, adapter_id: adapterId, dimension, method: 'dispatch_receipt', subject: 'synthetic fixture',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior',
        artifact_sha256: 'a'.repeat(64), result: 'pass', recorded_at_utc: new Date().toISOString(),
      });
      return { source, adapter_id: adapterId, dimension, subject: 'synthetic fixture', method: 'dispatch_receipt',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint,
        verification: 'behavior' as const, status: 'live_verified' as const };
    });
  return { store: { resolve: (s: string) => records.get(s), failuresFor: () => [] }, forParticipant };
}

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

/** 阶段感知假 runner（与 g085-e2e 同构）：按【阶段】【席位】返回合法 JSON 答案。 */
function writeEmitScript(root: string): string {
  const script = path.join(root, 'emit.mjs');
  writeFileSync(script, [
    "const prompt = process.argv.at(-1) ?? '';",
    "const phase = prompt.match(/【阶段】(\\w+)/)?.[1];",
    "const seat = prompt.match(/【席位】([A-C])/)?.[1] ?? 'A';",
    "const seatList = (prompt.match(/【席位】本场共 \\d+ 席：([A-C、]+)/)?.[1] ?? 'A、B').split('、').filter(Boolean);",
    "const target = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1];",
    "const materialIds = (prompt.match(/^m[0-9]+:/gm) ?? ['m1:']).map((s) => s.slice(0, -1));",
    "const plan = {}; for (const s of seatList) plan[s] = materialIds;",
    "const focus = {}; for (const s of seatList) focus[s.toLowerCase() + '_focus'] = s + ' focus';",
    "const base = {",
    "  coordination: { ...focus, material_plan: plan, notes: '' },",
    "  proposal: { body: 'proposal-' + seat, stance: 'support', evidence: materialIds, reserved_disagreements: '' },",
    "  review: { body: 'review-' + seat, stance: 'qualified', responds_to: target, evidence: [], flaws: ['gap'], suggestions: ['fix'], reserved_disagreements: '' },",
    "  revision: { body: 'revision-' + seat, stance: 'revised', changes: ['adopt-review'], reserved_disagreements: 'keep-point-' + seat },",
    "};",
    "process.stdout.write(JSON.stringify(base[phase] ?? {}));",
    '',
  ].join('\n'), 'utf8');
  return script;
}

interface BootOptions {
  historyStatus?: 'completed' | 'pending_approval' | 'failed' | 'interrupted';
  declareAll?: boolean;
  /** 启动前注入"修订齐备的历史三席位"夹具（必须在 server 启动前进注册表）。 */
  seedTripleRevisions?: boolean;
}

async function boot(root: string, options: BootOptions = {}): Promise<{
  base: string; token: string; board: CollaborationBlackboard; pipeline: DispatchPipeline; historyId?: string; tripleRevisedId?: string;
}> {
  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(root, { evidenceStore: store });
  const contracts = discussionContracts(root);
  const emitScript = writeEmitScript(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts,
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => '2.1.286 (Claude Code)',
    runAdapter: async (contract, prompt, runOptions) => {
      const seat = /【席位】([A-C])/.exec(prompt)?.[1] ?? 'A';
      const child = spawnSync(process.execPath, [emitScript, prompt], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      // 与生产同构：原生流以 system/init 开头并上报模型身份（受控席位身份门要求）；
      // 前置 NATIVE_MARKER 行只应留在派发记录/回执里，不进结果导出。
      const initLine = JSON.stringify({ type: 'system', subtype: 'init', model: contract.expected_model_id, session_id: 'fixture-result' });
      const stdout = NATIVE_MARKER + '\n' + initLine + '\n' + (child.stdout ?? '');
      runOptions?.onStdout?.(stdout);
      let structured: unknown;
      try { structured = JSON.parse((child.stdout ?? '').trim()); } catch { structured = undefined; }
      // 席位费用申报（回执 telemetry → 台账 ACTUAL_COST）：declareAll=true 全部申报
      //（覆盖 DECLARED 全已知口径）；否则仅席位 A 申报——同一场内同时存在 DECLARED
      // 与 UNKNOWN，验证"部分未知 → 整场 PARTIAL 不完整"（Codex 复核缺口 2）。
      const declared = options.declareAll === true || seat === 'A';
      return {
        exitCode: 0, stdout, stderr: '', timedOut: false, childKilled: false,
        ...(structured !== undefined ? { structured_output: structured } : {}),
        ...(declared ? { receipt: { telemetry: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0.0125, cache_savings_usd: 0 } } } : {}),
      };
    },
  });
  const historyId = options.historyStatus === undefined ? undefined : seedTripleHistory(board, root, options.historyStatus);
  if (historyId !== undefined) pipeline.createSessionAuthorizationRequest({ session_id: historyId });
  const tripleRevisedId = options.seedTripleRevisions === true ? seedTripleWithRevisions(board, root) : undefined;
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-result', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store,
    collaborationEvidence: (p, c) => forParticipant(p.adapter_id, contractPermissionFingerprint(c)),
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, token: server.callerToken, board, pipeline, historyId, tripleRevisedId };
}

async function post(base: string, token: string, url: string, body: object): Promise<{ status: number; body: Record<string, unknown>; text: string; contentType: string }> {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? {} : JSON.parse(text) as Record<string, unknown>, text, contentType: res.headers.get('content-type') ?? '' };
}

async function postRaw(base: string, token: string, url: string, body: object): Promise<{ status: number; text: string; contentType: string }> {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') ?? '' };
}

const DUAL_PARTICIPANTS = [
  { adapter_id: 'codex', model_id: 'gpt-5.5', effort: 'LOW' },
  { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW' },
];

/** 修订齐备的历史三席位夹具（failed 终态）：直接落库，绕过当前"仅双席位"创建门——
 *  模拟 GOAL-085 时期的三模型历史。仅允许 fixture 数据根，拒绝生产库。 */
function seedTripleWithRevisions(board: CollaborationBlackboard, workspace: string): string {
  if (!path.resolve(board.databasePath).startsWith(path.resolve('.test-fixtures') + path.sep)) {
    throw new Error('history fixture refuses a production database');
  }
  const id = randomUUID(), at = '2026-10-01T00:00:00.000Z';
  const snapshot = {
    topic: '历史三席位修订齐备夹具', workspace_root: workspace,
    participants: (['A', 'B', 'C'] as const).map(seat => ({ seat, adapter_id: 'fixture', model_id: 'fixture-model', ...(seat === 'A' ? { is_coordinator: true } : {}) })),
    materials: [], isolation_required: true, capability_evidence: [],
    review_relations: deriveReviewRelations(['A', 'B', 'C']),
    call_limit: 13, retry_limit: 1, single_call_timeout_s: 180, session_timeout_min: 40,
  };
  const json = JSON.stringify(snapshot), hash = createHash('sha256').update(json).digest('hex');
  const db = new DatabaseSync(board.databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO sessions (id,topic,workspace_root,status,phase,call_count,retry_count,call_limit,retry_limit,authorization_hash,session_timeout_min,created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,40,?)')
      .run(id, snapshot.topic, workspace, 'failed', 'revision', 13, 1, 13, 1, hash, at);
    for (const p of snapshot.participants) {
      db.prepare('INSERT INTO participants (session_id,seat,adapter_id,model_id,is_coordinator,run_instance) VALUES (?,?,?,?,?,?)')
        .run(id, p.seat, p.adapter_id, p.model_id, p.seat === 'A' ? 1 : 0, 'history-' + p.seat);
    }
    const proposalId = (seat: string): string => {
      const vpId = 'vp_' + randomUUID();
      db.prepare("INSERT INTO viewpoints (id,session_id,author_seat,author_instance,phase,kind,target,version,body,created_at_utc) VALUES (?,?,?,?,?,'proposal','',1,?,?)")
        .run(vpId, id, seat, 'history-' + seat, 'proposal', seat + ' 的提案', at);
      return vpId;
    };
    const proposalIds: Record<string, string> = { A: proposalId('A'), B: proposalId('B'), C: proposalId('C') };
    const review = (author: string, targetSeat: string): void => {
      db.prepare("INSERT INTO viewpoints (id,session_id,author_seat,author_instance,phase,kind,responds_to,target,version,body,created_at_utc) VALUES (?,?,?,?,?,'review',?,?,1,?,?)")
        .run('vp_' + randomUUID(), id, author, 'history-' + author, 'review', proposalIds[targetSeat]!, targetSeat, author + ' 评审 ' + targetSeat, at);
    };
    review('A', 'B'); review('A', 'C'); review('B', 'A'); review('B', 'C'); review('C', 'A'); review('C', 'B');
    for (const seat of ['A', 'B', 'C'] as const) {
      db.prepare("INSERT INTO viewpoints (id,session_id,author_seat,author_instance,phase,kind,target,version,body,created_at_utc) VALUES (?,?,?,?,?,'revision','',1,?,?)")
        .run('vp_' + randomUUID(), id, seat, 'history-' + seat, 'revision', JSON.stringify({ body: seat + ' 的修订', changes: ['c'], reserved_disagreements: 'r' }), at);
    }
    db.prepare('INSERT INTO authorizations (session_id,snapshot_json,sha256,created_at_utc) VALUES (?,?,?,?)').run(id, json, hash, at);
    db.prepare('INSERT INTO session_outcomes (session_id,outcome_json,recorded_at_utc) VALUES (?,?,?)')
      .run(id, JSON.stringify({ status: 'failed', reason: '夹具：修订齐备后终局失败', dispatch_ids: [] }), at);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
  return id;
}

async function createDualSession(base: string, token: string, topic: string): Promise<string> {
  const created = await post(base, token, '/api/collaboration/sessions', {
    topic, participants: DUAL_PARTICIPANTS,
    materials: [{ name: '评审材料', content: '公开摘要\n' + MATERIAL_SECRET, allowed_seats: ['A', 'B'] }],
    isolation_required: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return String(created.body.session_id);
}

test('导出：完整双模型会话——结构、观点、费用部分申报、敏感字段排除、JSON/Markdown 一致', async () => {
  const root = fixtureRoot('complete');
  const { base, token, board, pipeline } = await boot(root);
  const sessionId = await createDualSession(base, token, '评审 GOAL-084 实现（夹具）');
  board.authorizeSession(sessionId);
  const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
  // 与服务端 startCollaborationRun 同构：协调器跑完后由宿主记录终态（导出只读不代写）。
  board.recordSessionOutcome(sessionId, { status: 'completed', reason: outcome.reason, dispatch_ids: [...outcome.dispatch_ids] });

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200, res.text.slice(0, 400));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.format, 'json');
  assert.match(String(res.body.file_name), /^collab-result-[0-9a-f-]{8}\.json$/);
  const doc = res.body.result as Record<string, unknown>;
  const jsonText = JSON.stringify(doc);

  // 结构与会话事实
  assert.equal(doc.schema, 'mush.collaboration-session-result');
  const session = doc.session as Record<string, unknown>;
  assert.equal(session.session_id, sessionId);
  assert.equal(session.status, 'completed');
  assert.equal(session.call_count, 7);
  assert.deepEqual(((session.review_relations as Array<{ author: string; target: string }>).map((r) => `${r.author}->${r.target}`)), ['A->B', 'B->A']);
  assert.equal((doc.end as Record<string, unknown>).status, 'completed');

  // 参与配置与冻结材料（标识+哈希，无正文）
  const participants = doc.participants as Array<Record<string, unknown>>;
  assert.deepEqual(participants.map((p) => p.adapter_id), ['codex', 'claude-code']);
  for (const p of participants) {
    assert.match(String(p.config_fingerprint), /^[0-9a-f]{64}$/);
    assert.equal(p.effort, 'LOW');
  }
  const materials = doc.materials as Array<Record<string, unknown>>;
  assert.equal(materials.length, 1);
  assert.match(String(materials[0]!.sha256), /^[0-9a-f]{64}$/);
  assert.equal('content' in materials[0]!, false, '材料正文不得进入导出');
  assert.ok(!jsonText.includes(MATERIAL_SECRET), '材料正文标记不得出现在导出中');

  // 阶段观点：1 分配 + 2 提案 + 2 互评 + 2 修订；body 为原始 JSON 原文
  const opinions = doc.opinions as Array<Record<string, unknown>>;
  const kinds = opinions.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ['assignment', 'proposal', 'proposal', 'review', 'review', 'revision', 'revision']);
  const revisions = opinions.filter((o) => o.kind === 'revision') as Array<Record<string, unknown>>;
  for (const r of revisions) assert.match(String(r.body), /"changes":\s*\[\s*"adopt-review"\s*\]/);
  for (const o of opinions) {
    assert.ok(Array.isArray(o.evidence));
    assert.ok(Array.isArray(o.material_manifest));
    assert.ok(String(o.viewpoint_id).startsWith('vp_'));
  }

  // 完成情况（Codex 复核缺口 1 修复后口径）：completed + 双席 + 修订齐备 = 流程完成
  const completion = doc.completion as Record<string, unknown>;
  assert.equal(completion.complete, true);
  assert.equal(completion.revisions_complete, true);
  assert.match(String(completion.note), /当前双模型流程完成/);

  // 费用可见性（Codex 复核缺口 2 修复后口径）：A 席 4 次申报（0.0125×4=0.05），
  // B 席 3 次 UNKNOWN → 整场 PARTIAL（不完整），已知小计保留，不得冒充整场已知
  const fees = doc.fees as Record<string, unknown>;
  const perDispatch = fees.per_dispatch as Array<Record<string, unknown>>;
  assert.equal(perDispatch.length, 7);
  const declaredList = perDispatch.filter((f) => f.visibility === 'DECLARED');
  const unknownList = perDispatch.filter((f) => f.visibility === 'UNKNOWN');
  assert.equal(declaredList.length, 4);
  assert.equal(unknownList.length, 3);
  for (const f of unknownList) assert.equal(f.declared_cost_usd, null);
  for (const f of declaredList) assert.equal(f.declared_cost_usd, 0.0125);
  assert.equal(fees.total_declared_usd, 0.05);
  assert.equal(fees.visibility, 'PARTIAL');
  assert.equal(fees.declared_dispatch_count, 4);
  assert.equal(fees.unknown_dispatch_count, 3);
  assert.match(String(fees.note), /UNKNOWN 表示无申报记录，不是 0/);
  assert.match(String(fees.note), /整场费用不完整/);

  // 执行记录摘要：7 条、含结算状态；不含派发原生流
  const execLog = doc.execution_log as Array<Record<string, unknown>>;
  assert.equal(execLog.length, 7);
  assert.ok(execLog.every((e) => e.status === 'pass'));
  assert.ok(!jsonText.includes(NATIVE_MARKER), '原生审计流标记不得进入导出');
  assert.ok(!jsonText.includes(token), 'caller token 不得进入导出');
  assert.ok(!jsonText.includes('x-mush-caller-auth'));

  // Markdown：同一事实源，可下载
  const md = await postRaw(base, token, '/api/collaboration/sessions/result', { session_id: sessionId, format: 'markdown' });
  assert.equal(md.status, 200);
  assert.match(md.contentType, /text\/markdown/);
  assert.ok(md.text.includes('# 协作会话结果：评审 GOAL-084 实现（夹具）'));
  assert.ok(md.text.includes('当前双模型流程完成：是（修订齐备：是）'));
  assert.ok(md.text.includes('codex · 模型 gpt-5.5 · 强度 LOW'));
  assert.ok(md.text.includes('claude-code · 模型 claude-sonnet-5 · 强度 LOW'));
  assert.ok(md.text.includes(String(materials[0]!.sha256)), 'Markdown 材料哈希与 JSON 一致');
  assert.ok(md.text.includes('adopt-review'), 'Markdown 携带原始观点 JSON');
  assert.ok(md.text.includes('UNKNOWN（无申报记录，不是 0）'));
  assert.ok(md.text.includes('合计申报：$0.05（PARTIAL：4 条申报、3 条 UNKNOWN——整场费用不完整）'));
  assert.ok(md.text.includes('A→B'));
  assert.ok(md.text.includes('不合成'));
  assert.ok(!md.text.includes(NATIVE_MARKER));
  assert.ok(!md.text.includes(token));
  assert.ok(!md.text.includes(MATERIAL_SECRET));

  // 格式校验：非法 format 400
  const bad = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId, format: 'yaml' });
  assert.equal(bad.status, 400);
});

test('导出：缺少修订（中途失败）——最后有效阶段说明未完成，费用 UNKNOWN 不当 0', async () => {
  const root = fixtureRoot('missing-revision');
  const { base, token, board } = await boot(root);
  const sessionId = await createDualSession(base, token, '缺修订夹具');
  board.authorizeSession(sessionId);
  for (const seat of ['A', 'B'] as const) board.bindRunInstance(sessionId, seat, 'fx-' + seat);
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ material_plan: {}, notes: '' }) });
  board.setPhase(sessionId, 'proposal');
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ body: 'A 提案正文', stance: 'support' }) });
  board.closeSession(sessionId, 'failed');
  board.recordSessionOutcome(sessionId, { status: 'failed', reason: '席位 B 提案派发失败（夹具）', dispatch_ids: ['disp-missing-1'] });

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200);
  const doc = res.body.result as Record<string, unknown>;
  assert.equal((doc.session as Record<string, unknown>).status, 'failed');
  const completion = doc.completion as Record<string, unknown>;
  assert.equal(completion.complete, false);
  assert.equal(completion.revisions_complete, false);
  assert.deepEqual(completion.missing_revision_seats, ['A', 'B']);
  assert.equal(completion.last_phase_with_content, 'proposal');
  assert.match(String(completion.note), /未产出全体席位的最终修订/);
  assert.match(String(completion.note), /不代表已完成共识/);
  const opinions = doc.opinions as Array<Record<string, unknown>>;
  assert.deepEqual(opinions.map((o) => o.kind).sort(), ['assignment', 'proposal']);
  const end = doc.end as Record<string, unknown>;
  assert.equal(end.status, 'failed');
  assert.match(String(end.reason), /夹具/);
  // 未知派发（记录已不可查）→ UNKNOWN，不写成 0
  const fees = doc.fees as Record<string, unknown>;
  const perDispatch = fees.per_dispatch as Array<Record<string, unknown>>;
  assert.equal(perDispatch.length, 1);
  assert.equal(perDispatch[0]!.visibility, 'UNKNOWN');
  assert.equal(perDispatch[0]!.declared_cost_usd, null);
  assert.equal(perDispatch[0]!.adapter_id, null);
  assert.equal(fees.total_declared_usd, null);
  assert.equal(fees.visibility, 'UNKNOWN');
  assert.ok(!JSON.stringify(doc).includes('"total_declared_usd":0'), '费用缺失不得序列化为 0');

  const md = await postRaw(base, token, '/api/collaboration/sessions/result', { session_id: sessionId, format: 'markdown' });
  assert.equal(md.status, 200);
  assert.ok(md.text.includes('终态 failed'));
  assert.ok(md.text.includes('UNKNOWN（无任何申报记录，不是 0）'));
});

test('导出：中断会话可读可导出，观点与结束原因如实保留', async () => {
  const root = fixtureRoot('interrupted');
  const { base, token, board } = await boot(root);
  const sessionId = await createDualSession(base, token, '中断夹具');
  board.authorizeSession(sessionId);
  board.bindRunInstance(sessionId, 'A', 'fx-A');
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ notes: '分配' }) });
  board.closeSession(sessionId, 'interrupted');
  board.recordSessionOutcome(sessionId, { status: 'interrupted', reason: 'owner 停止（夹具）', dispatch_ids: [] });

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200);
  const doc = res.body.result as Record<string, unknown>;
  assert.equal((doc.session as Record<string, unknown>).status, 'interrupted');
  assert.equal((doc.completion as Record<string, unknown>).complete, false);
  assert.equal((doc.end as Record<string, unknown>).status, 'interrupted');
  assert.match(String((doc.end as Record<string, unknown>).reason), /owner 停止/);
  assert.equal((doc.opinions as unknown[]).length, 1);
});

test('导出：历史三席位只读——可查看可导出，批准/启动/取消仍 409，不冒充双模型验收', async () => {
  const root = fixtureRoot('triple-history');
  const { base, token, historyId } = await boot(root, { historyStatus: 'completed' });
  assert.ok(historyId);

  // 历史三席位不得重新获得批准/启动/取消入口（现有门继续生效，这里一并回归）
  for (const action of ['approve', 'start', 'cancel']) {
    const denied = await post(base, token, `/api/collaboration/sessions/${action}`, { session_id: historyId });
    assert.equal(denied.status, 409, `${action} 应 409，实际 ${denied.status}`);
  }

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: historyId });
  assert.equal(res.status, 200);
  const doc = res.body.result as Record<string, unknown>;
  const session = doc.session as Record<string, unknown>;
  assert.equal(session.status, 'completed');
  assert.equal((doc.participants as unknown[]).length, 3);
  assert.equal(((session.review_relations as Array<unknown>)).length, 6, '历史三席位评审关系如实导出');
  assert.equal((doc.completion as Record<string, unknown>).complete, false, '三席位历史只有提案，不得标记为完成');
  assert.equal((doc.completion as Record<string, unknown>).last_phase_with_content, 'proposal');
  const opinions = doc.opinions as Array<Record<string, unknown>>;
  assert.deepEqual(opinions.map((o) => o.seat).sort(), ['A', 'B', 'C']);
  assert.ok(opinions.every((o) => String(o.body).includes('的历史提案正文')));

  const md = await postRaw(base, token, '/api/collaboration/sessions/result', { session_id: historyId, format: 'markdown' });
  assert.equal(md.status, 200);
  assert.ok(md.text.includes('席位 C'), '三席位 C 的观点在 Markdown 可读');
  assert.ok(md.text.includes('C 的历史提案正文'));
  assert.ok(md.text.includes('未产出全体席位的最终修订'));
});

test('导出：待批准会话也能只读导出（无结束记录、费用空集 UNKNOWN）；未知会话 400', async () => {
  const root = fixtureRoot('pending');
  const { base, token } = await boot(root);
  const sessionId = await createDualSession(base, token, '待批准夹具');

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200);
  const doc = res.body.result as Record<string, unknown>;
  assert.equal((doc.session as Record<string, unknown>).status, 'pending_approval');
  assert.equal(doc.end, null);
  const fees = doc.fees as Record<string, unknown>;
  assert.equal((fees.per_dispatch as unknown[]).length, 0);
  assert.equal(fees.total_declared_usd, null);
  assert.equal(fees.visibility, 'UNKNOWN');

  const unknown = await post(base, token, '/api/collaboration/sessions/result', { session_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(unknown.status, 400);
});

test('导出：修订齐备但会话失败——不冒充流程完成（Codex 复核缺口 1）', async () => {
  const root = fixtureRoot('failed-all-revised');
  const { base, token, board } = await boot(root);
  const sessionId = await createDualSession(base, token, '修订齐备但失败夹具');
  board.authorizeSession(sessionId);
  for (const seat of ['A', 'B'] as const) board.bindRunInstance(sessionId, seat, 'fx-' + seat);
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ material_plan: {}, notes: '' }) });
  board.setPhase(sessionId, 'proposal');
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ body: 'A 提案', stance: 'support' }) });
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-B', body: JSON.stringify({ body: 'B 提案', stance: 'support' }) });
  board.setPhase(sessionId, 'review');
  const proposalOf = (seat: 'A' | 'B'): string =>
    board.getVisibleContext(sessionId, seat).own.find((v) => v.kind === 'proposal')!.id;
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ body: 'A 评审' }), responds_to: proposalOf('B') });
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-B', body: JSON.stringify({ body: 'B 评审' }), responds_to: proposalOf('A') });
  board.setPhase(sessionId, 'revision');
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-A', body: JSON.stringify({ body: 'A 修订', changes: ['x'] }) });
  board.appendViewpoint({ session_id: sessionId, author_instance: 'fx-B', body: JSON.stringify({ body: 'B 修订', changes: ['y'] }) });
  board.closeSession(sessionId, 'failed');
  board.recordSessionOutcome(sessionId, { status: 'failed', reason: '夹具：修订齐备后终局失败', dispatch_ids: [] });

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200);
  const doc = res.body.result as Record<string, unknown>;
  assert.equal((doc.session as Record<string, unknown>).status, 'failed');
  const completion = doc.completion as Record<string, unknown>;
  assert.equal(completion.complete, false, '修订齐备但终态失败，不得标记流程完成');
  assert.equal(completion.revisions_complete, true);
  assert.deepEqual(completion.missing_revision_seats, []);
  assert.equal(completion.last_phase_with_content, 'revision');
  assert.match(String(completion.note), /修订已齐备/);
  assert.match(String(completion.note), /不构成当前双模型流程完成/);
});

test('导出：历史三席位修订齐备——仍不冒充当前双模型流程完成（Codex 复核缺口 1）', async () => {
  const root = fixtureRoot('triple-all-revised');
  const { base, token, tripleRevisedId } = await boot(root, { seedTripleRevisions: true });
  const sessionId = tripleRevisedId!;
  assert.ok(sessionId);

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200);
  const doc = res.body.result as Record<string, unknown>;
  assert.equal((doc.session as Record<string, unknown>).status, 'failed');
  assert.equal((doc.participants as unknown[]).length, 3);
  const completion = doc.completion as Record<string, unknown>;
  assert.equal(completion.complete, false, '三席位修订齐备也不属当前双模型流程口径');
  assert.equal(completion.revisions_complete, true);
  assert.match(String(completion.note), /3 席位，不属当前双模型流程口径/);
  const opinions = doc.opinions as Array<Record<string, unknown>>;
  assert.equal(opinions.filter((o) => o.kind === 'revision').length, 3);
});

test('导出：全部派发均有申报——visibility DECLARED（与 PARTIAL 三态闭合）', async () => {
  const root = fixtureRoot('all-declared');
  const { base, token, board, pipeline } = await boot(root, { declareAll: true });
  const sessionId = await createDualSession(base, token, '全申报夹具');
  board.authorizeSession(sessionId);
  const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
  board.recordSessionOutcome(sessionId, { status: 'completed', reason: outcome.reason, dispatch_ids: [...outcome.dispatch_ids] });

  const res = await post(base, token, '/api/collaboration/sessions/result', { session_id: sessionId });
  assert.equal(res.status, 200);
  const fees = (res.body.result as Record<string, unknown>).fees as Record<string, unknown>;
  assert.equal(fees.visibility, 'DECLARED');
  assert.equal(fees.declared_dispatch_count, 7);
  assert.equal(fees.unknown_dispatch_count, 0);
  assert.equal(fees.total_declared_usd, 0.0875);
});
