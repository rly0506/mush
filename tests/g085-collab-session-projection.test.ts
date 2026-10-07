/** GOAL-085（owner 2026-10-05 复核）：**待批投影必须排除终态会话**——
 *  会话已 completed/failed/cancelled/interrupted 时，其授权卡不再是"待批"；
 *  **原卡文件与历史一律保留、不写应答、不伪造决定**，只是不再出现在待批列表里。
 *
 *  真实 HTTP + 隔离数据根（零真实模型调用）；另含 `collectBoardSnapshot` 的单元级断言。 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { collectBoardSnapshot } from '../src/web/sources.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { withFixtureDiscussionProfile, fixtureDiscussionInspector } from './fixtures/discussion-profile.ts';
import { CollaborationBlackboard, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { validateAdapterContract, contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const servers: BoardServer[] = [];
after(async () => { for (const s of servers) await s.close(); });

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-projection-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** 无讨论档案的普通通道合同：本用例只考投影，不考准入（不要求隔离证据）。 */
function plainContract(adapterId: string): AdapterContract {
  return validateAdapterContract({
    adapter_id: adapterId,
    executable: process.execPath,
    arguments: ['-e', 'process.stdout.write(JSON.stringify({a_focus:"A",b_focus:"B",material_plan:{A:[],B:[]},notes:"n"}))'],
    protocol: 't1', prompt_transport: 'argument', prompt_flag: '-p',
    expected_provider: 'fixture', expected_model_id: 'fixture-model',
  });
}

function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085-projection/${adapterId}/${fingerprint}/${dimension}`;
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

async function boot(root: string): Promise<{ base: string; token: string; bb: CollaborationBlackboard }> {
  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(root, { evidenceStore: store });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board,
    contracts: { 'codex': withFixtureDiscussionProfile(plainContract('codex'), root) },
    codexDiscussionInspector: fixtureDiscussionInspector,
    runAdapter: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }),
  });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-projection', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store,
    collaborationEvidence: (p, c) => forParticipant(p.adapter_id, contractPermissionFingerprint(c)),
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, token: server.callerToken, bb: board };
}

const post = async (base: string, token: string, url: string, body: object) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const snapshotOf = async (base: string, token: string) => {
  const res = await fetch(base + '/api/snapshot', { headers: { 'x-mush-caller-auth': token } });
  return await res.json() as { approvals: Array<Record<string, unknown>> };
};

test('投影（单元级）：会话已终态 → 授权卡投影为 SESSION_TERMINAL，且不写应答、不删卡', () => {
  const root = fixtureRoot('unit');
  const approvalRoot = path.join(root, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  const card = {
    kind: 'collab-session', gate: 'D30', actor_id: 'collab', session_id: 'sess-1', topic: '议题',
    requested_at_utc: new Date().toISOString(),
  };
  const cardFile = path.join(approvalRoot, 'collab-session-sess-1.json');
  writeFileSync(cardFile, JSON.stringify(card) + '\n', 'utf8');

  const cancelled = collectBoardSnapshot({ eventLogs: [], approvalRoot, collabSessionStatus: () => 'cancelled' });
  const entry = cancelled.approvals.find((a) => a.request_file === 'collab-session-sess-1.json')!;
  assert.equal(entry.status, 'SESSION_TERMINAL', '终态会话的卡不得再投影为待批');
  assert.equal(entry.session_terminal_status, 'cancelled');
  assert.match(entry.stale_reason ?? '', /会话已终态（cancelled）/);
  assert.ok(existsSync(cardFile), '原卡文件必须保留');
  assert.equal(existsSync(cardFile + '.owner-response.json'), false, '不得伪造应答');

  const pending = collectBoardSnapshot({ eventLogs: [], approvalRoot, collabSessionStatus: () => 'pending_approval' });
  assert.equal(pending.approvals.find((a) => a.request_file === 'collab-session-sess-1.json')!.status, 'WAITING', '待批会话仍应照常投影');
  const unknown = collectBoardSnapshot({ eventLogs: [], approvalRoot, collabSessionStatus: () => undefined });
  assert.equal(unknown.approvals.find((a) => a.request_file === 'collab-session-sess-1.json')!.status, 'WAITING', '查不到会话状态时不误标终态');
});

test('投影（HTTP）：取消后的会话从待批投影移除，仍待批的会话保留为 WAITING', async () => {
  const root = fixtureRoot('http');
  const { base, token, bb } = await boot(root);
  const mk = async (topic: string) => {
    const created = await post(base, token, '/api/collaboration/sessions', {
      topic, participants: [{ adapter_id: 'codex' }, { adapter_id: 'codex' }],
      materials: [{ name: 'm', content: 'c', allowed_seats: ['A', 'B'] }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return String(created.body.session_id);
  };
  const keep = await mk('保持待批的会话');
  const drop = await mk('将被取消的会话');

  const before = await snapshotOf(base, token);
  const statusOf = (file: string) => before.approvals.find((a) => a.request_file === file)?.status;
  assert.equal(statusOf(`collab-session-${keep}.json`), 'WAITING');
  assert.equal(statusOf(`collab-session-${drop}.json`), 'WAITING');

  const cancelled = await post(base, token, '/api/collaboration/sessions/cancel', { session_id: drop });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(bb.getSession(drop).status, 'cancelled');

  const after = await snapshotOf(base, token);
  const dropEntry = after.approvals.find((a) => a.request_file === `collab-session-${drop}.json`)!;
  assert.equal(dropEntry.status, 'SESSION_TERMINAL', '取消后的会话卡不得再算待批');
  assert.equal(dropEntry.session_terminal_status, 'cancelled');
  assert.equal(after.approvals.find((a) => a.request_file === `collab-session-${keep}.json`)!.status, 'WAITING', '未取消的会话卡不受影响');
  assert.equal(after.approvals.filter((a) => a.status === 'WAITING' && a.request_file === `collab-session-${drop}.json`).length, 0, '待批列表必须排除它');

  // 原卡与历史保留、未写应答
  const cardPath = path.join(root, 'approvals', `collab-session-${drop}.json`);
  assert.ok(existsSync(cardPath), '原卡文件必须保留');
  assert.equal(JSON.parse(readFileSync(cardPath, 'utf8')).topic, '将被取消的会话', '原卡内容未被改写');
  assert.equal(existsSync(cardPath + '.owner-response.json'), false, '取消不等于写应答：不得伪造 owner 决定');
});
