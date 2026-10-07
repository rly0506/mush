/** GOAL-085 第三阶段第二片（本地 stdio MCP）聚焦回归：
 *  mush mcp——newline-delimited JSON-RPC 2.0；工具复用共享客户端与审批门
 *  （create 仅待批卡、无 approve/reject 工具、工具面不含文件系统）；
 *  fixture 看板 + fake runner，零真实模型。
 *  历史：Codex 二轮复核后本文件曾被损坏脚本截断为 12 字节，已整文件重写
 *  （损坏副本留档 .test-fixtures/backup-g085-mcp-collab.test.ts.corrupted）。 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { CollaborationCoordinator } from '../src/orchestration/collaboration-coordinator.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';
import { mcpCollabTools } from '../src/mcp-collab.ts';

const servers: BoardServer[] = [];
after(async () => { for (const s of servers) await s.close(); });

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-mcp-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085-mcp/${adapterId}/${fingerprint}/${dimension}`;
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

async function boot(root: string): Promise<{ url: string; board: CollaborationBlackboard; pipeline: DispatchPipeline }> {
  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(root, { evidenceStore: store });
  const contracts = discussionContracts(root);
  const emitScript = path.join(root, 'emit.mjs');
  writeFileSync(emitScript, [
    "const prompt = process.argv.at(-1) ?? '';",
    "const phase = prompt.match(/【阶段】(\\w+)/)?.[1];",
    "const seat = prompt.match(/【席位】([A-C])/)?.[1] ?? 'A';",
    "const target = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1];",
    "const answers = {",
    "  coordination: { a_focus: 'A', b_focus: 'B', material_plan: { A: ['m1'], B: ['m1'] }, notes: '' },",
    "  proposal: { body: 'proposal-' + seat, stance: 'support', evidence: ['m1'], reserved_disagreements: '' },",
    "  review: { body: 'review-' + seat, stance: 'qualified', responds_to: target, evidence: [], flaws: ['gap'], suggestions: ['fix'], reserved_disagreements: '' },",
    "  revision: { body: 'revision-' + seat, stance: 'revised', changes: ['adopt'], reserved_disagreements: 'keep-' + seat },",
    "};",
    "process.stdout.write(JSON.stringify(answers[phase] ?? {}));",
    '',
  ].join('\n'), 'utf8');
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts,
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => '2.1.286 (Claude Code)',
    runAdapter: async (contract, prompt, runOptions) => {
      const phase = prompt.match(/【阶段】(\w+)/)?.[1];
      const seat = prompt.match(/【席位】([A-C])/)?.[1] ?? 'A';
      const target = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1];
      const answers: Record<string, unknown> = {
        coordination: { a_focus: 'A', b_focus: 'B', material_plan: { A: ['m1'], B: ['m1'] }, notes: '' },
        proposal: { body: 'proposal-' + seat, stance: 'support', evidence: ['m1'], reserved_disagreements: '' },
        review: { body: 'review-' + seat, stance: 'qualified', responds_to: target, evidence: [], flaws: ['gap'], suggestions: ['fix'], reserved_disagreements: '' },
        revision: { body: 'revision-' + seat, stance: 'revised', changes: ['adopt'], reserved_disagreements: 'keep-' + seat },
      };
      const answer = answers[phase ?? ''] ?? {};
      const initLine = JSON.stringify({ type: 'system', subtype: 'init', model: contract.expected_model_id, session_id: 'fixture-mcp' });
      const stdout = initLine + '\n' + JSON.stringify(answer);
      runOptions?.onStdout?.(stdout);
      return { exitCode: 0, stdout, stderr: '', timedOut: false, childKilled: false, structured_output: answer };
    },
  });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-mcp', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store,
    collaborationEvidence: (p, c) => forParticipant(p.adapter_id, contractPermissionFingerprint(c)),
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, board, pipeline };
}

/** 子进程 stdio MCP 客户端：逐行读 JSON-RPC，按 id 匹配响应（带超时）。 */
class McpProc {
  readonly proc: ChildProcess;
  private readonly waiters = new Map<number, (value: Record<string, unknown>) => void>();
  private nextId = 1;
  readonly exited: Promise<number>;
  readonly stderrChunks: string[] = [];
  readonly stdoutLines: string[] = [];

  constructor(argv: string[]) {
    this.proc = spawn(process.execPath, ['bin/mush', 'mcp', ...argv], { cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: this.proc.stdout!, terminal: false });
    rl.on('line', (line) => {
      this.stdoutLines.push(line);
      const trimmed = line.trim();
      if (trimmed === '') return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(trimmed) as Record<string, unknown>; } catch { return; }
      const id = msg.id;
      if (typeof id === 'number' && this.waiters.has(id)) {
        const resolve = this.waiters.get(id)!;
        this.waiters.delete(id);
        resolve(msg);
      }
    });
    this.proc.stderr!.on('data', (chunk: Buffer) => this.stderrChunks.push(chunk.toString('utf8')));
    this.exited = new Promise<number>((resolve) => {
      this.proc.on('close', (code) => resolve(code ?? -1));
      this.proc.on('error', () => resolve(-1));
    });
  }

  async request(method: string, params?: unknown, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const id = this.nextId;
    this.nextId += 1;
    const waiter = new Promise<Record<string, unknown>>((resolve) => this.waiters.set(id, resolve));
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }) + '\n');
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`mcp request timeout: ${method}`)), timeoutMs));
    return Promise.race([waiter, timeout]);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }) + '\n');
  }

  /** 发送原始帧（协议校验用例）。 */
  raw(line: string): void {
    this.proc.stdin!.write(line + '\n');
  }

  async close(): Promise<number> {
    this.proc.stdin!.end();
    return this.exited;
  }
}

function resultText(response: Record<string, unknown>): string {
  const result = response.result as { content?: Array<{ type: string; text: string }>; isError?: boolean } | undefined;
  assert.ok(result && Array.isArray(result.content), 'tools/call 响应必须带 content');
  return result.content.map((c) => c.text).join('\n');
}

const PARTICIPANTS = [
  { adapter_id: 'codex', model_id: 'gpt-5.5', effort: 'LOW' },
  { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW' },
];

test('MCP stdio：initialize/tools/ping/未知方法（协议面）', async () => {
  const root = fixtureRoot('protocol');
  const { url } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    const initResult = init.result as Record<string, unknown>;
    assert.equal(initResult.protocolVersion, '2024-11-05');
    const serverInfo = initResult.serverInfo as Record<string, unknown>;
    assert.equal(serverInfo.name, 'mush-collab');
    assert.deepEqual((initResult.capabilities as Record<string, unknown>).tools, { listChanged: false });
    await mcp.notify('notifications/initialized');

    const ping = await mcp.request('ping');
    assert.deepEqual(ping.result, {});

    const unknown = await mcp.request('resources/list');
    assert.equal((unknown.error as Record<string, unknown>).code, -32601);

    // 静态断言：工具清单与 schema 不暴露 board_url（目标在启动参数固定）；
    // 工具面不含文件系统（无 path/out）。
    const tools = mcpCollabTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['collab_check', 'collab_create', 'collab_result', 'collab_status', 'collab_stop']);
    assert.ok(!JSON.stringify(tools).includes('board_url'), '工具入参不得暴露 board_url');
    assert.ok(!JSON.stringify(tools).includes('"out"'), 'collab_result 不得暴露 out 落盘参数');
    assert.ok(!JSON.stringify(tools).includes('"path"'), 'materials 不得暴露 path 读文件参数');
  } finally { await mcp.close(); }
});

test('MCP stdio：check/create 待批卡/stop——复用审批门，不自动批准', async () => {
  const root = fixtureRoot('gate');
  const { url, board, pipeline } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    await mcp.notify('notifications/initialized');

    const check = await mcp.request('tools/call', { name: 'collab_check', arguments: { participants: PARTICIPANTS } });
    assert.equal((check.result as { isError?: boolean }).isError, undefined);
    const checkData = JSON.parse(resultText(check)) as Record<string, unknown>;
    assert.equal(checkData.ready, true);

    const created = await mcp.request('tools/call', {
      name: 'collab_create',
      arguments: { topic: 'MCP 薄入口夹具议题', participants: PARTICIPANTS,
        materials: [{ name: '席位材料', content: '冻结材料正文（夹具）', allowed_seats: ['A', 'B'] }], constraints: '夹具约束' },
    });
    assert.equal((created.result as { isError?: boolean }).isError, undefined);
    const createdData = JSON.parse(resultText(created)) as Record<string, unknown>;
    assert.equal(createdData.approval, 'PENDING_OWNER_APPROVAL');
    assert.match(String(createdData.note), /MCP 不自动批准/);
    const sessionId = String(createdData.session_id);
    // 不自动批准：待批状态、零调用、审批卡已生成；材料席位权限保留。
    assert.equal(board.getSession(sessionId).status, 'pending_approval');
    assert.equal(board.getSession(sessionId).call_count, 0);
    assert.ok(pipeline.sessionAuthorizationRequestPath(sessionId));
    const snapshot = board.getAuthorizationSnapshot(sessionId) as unknown as { constraints: string; materials: Array<{ allowed_seats: string[] }> };
    assert.equal(snapshot.constraints, '夹具约束');
    assert.deepEqual(snapshot.materials[0]!.allowed_seats, ['A', 'B']);

    // status 列表与逐会话摘要。
    const list = await mcp.request('tools/call', { name: 'collab_status', arguments: {} });
    const listData = JSON.parse(resultText(list)) as { sessions: Array<Record<string, unknown>> };
    assert.ok(listData.sessions.some(s => s.session_id === sessionId));
    board.authorizeSession(sessionId);
    const summary = await mcp.request('tools/call', { name: 'collab_status', arguments: { session_id: sessionId } });
    const summaryData = JSON.parse(resultText(summary)) as Record<string, unknown>;
    assert.equal(summaryData.status, 'authorized');
    assert.deepEqual(summaryData.review_relations, ['A->B', 'B->A']);

    // stop：已授权（未启动）会话 → cancel 请求被接受（stop_requested 语义）。
    const stopped = await mcp.request('tools/call', { name: 'collab_stop', arguments: { session_id: sessionId } });
    const stoppedData = JSON.parse(resultText(stopped)) as Record<string, unknown>;
    assert.equal(stoppedData.stop_requested, true);
  } finally { await mcp.close(); }
});

test('MCP stdio：result 导出（JSON/Markdown 文本）与工具面不含文件系统', async () => {
  const root = fixtureRoot('result');
  const { url, board, pipeline } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    await mcp.notify('notifications/initialized');

    // 工具业务错误 → isError:true（不崩溃进程）。
    const bad = await mcp.request('tools/call', { name: 'collab_status', arguments: { session_id: '00000000-0000-0000-0000-000000000000' } });
    assert.equal((bad.result as { isError?: boolean }).isError, true);
    assert.match(resultText(bad), /unknown collaboration session/);

    const created = await mcp.request('tools/call', { name: 'collab_create', arguments: { topic: 'MCP 导出夹具', participants: PARTICIPANTS, materials: [{ name: '评审材料', content: '冻结材料正文（夹具）' }] } });
    const sessionId = String((JSON.parse(resultText(created)) as Record<string, unknown>).session_id);
    board.authorizeSession(sessionId);
    const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
    const outcome = await coordinator.run(sessionId);
    assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
    board.recordSessionOutcome(sessionId, { status: 'completed', reason: outcome.reason, dispatch_ids: [...outcome.dispatch_ids] });

    const jsonRes = await mcp.request('tools/call', { name: 'collab_result', arguments: { session_id: sessionId } });
    const doc = JSON.parse(resultText(jsonRes)) as Record<string, unknown>;
    assert.equal(doc.schema, 'mush.collaboration-session-result');
    assert.equal((doc.completion as Record<string, unknown>).complete, true);
    assert.equal((doc.opinions as unknown[]).length, 7);

    // Markdown 以文本返回（MCP 不落盘）。
    const mdRes = await mcp.request('tools/call', { name: 'collab_result', arguments: { session_id: sessionId, format: 'markdown' } });
    assert.equal((mdRes.result as { isError?: boolean }).isError, undefined);
    assert.ok(resultText(mdRes).startsWith('# 协作会话结果：MCP 导出夹具'));

    // Codex 二轮复核缺口 1：MCP 工具面不含文件系统——path/out 明确拒绝。
    const withPath = await mcp.request('tools/call', { name: 'collab_create', arguments: { topic: 'x', participants: PARTICIPANTS, materials: [{ name: 'm', path: 'D:/mush/README.md' }] } });
    assert.equal((withPath.result as { isError?: boolean }).isError, true);
    assert.match(resultText(withPath), /path 不受支持/);
    const withOut = await mcp.request('tools/call', { name: 'collab_result', arguments: { session_id: sessionId, out: path.join(root, 'x.md') } });
    assert.equal((withOut.result as { isError?: boolean }).isError, true);
    assert.match(resultText(withOut), /不支持 out/);
    assert.equal(existsSync(path.join(root, 'x.md')), false, '不得创建文件');
  } finally { await mcp.close(); }
});

test('MCP stdio：非回环 --board-url 拒绝启动（exit 64），错误写 stderr、stdout 无污染', async () => {
  const mcp = new McpProc(['--board-url', 'http://10.1.2.3:4790']);
  const code = await Promise.race([mcp.exited, new Promise<number>(resolve => setTimeout(() => resolve(-1), 10_000))]);
  assert.equal(code, 64, `stderr=${mcp.stderrChunks.join('')}`);
  assert.match(mcp.stderrChunks.join(''), /回环/, '启动错误必须写 stderr');
  assert.equal(mcp.stdoutLines.length, 0, 'stdout 不得出现非协议内容');
});

test('MCP stdio：未知工具名 → isError；stdin EOF 正常退出', async () => {
  const root = fixtureRoot('lifecycle');
  const { url } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    await mcp.notify('notifications/initialized');
    const unknown = await mcp.request('tools/call', { name: 'collab_approve', arguments: { session_id: 'x' } });
    assert.equal((unknown.result as { isError?: boolean }).isError, true, '不存在 approve/reject 工具');
    assert.match(resultText(unknown), /未知工具/);
  } finally {
    const code = await mcp.close();
    assert.equal(code, 0, 'stdin EOF 后正常退出');
  }
});

// ---- Codex 二轮复核四缺口修复回归（2026-10-06） ----

test('MCP 缺口2：未初始化拒绝请求；jsonrpc 非法与空请求回 -32600 不静默', async () => {
  const root = fixtureRoot('lifecycle2');
  const { url } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    // 未 initialize 直接 tools/call → 协议错误（不得执行工具、不得发 HTTP）。
    const early = await mcp.request('tools/call', { name: 'collab_status', arguments: {} });
    assert.ok(early.error !== undefined, '未初始化请求必须回协议错误');
    assert.equal((early.error as Record<string, unknown>).code, -32600);
    assert.match(String((early.error as Record<string, unknown>).message), /not initialized/i);

    // jsonrpc 非 "2.0" → Invalid Request（不静默接受）。
    mcp.raw(JSON.stringify({ jsonrpc: '1.0', id: 99, method: 'tools/list' }));
    await new Promise(resolve => setTimeout(resolve, 400));
    const invalidResp = mcp.stdoutLines.map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .find(m => m !== null && m.id === 99);
    assert.ok(invalidResp, '非法 jsonrpc 请求必须回 -32600');
    assert.equal((invalidResp.error as Record<string, unknown>).code, -32600);

    // 完全无效的空对象请求 → -32600（不静默丢弃）。
    mcp.raw('{}');
    await new Promise(resolve => setTimeout(resolve, 300));
    const emptyResp = mcp.stdoutLines.map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .find(m => m !== null && m.error !== undefined && m.id === null);
    assert.ok(emptyResp, '空对象请求必须回 -32600');

    // 之后正常 initialize → 仍可用。
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    assert.equal(((init.result as Record<string, unknown>).serverInfo as Record<string, unknown>).name, 'mush-collab');
    await mcp.notify('notifications/initialized');
    const ping = await mcp.request('ping');
    assert.deepEqual(ping.result, {});
  } finally { await mcp.close(); }
});

test('MCP 缺口3：入参存在但类型错误 → isError 拒绝（effort:99 / topic 数字 / format 非法）', async () => {
  const root = fixtureRoot('strict-types');
  const { url } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    await mcp.notify('notifications/initialized');
    // effort:99（数字）不得被静默丢弃后用默认值——必须拒绝。
    const badEffort = await mcp.request('tools/call', { name: 'collab_check', arguments: { participants: [{ adapter_id: 'codex', effort: 99 }, { adapter_id: 'claude-code' }] } });
    assert.equal((badEffort.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badEffort), /effort 存在但必须是字符串/);
    // topic 数字 → 拒绝。
    const badTopic = await mcp.request('tools/call', { name: 'collab_create', arguments: { topic: 123, participants: PARTICIPANTS } });
    assert.equal((badTopic.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badTopic), /topic 存在但必须是字符串/);
    // format 非法枚举 → 拒绝（不悄悄回退 json）。
    const badFormat = await mcp.request('tools/call', { name: 'collab_result', arguments: { session_id: '00000000-0000-0000-0000-000000000000', format: 'yaml' } });
    assert.equal((badFormat.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badFormat), /format 存在但必须是/);
  } finally { await mcp.close(); }
});

// ---- Codex 三轮复核三残留修复回归（2026-10-06） ----

test('MCP 三轮缺口1：只发 notifications/initialized 无法绕过握手；对象/null 请求 ID 回 -32600', async () => {
  const root = fixtureRoot('handshake');
  const { url, board } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    // 绕过路径：不发 initialize，直接发 initialized 通知 → 握手未完成，tools/call 仍被拒。
    await mcp.notify('notifications/initialized');
    const bypass = await mcp.request('tools/call', { name: 'collab_status', arguments: {} });
    assert.ok(bypass.error !== undefined, '只发 initialized 通知不得完成握手');
    assert.equal((bypass.error as Record<string, unknown>).code, -32600);
    assert.match(String((bypass.error as Record<string, unknown>).message), /not initialized/i);

    // 对象类型请求 ID → -32600 且响应 id 为 null（不原样回显）。
    mcp.raw(JSON.stringify({ jsonrpc: '2.0', id: { invalid: true }, method: 'tools/list' }));
    await new Promise(resolve => setTimeout(resolve, 300));
    const objIdResp = mcp.stdoutLines.map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .find(m => m !== null && m.error !== undefined && m.id === null);
    assert.ok(objIdResp, '对象 id 请求必须回 -32600');
    assert.equal(objIdResp.id, null, '无效 id 的响应 id 必须为 null，不得原样回显');
    assert.equal((objIdResp.error as Record<string, unknown>).code, -32600);
    assert.match(String((objIdResp.error as Record<string, unknown>).message), /id must be a string or number/);

    // null id 请求同样 -32600。
    mcp.raw(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'tools/list' }));
    await new Promise(resolve => setTimeout(resolve, 300));
    const nullIdResp = mcp.stdoutLines.map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .filter(m => m !== null && m.error !== undefined).length;
    assert.ok(nullIdResp >= 2, 'null id 请求也必须回 -32600');

    // 完整握手后恢复可用：initialize → initialized → tools 可用。
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    assert.equal(((init.result as Record<string, unknown>).serverInfo as Record<string, unknown>).name, 'mush-collab');
    await mcp.notify('notifications/initialized');
    const ping = await mcp.request('ping');
    assert.deepEqual(ping.result, {});
    const list = await mcp.request('tools/list');
    assert.equal(((list.result as Record<string, unknown>).tools as unknown[]).length, 5);
    // 零会话创建（绕过路径未触达看板写路径）。
    assert.equal(board.listSessions().length, 0);
  } finally { await mcp.close(); }
});

test('MCP 三轮缺口2：workspace_root/constraints/refresh 存在但类型错误 → isError 拒绝', async () => {
  const root = fixtureRoot('strict-fields');
  const { url, board } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    await mcp.notify('notifications/initialized');
    // workspace_root:99（数字）——不得静默省略后提交。
    const badWs = await mcp.request('tools/call', { name: 'collab_create', arguments: { topic: 'x', participants: PARTICIPANTS, workspace_root: 99 } });
    assert.equal((badWs.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badWs), /workspace_root 存在但必须是字符串/);
    // constraints:123 —— 同样拒绝。
    const badConstraints = await mcp.request('tools/call', { name: 'collab_create', arguments: { topic: 'x', participants: PARTICIPANTS, constraints: 123 } });
    assert.equal((badConstraints.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badConstraints), /constraints 存在但必须是字符串/);
    // refresh:'yes'（字符串）——collab_check 同样拒绝。
    const badRefresh = await mcp.request('tools/call', { name: 'collab_check', arguments: { participants: PARTICIPANTS, refresh: 'yes' } });
    assert.equal((badRefresh.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badRefresh), /refresh 存在但必须是 boolean/);
    // isolation_required:99 —— 拒绝。
    const badIso = await mcp.request('tools/call', { name: 'collab_create', arguments: { topic: 'x', participants: PARTICIPANTS, isolation_required: 99 } });
    assert.equal((badIso.result as { isError?: boolean }).isError, true);
    assert.match(resultText(badIso), /isolation_required 存在但必须是 boolean/);
    // 以上均未触达看板写路径。
    assert.equal(board.listSessions().length, 0);
  } finally { await mcp.close(); }
});

test('MCP 三轮缺口3：未知/重复旗标启动错误写 stderr、stdout 零输出', async () => {
  const unknownFlag = new McpProc(['--unsupported-mcp-flag']);
  let code = await Promise.race([unknownFlag.exited, new Promise<number>(resolve => setTimeout(() => resolve(-1), 10_000))]);
  assert.equal(code, 64, `stderr=${unknownFlag.stderrChunks.join('')}`);
  assert.match(unknownFlag.stderrChunks.join(''), /unknown flag/);
  assert.equal(unknownFlag.stdoutLines.length, 0, 'stdout 不得出现非协议内容');

  const dupFlag = new McpProc(['--board-url', 'http://127.0.0.1:4790', '--board-url', 'http://localhost:4790']);
  code = await Promise.race([dupFlag.exited, new Promise<number>(resolve => setTimeout(() => resolve(-1), 10_000))]);
  assert.equal(code, 64);
  assert.match(dupFlag.stderrChunks.join(''), /duplicate flag/);
  assert.equal(dupFlag.stdoutLines.length, 0, 'stdout 不得出现非协议内容');
});

// ---- Codex 四轮复核握手绕过修复回归（2026-10-06） ----

test('MCP 四轮：无 id 的 initialize 通知不推进握手（须有可响应的 initialize 请求）', async () => {
  const root = fixtureRoot('handshake2');
  const { url, board } = await boot(root);
  const mcp = new McpProc(['--board-url', url]);
  try {
    // 绕过路径：无 id 的 initialize 通知 + notifications/initialized → 握手仍未完成。
    mcp.raw(JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bypass', version: '0' } } }));
    await mcp.notify('notifications/initialized');
    const bypass = await mcp.request('tools/call', { name: 'collab_status', arguments: {} });
    assert.ok(bypass.error !== undefined, '无 id 的 initialize 通知不得完成握手');
    assert.equal((bypass.error as Record<string, unknown>).code, -32600);
    assert.match(String((bypass.error as Record<string, unknown>).message), /not initialized/i);
    // 绕过路径未触达看板写路径。
    assert.equal(board.listSessions().length, 0);

    // 有 id 的 initialize 请求产生响应后，同一通知才完成握手。
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
    assert.equal(((init.result as Record<string, unknown>).serverInfo as Record<string, unknown>).name, 'mush-collab');
    await mcp.notify('notifications/initialized');
    const list = await mcp.request('tools/list');
    assert.equal(((list.result as Record<string, unknown>).tools as unknown[]).length, 5);
  } finally { await mcp.close(); }
});
