/** GOAL-085 D95（owner 2026-10-05 裁定）：**显式接受原生版本漂移**的机制回归。
 *
 *  规则：观察版本与冻结版本不符时**默认 fail-closed**；只有当 owner 登记文件
 *   ① 里的 `frozen_native_version` 与合同绑定值一致，且
 *   ② 观察版本被逐个列出，
 *  才放行并在返回值里如实报出依据；其余一律抛错。接受**不改变**席位指纹与证据归属。
 *  全部为合成资产，零真实模型调用。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import {
  buildClaudeDiscussionProfile,
  readClaudeVersionDriftAcceptance,
  readClaudeVersionDriftAcceptanceDir,
  verifyClaudeDiscussionBinding,
  type ClaudeVersionDriftAcceptance,
} from '../src/adapters/claude-discussion-profile.ts';
import { contractPermissionFingerprint } from '../src/adapters/contract.ts';

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-drift-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function build(root: string, nativeVersion = '2.1.286') {
  return buildClaudeDiscussionProfile({
    workspace: path.join(root, 'workspace'),
    nativeVersion,
    modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'),
    directory: path.join(root, 'profile'),
  });
}

const acceptance = (over: Partial<ClaudeVersionDriftAcceptance> = {}): ClaudeVersionDriftAcceptance => ({
  schema_version: 1,
  decision: 'D95-fixture',
  accepted_by: 'owner-fixture',
  accepted_at_utc: '2026-10-05T00:00:00.000Z',
  frozen_native_version: '2.1.286',
  accepted_versions: ['2.1.289'],
  ...over,
});

test('版本漂移：无登记 → 照旧 fail-closed（未列出的漂移一律拒绝）', () => {
  const { contract } = build(fixtureRoot('no-acceptance'));
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.289 (Claude Code)'), /native version mismatch/);
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.2.0 (Claude Code)'), /native version mismatch/);
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.289 (Claude Code)', null), /native version mismatch/);
});

test('版本漂移：登记逐个列出观察版本 → 放行并如实报出依据；指纹不变', () => {
  const { contract } = build(fixtureRoot('accepted'));
  const before = contractPermissionFingerprint(contract);
  const result = verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.289 (Claude Code)', acceptance());
  assert.deepEqual(result.drift_accepted, {
    decision: 'D95-fixture', accepted_by: 'owner-fixture',
    frozen_native_version: '2.1.286', observed_native_version: '2.1.289',
  });
  assert.equal(contractPermissionFingerprint(contract), before, '接受漂移不得改变席位指纹');
});

test('版本漂移：登记只覆盖列出的版本（相邻版本仍拒）', () => {
  const { contract } = build(fixtureRoot('narrow'));
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.290 (Claude Code)', acceptance()), /native version mismatch/);
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.28 (Claude Code)', acceptance()), /native version mismatch/);
});

test('版本漂移：登记的冻结版本必须与合同绑定一致，否则不放行', () => {
  const { contract } = build(fixtureRoot('frozen-mismatch'));
  assert.throws(
    () => verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.289 (Claude Code)', acceptance({ frozen_native_version: '2.1.100' })),
    /native version mismatch/,
  );
});

test('版本漂移：版本一致时不产生 drift_accepted（无漂移即无例外）', () => {
  const { contract } = build(fixtureRoot('exact'));
  assert.deepEqual(verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5', '2.1.286 (Claude Code)', acceptance()), {});
  assert.deepEqual(verifyClaudeDiscussionBinding(contract, 'claude-sonnet-5'), {});
  assert.throws(() => verifyClaudeDiscussionBinding(contract, 'gpt-5.5', '2.1.286 (Claude Code)', acceptance()), /model mismatch/);
});

test('版本漂移：登记文件读取——缺失/非法形态一律返回 null（fail-closed）', () => {
  const root = fixtureRoot('read');
  const write = (content: string) => {
    mkdirSync(path.join(root, 'collaboration-admission', 'claude'), { recursive: true });
    writeFileSync(path.join(root, 'collaboration-admission', 'claude', 'version-drift-acceptance.json'), content, 'utf8');
  };
  assert.equal(readClaudeVersionDriftAcceptance(root), null, '缺失即 null');
  write('{ not json');
  assert.equal(readClaudeVersionDriftAcceptance(root), null, '坏 JSON 即 null');
  write(JSON.stringify({ decision: 'D95', accepted_by: 'owner', frozen_native_version: '2.1.286', accepted_versions: '2.1.289' }));
  assert.equal(readClaudeVersionDriftAcceptance(root), null, 'accepted_versions 非数组即 null');
  write(JSON.stringify(acceptance({ accepted_versions: ['2.1.289'] })));
  const parsed = readClaudeVersionDriftAcceptance(root);
  assert.equal(parsed?.decision, 'D95-fixture');
  assert.deepEqual(parsed?.accepted_versions, ['2.1.289']);
});

test('版本漂移：登记目录由合同 workspace_root 的父目录推出（不依赖 dataRoot 布局）', () => {
  const root = fixtureRoot('derive');
  const admissionDir = path.join(root, 'collaboration-admission', 'claude');
  const { contract } = build(path.join(root, 'runtime')); // workspace = <root>/runtime/workspace
  // 生产布局：workspace_root = <runtime>/collaboration-admission/claude/workspace，
  // 而登记与 profile.json 同目录（…/collaboration-admission/claude）。
  const produced = buildClaudeDiscussionProfile({
    workspace: path.join(admissionDir, 'workspace'),
    nativeVersion: '2.1.286',
    modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'),
    directory: path.join(root, 'profile'),
  }).contract;
  assert.equal(
    path.dirname(produced.claude_discussion_profile!.workspace_root), admissionDir,
    '父目录必须就是准入目录',
  );
  mkdirSync(admissionDir, { recursive: true });
  writeFileSync(path.join(admissionDir, 'version-drift-acceptance.json'), JSON.stringify(acceptance()), 'utf8');
  writeFileSync(path.join(admissionDir, 'profile.json'), JSON.stringify({ workspace: path.join(admissionDir, 'workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5' }), 'utf8');
  const derived = readClaudeVersionDriftAcceptanceDir(path.dirname(produced.claude_discussion_profile!.workspace_root));
  assert.equal(derived?.decision, 'D95-fixture', '由合同推出的目录必须能读到登记');
  // 未放登记时按目录读取返回 null（同一推导路径）
  assert.equal(readClaudeVersionDriftAcceptanceDir(path.dirname(contract.claude_discussion_profile!.workspace_root)), null);
});
