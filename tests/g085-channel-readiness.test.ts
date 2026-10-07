import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { realDiscussionBaseline } from '../src/web/collaboration-history.ts';

test('真实复现索引按完整席位、强度、版本匹配；隔离fixture根不借用生产证据', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-history-'));
  mkdirSync(path.join(root, 'goals/receipts'), {recursive:true});
  const detail = { status: 'completed', session_id: 'fixture-history', snapshot: { participants: [
    { seat: 'A' as const, adapter_id: 'codex', provider_id: 'fixture', model_id: 'fixture-model', effort: 'LOW', config_fingerprint: 'a'.repeat(64) },
    { seat: 'B' as const, adapter_id: 'claude-code', provider_id: 'fixture', model_id: 'fixture-model', effort: 'LOW', config_fingerprint: 'b'.repeat(64) },
  ] } };
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const detailText = JSON.stringify(detail), file = path.join(root, 'final-detail.json');
  writeFileSync(file, detailText);
  const receiptText = JSON.stringify({session_id:detail.session_id, evidence:[{file,sha256:hash(detailText)}]});
  writeFileSync(path.join(root,'goals/receipts/test.json'), receiptText);
  const baselines = [{file:'test.json',sha256:hash(receiptText),versions:{codex:'0.160.0','claude-code':'2.1.290'}}];
  const channels = ['codex', 'claude-code'].map(id => ({ adapter_id: id, ready: true, checked_at_utc: '', observed_version: id === 'codex' ? 'codex-cli 0.160.0' : '2.1.290' }));
  assert.equal(realDiscussionBaseline(root, detail.snapshot.participants, channels, baselines).status, 'VERIFIED');
  const changed = structuredClone(detail.snapshot.participants); changed[0].effort = 'HIGH';
  assert.equal(realDiscussionBaseline(root, changed, channels, baselines).status, 'UNTESTED');
  channels[1]!.observed_version = '2.1.291';
  assert.equal(realDiscussionBaseline(root, detail.snapshot.participants, channels, baselines).status, 'UNTESTED');
  channels[1]!.observed_version = '2.1.290';
  writeFileSync(file, detailText + ' ');
  assert.equal(realDiscussionBaseline(root, detail.snapshot.participants, channels, baselines).status, 'UNTESTED', '哈希变化不采纳');
  assert.equal(realDiscussionBaseline(root, detail.snapshot.participants, channels).status, 'UNTESTED', '生产默认清单不会采纳合成回执');
});

test('缓存超过30秒重新观测；资产变化不能被有效版本缓存掩盖', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-readiness-'));
  const contract = buildClaudeDiscussionProfile({ workspace: path.join(root, 'w'), directory: path.join(root, 'p'),
    nativeVersion: '2.1.286', modelId: 'claude-sonnet-5', contract: buildClaudeContract('claude-sonnet-5') }).contract;
  let inspections = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'a'), ledgerPath: path.join(root, 'l'),
    contracts: { 'claude-code': contract }, claudeDiscussionInspector: async () => { inspections++; return '2.1.286'; } });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready, true);
  t.mock.timers.tick(30001);
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready, true);
  assert.equal(inspections, 2);
  writeFileSync(contract.claude_discussion_profile!.settings_file, '{} modified');
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready, false);
  assert.equal(inspections, 2, '已变更资产应早于再次原生检查被拒');
});

test('版本观测最多缓存30秒，强制刷新发现升级；未选通道不被探测', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-readiness-'));
  const contract = buildClaudeDiscussionProfile({ workspace: path.join(root, 'w'), directory: path.join(root, 'p'),
    nativeVersion: '2.1.286', modelId: 'claude-sonnet-5', contract: buildClaudeContract('claude-sonnet-5') }).contract;
  let version = '2.1.286', inspections = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'a'),
    ledgerPath: path.join(root, 'l.jsonl'), contracts: { 'claude-code': contract },
    claudeDiscussionInspector: async () => { inspections++; return version; } });
  const first = await pipeline.checkDiscussionChannels(['claude-code']);
  assert.equal(first[0]?.ready, true);
  assert.equal(first[0]?.observed_version, '2.1.286');
  version = '2.1.999';
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready, true);
  assert.equal(inspections, 1);
  const fresh = await pipeline.checkDiscussionChannels(['claude-code'], true);
  assert.equal(fresh[0]?.ready, false);
  assert.equal(fresh[0]?.observed_version, '2.1.999');
  assert.match(fresh[0]?.reason ?? '', /version/);
  await assert.rejects(pipeline.preflightDiscussionChannels(['claude-code']), /version/);
  assert.equal(inspections, 3, '执行预检不得使用展示缓存');
});

test('检查失败与未激活档案不能显示为可用', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-readiness-'));
  const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'a'), ledgerPath: path.join(root, 'l.jsonl') });
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready, false);
  assert.equal((await pipeline.checkDiscussionChannels(['missing']))[0]?.ready, false);
});

test('有效版本缓存不缓存政策放行；政策撤销立即阻断', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-readiness-'));
  const contract = buildClaudeDiscussionProfile({ workspace:path.join(root,'w'), directory:path.join(root,'p'),
    nativeVersion:'2.1.286',modelId:'claude-sonnet-5',contract:buildClaudeContract('claude-sonnet-5') }).contract;
  const policyFile = path.join(root,'version-drift-acceptance.json');
  const policy = {decision:'fixture',accepted_by:'test',frozen_native_version:'2.1.286',accepted_versions:['2.1.289']};
  writeFileSync(policyFile,JSON.stringify(policy));
  let inspections=0;
  const pipeline = new DispatchPipeline({workspaceRoot:root,approvalRoot:path.join(root,'a'),ledgerPath:path.join(root,'l'),
    contracts:{'claude-code':contract},claudeDiscussionInspector:async()=>{inspections++;return '2.1.289';}});
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready,true);
  writeFileSync(policyFile,JSON.stringify({...policy,accepted_versions:[]}));
  assert.equal((await pipeline.checkDiscussionChannels(['claude-code']))[0]?.ready,false);
  assert.equal(inspections,1,'政策重判不需要消耗模型或重复进程观测');
});
