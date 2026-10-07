/** GOAL-085 D95 收口（2026-10-05 交接 §4.1 必修缺口）：版本漂移接受事实必须落盘。
 *
 *  交接实证：runtime/dispatches/<id>.jsonl 的 header 字段白名单吞掉了
 *  `version_drift_accepted`（连既有的 `observed_model_id` 也一并丢失），D95 声称的
 *  "放行事实写入派发记录"只成立于内存 + console.warn。本回归用完整
 *  DispatchPipeline + 假 runner（零真实模型调用、隔离数据根）断言：
 *  ① 漂移放行时字段实际进入 header 与回执，并经新 BoardPersistence 实例读回；
 *  ② 无漂移（版本一致）时不编造接受字段；
 *  ③ 旧格式 header（无新字段）读回兼容，不炸、不编造。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { BoardPersistence } from '../src/web/persistence.ts';

const FAKE_CLI = path.resolve('tests', 'fixtures', 'claude-probe-assets', 'fake-claude.mjs');

const CLOSED_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(['write', 'read', 'shell', 'mcp', 'recursion'].map((k) => [k, { type: 'string', enum: ['BLOCKED', 'AVAILABLE', 'NOT_ATTEMPTED'] }])),
  required: ['write', 'read', 'shell', 'mcp', 'recursion'],
  additionalProperties: false,
};

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-drift-persist-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function buildControlled(root: string, tag: string): AdapterContract {
  const { contract } = buildClaudeDiscussionProfile({
    workspace: path.join(root, 'workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(root, 'profile-' + tag),
  });
  const args = [...(contract.arguments ?? [])];
  const printAt = args.indexOf('-p');
  if (printAt !== -1) args[printAt] = FAKE_CLI;
  else args.unshift(FAKE_CLI);
  return validateAdapterContract({ ...contract, executable: process.execPath, arguments: args });
}

/** D95 登记文件（合成）：冻结 2.1.286、放行 2.1.289。准入目录 = workspace_root 的父目录。 */
function writeAcceptance(root: string): void {
  writeFileSync(path.join(root, 'version-drift-acceptance.json'), JSON.stringify({
    schema_version: 1, decision: 'D95-fixture', accepted_by: 'owner-fixture',
    accepted_at_utc: '2026-10-05T00:00:00.000Z',
    frozen_native_version: '2.1.286', accepted_versions: ['2.1.289'],
  }), 'utf8');
}

const DRIFT = {
  decision: 'D95-fixture', accepted_by: 'owner-fixture',
  frozen_native_version: '2.1.286', observed_native_version: '2.1.289',
};

test('D95 漂移放行全链路：header、回执、新实例读回三处都在', async () => {
  const root = fixtureRoot('persist');
  writeAcceptance(root);
  const contract = buildControlled(root, 'persist');
  const runtime = path.join(root, 'runtime');
  const persistence = new BoardPersistence(runtime);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, dataRoot: root,
    approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger.jsonl'),
    contracts: { 'claude-code': contract },
    // 冻结 2.1.286，观察 2.1.289：与交接中真实漂移同一形态
    claudeDiscussionInspector: async () => '2.1.289 (Claude Code)',
    persistence,
  });
  process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL = 'claude-sonnet-5';
  try {
    const record = await pipeline.dispatch(
      { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '漂移放行落盘', real: true, timeout_s: 30 },
      { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
    );
    assert.equal(record.status, 'PASS', JSON.stringify(record.error));
    assert.deepEqual(record.version_drift_accepted, DRIFT, '放行依据必须在记录里');
    assert.equal(record.observed_model_id, 'claude-sonnet-5');

    // ① header 首行实际落盘（重启前）
    const headerLine = readFileSync(persistence.dispatchPath(record.dispatch_id), 'utf8').split('\n')[0];
    const header = JSON.parse(headerLine) as Record<string, unknown>;
    assert.deepEqual(header.version_drift_accepted, DRIFT, 'version_drift_accepted 必须写进 header');
    assert.equal(header.observed_model_id, 'claude-sonnet-5', 'observed_model_id 必须写进 header');

    // ② 回执与记录同源
    const receipt = JSON.parse(readFileSync(record.receipt_path!, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(receipt.version_drift_accepted, DRIFT, '回执必须带同源 version_drift_accepted');
    assert.equal(receipt.observed_model_id, 'claude-sonnet-5');

    // ③ 新 BoardPersistence 实例（= 服务重启）读回
    const restored = new BoardPersistence(runtime).loadDispatchRecords()
      .find((r) => r.dispatch_id === record.dispatch_id);
    assert.ok(restored !== undefined, '重启后必须能读回本单');
    assert.deepEqual(restored.version_drift_accepted, DRIFT, '读回后漂移依据不得丢失');
    assert.equal(restored.observed_model_id, 'claude-sonnet-5', '读回后观测身份不得丢失');
  } finally {
    delete process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL;
  }
});

test('D95 无漂移：版本一致时不编造接受字段（登记在也不写）', async () => {
  const root = fixtureRoot('no-drift');
  writeAcceptance(root);
  const contract = buildControlled(root, 'no-drift');
  const runtime = path.join(root, 'runtime');
  const persistence = new BoardPersistence(runtime);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, dataRoot: root,
    approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger.jsonl'),
    contracts: { 'claude-code': contract },
    claudeDiscussionInspector: async () => '2.1.286 (Claude Code)', // 与冻结一致
    persistence,
  });
  process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL = 'claude-sonnet-5';
  try {
    const record = await pipeline.dispatch(
      { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '无漂移不编造', real: true, timeout_s: 30 },
      { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
    );
    assert.equal(record.status, 'PASS', JSON.stringify(record.error));
    assert.equal(record.version_drift_accepted, undefined, '版本一致即无例外');
    const header = JSON.parse(readFileSync(persistence.dispatchPath(record.dispatch_id), 'utf8').split('\n')[0]) as Record<string, unknown>;
    assert.equal(header.version_drift_accepted, undefined, 'header 不得编造接受字段');
    assert.equal(header.observed_model_id, 'claude-sonnet-5', '观测身份照常进 header');
    const receipt = JSON.parse(readFileSync(record.receipt_path!, 'utf8')) as Record<string, unknown>;
    assert.equal(receipt.version_drift_accepted, undefined, '回执不得编造接受字段');
  } finally {
    delete process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL;
  }
});

test('D95 旧格式兼容：header 无新字段时读回不炸、不编造', () => {
  const root = fixtureRoot('legacy');
  const runtime = path.join(root, 'runtime');
  const persistence = new BoardPersistence(runtime);
  const legacyId = 'legacy' + '0'.repeat(26);
  mkdirSync(path.join(runtime, 'dispatches'), { recursive: true });
  // 旧白名单 header（不含 version_drift_accepted / observed_model_id）+ 一条事件行
  const legacyHeader = {
    kind: 'header', schema_version: 1, dispatch_id: legacyId,
    adapter_id: 'claude-code', status: 'PASS', receipt_path: null,
    admission: null, error: null, stdout_tail: null, stderr_tail: null, session_id: null,
  };
  const legacyEvent = {
    kind: 'event', phase: 'REPORT', status: 'PASS', adapter_id: 'claude-code', dispatch_id: legacyId,
    at_utc: '2026-10-05T00:00:00.000Z', payload: {},
  };
  writeFileSync(
    persistence.dispatchPath(legacyId),
    JSON.stringify(legacyHeader) + '\n' + JSON.stringify(legacyEvent) + '\n',
    'utf8',
  );
  const [record] = persistence.loadDispatchRecords();
  assert.ok(record !== undefined, '旧格式记录必须可读回');
  assert.equal(record.dispatch_id, legacyId);
  assert.equal(record.status, 'PASS');
  assert.equal(record.version_drift_accepted, undefined, '旧记录不补造漂移依据');
  assert.equal(record.observed_model_id, undefined, '旧记录不补造观测身份');
});
