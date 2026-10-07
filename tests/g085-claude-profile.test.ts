/** GOAL-085：Claude Code 讨论通道受控配置——档案装配、参数冻结、漂移复核与隔离纪律。
 *  全部使用合成资产与本地 fixture，零真实账户、零模型调用。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import {
  buildClaudeDiscussionProfile,
  claudeDiscussionRestrictionArgs,
  readClaudeDiscussionInputs,
  verifyClaudeDiscussionBinding,
  writeClaudeDiscussionInputs,
} from '../src/adapters/claude-discussion-profile.ts';
import { contractPermissionFingerprint, validateAdapterContract } from '../src/adapters/contract.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-claude-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function build(root: string, modelId = 'claude-sonnet-5') {
  return buildClaudeDiscussionProfile({
    workspace: path.join(root, 'workspace'),
    nativeVersion: '2.1.286',
    modelId,
    contract: buildClaudeContract(modelId),
    directory: path.join(root, 'profile'),
  });
}

test('Claude 讨论档案：受控参数集齐全且顺序冻结，空 MCP/settings 由宿主生成', () => {
  const root = fixtureRoot('args');
  const { contract, assets } = build(root);
  const args = contract.tool_restriction_args ?? [];
  for (const flag of ['--safe-mode', '--tools', '--strict-mcp-config', '--mcp-config', '--settings',
    '--disable-slash-commands', '--permission-mode', '--no-session-persistence']) {
    assert.notEqual(args.indexOf(flag), -1, `缺少受控参数 ${flag}`);
  }
  assert.equal(args[args.indexOf('--tools') + 1], '', '空字符串禁用全部内建工具');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(args.indexOf('--bare'), -1, '--bare 不采用（会改变加载与认证来源）');
  assert.deepEqual(args, claudeDiscussionRestrictionArgs({ mcpConfigPath: assets.mcpConfigPath, settingsPath: assets.settingsPath }));
  assert.equal(readFileSync(assets.mcpConfigPath, 'utf8'), '{"mcpServers":{}}\n');
  assert.equal(readFileSync(assets.settingsPath, 'utf8'), '{}\n');
  assert.equal(contract.output_schema_flag, '--json-schema');
  assert.equal(contract.output_schema_inline, true, 'schema 走 inline 运输');
  assert.deepEqual(contract.arguments, ['--output-format', 'stream-json', '--verbose']);
});

test('Claude 讨论档案：模型/版本/资产哈希进绑定，漂移即 fail-closed', () => {
  const root = fixtureRoot('drift');
  const { contract, assets } = build(root);
  const profile = contract.claude_discussion_profile!;
  assert.equal(profile.model_id, 'claude-sonnet-5');
  assert.equal(profile.native_version, '2.1.286');
  assert.match(profile.mcp_config_sha256, /^[a-f0-9]{64}$/);
  assert.match(profile.settings_sha256, /^[a-f0-9]{64}$/);

  verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5');
  verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.286');
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-4-5'), /model mismatch/);
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.275'), /native version mismatch/);

  // 参数被改写 → 拒绝
  const tampered = validateAdapterContract({ ...contract, tool_restriction_args: ['--safe-mode'] });
  assert.throws(() => verifyClaudeDiscussionBinding(tampered, 'claude-sonnet-5'), /execution arguments mismatch/);

  // 资产被改写 → 拒绝
  writeFileSync(assets.mcpConfigPath, '{"mcpServers":{"x":{}}}\n', 'utf8');
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5'), /MCP config hash mismatch/);
});

test('Claude 讨论档案：注册校验以传入合同为准；非本地目录与已存在异内容资产一律拒绝', () => {
  const root = fixtureRoot('reject');
  // 传入合同本身就声明了该模型（buildClaudeContract 总是把它设为 expected_model_id），
  // 因此这里只能证明"以传入合同为注册口径"；真正的模型白名单校验在变体层（下方用例）。
  const custom = build(root, 'claude-unknown-9');
  assert.equal(custom.contract.claude_discussion_profile!.model_id, 'claude-unknown-9');
  // 变体不在合同登记范围 → 拒绝
  assert.throws(() => buildClaudeDiscussionProfile({
    workspace: path.join(root, 'w2'), nativeVersion: '2.1.286', modelId: 'claude-not-registered',
    contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(root, 'profile2'),
  }), /registered model/);
  assert.throws(() => buildClaudeDiscussionProfile({
    workspace: path.join(root, 'w3'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'), directory: '//server/share/profile3',
  }), /nonlocal/);
  // 首次生成后改写资产再装配 → 拒绝覆盖
  const first = build(root, 'claude-sonnet-5');
  writeFileSync(first.assets.settingsPath, '{"allow":[]}\n', 'utf8');
  assert.throws(() => build(root, 'claude-sonnet-5'), /refusing overwrite/);
});

test('Claude 讨论档案：契约校验拒绝不完整绑定（缺哈希/缺路径）', () => {
  const root = fixtureRoot('contract-validate');
  const { contract } = build(root);
  const profile = contract.claude_discussion_profile!;
  assert.throws(() => validateAdapterContract({ ...contract, claude_discussion_profile: { ...profile, mcp_config_sha256: 'nope' } }),
    /invalid claude discussion profile binding/);
  assert.throws(() => validateAdapterContract({ ...contract, claude_discussion_profile: { ...profile, settings_file: 'relative.json' } }),
    /invalid claude discussion profile binding/);
  assert.throws(() => validateAdapterContract({ ...contract, claude_discussion_profile: { ...profile, model_id: '' } }),
    /invalid claude discussion profile binding/);
});

test('Claude 讨论档案：登记文件只含目录/模型/版本，异内容拒绝覆盖', () => {
  const root = fixtureRoot('inputs');
  const runtimeRoot = path.join(root, 'runtime');
  const inputs = { workspace: path.join(root, 'workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5' };
  writeClaudeDiscussionInputs(runtimeRoot, inputs);
  assert.deepEqual(readClaudeDiscussionInputs(runtimeRoot), inputs);
  const raw = readFileSync(path.join(runtimeRoot, 'collaboration-admission', 'claude', 'profile.json'), 'utf8');
  assert.equal(/key|token|secret/i.test(raw), false, '登记文件不得含凭据类字段');
  assert.throws(() => writeClaudeDiscussionInputs(runtimeRoot, { ...inputs, modelId: 'other' }), /refusing overwrite/);
});

test('Claude 讨论档案：管线按绑定派生 cwd 并登记工作目录，指纹随参数变化', () => {
  const root = fixtureRoot('pipeline');
  const { contract } = build(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger.jsonl'),
    contracts: { 'claude-code': contract },
  });
  pipeline.registerClaudeDiscussionWorkspace();
  const profile = contract.claude_discussion_profile!;
  assert.ok(pipeline.listWorkspaces().some((w) => path.resolve(w.path) === path.resolve(profile.workspace_root)),
    '讨论工作目录已登记');
  const fingerprint = contractPermissionFingerprint(pipeline.collaborationContract('claude-code', 'claude-sonnet-5'));
  const plain = contractPermissionFingerprint(buildClaudeContract('claude-sonnet-5'));
  assert.notEqual(fingerprint, plain, '讨论档案指纹与普通合同不同');
  // 同一输入重建 → 指纹稳定（可复现）
  const rebuilt = build(root);
  assert.equal(contractPermissionFingerprint(rebuilt.contract), contractPermissionFingerprint(contract));
});
