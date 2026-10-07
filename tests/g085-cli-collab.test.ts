/** GOAL-085 第三阶段第一片（CLI 薄入口）聚焦回归：
 *  mush collab check/create/status/result/stop——看板 HTTP API 的 loopback 薄客户端。
 *  create 仅返回待审批卡、不自动批准（D30）；fixture 数据根 + fake runner，零真实模型。 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runCli } from '../src/cli.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { CollaborationCoordinator } from '../src/orchestration/collaboration-coordinator.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const servers: BoardServer[] = [];
after(async () => { for (const s of servers) await s.close(); });

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-cli-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085-cli/${adapterId}/${fingerprint}/${dimension}`;
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

async function boot(root: string, options: { evidenceForCodex?: boolean } = {}): Promise<{ url: string; board: CollaborationBlackboard; pipeline: DispatchPipeline }> {
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
      const initLine = JSON.stringify({ type: 'system', subtype: 'init', model: contract.expected_model_id, session_id: 'fixture-cli' });
      const stdout = initLine + '\n' + JSON.stringify(answer);
      runOptions?.onStdout?.(stdout);
      return { exitCode: 0, stdout, stderr: '', timedOut: false, childKilled: false, structured_output: answer };
    },
  });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-cli', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store,
    collaborationEvidence: (p, c) => (options.evidenceForCodex === false && p.adapter_id === 'codex' ? [] : forParticipant(p.adapter_id, contractPermissionFingerprint(c))),
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, board, pipeline };
}

const ok = (r: { exitCode: number; stdout: string }): Record<string, unknown> => {
  assert.equal(r.exitCode, 0, `exit=${r.exitCode} stdout=${r.stdout.slice(0, 400)}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
};

test('CLI collab：check 就绪组合 exit 0；看板不可达 exit 3；未知子命令 exit 64', async () => {
  const root = fixtureRoot('check');
  const { url } = await boot(root);
  const good = await runCli(['collab', 'check', '--board-url', url,
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--effort-a', 'LOW',
    '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5', '--effort-b', 'LOW']);
  const goodBody = ok(good);
  assert.equal(goodBody.ready, true, good.stdout.slice(0, 300));
  assert.equal(goodBody.command, 'collab check');

  const unreachable = await runCli(['collab', 'check', '--board-url', 'http://127.0.0.1:1',
    '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(unreachable.exitCode, 3, unreachable.stdout.slice(0, 200));

  const badSub = await runCli(['collab', 'nope', '--board-url', url]);
  assert.equal(badSub.exitCode, 64);
});

test('CLI collab：create 只建待批准卡不自动批准；缺参 exit 64；准入拒绝 exit 2', async () => {
  const root = fixtureRoot('create');
  const { url, board, pipeline } = await boot(root);
  const materialPath = path.join(root, 'material.txt');
  writeFileSync(materialPath, '冻结材料正文（夹具）', 'utf8');
  const created = await runCli(['collab', 'create', '--board-url', url,
    '--topic', 'CLI 薄入口夹具议题', '--constraints', '夹具约束',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--effort-a', 'LOW',
    '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5', '--effort-b', 'LOW',
    '--material', `评审材料=${materialPath}`]);
  const body = ok(created);
  assert.equal(body.status, 'pending_approval');
  assert.equal(body.approval, 'PENDING_OWNER_APPROVAL');
  assert.match(String(body.note), /CLI 不自动批准/);
  const sessionId = String(body.session_id);
  // 未自动批准：会话停在 pending_approval、零调用、审批卡已生成。
  const row = board.getSession(sessionId);
  assert.equal(row.status, 'pending_approval');
  assert.equal(row.call_count, 0);
  assert.ok(existsSync(pipeline.sessionAuthorizationRequestPath(sessionId)));

  const noTopic = await runCli(['collab', 'create', '--board-url', url, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(noTopic.exitCode, 64);
  const missingMaterial = await runCli(['collab', 'create', '--board-url', url, '--topic', 'x',
    '--adapter-a', 'codex', '--adapter-b', 'claude-code', '--material', '名称=不存在的文件.txt']);
  assert.equal(missingMaterial.exitCode, 64);

  // 准入拒绝（codex 无证据）→ 409 → exit 2，原因原样透出。
  const root2 = fixtureRoot('create-409');
  const denied = await boot(root2, { evidenceForCodex: false });
  const rejected = await runCli(['collab', 'create', '--board-url', denied.url, '--topic', '缺证',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5',
    '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5']);
  assert.equal(rejected.exitCode, 2, rejected.stdout.slice(0, 300));
  const rejectedBody = JSON.parse(rejected.stdout) as Record<string, unknown>;
  assert.match(String(rejectedBody.error), /isolation admission|缺行为级/);
});

test('CLI collab：status 无 --session 列表、有 --session 出摘要', async () => {
  const root = fixtureRoot('status');
  const { url, board } = await boot(root);
  const created = await runCli(['collab', 'create', '--board-url', url, '--topic', '状态夹具',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5']);
  const sessionId = String(ok(created).session_id);

  const list = ok(await runCli(['collab', 'status', '--board-url', url]));
  const sessions = list.sessions as Array<Record<string, unknown>>;
  assert.ok(sessions.some(s => s.session_id === sessionId));

  board.authorizeSession(sessionId);
  const summary = ok(await runCli(['collab', 'status', '--board-url', url, '--session', sessionId]));
  assert.equal(summary.status, 'authorized');
  assert.equal(summary.owner_decision, null);
  assert.deepEqual(summary.seats, ['A=codex·gpt-5.5·LOW', 'B=claude-code·claude-sonnet-5·LOW']);
  assert.deepEqual(summary.review_relations, ['A->B', 'B->A']);
});

test('CLI collab：result JSON 到 stdout、Markdown 到 --out 文件，与黑板同源', async () => {
  const root = fixtureRoot('result');
  const { url, board, pipeline } = await boot(root);
  const materialPath = path.join(root, 'material.txt');
  writeFileSync(materialPath, '冻结材料正文（夹具）', 'utf8');
  const created = await runCli(['collab', 'create', '--board-url', url, '--topic', '导出夹具',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5',
    '--material', `评审材料=${materialPath}`]);
  const sessionId = String(ok(created).session_id);
  board.authorizeSession(sessionId);
  const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
  board.recordSessionOutcome(sessionId, { status: 'completed', reason: outcome.reason, dispatch_ids: [...outcome.dispatch_ids] });

  const token = (await (await fetch(url + '/api/session/token')).json() as { caller_token: string }).caller_token;
  const jsonOut = await runCli(['collab', 'result', '--board-url', url, '--session', sessionId, '--format', 'json']);
  assert.equal(jsonOut.exitCode, 0, jsonOut.stdout.slice(0, 300));
  const doc = JSON.parse(jsonOut.stdout) as Record<string, unknown>;
  assert.equal(doc.schema, 'mush.collaboration-session-result');
  assert.equal((doc.completion as Record<string, unknown>).complete, true);
  assert.equal((doc.opinions as unknown[]).length, 7);
  assert.equal(jsonOut.stdout.includes(token), false, 'CLI stdout 不得含 caller token');

  const mdPath = path.join(root, 'result.md');
  const mdOut = ok(await runCli(['collab', 'result', '--board-url', url, '--session', sessionId, '--format', 'markdown', '--out', mdPath]));
  assert.equal(mdOut.format, 'markdown');
  const md = readFileSync(mdPath, 'utf8');
  assert.ok(md.startsWith('# 协作会话结果：导出夹具'));
  assert.ok(md.includes('UNKNOWN（无申报记录，不是 0）'));
  assert.equal(md.includes(token), false);
});

test('CLI collab：stop 对待批准会话取消成功；终态会话 stop exit 2', async () => {
  const root = fixtureRoot('stop');
  const { url, board } = await boot(root);
  const created = await runCli(['collab', 'create', '--board-url', url, '--topic', '停止夹具',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5']);
  const sessionId = String(ok(created).session_id);
  const stopped = ok(await runCli(['collab', 'stop', '--board-url', url, '--session', sessionId]));
  assert.equal(stopped.status, 'cancelled');
  assert.equal(board.getSession(sessionId).status, 'cancelled');

  const again = await runCli(['collab', 'stop', '--board-url', url, '--session', sessionId]);
  assert.equal(again.exitCode, 2, again.stdout.slice(0, 200));
});

// ---- Codex 复核五缺口修复回归（2026-10-06） ----

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 一次性 mock 看板：handler 自定义响应（用于重定向/超时/非协议 200 用例）。 */
async function mockBoard(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<string> {
  const server: Server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  after(async () => new Promise<void>(resolve => server.close(() => resolve())));
  return url;
}

test('CLI collab 缺口1：--board-url 拒绝非回环与带凭据 URL，不发起请求', async () => {
  const external = await runCli(['collab', 'check', '--board-url', 'http://10.1.2.3:4790', '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(external.exitCode, 64, external.stdout.slice(0, 200));
  assert.match(String((JSON.parse(external.stdout) as Record<string, unknown>).error), /回环/);
  const userinfo = await runCli(['collab', 'check', '--board-url', 'http://user:pass@127.0.0.1:4790', '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(userinfo.exitCode, 64);
  assert.match(String((JSON.parse(userinfo.stdout) as Record<string, unknown>).error), /凭据/);
});

test('CLI collab 缺口1：重定向被拒绝（不跟随），exit 3', async () => {
  const url = await mockBoard((_req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end(); });
  const res = await runCli(['collab', 'check', '--board-url', url, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(res.exitCode, 3, res.stdout.slice(0, 200));
});

test('CLI collab 缺口5：请求截止时间生效（MUSH_COLLAB_TIMEOUT_MS）', async () => {
  const url = await mockBoard((_req, res) => { /* 挂起不响应 */ setTimeout(() => res.end(), 10_000); });
  const previous = process.env.MUSH_COLLAB_TIMEOUT_MS;
  process.env.MUSH_COLLAB_TIMEOUT_MS = '200';
  try {
    const res = await runCli(['collab', 'check', '--board-url', url, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
    assert.equal(res.exitCode, 3, res.stdout.slice(0, 200));
  } finally {
    if (previous === undefined) delete process.env.MUSH_COLLAB_TIMEOUT_MS;
    else process.env.MUSH_COLLAB_TIMEOUT_MS = previous;
  }
});

test('CLI collab 缺口3：两种写法的重复 --material 均聚合；重复标量旗标 exit 64', async () => {
  const root = fixtureRoot('dup-material');
  const { url, board } = await boot(root);
  const matA = path.join(root, 'a.txt'), matB = path.join(root, 'b.txt');
  writeFileSync(matA, '材料 A 正文', 'utf8');
  writeFileSync(matB, '材料 B 正文', 'utf8');
  const created = await runCli(['collab', 'create', '--board-url', url, '--topic', '重复材料夹具',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5',
    '--material=甲=' + matA, '--material', '乙=' + matB]);
  const sessionId = String(ok(created).session_id);
  const snapshot = board.getAuthorizationSnapshot(sessionId) as unknown as { materials: Array<{ name: string }> };
  assert.deepEqual(snapshot.materials.map(m => m.name).sort(), ['乙', '甲'], '两种写法的重复材料都必须提交');

  const dupScalar = await runCli(['collab', 'create', '--board-url', url, '--topic', 'x', '--topic', 'y',
    '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(dupScalar.exitCode, 64);
  assert.match(String((JSON.parse(dupScalar.stdout) as Record<string, unknown>).error), /duplicate/);
});

test('CLI collab 缺口2：--request JSON 文件入口（工作区透传 + 材料席位权限）；与逐项旗标互斥', async () => {
  const root = fixtureRoot('request-file');
  const { url, board } = await boot(root);
  const matA = path.join(root, 'ra.txt');
  writeFileSync(matA, '请求文件材料正文', 'utf8');
  const requestFile = path.join(root, 'request.json');
  writeFileSync(requestFile, JSON.stringify({
    topic: '请求文件夹具议题',
    participants: [
      { adapter_id: 'codex', model_id: 'gpt-5.5', effort: 'LOW' },
      { adapter_id: 'claude-code', model_id: 'claude-sonnet-5', effort: 'LOW' },
    ],
    materials: [{ name: '席位材料', path: matA, allowed_seats: ['A'] }],
    constraints: '请求文件约束',
  }), 'utf8');

  const created = await runCli(['collab', 'create', '--board-url', url, '--request', requestFile, '--workspace', root]);
  const sessionId = String(ok(created).session_id);
  const snapshot = board.getAuthorizationSnapshot(sessionId) as unknown as {
    workspace_root: string; constraints: string;
    materials: Array<{ name: string; allowed_seats: string[]; sha256: string }>;
  };
  assert.equal(snapshot.workspace_root, path.resolve(root), '--workspace 必须透传为 workspace_root');
  assert.equal(snapshot.constraints, '请求文件约束');
  assert.deepEqual(snapshot.materials[0]!.allowed_seats, ['A'], '材料席位权限必须保留');
  assert.match(snapshot.materials[0]!.sha256, /^[0-9a-f]{64}$/);

  // --workspace 传错 → 服务端 400 → exit 64（证明旗标确实到达 API）。
  const wrongWs = await runCli(['collab', 'create', '--board-url', url, '--request', requestFile, '--workspace', path.join(root, 'no-such-dir')]);
  assert.equal(wrongWs.exitCode, 64);
  assert.match(String((JSON.parse(wrongWs.stdout) as Record<string, unknown>).error), /工作区|not exist/);

  const conflict = await runCli(['collab', 'create', '--board-url', url, '--request', requestFile, '--topic', '另一议题']);
  assert.equal(conflict.exitCode, 64);
  assert.match(String((JSON.parse(conflict.stdout) as Record<string, unknown>).error), /互斥/);
});

test('CLI collab 缺口4：--out 已存在文件拒绝覆盖，原文件保留', async () => {
  const root = fixtureRoot('out-overwrite');
  const { url, board, pipeline } = await boot(root);
  const materialPath = path.join(root, 'material.txt');
  writeFileSync(materialPath, '冻结材料正文（夹具）', 'utf8');
  const created = await runCli(['collab', 'create', '--board-url', url, '--topic', '覆盖夹具',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5',
    '--material', `评审材料=${materialPath}`]);
  const sessionId = String(ok(created).session_id);
  board.authorizeSession(sessionId);
  const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
  board.recordSessionOutcome(sessionId, { status: 'completed', reason: outcome.reason, dispatch_ids: [...outcome.dispatch_ids] });

  const outPath = path.join(root, 'result.md');
  writeFileSync(outPath, '原始内容，不得覆盖', 'utf8');
  const refused = await runCli(['collab', 'result', '--board-url', url, '--session', sessionId, '--format', 'markdown', '--out', outPath]);
  assert.equal(refused.exitCode, 64, refused.stdout.slice(0, 200));
  assert.equal(readFileSync(outPath, 'utf8'), '原始内容，不得覆盖', '原文件必须保留');
});

test('CLI collab 缺口5：不可达 status exit 3；非协议 200 exit 1 不输出 undefined', async () => {
  const unreachable = await runCli(['collab', 'status', '--board-url', 'http://127.0.0.1:1']);
  assert.equal(unreachable.exitCode, 3, unreachable.stdout.slice(0, 200));

  const badJson = await mockBoard((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('<html>not json</html>'); });
  const listBad = await runCli(['collab', 'status', '--board-url', badJson]);
  assert.equal(listBad.exitCode, 1, listBad.stdout.slice(0, 200));

  const badResult = await mockBoard((_req, res) => {
    if (_req.url === '/api/session/token') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ caller_token: 't' })); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":false}');
  });
  const resultBad = await runCli(['collab', 'result', '--board-url', badResult, '--session', '00000000-0000-0000-0000-000000000000', '--format', 'json']);
  assert.equal(resultBad.exitCode, 1, resultBad.stdout.slice(0, 200));
  assert.match(resultBad.stdout, /不符合协议/);
  assert.equal(resultBad.stdout.includes('undefined'), false, '不得输出 undefined');
});

// ---- Codex 第二轮复核四边界修复回归（2026-10-06） ----

test('CLI collab 边界A：--out 并发竞态——恰一成功一拒绝，原文件不被破坏', async () => {
  const root = fixtureRoot('out-race');
  const { url, board, pipeline } = await boot(root);
  const materialPath = path.join(root, 'material.txt');
  writeFileSync(materialPath, '冻结材料正文（夹具）', 'utf8');
  const created = await runCli(['collab', 'create', '--board-url', url, '--topic', '竞态夹具',
    '--adapter-a', 'codex', '--model-a', 'gpt-5.5', '--adapter-b', 'claude-code', '--model-b', 'claude-sonnet-5',
    '--material', `评审材料=${materialPath}`]);
  const sessionId = String(ok(created).session_id);
  board.authorizeSession(sessionId);
  const coordinator = new CollaborationCoordinator(board, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
  board.recordSessionOutcome(sessionId, { status: 'completed', reason: outcome.reason, dispatch_ids: [...outcome.dispatch_ids] });

  const outPath = path.join(root, 'raced.md');
  // 两个并发写同一目标：都可能在对方写入前通过 existsSync——原子排他创建必须兜底。
  const [first, second] = await Promise.all([
    runCli(['collab', 'result', '--board-url', url, '--session', sessionId, '--format', 'markdown', '--out', outPath]),
    runCli(['collab', 'result', '--board-url', url, '--session', sessionId, '--format', 'markdown', '--out', outPath]),
  ]);
  const codes = [first.exitCode, second.exitCode].sort();
  assert.deepEqual(codes, [0, 64], `应恰一成功一拒绝：first=${first.stdout.slice(0, 160)} second=${second.stdout.slice(0, 160)}`);
  const content = readFileSync(outPath, 'utf8');
  assert.ok(content.startsWith('# 协作会话结果：竞态夹具'), '落盘内容必须是完整导出');
});

test('CLI collab 边界B：非协议 200 时 check/stop 一律 exit 1，stop 不声称已提交', async () => {
  const url = await mockBoard((_req, res) => {
    if (_req.url === '/api/session/token') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ caller_token: 't' })); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not json</html>');
  });
  const check = await runCli(['collab', 'check', '--board-url', url, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(check.exitCode, 1, check.stdout.slice(0, 200));
  assert.match(check.stdout, /不符合协议/);
  const stop = await runCli(['collab', 'stop', '--board-url', url, '--session', '00000000-0000-0000-0000-000000000000']);
  assert.equal(stop.exitCode, 1, stop.stdout.slice(0, 200));
  assert.equal(stop.stdout.includes('停止请求已提交'), false, '非协议响应不得声称请求已提交');
  // 200 JSON 但 ok=false / 缺接受证据 → 同样 exit 1。
  const badJson = await mockBoard((_req, res) => {
    if (_req.url === '/api/session/token') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ caller_token: 't' })); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, unexpected: true }));
  });
  const stop2 = await runCli(['collab', 'stop', '--board-url', badJson, '--session', '00000000-0000-0000-0000-000000000000']);
  assert.equal(stop2.exitCode, 1, stop2.stdout.slice(0, 200));
  const check2 = await runCli(['collab', 'check', '--board-url', badJson, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(check2.exitCode, 1, check2.stdout.slice(0, 200));
  assert.match(check2.stdout, /不符合协议/);
});

test('CLI collab 边界C：响应头到达后正文挂起 → 超时归 exit 3', async () => {
  const url = await mockBoard((_req, res) => {
    if (_req.url === '/api/session/token') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ caller_token: 't' })); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    // 只发响应头，正文挂起不结束。
  });
  const previous = process.env.MUSH_COLLAB_TIMEOUT_MS;
  process.env.MUSH_COLLAB_TIMEOUT_MS = '200';
  try {
    const res = await runCli(['collab', 'check', '--board-url', url, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
    assert.equal(res.exitCode, 3, res.stdout.slice(0, 200));
    assert.match(res.stdout, /看板请求失败|响应读取失败/);
  } finally {
    if (previous === undefined) delete process.env.MUSH_COLLAB_TIMEOUT_MS;
    else process.env.MUSH_COLLAB_TIMEOUT_MS = previous;
  }
});

test('CLI collab 边界D：IPv6 回环 [::1] 被接受', async () => {
  const server: Server = createServer((req, res) => {
    if (req.url === '/api/session/token') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ caller_token: 't' })); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ready: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '::1', resolve));
  const { port } = server.address() as AddressInfo;
  after(async () => new Promise<void>(resolve => server.close(() => resolve())));
  const res = await runCli(['collab', 'check', '--board-url', `http://[::1]:${port}`, '--adapter-a', 'codex', '--adapter-b', 'claude-code']);
  assert.equal(res.exitCode, 0, res.stdout.slice(0, 200));
  assert.equal((JSON.parse(res.stdout) as Record<string, unknown>).ready, true);
});
