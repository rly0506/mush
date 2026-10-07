/** GOAL-084 第一片：黑板存储、上下文可见性与会话额度的隔离测试。 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CollaborationBlackboard,
  BlackboardAccessError,
  BlackboardQuotaError,
  type CollabMaterialInput,
} from '../src/orchestration/collaboration-blackboard.ts';

function openStore(tag: string): { dir: string; bb: CollaborationBlackboard } {
  const dir = mkdtempSync(path.join(tmpdir(), `g084-${tag}-`));
  return { dir, bb: CollaborationBlackboard.open(dir) };
}

function makeAuthorizedSession(bb: CollaborationBlackboard, materials?: CollabMaterialInput[]): string {
  const { session_id } = bb.createSession({
    topic: '讨论黑板存储的实现方案',
    workspace_root: mkdtempSync(path.join(tmpdir(), 'g084-business-ws-')),
    participants: [
      { seat: 'A', adapter_id: 'codex', is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code' },
    ],
    materials,
  });
  bb.bindRunInstance(session_id, 'A', 'run-A');
  bb.bindRunInstance(session_id, 'B', 'run-B');
  bb.authorizeSession(session_id);
  return session_id;
}

test('会话创建即冻结授权快照：哈希一致、材料哈希落库、快照不可变', () => {
  const { bb } = openStore('auth');
  const { session_id, authorization_hash } = bb.createSession({
    topic: '议题 X',
    workspace_root: 'D:\\some\\ws',
    participants: [
      { seat: 'A', adapter_id: 'codex', is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code' },
    ],
    materials: [{ material_id: 'm1', name: '需求.txt', source: 'owner', content: '原始材料内容', allowed_seats: ['A', 'B'] }],
  });
  const snapshot = bb.getAuthorizationSnapshot(session_id);
  assert.equal(snapshot.call_limit, 7);
  assert.equal(snapshot.retry_limit, 1);
  assert.equal(snapshot.single_call_timeout_s, 180);
  assert.equal(snapshot.session_timeout_min, 20);
  assert.equal(snapshot.materials[0].sha256, createHash('sha256').update('原始材料内容', 'utf8').digest('hex'));
  assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), authorization_hash);
  assert.throws(() => bb.appendAuthorizationSnapshot(), BlackboardAccessError);
  bb.authorizeSession(session_id);
  assert.throws(() => bb.authorizeSession(session_id), BlackboardAccessError);
});

test('参与者约束：必须恰两位（A/B）且恰一位协调者', () => {
  const { bb } = openStore('seats');
  assert.throws(() => bb.createSession({
    topic: 't', workspace_root: 'D:\\ws',
    participants: [
      { seat: 'A', adapter_id: 'codex', is_coordinator: true },
      { seat: 'A', adapter_id: 'x' },
    ],
  }), BlackboardAccessError);
  assert.throws(() => bb.createSession({
    topic: 't', workspace_root: 'D:\\ws',
    participants: [
      { seat: 'A', adapter_id: 'codex' },
      { seat: 'B', adapter_id: 'claude-code' },
    ],
  }), BlackboardAccessError);
});

test('工作区隔离：不同数据面各自成库、跨库不可见、业务工作区目录零足迹', () => {
  const ws1 = mkdtempSync(path.join(tmpdir(), 'g084-ws1-'));
  const s1 = openStore('iso1');
  const s2 = openStore('iso2');
  const { session_id } = s1.bb.createSession({
    topic: '隔离议题',
    workspace_root: ws1,
    participants: [
      { seat: 'A', adapter_id: 'codex', is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code' },
    ],
  });
  assert.equal(path.basename(path.dirname(s1.bb.databasePath)), 'collaboration');
  assert.throws(() => s2.bb.getSession(session_id), /session not found/);
  assert.deepEqual(readdirSync(ws1), [], '会话不得向业务工作区写入任何条目');
});

test('身份纪律：未知运行实例拒绝写入，席位由存储反查，重复绑定拒绝', () => {
  const { bb } = openStore('identity');
  const sessionId = makeAuthorizedSession(bb);
  assert.throws(() => bb.appendViewpoint({
    session_id: sessionId, author_instance: 'model-claimed-instance', body: '伪造作者',
  }), BlackboardAccessError);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议：A 关注存储，B 关注可见性' });
  const vp = bb.getVisibleContext(sessionId, 'A').own[0];
  assert.equal(vp.author_seat, 'A');
  assert.throws(() => bb.bindRunInstance(sessionId, 'A', 'run-other'), /already bound/);
});

test('阶段门：coordination 仅协调者、阶段只沿固定链前进、上一阶段齐备才可放行', () => {
  const { bb } = openStore('phase');
  const sessionId = makeAuthorizedSession(bb);
  assert.throws(() => bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-B', body: 'B 想先说' }), BlackboardAccessError);
  assert.throws(() => bb.setPhase(sessionId, 'review'), BlackboardAccessError);
  assert.throws(() => bb.setPhase(sessionId, 'proposal'), /分配建议/);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议' });
  bb.setPhase(sessionId, 'proposal');
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: 'A 的提案' });
  assert.throws(() => bb.setPhase(sessionId, 'review'), /all 2 seats must finish proposal/);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-B', body: 'B 的提案' });
  bb.setPhase(sessionId, 'review');
  assert.throws(() => bb.setPhase(sessionId, 'proposal'), /must advance/);
});

test('可见性：提案互不可见→评审互换提案→修订只见针对自己提案的质疑', () => {
  const { bb } = openStore('visibility');
  const sessionId = makeAuthorizedSession(bb);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议' });
  bb.setPhase(sessionId, 'proposal');
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: 'A 的提案' });
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-B', body: 'B 的提案' });

  const aInProposal = bb.getVisibleContext(sessionId, 'A');
  assert.equal(aInProposal.visible.length, 0, 'proposal 阶段对方一切不可见');
  const bInProposal = bb.getVisibleContext(sessionId, 'B');
  assert.deepEqual(bInProposal.visible.map((v) => v.kind), ['assignment'], '分配建议对双方公开');

  bb.setPhase(sessionId, 'review');
  const aProposalId = bb.getVisibleContext(sessionId, 'A').own.find((v) => v.kind === 'proposal')!.id;
  const bProposalId = bb.getVisibleContext(sessionId, 'B').own.find((v) => v.kind === 'proposal')!.id;
  const aInReview = bb.getVisibleContext(sessionId, 'A');
  assert.deepEqual(aInReview.visible.map((v) => v.body), ['B 的提案'], '评审阶段互换指定提案');
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', responds_to: bProposalId, body: 'A 评 B' });
  assert.throws(() => bb.appendViewpoint({
    session_id: sessionId, author_instance: 'run-B', responds_to: bProposalId, body: 'B 评自己的提案',
  }), /自己的提案/);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-B', responds_to: aProposalId, body: 'B 评 A' });

  const aStillInReview = bb.getVisibleContext(sessionId, 'A');
  assert.equal(aStillInReview.visible.some((v) => v.kind === 'review'), false, '评审阶段看不到对方评审');
  bb.setPhase(sessionId, 'revision');
  const aInRevision = bb.getVisibleContext(sessionId, 'A');
  assert.deepEqual(aInRevision.visible.filter((v) => v.kind === 'review').map((v) => v.body), ['B 评 A'],
    '修订阶段只见针对自己提案的质疑');
});

test('材料白名单：跨席位不可见、越权引用拒绝、清单冻结 id+哈希', () => {
  const { bb } = openStore('materials');
  const sessionId = makeAuthorizedSession(bb, [
    { material_id: 'mat-a', name: '仅A', source: 'owner', content: 'A 专属', allowed_seats: ['A'] },
    { material_id: 'mat-both', name: '共享', source: 'owner', content: '公共材料', allowed_seats: ['B', 'A'] },
    { material_id: 'mat-b', name: '仅B', source: 'owner', content: 'B 专属', allowed_seats: ['B'] },
  ]);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议' });
  bb.setPhase(sessionId, 'proposal');
  assert.throws(() => bb.appendViewpoint({
    session_id: sessionId, author_instance: 'run-A', body: 'A 提案',
    evidence_material_ids: ['mat-b-unknown'],
  }), /材料不存在/);
  assert.throws(() => bb.appendViewpoint({
    session_id: sessionId, author_instance: 'run-A', body: 'A 提案',
    evidence_material_ids: ['mat-b'],
  }), /无权引用/);
  const aCtx = bb.getVisibleContext(sessionId, 'A');
  assert.deepEqual(aCtx.materials.map((m) => m.material_id).sort(), ['mat-a', 'mat-both']);
  const bCtx = bb.getVisibleContext(sessionId, 'B');
  assert.deepEqual(bCtx.materials.map((m) => m.material_id).sort(), ['mat-b', 'mat-both'], 'B 看不到 A 专属材料');
  bb.appendViewpoint({
    session_id: sessionId, author_instance: 'run-A', body: 'A 的提案',
    evidence_material_ids: ['mat-a'], manifest_material_ids: ['mat-a', 'mat-both'],
  });
  const vp = bb.getVisibleContext(sessionId, 'A').own.find((v) => v.kind === 'proposal')!;
  assert.equal(vp.evidence[0].sha256, createHash('sha256').update('A 专属', 'utf8').digest('hex'));
  assert.equal(vp.material_manifest.length, 2);
  assert.equal(vp.material_manifest[0].material_id, 'mat-a');
});

test('会话额度：正常调用限 7、共享重试恰 1 且总数 8、终态额度冻结', () => {
  const { bb } = openStore('quota');
  const sessionId = makeAuthorizedSession(bb);
  for (let i = 1; i <= 7; i++) {
    const r = bb.occupyCall(sessionId, 'normal', i <= 3 ? 'A' : 'B');
    assert.equal(r.call_index, i);
    bb.recordExecutionResult(r.log_seq, 'pass');
  }
  assert.throws(() => bb.occupyCall(sessionId, 'normal', 'A'), BlackboardQuotaError);
  const retry = bb.occupyCall(sessionId, 'retry', 'A');
  assert.equal(retry.call_index, 8, '重试共享全场预算，占第 8 次调用');
  assert.throws(() => bb.occupyCall(sessionId, 'retry', 'B'), BlackboardQuotaError);
  const log = bb.getExecutionLog(sessionId);
  assert.equal(log.length, 8);
  assert.equal(log[7].kind, 'retry');
  bb.closeSession(sessionId, 'completed');
  assert.throws(() => bb.occupyCall(sessionId, 'retry'), BlackboardQuotaError);
});

test('追加式：每席位每阶段一条、二次写入被拒且原文保留', () => {
  const { bb } = openStore('append-only');
  const sessionId = makeAuthorizedSession(bb);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议 v1' });
  assert.throws(() => bb.appendViewpoint({
    session_id: sessionId, author_instance: 'run-A', body: '分配建议覆盖稿',
  }), /只追加不覆盖/);
  assert.equal(bb.getVisibleContext(sessionId, 'A').own[0].body, '分配建议 v1');
});

test('待批准会话可取消；终态后不可批准、绑定与占用', () => {
  const { bb } = openStore('cancel');
  const { session_id } = bb.createSession({
    topic: '待批议题',
    workspace_root: 'D:\\ws',
    participants: [
      { seat: 'A', adapter_id: 'codex', is_coordinator: true },
      { seat: 'B', adapter_id: 'claude-code' },
    ],
  });
  bb.closeSession(session_id, 'cancelled');
  assert.throws(() => bb.authorizeSession(session_id), BlackboardAccessError);
  assert.throws(() => bb.bindRunInstance(session_id, 'A', 'run-A'), BlackboardAccessError);
  assert.throws(() => bb.occupyCall(session_id, 'normal'), BlackboardQuotaError);
});

// ---- 2026-10-01 Codex 独立复核轮一（owner 转呈）：五个边界回归（复现脚本 .test-fixtures/g084-review-boundaries.mjs）----

test('额度边界：中途重试不挤占正常额度（7 正常 + 1 重试恰好用满）', () => {
  const { bb } = openStore('quota-mid-retry');
  const sessionId = makeAuthorizedSession(bb);
  bb.occupyCall(sessionId, 'normal', 'A');
  bb.occupyCall(sessionId, 'retry', 'A');
  for (let i = 0; i < 6; i++) bb.occupyCall(sessionId, 'normal', 'B');
  const s = bb.getSession(sessionId);
  assert.equal(s.call_count, 8, '应恰好 7 正常 + 1 重试，重试不得提前吃掉正常名额');
  assert.throws(() => bb.occupyCall(sessionId, 'normal', 'A'), BlackboardQuotaError);
  assert.throws(() => bb.occupyCall(sessionId, 'retry', 'A'), BlackboardQuotaError);
});

test('终态冻结：取消后不得推进阶段', () => {
  const { bb } = openStore('terminal-phase');
  const sessionId = makeAuthorizedSession(bb);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议' });
  bb.closeSession(sessionId, 'cancelled');
  assert.throws(() => bb.setPhase(sessionId, 'proposal'), BlackboardAccessError);
  assert.equal(bb.getSession(sessionId).phase, 'coordination');
});

test('身份唯一：同一会话内运行实例与席位一一对应，归属不含糊', () => {
  const { bb } = openStore('identity-unique');
  const sessionId = makeAuthorizedSession(bb);
  assert.throws(() => bb.bindRunInstance(sessionId, 'B', 'run-A'), /一一对应/);
  bb.appendViewpoint({ session_id: sessionId, author_instance: 'run-A', body: '分配建议' });
  assert.equal(bb.getVisibleContext(sessionId, 'A').own[0].author_seat, 'A');
  const bVisibleA = bb.getVisibleContext(sessionId, 'B').visible.filter((v) => v.author_seat === 'A');
  assert.equal(bVisibleA.length, 1, '同一实例不得造成双席位归属');
});

test('材料正文：上下文按席位返回冻结正文与来源', () => {
  const { bb } = openStore('material-content');
  const sessionId = makeAuthorizedSession(bb, [
    { material_id: 'm-shared', name: '共享', source: 'owner', content: 'FROZEN_CONTENT', allowed_seats: ['A', 'B'] },
    { material_id: 'm-a', name: '仅A', source: 'owner', content: 'A-ONLY', allowed_seats: ['A'] },
  ]);
  const aCtx = bb.getVisibleContext(sessionId, 'A');
  const shared = aCtx.materials.find((m) => m.material_id === 'm-shared')!;
  assert.equal(shared.content, 'FROZEN_CONTENT');
  assert.equal(shared.source, 'owner');
  assert.equal(aCtx.materials.find((m) => m.material_id === 'm-a')?.content, 'A-ONLY');
  const bCtx = bb.getVisibleContext(sessionId, 'B');
  assert.equal(bCtx.materials.some((m) => m.material_id === 'm-a'), false, '未获准席位连条目都不可见');
});

test('执行结算：一次结算后不得改写，原始失败证据保留', () => {
  const { bb } = openStore('settle-once');
  const sessionId = makeAuthorizedSession(bb);
  const r = bb.occupyCall(sessionId, 'normal', 'A');
  bb.recordExecutionResult(r.log_seq, 'fail', 'original failure');
  assert.throws(() => bb.recordExecutionResult(r.log_seq, 'pass'), /已结算/);
  const log = bb.getExecutionLog(sessionId);
  assert.equal(log[0].status, 'fail');
  assert.equal(log[0].error, 'original failure');
  assert.ok(log[0].ended_at_utc);
});

// ---- 2026-10-01 Codex 独立复核轮二（owner 转呈）：一次结算的 started 绕过（.test-fixtures/g084-settlement-nonterminal-review.mjs）----

test('结算白名单：started 与未知状态拒绝，正式终态才可落证据', () => {
  const { bb } = openStore('settle-whitelist');
  const sessionId = makeAuthorizedSession(bb);
  const r = bb.occupyCall(sessionId, 'normal', 'A');
  assert.throws(() => bb.recordExecutionResult(r.log_seq, 'started' as never, 'first settlement evidence'), /非法结算状态/);
  assert.throws(() => bb.recordExecutionResult(r.log_seq, 'ok' as never), /非法结算状态/);
  bb.recordExecutionResult(r.log_seq, 'fail', 'original failure');
  const log = bb.getExecutionLog(sessionId);
  assert.equal(log[0].status, 'fail', '拒绝后行仍可正常结算');
  assert.equal(log[0].error, 'original failure');
});

test('结算双保险：ended_at_utc 已置行的二次结算拒绝（含跨状态路径）', () => {
  const { bb } = openStore('settle-db-guard');
  const sessionId = makeAuthorizedSession(bb);
  const r = bb.occupyCall(sessionId, 'normal', 'A');
  bb.recordExecutionResult(r.log_seq, 'timeout', '上游 180s 无响应');
  assert.throws(() => bb.recordExecutionResult(r.log_seq, 'pass'), /已结算/);
  assert.throws(() => bb.recordExecutionResult(r.log_seq, 'interrupted'), /已结算/);
  const log = bb.getExecutionLog(sessionId);
  assert.equal(log[0].status, 'timeout');
  assert.equal(log[0].error, '上游 180s 无响应');
});
