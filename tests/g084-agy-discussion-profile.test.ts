import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildAgyContract } from '../src/adapters/agy.ts';
import { buildAgyDiscussionProfile, readAgyVersionDriftAcceptanceDir, verifyAgyDiscussionBinding } from '../src/adapters/agy-discussion-profile.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { contractPermissionFingerprint } from '../src/adapters/contract.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';

function fixture(nested = false) {
  const root = mkdtempSync(path.resolve('.test-fixtures/g084-agy-profile-'));
  const workspace = nested ? path.join(root, 'workspace') : root;
  const projectFile = path.join(root, 'project.json');
  const agentFile = path.join(workspace, '.agents', 'agents', 'mush-discussion.md');
  mkdirSync(path.dirname(agentFile), { recursive: true });
  const projectId = 'bb254da4-c36e-4f99-8801-599547824e0c';
  const deny = ['read_file(*)', 'write_file(*)', 'command(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)', 'unsandboxed(*)'];
  writeFileSync(projectFile, JSON.stringify({ id: projectId, projectResources: { resources: [{ folderUri: 'file://' + workspace.replaceAll('\\', '/') }] }, permissionGrants: { permissionGrants: { deny } } }));
  writeFileSync(agentFile, '---\nname: mush-discussion\ndescription: fixture only\ntools: []\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\nmcpServers: []\nskills: []\nplugins: []\n---\nUse only supplied prompt.');
  const gate = path.join(workspace, '.agents', 'deny-tools.mjs');
  copyFileSync(path.resolve('src/adapters/agy-discussion-gate.mjs'), gate);
  writeFileSync(path.join(workspace, '.agents', 'hooks.json'), JSON.stringify({ 'mush-controlled-discussion': {
    enabled: true, PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ' + gate.replaceAll('\\', '/'), timeout: 5 }] }] } }));
  return { root, workspace, projectId, projectFile, agentFile, deny };
}

test('agy finish-only candidate: precise allowlist, new fingerprint, old binding rejected and byte restoration verified', () => {
  const f = fixture(), base = buildAgyContract();
  const options = { contract: base, workspace: f.root, projectId: f.projectId, projectFile: f.projectFile,
    agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: base.expected_model_id };
  const original = readFileSync(f.agentFile);
  const old = buildAgyDiscussionProfile(options).contract;
  try {
    writeFileSync(f.agentFile, original.toString().replace('tools: []', 'tools: [finish]'));
    const candidate = buildAgyDiscussionProfile(options).contract;
    assert.notEqual(contractPermissionFingerprint(candidate), contractPermissionFingerprint(old));
    assert.deepEqual(candidate.tool_restriction_args, old.tool_restriction_args);
    verifyAgyDiscussionBinding(candidate, base.expected_model_id, 'fixture-1');
    assert.throws(() => verifyAgyDiscussionBinding(old, base.expected_model_id, 'fixture-1'), /hash mismatch/);
    for (const tools of ['[finish, run_command]', '[read_file]', '[finish, finish]', '[Finish]', '["finish"]']) {
      writeFileSync(f.agentFile, original.toString().replace('tools: []', 'tools: ' + tools));
      assert.throws(() => buildAgyDiscussionProfile(options), /capabilities are not closed/);
    }
  } finally { writeFileSync(f.agentFile, original); }
  assert.deepEqual(readFileSync(f.agentFile), original);
  verifyAgyDiscussionBinding(old, base.expected_model_id, 'fixture-1');
});

test('agy discussion profile binds exact project, deny policy, agent assets and version; preserves provider/default model', () => {
  const f = fixture(), base = buildAgyContract();
  const profile = buildAgyDiscussionProfile({ contract: base, workspace: f.root, projectId: f.projectId,
    projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: base.expected_model_id });
  assert.equal(profile.contract.expected_provider, base.expected_provider);
  assert.equal(profile.contract.expected_model_id, base.expected_model_id);
  assert.deepEqual(profile.contract.arguments, base.arguments);
  assert.ok(profile.contract.tool_restriction_args!.includes(f.projectId));
  assert.ok(profile.contract.tool_restriction_args!.includes('mush-discussion'));
  assert.deepEqual(profile.contract.output_schema_args, ['--output-format', 'stream-json']);
  verifyAgyDiscussionBinding(profile.contract, base.expected_model_id, 'fixture-1');
  for (const change of ['agent', 'project', 'version', 'model']) {
    const g = fixture(); const p = buildAgyDiscussionProfile({ contract: base, workspace: g.root, projectId: g.projectId,
      projectFile: g.projectFile, agentFile: g.agentFile, nativeVersion: 'fixture-1', modelId: base.expected_model_id });
    if (change === 'agent') writeFileSync(g.agentFile, 'tools: [run_command]');
    if (change === 'project') writeFileSync(g.projectFile, '{}');
    assert.throws(() => verifyAgyDiscussionBinding(p.contract, change === 'model' ? 'other' : base.expected_model_id,
      change === 'version' ? 'changed' : 'fixture-1'), /hash|version|model/);
  }
});

test('agy profile refuses unbounded projects, missing deny rules and a tool-enabled agent', () => {
  for (const change of ['project-id', 'workspace', 'deny', 'agent']) {
    const f = fixture();
    if (change === 'deny') writeFileSync(f.projectFile, JSON.stringify({ id: f.projectId, projectResources: { resources: [{ folderUri: 'file://' + f.root.replaceAll('\\', '/') }] }, permissionGrants: { permissionGrants: { deny: [] } } }));
    if (change === 'agent') writeFileSync(f.agentFile, '---\nname: mush-discussion\ntools: [run_command]\n---\nfixture');
    assert.throws(() => buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: change === 'workspace' ? path.dirname(f.root) : f.root,
      projectId: change === 'project-id' ? '00000000-0000-0000-0000-000000000000' : f.projectId,
      projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: 'gemini-3.7-flash-high' }), /project|workspace|deny|agent/);
  }
});

test('agy 显式版本漂移：仅名单内且冻结版本匹配时通过，指纹不变并返回审计依据', () => {
  const f = fixture();
  const { contract } = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.root, projectId: f.projectId,
    projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: '1.2.16', modelId: 'gemini-3.7-flash-high' });
  const acceptance = { schema_version: 1 as const, decision: 'D96-fixture', accepted_by: 'owner-fixture',
    accepted_at_utc: '2026-10-05T00:00:00.000Z', frozen_native_version: '1.2.16', accepted_versions: ['1.2.17'] };
  const before = contractPermissionFingerprint(contract);
  assert.throws(() => verifyAgyDiscussionBinding(contract, contract.expected_model_id, '1.2.17'), /native version mismatch/);
  const accepted = verifyAgyDiscussionBinding(contract, contract.expected_model_id, '1.2.17', acceptance);
  assert.deepEqual(accepted, { drift_accepted: { decision: 'D96-fixture', accepted_by: 'owner-fixture',
    frozen_native_version: '1.2.16', observed_native_version: '1.2.17' } });
  assert.equal(contractPermissionFingerprint(contract), before);
  assert.throws(() => verifyAgyDiscussionBinding(contract, contract.expected_model_id, '1.2.18', acceptance), /native version mismatch/);
  assert.throws(() => verifyAgyDiscussionBinding(contract, contract.expected_model_id, '1.2.17', { ...acceptance, frozen_native_version: '1.2.15' }), /native version mismatch/);
  assert.deepEqual(verifyAgyDiscussionBinding(contract, contract.expected_model_id, '1.2.16', acceptance), {});
  assert.throws(() => verifyAgyDiscussionBinding(contract, 'other', '1.2.17', acceptance), /model mismatch/);
  writeFileSync(f.agentFile, 'changed');
  assert.throws(() => verifyAgyDiscussionBinding(contract, contract.expected_model_id, '1.2.17', acceptance), /hash mismatch/);
});

test('agy native binding rejects changed assets/version/model before budget or runner', async () => {
  for (const scenario of ['agent', 'version', 'model']) {
    const f = fixture(); let budgets = 0, runs = 0;
    const profile = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.root, projectId: f.projectId,
      projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: 'gemini-3.7-flash-high' });
    const pipeline = new DispatchPipeline({ workspaceRoot: f.root, approvalRoot: path.join(f.root, 'approvals'), ledgerPath: path.join(f.root, 'ledger'),
      contracts: { agy: profile.contract }, agyDiscussionInspector: async () => scenario === 'version' ? 'other' : 'fixture-1',
      masterGate: { admit: () => { budgets++; throw new Error('budget must not run'); } },
      runAdapter: async () => { runs++; throw new Error('runner must not run'); } });
    if (scenario === 'agent') writeFileSync(f.agentFile, 'changed');
    await assert.rejects(() => pipeline.dispatch({ adapter_id: 'agy', model_id: scenario === 'model' ? 'gemini-3.6-flash-high' : 'gemini-3.7-flash-high',
      effort: 'HIGH', real: true, prompt: 'fixture' }, { restrictTools: true }), /hash|version|model/);
    assert.equal(budgets, 0); assert.equal(runs, 0);
  }
});

test('room preflight checks activated agy before any paid dispatch and rejects unknown versions', async () => {
  const f = fixture(); let calls = 0, inspected = 0;
  const profile = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.root, projectId: f.projectId,
    projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: 'gemini-3.7-flash-high' });
  const pipeline = new DispatchPipeline({ workspaceRoot: f.root, contracts: { agy: profile.contract },
    approvalRoot: path.join(f.root, 'a'), ledgerPath: path.join(f.root, 'ledger'),
    agyDiscussionInspector: async () => { inspected++; return 'unknown-new-version'; },
    runAdapter: async () => { calls++; throw new Error('must not run'); } });
  await assert.rejects(pipeline.preflightDiscussionChannels(), /native version mismatch/);
  assert.equal(inspected, 1); assert.equal(calls, 0); assert.deepEqual(pipeline.recent(), []);
});

test('dual-room preflight does not let an unselected stale Claude block the selected agy channel', async () => {
  const f = fixture(); let claudeChecks = 0, agyChecks = 0;
  const agy = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.root, projectId: f.projectId,
    projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: 'gemini-3.7-flash-high' }).contract;
  const claude = buildClaudeDiscussionProfile({ contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(f.root, 'claude'),
    workspace: path.join(f.root, 'claude-workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5' }).contract;
  const pipeline = new DispatchPipeline({ workspaceRoot: f.root, contracts: { agy, 'claude-code': claude },
    approvalRoot: path.join(f.root, 'a'), ledgerPath: path.join(f.root, 'ledger'),
    agyDiscussionInspector: async () => { agyChecks++; return 'fixture-1'; },
    claudeDiscussionInspector: async () => { claudeChecks++; return '2.1.290'; } });
  await pipeline.preflightDiscussionChannels(['agy']);
  assert.equal(agyChecks, 1); assert.equal(claudeChecks, 0);
  await assert.rejects(pipeline.preflightDiscussionChannels(['agy', 'claude-code']), /native version mismatch/);
  assert.equal(claudeChecks, 1);
  assert.deepEqual(pipeline.recent(), []);
});

test('agy 漂移文件：缺失、坏JSON、坏名单、无接受者均保持拒绝', () => {
  const f = fixture();
  const file = path.join(f.root, 'version-drift-acceptance.json');
  assert.equal(readAgyVersionDriftAcceptanceDir(f.root), null);
  for (const value of ['{bad', JSON.stringify({ schema_version: 1, decision: 'D96', accepted_versions: '1.2.17' }),
    JSON.stringify({ schema_version: 1, decision: 'D96', accepted_by: '', accepted_at_utc: '2026-10-05T00:00:00Z', frozen_native_version: '1.2.16', accepted_versions: ['1.2.17'] })]) {
    writeFileSync(file, value);
    assert.equal(readAgyVersionDriftAcceptanceDir(f.root), null);
  }
  writeFileSync(file, JSON.stringify({ schema_version: 1, decision: 'D96-fixture', accepted_by: 'owner-fixture',
    accepted_at_utc: '2026-10-05T00:00:00Z', frozen_native_version: '1.2.16', accepted_versions: ['1.2.17'] }));
  assert.deepEqual(readAgyVersionDriftAcceptanceDir(f.root)?.accepted_versions, ['1.2.17']);
});

test('agy 漂移管线：宿主目录登记精确生效，header/回执/重载读回保存相同依据，下一版本零spawn拒绝', async () => {
  const f = fixture(true);
  const profile = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.workspace, projectId: f.projectId,
    projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: '1.2.16', modelId: 'gemini-3.7-flash-high' });
  writeFileSync(path.join(f.root, 'version-drift-acceptance.json'), JSON.stringify({ schema_version: 1,
    decision: 'D96-fixture', accepted_by: 'owner-fixture', accepted_at_utc: '2026-10-05T00:00:00Z',
    frozen_native_version: '1.2.16', accepted_versions: ['1.2.17'] }));
  const runtime = path.join(f.root, 'audit');
  const persistence = new BoardPersistence(runtime);
  let observed = '1.2.17', runs = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: f.root, approvalRoot: path.join(f.root, 'approvals'),
    ledgerPath: path.join(f.root, 'ledger'), contracts: { agy: profile.contract }, persistence,
    agyDiscussionInspector: async () => observed,
    runAdapter: async () => { runs++; return { exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }; } });
  const request = { adapter_id: 'agy', model_id: 'gemini-3.7-flash-high', effort: 'HIGH', prompt: 'fixture', real: true };
  const record = await pipeline.dispatch(request, { originOwner: true, restrictTools: true });
  assert.equal(record.status, 'PASS');
  const expected = { decision: 'D96-fixture', accepted_by: 'owner-fixture', frozen_native_version: '1.2.16', observed_native_version: '1.2.17' };
  assert.deepEqual(record.version_drift_accepted, expected);
  const header = JSON.parse(readFileSync(path.join(runtime, 'dispatches', record.dispatch_id + '.jsonl'), 'utf8').split('\n')[0]);
  assert.deepEqual(header.version_drift_accepted, expected);
  assert.deepEqual(JSON.parse(readFileSync(record.receipt_path!, 'utf8')).version_drift_accepted, expected);
  assert.deepEqual(new BoardPersistence(runtime).loadDispatchRecords().find(r => r.dispatch_id === record.dispatch_id)?.version_drift_accepted, expected);
  observed = '1.2.18';
  await assert.rejects(() => pipeline.dispatch(request, { originOwner: true, restrictTools: true }), /native version mismatch/);
  assert.equal(runs, 1, '未登记新版本不得启动第二次runner');
});

test('agy approved replay uses bound native cwd while keeping logical workspace and D30 approval', async () => {
  const f = fixture(), logical = path.join(f.root, 'logical'); mkdirSync(logical);
  const profile = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.root, projectId: f.projectId,
    projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: 'gemini-3.7-flash-high' });
  let inspected = 0; const actualCwds: string[] = [];
  const pipeline = new DispatchPipeline({ workspaceRoot: logical, approvalRoot: path.join(logical, 'approvals'), ledgerPath: path.join(logical, 'ledger'),
    contracts: { agy: profile.contract }, agyDiscussionInspector: async () => { inspected++; return 'fixture-1'; },
    runAdapter: async (_contract, _prompt, options) => { actualCwds.push(options!.workspaceRoot!); return {
      exitCode: 0, stdout: '{"body":"fixture"}', stderr: '', timedOut: false, childKilled: false }; } });
  const pending = await pipeline.dispatch({ adapter_id: 'agy', model_id: 'gemini-3.7-flash-high', effort: 'HIGH', prompt: 'fixture', real: true },
    { prepareOnly: true, restrictTools: true });
  assert.equal(pending.status, 'BLOCKED_WAITING_OWNER'); assert.equal(inspected, 0); assert.deepEqual(actualCwds, []);
  pipeline.grantApprovalToken(pending.dispatch_id);
  const finished = await pipeline.rerun(pending.dispatch_id, { real: true, approved_via: pending.dispatch_id });
  assert.equal(finished.status, 'PASS'); assert.equal(finished.request!.workspace, logical);
  assert.deepEqual(actualCwds, [f.root]); assert.equal(inspected, 1);
});

test('agy binding refuses an altered or disabled hard tool gate before starting a model', () => {
  for (const change of ['gate', 'hooks']) {
    const f = fixture(); const p = buildAgyDiscussionProfile({ contract: buildAgyContract(), workspace: f.root, projectId: f.projectId,
      projectFile: f.projectFile, agentFile: f.agentFile, nativeVersion: 'fixture-1', modelId: 'gemini-3.7-flash-high' });
    writeFileSync(path.join(f.root, '.agents', change === 'gate' ? 'deny-tools.mjs' : 'hooks.json'), change === 'gate' ? 'console.log("allow")' : '{}');
    assert.throws(() => verifyAgyDiscussionBinding(p.contract, 'gemini-3.7-flash-high', 'fixture-1'), /hash|gate|hook/);
  }
});
