import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';
import { buildAgyContract } from '../src/adapters/agy.ts';
import { DEFAULT_POLICY } from '../src/core/unattended-policy.ts';
import { prepareSchemaProbe, withAgyFinishCandidate } from '../src/web/collaboration-probes.ts';

const servers: BoardServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });
function root() { return mkdtempSync(path.resolve('.test-fixtures/g084-prepare-')); }
function optional(file: string) { return existsSync(file) ? readFileSync(file, 'utf8') : ''; }

test('preparation queues a frozen D30 request during halt without runner, liveness or ledger admission', async () => {
  const dir = root(), ledger = path.join(dir, 'ledger.jsonl');
  const breaker = new CircuitBreaker(path.join(dir, 'breaker.json'));
  breaker.trip('fixture historical halt');
  let runs = 0, checks = 0, admissions = 0;
  const alive = { adapter_id: 'agy', level_reached: 0 as const, ok: true, label: 'PROCESS_ONLY' as const, detail: 'fixture', checked_at_utc: new Date().toISOString() };
  const pipeline = new DispatchPipeline({
    workspaceRoot: dir, approvalRoot: path.join(dir, 'approvals'), ledgerPath: ledger,
    contracts: { agy: buildAgyContract() },
    unattended: { breaker, policy: { ...DEFAULT_POLICY } },
    runAdapter: async () => { runs++; throw new Error('must not run during preparation'); },
    liveness: { check: async () => { checks++; return alive; }, refresh: async () => alive, snapshot: () => [alive] },
    masterGate: { admit: () => { admissions++; throw new Error('must not admit during preparation'); } },
  });
  const record = await pipeline.dispatch(
    { adapter_id: 'agy', model_id: 'gemini-3.7-flash-high', prompt: 'schema probe', real: true, timeout_s: 180 },
    { prepareOnly: true, restrictTools: true, outputSchema: { type: 'object', required: ['body'] } },
  );
  assert.equal(record.status, 'BLOCKED_WAITING_OWNER');
  assert.equal(record.admission, null);
  assert.equal(record.request?.prepared_only, true);
  assert.equal(record.request?.restrictTools, true);
  assert.equal(record.request?.contract_fingerprint?.length, 64);
  assert.equal(runs, 0); assert.equal(checks, 0); assert.equal(admissions, 0);
  assert.equal(existsSync(ledger), false);
  assert.equal(breaker.halted, true, 'preparation never resets a real execution gate');
  const card = path.join(dir, 'goals/receipts/approval-requests', 'dispatch-' + record.dispatch_id + '.json');
  assert.equal(JSON.parse(readFileSync(card, 'utf8')).prepared_only, true);
  await assert.rejects(() => pipeline.rerun(record.dispatch_id, { real: false }), /prepared|approval|probe/i);
});

test('preparation rejects bypass contexts before doing any execution', async () => {
  const dir = root();
  let runs = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: dir, approvalRoot: path.join(dir, 'approvals'), ledgerPath: path.join(dir, 'ledger'),
    contracts: { agy: buildAgyContract() }, runAdapter: async () => { runs++; throw new Error('unexpected execution'); } });
  const request = { adapter_id: 'agy', prompt: 'fixture', real: true };
  await assert.rejects(() => pipeline.dispatch(request, { prepareOnly: true, originOwner: true }), /prepare|preparation/i);
  await assert.rejects(() => pipeline.dispatch({ ...request, real: false }, { prepareOnly: true }), /prepare|preparation/i);
  assert.equal(runs, 0);
});

async function boot(halted = true) {
  const dir = root(), runtime = path.join(dir, 'runtime'), approvals = path.join(dir, 'goals/receipts/approval-requests');
  mkdirSync(runtime, { recursive: true });
  if (halted) new CircuitBreaker(path.join(runtime, 'unattended-breaker.json')).trip('fixture historical halt');
  const calls: Array<{ adapter: string; tools: boolean; schema: unknown }> = [];
  const agyWorkspace = path.join(runtime, 'collaboration-admission', 'agy', 'workspace');
  const agyProject = path.join(runtime, 'agy-project.json');
  const agyAgent = path.join(agyWorkspace, '.agents', 'agents', 'mush-discussion.md');
  mkdirSync(path.dirname(agyAgent), { recursive: true });
  const agyProjectId = 'bb254da4-c36e-4f99-8801-599547824e0c';
  writeFileSync(agyProject, JSON.stringify({ id: agyProjectId, projectResources: { resources: [{ folderUri: 'file://' + agyWorkspace.replaceAll('\\', '/') }] },
    permissionGrants: { permissionGrants: { deny: ['read_file(*)', 'write_file(*)', 'command(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)', 'unsandboxed(*)'] } } }));
  writeFileSync(agyAgent, '---\nname: mush-discussion\ndescription: fixture only\ntools: []\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\nmcpServers: []\nskills: []\nplugins: []\n---\nFixture.');
  writeFileSync(path.join(path.dirname(agyAgent), 'mush-probe-open.md'),
    '---\nname: mush-probe-open\ndescription: fixture guard probe agent\ntools:\n  - view_file\n  - read_file\n  - write_to_file\n  - run_command\n  - invoke_subagent\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\nmcpServers: []\nskills: []\nplugins: []\n---\nFixture.');
  const agyGate = path.join(agyWorkspace, '.agents', 'deny-tools.mjs');
  copyFileSync(path.resolve('src/adapters/agy-discussion-gate.mjs'), agyGate);
  writeFileSync(path.join(agyWorkspace, '.agents', 'hooks.json'), JSON.stringify({ 'mush-controlled-discussion': {
    enabled: true, PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ' + agyGate.replaceAll('\\', '/'), timeout: 5 }] }] } }));
  const server = await startBoardServer({
    workspaceRoot: dir, runtimeRoot: runtime, approvalRoot: approvals, ledgerPath: path.join(runtime, 'budget-ledger.jsonl'),
    runId: 'g084-prepare', assignmentEpoch: 1, port: 0, enforceCallerToken: true,
    codexDiscussionInputs: async () => ({ nativeVersion: 'fixture-version', mcpNames: ['probe'],
      catalog: { models: [{ slug: 'gpt-5.5', apply_patch_tool_type: 'freeform' }] } }),
    codexDiscussionInspector: async () => ({ nativeVersion: 'fixture-version', mcps: [{ name: 'probe', enabled: false }] }),
    agyDiscussionInputs: () => ({ workspace: agyWorkspace, projectId: agyProjectId, projectFile: agyProject,
      agentFile: agyAgent, nativeVersion: 'fixture-version', modelId: 'gemini-3.7-flash-high' }),
    agyDiscussionInspector: async () => 'fixture-version',
    runAdapter: async (contract, _prompt, options) => {
      if (readFileSync(agyAgent, 'utf8').includes('tools: [finish]')) {
        assert.equal(contract.agy_discussion_profile?.agent_sha256, (await import('node:crypto')).createHash('sha256').update(readFileSync(agyAgent)).digest('hex'));
      }
      calls.push({ adapter: contract.adapter_id, tools: options?.restrictTools === true, schema: options?.outputSchemaJson ?? options?.outputSchemaPath });
      return { exitCode: 0, stdout: '{"body":"PROBE_SCHEMA_OK","stance":"support"}', stderr: '', timedOut: false, childKilled: false };
    },
  });
  servers.push(server);
  const base = 'http://127.0.0.1:' + server.port;
  const post = async (route: string, body: unknown, token = server.callerToken) => {
    const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as Record<string, any> };
  };
  return { dir, runtime, approvals, calls, server, base, post };
}

test('C6/A6 HTTP preparation is idempotent and freezes complete packets with zero model calls', async () => {
  const env = await boot();
  const ledger = path.join(env.runtime, 'budget-ledger.jsonl'), before = optional(ledger);
  for (const packet_id of ['C6', 'A6']) {
    const first = await env.post('/api/collaboration/probes/prepare', { packet_id });
    assert.equal(first.status, 201);
    assert.equal(first.body.status, 'BLOCKED_WAITING_OWNER');
    assert.equal(first.body.breaker_halted, true);
    assert.equal(first.body.execution_checks, 'NOT_RUN');
    const card = JSON.parse(readFileSync(path.join(env.approvals, first.body.request_file), 'utf8'));
    assert.equal(card.restrict_tools, true);
    assert.equal(card.timeout_s, 180);
    assert.equal(card.effort, packet_id === 'C6' ? 'LOW' : 'HIGH', 'agy high model requires matching effort');
    assert.equal(card.cap_usd, 0.10);
    assert.equal(card.model_id, packet_id === 'C6' ? 'gpt-5.5' : 'gemini-3.7-flash-high');
    assert.equal(card.output_schema.properties.body.enum[0], 'PROBE_SCHEMA_OK');
    assert.ok(card.workspace.startsWith(env.runtime + path.sep));
    const again = await env.post('/api/collaboration/probes/prepare', { packet_id });
    assert.equal(again.body.dispatch_id, first.body.dispatch_id, 'one pending card per unchanged packet');
  }
  assert.equal(env.calls.length, 0);
  assert.equal(optional(ledger), before);
  const snapshot = await (await fetch(env.base + '/api/snapshot')).json() as { workspace_root: string; approvals: Array<{ status: string }> };
  assert.equal(snapshot.workspace_root, env.dir, 'registering a synthetic directory never switches the owner workspace');
  assert.equal(snapshot.approvals.filter((a: any) => a.status === 'WAITING').length, 2);
});

test('A16 finish-only packet: prepare restores original bytes; approved replay runs exactly once then restores again', async () => {
  const env = await boot(false);
  const agent = path.join(env.runtime, 'collaboration-admission/agy/workspace/.agents/agents/mush-discussion.md');
  const original = readFileSync(agent);
  const prepared = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A16' });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
  assert.equal(env.calls.length, 0);
  assert.deepEqual(readFileSync(agent), original);
  const card = JSON.parse(readFileSync(path.join(env.approvals, prepared.body.request_file), 'utf8'));
  assert.equal(card.probe_id, 'A16'); assert.equal(card.timeout_s, 180);
  assert.match(card.prompt, /finish/); assert.equal(card.restrict_tools, true);
  const approved = await env.post('/api/approvals/respond', { request_file: prepared.body.request_file, decision: 'APPROVED' });
  assert.equal(approved.status, 201);
  for (let i = 0; i < 200; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (env.calls.length && readFileSync(agent).equals(original)) break;
  }
  assert.equal(env.calls.length, 1);
  assert.deepEqual(readFileSync(agent), original);
  assert.equal((await env.post('/api/approvals/respond', { request_file: prepared.body.request_file, decision: 'APPROVED' })).status, 409);
});

test('A16 candidate restores original assets and contract after preparation failure', async () => {
  const env = await boot(false);
  const workspace = path.join(env.runtime, 'collaboration-admission/agy/workspace');
  const agentFile = path.join(workspace, '.agents/agents/mush-discussion.md');
  const original = readFileSync(agentFile);
  const pipeline = new DispatchPipeline({ workspaceRoot: env.dir, approvalRoot: path.join(env.dir, 'a'), ledgerPath: path.join(env.dir, 'l'), contracts: { agy: buildAgyContract() } });
  const before = pipeline.getContractMap().agy;
  await assert.rejects(withAgyFinishCandidate(pipeline, env.runtime, async () => {
    assert.match(readFileSync(agentFile, 'utf8'), /tools: \[finish\]/);
    await assert.rejects(pipeline.dispatch({ adapter_id: 'agy', real: true, prompt: 'ordinary' }), /other dispatches are blocked/);
    throw new Error('synthetic preparation failure');
  }, () => ({ workspace, projectId: 'bb254da4-c36e-4f99-8801-599547824e0c', projectFile: path.join(env.runtime, 'agy-project.json'), agentFile,
    nativeVersion: 'fixture-version', modelId: 'gemini-3.7-flash-high' })), /synthetic preparation failure/);
  assert.deepEqual(readFileSync(agentFile), original);
  assert.equal(pipeline.getContractMap().agy, before);
});

test('halted approval is refused without an owner response; fixture owner reset then approval runs one frozen call', async () => {
  const env = await boot();
  const created = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A6' });
  assert.equal(created.status, 201);
  const declined = await env.post('/api/approvals/respond', { request_file: created.body.request_file, decision: 'APPROVED' });
  assert.equal(declined.status, 409);
  assert.match(String(declined.body.error), /breaker|熔断/);
  assert.equal(existsSync(path.join(env.approvals, created.body.request_file + '.owner-response.json')), false);
  assert.equal(env.calls.length, 0);
  // Only the isolated fixture's circuit breaker is reset here.
  assert.equal((await env.post('/api/unattended/breaker/reset', { by: 'fixture-owner' })).status, 200);
  assert.equal((await env.post('/api/approvals/respond', { request_file: created.body.request_file, decision: 'APPROVED' })).status, 201);
  for (let i = 0; i < 100 && env.calls.length === 0; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].tools, true);
  assert.ok(env.calls[0].schema, 'native schema transport survives approval');
  assert.equal((await env.post('/api/approvals/respond', { request_file: created.body.request_file, decision: 'APPROVED' })).status, 409);
});

test('probe preparation accepts only fixed packet IDs and is protected by caller authentication', async () => {
  const env = await boot();
  assert.equal((await env.post('/api/collaboration/probes/prepare', { packet_id: 'C5' })).status, 400);
  assert.equal((await env.post('/api/collaboration/probes/prepare', { packet_id: 'C6', originOwner: true })).status, 400);
  assert.equal((await env.post('/api/collaboration/probes/prepare', { packet_id: 'C6' }, 'bad-token')).status, 401);
  assert.equal(env.calls.length, 0);
});

test('approved schema probe never silently fails over to another harness', async () => {
  const dir = root(); let runs = 0;
  const alive = ['claude-code', 'agy'].map(adapter_id => ({ adapter_id, level_reached: 0 as const, ok: true, label: 'PROCESS_ONLY' as const, detail: 'fixture', checked_at_utc: new Date().toISOString() }));
  const pipeline = new DispatchPipeline({
    workspaceRoot: dir, approvalRoot: path.join(dir, 'approvals'), ledgerPath: path.join(dir, 'ledger'),
    contracts: { 'claude-code': { ...buildAgyContract(), adapter_id: 'claude-code' }, agy: buildAgyContract() },
    liveness: { check: async id => alive.find(r => r.adapter_id === id)!, refresh: async id => alive.find(r => r.adapter_id === id)!, snapshot: () => alive },
    runAdapter: async () => { runs++; return { exitCode: 3, stdout: '', stderr: 'synthetic failure', timedOut: false, childKilled: false }; },
  });
  const prepared = await pipeline.dispatch(
    { adapter_id: 'agy', model_id: 'gemini-3.7-flash-high', prompt: 'A6', real: true },
    { prepareOnly: true, probeId: 'A6', restrictTools: true, outputSchema: { type: 'object' } },
  );
  pipeline.grantApprovalToken(prepared.dispatch_id);
  const result = await pipeline.rerun(prepared.dispatch_id, { real: true, approved_via: prepared.dispatch_id });
  assert.equal(result.status, 'FAIL');
  assert.equal(runs, 1, 'one approval covers one harness attempt, no fallback');
  // Positive control: this fixture genuinely has an eligible fallback.
  const ordinary = await pipeline.dispatch({ adapter_id: 'agy', model_id: 'gemini-3.7-flash-high', prompt: 'ordinary fixture', real: true });
  pipeline.grantApprovalToken(ordinary.dispatch_id);
  const beforeOrdinary = runs;
  await pipeline.rerun(ordinary.dispatch_id, { real: true, approved_via: ordinary.dispatch_id });
  assert.equal(runs - beforeOrdinary, 2, 'ordinary fixture demonstrates the alternate runner is reachable');
});


test('C3/A3 freeze synthetic read probes without leaking canaries or launching a model', async () => {
  const env = await boot();
  for (const packet_id of ['C3', 'A3']) {
    const first = await env.post('/api/collaboration/probes/prepare', { packet_id });
    assert.equal(first.status, 201);
    const card = JSON.parse(readFileSync(path.join(env.approvals, first.body.request_file), 'utf8'));
    assert.equal(card.timeout_s, 120);
    assert.equal(card.effort, packet_id === 'C3' ? 'LOW' : 'HIGH');
    assert.equal(card.restrict_tools, true);
    const inner = path.join(card.workspace, 'probe-inner.txt');
    const outer = path.join(env.runtime, 'collab-probes', packet_id, 'assets', 'probe-outside.txt');
    const innerText = readFileSync(inner, 'utf8').trim(), outerText = readFileSync(outer, 'utf8').trim();
    assert.notEqual(innerText, outerText);
    assert.match(innerText, /^MUSH_READ_PROBE_[a-f0-9]{64}$/);
    assert.match(outerText, /^MUSH_READ_PROBE_[a-f0-9]{64}$/);
    assert.ok(card.prompt.includes(inner) && card.prompt.includes(outer));
    assert.ok(!card.prompt.includes(innerText) && !card.prompt.includes(outerText), 'only a true read can reveal canaries');
    assert.deepEqual(card.output_schema.required, ['inner', 'outside']);
    const again = await env.post('/api/collaboration/probes/prepare', { packet_id });
    assert.equal(again.body.dispatch_id, first.body.dispatch_id);
    assert.equal(readFileSync(inner, 'utf8').trim(), innerText);
  }
  assert.equal(env.calls.length, 0);
});


test('read probe preparation refuses unknown pre-existing assets without overwriting them', async () => {
  const env = await boot();
  const assetDir = path.join(env.runtime, 'collab-probes', 'C3', 'assets');
  mkdirSync(assetDir, { recursive: true });
  const file = path.join(assetDir, 'probe-outside.txt');
  writeFileSync(file, 'owner existing content');
  const response = await env.post('/api/collaboration/probes/prepare', { packet_id: 'C3' });
  assert.equal(response.status, 400);
  assert.match(String(response.body.error), /unknown probe asset/);
  assert.equal(readFileSync(file, 'utf8'), 'owner existing content');
  assert.equal(env.calls.length, 0);
});


test('fixed probe approval never inherits another room native conversation or output', async () => {
  const dir = root(); const calls: Array<{ prompt: string; args: readonly string[] }> = [];
  const pipeline = new DispatchPipeline({ workspaceRoot: dir, approvalRoot: path.join(dir, 'approvals'), ledgerPath: path.join(dir, 'ledger'),
    contracts: { agy: buildAgyContract() }, runAdapter: async (c, prompt) => {
      calls.push({ prompt, args: [...c.arguments] }); return { exitCode: 0, stdout: 'FOREIGN_ROOM_OUTPUT', stderr: '',
        timedOut: false, childKilled: false, sessionId: 'foreign-conversation' };
    } });
  await pipeline.dispatch({ adapter_id: 'agy', model_id: 'gemini-3.7-flash-high', effort: 'HIGH', goal_id: 'GOAL-084',
    prompt: 'ordinary conversation', real: true }, { originOwner: true });
  const prepared = await prepareSchemaProbe(pipeline, path.join(dir, 'runtime'), 'A6');
  pipeline.grantApprovalToken(prepared.record.dispatch_id);
  const result = await pipeline.rerun(prepared.record.dispatch_id, { real: true, approved_via: prepared.record.dispatch_id });
  assert.equal(result.status, 'PASS');
  assert.equal(calls[1].prompt, prepared.record.request?.prompt);
  assert.ok(!calls[1].args.includes('foreign-conversation'));
  assert.equal(result.request?.resume_session, undefined);
  assert.ok(!calls[1].prompt.includes('FOREIGN_ROOM_OUTPUT'));
});

test('C7 host-generated profile freezes exact native configuration and remains D30-gated', async () => {
  const env = await boot(false);
  const prepared = await env.post('/api/collaboration/probes/prepare', { packet_id: 'C7' });
  assert.equal(prepared.status, 201);
  assert.equal(env.calls.length, 0);
  const card = JSON.parse(readFileSync(path.join(env.approvals, prepared.body.request_file), 'utf8'));
  for (const setting of ['features.shell_tool=false', 'features.view_image=false', 'features.goals=false', 'features.tool_suggest=false', 'mcp_servers.probe.enabled=false']) assert.ok(card.tool_restriction_args.includes(setting));
  assert.equal(card.model_id, 'gpt-5.5');
  assert.ok(card.tool_restriction_args.some((arg: string) => arg.startsWith('model_catalog_json=')));
  const again = await env.post('/api/collaboration/probes/prepare', { packet_id: 'C7' });
  assert.equal(again.body.dispatch_id, prepared.body.dispatch_id);
  const approved = await env.post('/api/approvals/respond', { request_file: prepared.body.request_file, decision: 'APPROVED' });
  assert.equal(approved.status, 201);
  for (let i = 0; i < 100 && env.calls.length === 0; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].adapter, 'codex');
  assert.equal(env.calls[0].tools, true);
});

test('A9 freezes the project-local native agent, stream events and exact asset binding before browser approval', async () => {
  const env = await boot(false);
  const prepared = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A9' });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.body)); assert.equal(env.calls.length, 0);
  const card = JSON.parse(readFileSync(path.join(env.approvals, prepared.body.request_file), 'utf8'));
  assert.equal(card.model_id, 'gemini-3.7-flash-high'); assert.equal(card.effort, 'HIGH');
  assert.ok(card.tool_restriction_args.includes('--project')); assert.ok(card.tool_restriction_args.includes('mush-discussion'));
  assert.match(card.workspace, /collaboration-admission/); assert.ok(!card.tool_restriction_args.includes('--dangerously-skip-permissions'));
  const again = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A9' });
  assert.equal(again.body.dispatch_id, prepared.body.dispatch_id);
  const approved = await env.post('/api/approvals/respond', { request_file: prepared.body.request_file, decision: 'APPROVED' });
  assert.equal(approved.status, 201);
  for (let i = 0; i < 100 && env.calls.length === 0; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(env.calls.length, 1); assert.equal(env.calls[0].adapter, 'agy');
});

test('A10 freezes closed-profile induced-attempt probe under the seat fingerprint; A11-A14 freeze guard-probe contract with distinct fingerprint', async () => {
  const env = await boot(false);
  const a10 = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A10' });
  assert.equal(a10.status, 201, JSON.stringify(a10.body));
  assert.equal(env.calls.length, 0);
  const a10Card = JSON.parse(readFileSync(path.join(env.approvals, a10.body.request_file), 'utf8'));
  assert.equal(a10Card.model_id, 'gemini-3.7-flash-high');
  assert.equal(a10Card.effort, 'HIGH');
  assert.ok(a10Card.tool_restriction_args.includes('mush-discussion'), 'A10 runs under the discussion profile');
  assert.ok(a10Card.prompt.includes('无论该工具是否出现在你的可用工具列表中'));
  assert.ok(a10Card.prompt.includes('Subagents=[]'));
  const again = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A10' });
  assert.equal(again.body.dispatch_id, a10.body.dispatch_id, 'A10 pending reuse');
  for (const packet_id of ['A11', 'A12', 'A13', 'A14']) {
    const prepared = await env.post('/api/collaboration/probes/prepare', { packet_id });
    assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
    const card = JSON.parse(readFileSync(path.join(env.approvals, prepared.body.request_file), 'utf8'));
    assert.equal(card.model_id, 'gemini-3.7-flash-high');
    assert.ok(card.tool_restriction_args.includes('mush-probe-open'), 'guard probes bind the tools-open agent');
    assert.ok(card.tool_restriction_args.includes('--project'));
    assert.ok(!card.tool_restriction_args.includes('mush-discussion'), 'guard probes never use the discussion agent');
    assert.ok(card.prompt.includes('权限门集成探针'));
    assert.ok(card.prompt.includes('probe-write-' + packet_id.toLowerCase()));
    const reused = await env.post('/api/collaboration/probes/prepare', { packet_id });
    assert.equal(reused.body.dispatch_id, prepared.body.dispatch_id);
  }
  // 换装守卫探针合同后，A9 的席位指纹与守卫探针指纹不同（证据只覆盖守卫层）。
  const a9 = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A9' });
  const a9Card = JSON.parse(readFileSync(path.join(env.approvals, a9.body.request_file), 'utf8'));
  const a11Card = JSON.parse(readFileSync(path.join(env.approvals, 'dispatch-' +
    (await env.post('/api/collaboration/probes/prepare', { packet_id: 'A11' })).body.dispatch_id + '.json'), 'utf8'));
  assert.notEqual(a9Card.contract_fingerprint, a11Card.contract_fingerprint, 'guard-probe contract is a distinct configuration');
  assert.equal(env.calls.length, 0);
});

test('guard probe preparation refuses missing mush-probe-open asset', async () => {
  const env = await boot(false);
  const agent = path.join(env.runtime, 'collaboration-admission', 'agy', 'workspace', '.agents', 'agents', 'mush-probe-open.md');
  const original = readFileSync(agent, 'utf8');
  writeFileSync(agent + '.bak', original);
  const removed = rmSync(agent);
  void removed;
  try {
    const response = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A11' });
    assert.equal(response.status, 400);
    assert.match(String(response.body.error), /mush-probe-open/);
  } finally {
    writeFileSync(agent, original);
    rmSync(agent + '.bak');
  }
  assert.equal(env.calls.length, 0);
});

test('profile activation after restart restores verified discussion configs without dispatch, cards or breaker changes', async () => {
  const env = await boot(false);
  // 用一次准备拿到"激活时期"的指纹参照（同一 fixture 原生输入 → 同一指纹）。
  const reference = await env.post('/api/collaboration/probes/prepare', { packet_id: 'C7' });
  assert.equal(reference.status, 201);
  const referenceCard = JSON.parse(readFileSync(path.join(env.approvals, reference.body.request_file), 'utf8'));
  const agyReference = await env.post('/api/collaboration/probes/prepare', { packet_id: 'A9' });
  const agyCard = JSON.parse(readFileSync(path.join(env.approvals, agyReference.body.request_file), 'utf8'));
  assert.equal(env.calls.length, 0);
  const ledger = path.join(env.runtime, 'budget-ledger.jsonl');
  const beforeLedger = optional(ledger);
  const before = await (await fetch(env.base + '/api/snapshot')).json() as { approvals: Array<{ status: string }> };
  const waitingBefore = before.approvals.filter((a: any) => a.status === 'WAITING').length;
  // 激活：重启形态——仅调用激活入口，不得创建新卡/派发/占额。
  const activated = await env.post('/api/collaboration/profiles/activate', {});
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(activated.body.codex_fingerprint, referenceCard.contract_fingerprint, 'codex rebuild from identical native observations reproduces the fingerprint');
  assert.equal(activated.body.agy_fingerprint, agyCard.contract_fingerprint);
  assert.equal(env.calls.length, 0, 'activation never executes');
  assert.equal(optional(ledger), beforeLedger, 'activation never occupies budget');
  const snapshot = await (await fetch(env.base + '/api/snapshot')).json() as { approvals: Array<{ status: string }> };
  assert.equal(snapshot.approvals.filter((a: any) => a.status === 'WAITING').length, waitingBefore, 'activation creates no approval card');
  // 激活后同一会话指纹比对可通过（readiness 的前置：collaborationContract 返回档案合同）。
  const again = await env.post('/api/collaboration/profiles/activate', {});
  assert.equal(again.status, 200);
  assert.equal(again.body.codex_fingerprint, activated.body.codex_fingerprint, 'activation is deterministic under unchanged inputs');
});

test('activation rejects parameter injection and drifts fail closed', async () => {
  const env = await boot(false);
  const injected = await env.post('/api/collaboration/profiles/activate', { tool_restriction_args: ['--dangerously-skip-permissions'] });
  assert.equal(injected.status, 400, 'HTTP caller cannot widen the discussion configuration');
  assert.equal(env.calls.length, 0);
  // 资产漂移：门脚本被篡改 → 重建必须失败（哈希不匹配），普通合同保持不变。
  const gate = path.join(env.runtime, 'collaboration-admission', 'agy', 'workspace', '.agents', 'deny-tools.mjs');
  const original = readFileSync(gate, 'utf8');
  writeFileSync(gate, original.replace('decision = \'allow\'', 'decision = \'allow\' /* tampered */'));
  try {
    const drifted = await env.post('/api/collaboration/profiles/activate', {});
    assert.equal(drifted.status, 500, 'tampered gate asset must fail the rebuild');
  } finally {
    writeFileSync(gate, original);
  }
});
