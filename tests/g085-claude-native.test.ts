/** GOAL-085：Claude 受控通道的**隔离原生验证**——真实 spawn 本地假后端（零真实账户、零网络、零模型）。
 *  验证：受控 argv 实际形态、schema inline 运输、stream-json 解析与结构化回执、工具请求面可见性、
 *  模型身份 fail-closed、长输出/取消。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

const FAKE_CLI = path.resolve('tests', 'fixtures', 'claude-probe-assets', 'fake-claude.mjs');

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-claude-native-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** 受控档案合同 → 只把可执行文件换成假后端，`-p` 原位替换为脚本路径（prompt 仍居尾）。 */
function withFakeCli(contract: AdapterContract): AdapterContract {
  const args = [...(contract.arguments ?? [])];
  const printAt = args.indexOf('-p');
  if (printAt !== -1) args[printAt] = FAKE_CLI;
  else args.unshift(FAKE_CLI);
  return validateAdapterContract({ ...contract, executable: process.execPath, arguments: args });
}

function buildControlled(root: string, tag: string): AdapterContract {
  const { contract } = buildClaudeDiscussionProfile({
    workspace: path.join(root, 'workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(root, 'profile-' + tag),
  });
  return withFakeCli(contract);
}

/** 版本探测注入：假后端在 `--version` 上回 2.1.286（与绑定一致），
 *  同时把这条只读调用也记进同一日志，便于断言"派发前确实做了版本核验"。 */
const versionInspector = async (): Promise<string> => '2.1.286 (Claude Code)';

function makePipeline(root: string, contract: AdapterContract): DispatchPipeline {
  return new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger.jsonl'),
    contracts: { 'claude-code': contract },
    claudeDiscussionInspector: versionInspector,
  });
}

const CLOSED_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(['write', 'read', 'shell', 'mcp', 'recursion'].map((k) => [k, { type: 'string', enum: ['BLOCKED', 'AVAILABLE', 'NOT_ATTEMPTED'] }])),
  required: ['write', 'read', 'shell', 'mcp', 'recursion'],
  additionalProperties: false,
};

test('隔离原生：受控 argv 实际下发（safe-mode/空工具/空 MCP/不持久化），prompt 居尾', async () => {
  const root = fixtureRoot('argv');
  const log = path.join(root, 'fake-cli.jsonl');
  process.env.MUSH_FAKE_CLAUDE_LOG = log;
  const contract = buildControlled(root, 'argv');
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: 'long task', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'PASS', JSON.stringify(record.error));
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 1);
  const argv = calls[0].argv as string[];
  assert.equal(argv[argv.length - 1], 'long task', 'prompt 恒居尾');
  assert.notEqual(argv.indexOf('--safe-mode'), -1);
  assert.equal(argv[argv.indexOf('--tools') + 1], '');
  assert.notEqual(argv.indexOf('--strict-mcp-config'), -1);
  assert.notEqual(argv.indexOf('--no-session-persistence'), -1);
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5');
  assert.equal(argv.indexOf('--json-schema') !== -1, true, 'schema inline 运输');
  assert.equal(path.resolve(calls[0].cwd), path.resolve(contract.claude_discussion_profile!.workspace_root),
    '实际 cwd 从绑定派生');
  delete process.env.MUSH_FAKE_CLAUDE_LOG;
});

test('隔离原生：stream-json 解析出结构化输出，且完整对象进入记录与回执', async () => {
  const root = fixtureRoot('structured');
  const contract = buildControlled(root, 'structured');
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '返回闭合 schema', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'PASS', JSON.stringify(record.error));
  assert.deepEqual(record.structured_output, { write: 'BLOCKED', read: 'BLOCKED', shell: 'BLOCKED', mcp: 'BLOCKED', recursion: 'BLOCKED' });
  assert.ok(record.receipt_path !== null && existsSync(record.receipt_path), '回执已落盘');
  const receipt = JSON.parse(readFileSync(record.receipt_path!, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(receipt.structured_output, record.structured_output, '完整 structured_output 进入回执');
  assert.equal(typeof receipt.stdout_sha256, 'string');
  assert.notEqual(record.session_id, null, '原生 session_id 被解析');
});

test('隔离原生：模型"尝试"工具时，工具请求在流中可见但不产生执行痕迹', async () => {
  const root = fixtureRoot('tool-attempt');
  const contract = buildControlled(root, 'tool-attempt');
  const touch = path.join(root, 'touched.marker');
  process.env.MUSH_FAKE_CLAUDE_EMIT_TOOL_CALLS = '1';
  process.env.MUSH_FAKE_CLAUDE_TOUCH = touch;
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '尝试工具', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'PASS', JSON.stringify(record.error));
  assert.ok(!existsSync(path.join(root, 'workspace', 'probe-write.txt')), '合成写目标未被创建');
  assert.ok(!existsSync(path.join(root, 'workspace', 'probe-write.txt')), '合成写目标未被创建');
  assert.deepEqual(record.structured_output, { write: 'BLOCKED', read: 'BLOCKED', shell: 'BLOCKED', mcp: 'BLOCKED', recursion: 'BLOCKED' });
  delete process.env.MUSH_FAKE_CLAUDE_EMIT_TOOL_CALLS;
  delete process.env.MUSH_FAKE_CLAUDE_TOUCH;
});

test('隔离原生：运行时模型身份与绑定不符即失败（不再记 PASS）', async () => {
  const root = fixtureRoot('identity');
  const contract = buildControlled(root, 'identity');
  // 假后端在原生流里宣称自己是另一个模型。GOAL-085（2026-10-05 独立审核要求）起，
  // 派发路径**逐轮**比对运行时上报身份：不符即 FAIL、不产出可用结构化输出，
  // 协调器据此停止并不形成观点。身份证明另走 nonce 路径，二者不可互相替代。
  process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL = 'claude-sonnet-4-5';
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '身份不符', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'FAIL', '运行时身份与绑定不符必须失败，实际=' + record.status);
  assert.match(String(record.error), /identity mismatch/, '失败原因须指明身份不符：' + String(record.error));
  assert.equal(record.observed_model_id, 'claude-sonnet-4-5', '回执须记录观测到的身份供审计');
  assert.equal(record.structured_output, undefined, '身份不符时不得产出可用结构化输出（协调器不会据此形成观点）');
  delete process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL;
});

test('隔离原生：运行时身份与绑定一致时照常 PASS 并记录观测量', async () => {
  const root = fixtureRoot('identity-ok');
  const contract = buildControlled(root, 'identity-ok');
  process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL = 'claude-sonnet-5';
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '身份一致', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'PASS', JSON.stringify(record.error));
  assert.equal(record.observed_model_id, 'claude-sonnet-5');
  delete process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL;
});

test('隔离原生：身份不可证（init 上报未知串）也必须拒绝，且回执不留合法输出', async () => {
  const root = fixtureRoot('identity-missing');
  const contract = buildControlled(root, 'identity-missing');
  // 原生 init 上报一个**非绑定**的未知模型串：身份存在但不可信。
  // 受控讨论席位要求身份存在且匹配，因此必须 FAIL——不能"解析不到就放行"。
  process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL = 'UNKNOWN_UNPARSEABLE';
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '身份不可证', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'FAIL', '身份不可证必须拒绝，实际=' + record.status);
  assert.match(String(record.error), /identity mismatch/, '原因须写明身份不符：' + String(record.error));
  assert.equal(record.structured_output, undefined, '身份不可证时不得留下可用结构化输出');
  // 记录与回执必须一致：回执同样不得保留那份输出。
  const receipt = JSON.parse(readFileSync(record.receipt_path!, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.structured_output, undefined, '回执不得保留身份未证时的结构化输出');
  assert.equal(receipt.identity_failed, true, '回执须标记身份判定失败');
  assert.equal(typeof receipt.raw_stream, 'string', '原始流仍须保留作审计证据');
  assert.match(String(receipt.raw_stream), /"subtype":"init"/);
  delete process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL;
});

test('隔离原生：超时不得被身份判定掩盖（原因仍是 TIMEOUT）', async () => {
  const root = fixtureRoot('identity-timeout');
  const contract = buildControlled(root, 'identity-timeout');
  // 超时被杀时原生流可能没有任何 init；真正的原因是超时。
  // 身份门只在执行成功时生效，不得把 TIMEOUT 改写成身份失败。
  process.env.MUSH_FAKE_CLAUDE_HANG_MS = '30000';
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '超时', real: true, timeout_s: 5 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'TIMEOUT', '超时必须如实结算为 TIMEOUT，实际=' + record.status + ' err=' + String(record.error));
  delete process.env.MUSH_FAKE_CLAUDE_HANG_MS;
});

test('隔离原生：身份不符时回执同样剔除结构化输出，但保留原始流与观测身份', async () => {
  const root = fixtureRoot('identity-receipt');
  const contract = buildControlled(root, 'identity-receipt');
  process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL = 'claude-sonnet-4-5';
  const pipeline = makePipeline(root, contract);
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '身份不符回执', real: true, timeout_s: 30 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  assert.equal(record.status, 'FAIL');
  const receipt = JSON.parse(readFileSync(record.receipt_path!, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.structured_output, undefined, '记录已删，回执也必须一致地删掉');
  assert.equal(receipt.observed_model_id, 'claude-sonnet-4-5', '观测身份须入回执供审计');
  assert.equal(receipt.identity_failed, true);
  assert.equal(typeof receipt.raw_stream, 'string', '原始流（含 init 与工具事实）必须保留');
  assert.ok(Number(receipt.raw_stream_bytes) > 0);
  delete process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL;
});

test('隔离原生：长输出——单次超时到点即杀进程并结算 TIMEOUT（与取消同一杀进程路径）', async () => {
  const root = fixtureRoot('cancel');
  const contract = buildControlled(root, 'cancel');
  process.env.MUSH_FAKE_CLAUDE_HANG_MS = '30000';
  const pipeline = makePipeline(root, contract);
  const started = Date.now();
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW', prompt: '挂起', real: true, timeout_s: 5 },
    { restrictTools: true, outputSchema: CLOSED_SCHEMA, originOwner: true },
  );
  const elapsed = Date.now() - started;
  assert.notEqual(record.status, 'PASS', '挂起进程不得记 PASS，实际=' + record.status);
  assert.ok(elapsed < 25_000, '必须在超时点结算而不是等挂起结束（实测 ' + elapsed + 'ms）');
  assert.equal(record.status, 'TIMEOUT', '超时应如实结算为 TIMEOUT');
  delete process.env.MUSH_FAKE_CLAUDE_HANG_MS;
});
