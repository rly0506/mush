/** GOAL-085（2026-10-05 owner 追加需求）：协作席位**逐席位强度选择**。
 *
 * 口径：
 *  - 可选档位 = 通道合同声明的 `effort_levels`；
 *  - 缺省值   = 讨论档案的冻结默认（codex/Claude LOW、agy HIGH，保持既有行为）；
 *  - 显式覆盖 = 创建会话时逐席位给出，服务端校验后**随授权快照冻结**；
 *    派发路径继续要求请求强度与冻结值逐字相等（批准后改强度仍被拒）。
 *
 * 本文件同时锁定：名册投影把默认值暴露给界面（两端口径同源），以及非法档位被拒。
 * 零真实模型调用：真实 HTTP + 合成证据库 + fake runner。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { renderBoardPage } from '../src/web/page.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { collabEffortLevels, defaultCollabEffort, defaultCollabModelId, parseCollabEffortRequest } from '../src/web/collab-effort.ts';

const servers: BoardServer[] = [];
after(async () => { for (const s of servers) await s.close(); });

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-collab-effort-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** 合成讨论档案合同：只带档案标记字段（形状必须过合同校验：codex 的 catalog 文件名
 *  必须内嵌其 sha256，claude/agy 的资产路径必须是绝对路径），用于默认值/档位判定的单元级断言。 */
function profileContract(adapterId: string, marker: 'codex' | 'claude' | 'agy' | 'none', levels?: string[]): AdapterContract {
  const sha = 'a'.repeat(64);
  return validateAdapterContract({
    adapter_id: adapterId,
    executable: 'fixture',
    arguments: [],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'fixture',
    expected_model_id: `${adapterId}-model`,
    ...(levels !== undefined ? { effort_levels: levels } : {}),
    ...(marker === 'codex' ? { codex_discussion_profile: { model_id: 'm', native_version: '1', catalog_path: `D:\\catalog-${sha}.json`, catalog_sha256: sha } } : {}),
    ...(marker === 'claude' ? { claude_discussion_profile: { model_id: 'm', native_version: '1', workspace_root: 'D:\\w', mcp_config_file: 'D:\\m.json', mcp_config_sha256: sha, settings_file: 'D:\\s.json', settings_sha256: 'b'.repeat(64) } } : {}),
    ...(marker === 'agy' ? { agy_discussion_profile: { model_id: 'm', native_version: '1', workspace_root: 'D:\\w', project_id: '11111111-2222-3333-4444-555555555555', project_file: 'D:\\p.json', project_sha256: sha, agent_file: 'D:\\a.md', agent_sha256: 'b'.repeat(64), hooks_file: 'D:\\h.json', hooks_sha256: 'c'.repeat(64), tool_gate_file: 'D:\\g.mjs', tool_gate_sha256: 'd'.repeat(64) } } : {}),
  });
}

test('强度默认值与档位：codex/Claude 讨论档案 LOW、agy HIGH；无档案通道不冻结；非法档位被拒', () => {
  const codex = profileContract('codex', 'codex', ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
  const claude = profileContract('claude-code', 'claude', ['LOW', 'MEDIUM', 'HIGH']);
  const agy = profileContract('agy', 'agy', ['LOW', 'MEDIUM', 'HIGH']);
  const plain = profileContract('plain', 'none', undefined);
  const noProfile = plain;
  assert.equal(defaultCollabEffort(codex), 'LOW');
  assert.equal(defaultCollabEffort(claude), 'LOW');
  assert.equal(defaultCollabEffort(agy), 'HIGH');
  assert.equal(defaultCollabEffort(noProfile), undefined, '非讨论档案通道不冻结强度（旧行为）');
  assert.deepEqual(collabEffortLevels(agy), ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(collabEffortLevels(noProfile), ['LOW', 'HIGH', 'XHIGH'], '未声明档位退回通用三档');

  assert.equal(parseCollabEffortRequest(agy, 'C', 'high'), 'HIGH', '大小写归一');
  assert.equal(parseCollabEffortRequest(agy, 'C', undefined), undefined, '未请求 = 用默认');
  assert.throws(() => parseCollabEffortRequest(agy, 'C', 'ULTRA'), /不在可用档位 LOW\|MEDIUM\|HIGH 内/);
  assert.throws(() => parseCollabEffortRequest(agy, 'C', 5), /必须是字符串/);
  // 模型默认值判定：只有讨论档案通道有绑定模型
  assert.equal(defaultCollabModelId(codex), 'm');
  assert.equal(defaultCollabModelId(noProfile), undefined);
});

test('协作表单：模型初值优先讨论档案绑定模型（仅协作表单，保留用户显式选择）', () => {
  const html = renderBoardPage();
  assert.match(html, /entry\.collab_default_model_id/, '协作表单必须读名册的 collab_default_model_id');
  assert.match(html, /models\.indexOf\(current\) >= 0\) model\.value = current/, '用户显式选过的模型优先保留');
  assert.match(html, /else if \(collabDefault && models\.indexOf\(collabDefault\) >= 0\)/, '换犬/首次填充才回到绑定模型');
  // 只影响协作表单：普通派发的模型预填仍走 req.model_id，不读 collab_default_model_id
  const dispatchPrefill = html.slice(html.indexOf('selectOptionByValue(document.getElementById(\'dispatch-effort\'), req.effort)'));
  assert.doesNotMatch(dispatchPrefill.slice(0, 600), /collab_default_model_id/, '普通派发路径不得消费协作默认模型');
});

/** 合成证据库：五维行为级通过（本文件只考强度冻结，不重复考证据语义）。 */
function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085-effort/${adapterId}/${fingerprint}/${dimension}`;
      records.set(source, {
        source, adapter_id: adapterId, dimension, method: 'dispatch_receipt', subject: 'synthetic fixture',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior',
        artifact_sha256: 'a'.repeat(64), result: 'pass', recorded_at_utc: new Date().toISOString(),
      });
      return { source, adapter_id: adapterId, dimension, subject: 'synthetic fixture', method: 'dispatch_receipt',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint,
        verification: 'behavior' as const, status: 'live_verified' as const };
    });
  return { store: { resolve: (source: string) => records.get(source), failuresFor: () => [] }, forParticipant };
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

async function boot(root: string): Promise<{ base: string; token: string }> {
  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(root, { evidenceStore: store });
  const contracts = discussionContracts(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts,
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => '2.1.286',
    runAdapter: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }),
  });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-effort', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store, collaborationEvidence: (p, c) => forParticipant(p.adapter_id, contractPermissionFingerprint(c)),
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, token: server.callerToken };
}

async function post(base: string, token: string, url: string, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('API：逐席位强度随授权快照冻结（覆盖生效、未请求用默认），审批卡同步带出', async () => {
  const root = fixtureRoot('freeze');
  const { base, token } = await boot(root);
  const created = await post(base, token, '/api/collaboration/sessions', {
    topic: '逐席位强度',
    participants: [
      { adapter_id: 'codex', model_id: 'gpt-5.5', effort: 'MEDIUM' },
      { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' },
    ],
    materials: [{ name: 'm', content: 'x', allowed_seats: ['A', 'B'] }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const detail = await post(base, token, '/api/collaboration/sessions/detail', { session_id: created.body.session_id });
  const participants = (detail.body.snapshot as { participants: Array<{ seat: string; adapter_id: string; effort?: string }> }).participants;
  assert.deepEqual(participants.map((p) => `${p.seat}:${p.adapter_id}:${p.effort}`), ['A:codex:MEDIUM', 'B:claude-code:LOW'],
    'A 席显式 MEDIUM 生效，B 席未请求则用冻结默认 LOW');
  const card = JSON.parse(readFileSync(path.join(root, 'approvals', String(created.body.request_file)), 'utf8')) as { participants: Array<{ effort?: string }> };
  assert.deepEqual(card.participants.map((p) => p.effort), ['MEDIUM', 'LOW'], '审批卡必须带出逐席位强度');
});

test('API：快照里的强度与模型初值口径同源（界面初值不会偷偷改配置）', async () => {
  const root = fixtureRoot('roster-default');
  const { base, token } = await boot(root);
  const snapshot = await fetch(base + '/api/snapshot', { headers: { 'x-mush-caller-auth': token } }).then((r) => r.json()) as { roster?: Array<Record<string, unknown>> };
  const roster = snapshot.roster ?? [];
  const codex = roster.find((r) => r.adapter_id === 'codex');
  const claude = roster.find((r) => r.adapter_id === 'claude-code');
  assert.equal(codex?.collab_default_effort, 'LOW', '名册暴露 codex 席位默认 LOW（界面初值同源）');
  assert.equal(claude?.collab_default_effort, 'LOW', '名册暴露 Claude 席位默认 LOW');
  assert.deepEqual(claude?.effort_levels, ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'], '档位来自合同声明');
  // GOAL-085：协作席位模型初值 = 讨论档案绑定的模型（证据/批准按它登记），
  // 而不是名册默认模型（实测本机 codex 名册默认是 gpt-5.6-sol，用它创建会撞准入门）。
  assert.equal(codex?.collab_default_model_id, 'gpt-5.5', 'codex 席位模型初值取讨论档案绑定模型');
  assert.equal(claude?.collab_default_model_id, 'claude-sonnet-5', 'Claude 席位模型初值取讨论档案绑定模型');
  assert.equal(defaultCollabModelId(discussionContracts(root).codex), 'gpt-5.5', '默认值判定与名册投影同源');
});

test('API：非法档位/非字符串档位一律拒绝，且不留半成品会话', async () => {
  const root = fixtureRoot('reject');
  const { base, token } = await boot(root);
  // 注意 ULTRA 是 codex 的合法档位（合同声明），非法档位用两条通道都没有的取值。
  const cases: Array<[unknown, RegExp]> = [['TURBO', /不在可用档位/], [5, /必须是字符串/], ['', /必须是字符串/]];
  for (const [effort, pattern] of cases) {
    const res = await post(base, token, '/api/collaboration/sessions', {
      topic: '非法强度',
      participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5', effort }, { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }],
    });
    assert.equal(res.status, 400, `effort=${String(effort)} 应被拒绝：${JSON.stringify(res.body)}`);
    assert.match(String(res.body.error), pattern);
  }
  const sessions = await fetch(base + '/api/collaboration/sessions', { headers: { 'x-mush-caller-auth': token } }).then((r) => r.json()) as { sessions?: unknown[] };
  assert.deepEqual(sessions.sessions ?? [], [], '被拒的创建不留任何会话');
});

test('API：强度不进入权限指纹（§3.3 质量旋钮口径不变）', async () => {
  const root = fixtureRoot('fingerprint');
  const { base, token } = await boot(root);
  const mk = (effort: string) => post(base, token, '/api/collaboration/sessions', {
    topic: '指纹',
    participants: [{ adapter_id: 'codex', model_id: 'gpt-5.5', effort }, { adapter_id: 'claude-code', model_id: 'claude-sonnet-5' }],
  });
  const a = await mk('LOW');
  const b = await mk('HIGH');
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const fp = async (id: unknown) => ((await post(base, token, '/api/collaboration/sessions/detail', { session_id: id })).body.snapshot as { participants: Array<{ config_fingerprint: string }> }).participants.map((p) => p.config_fingerprint);
  const low = await fp(a.body.session_id);
  const high = await fp(b.body.session_id);
  assert.deepEqual(high, low, '强度是质量旋钮：同一通道不同强度共用同一权限指纹（既有决议口径）');
});
