/** GOAL-084 §3.4：固定阶段协调器——恰好 7 次调用、共享 1 次重试、模板哈希每轮
 * 检查、重启不重派、按席位材料计划拒绝反馈、修订齐备才完成。真实管线 +
 * 阶段感知 fixture（零模型调用），脚本化 dispatch 覆盖边界组。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, type CollabMaterialInput, type CollabParticipantInput } from '../src/orchestration/collaboration-blackboard.ts';
import { CollaborationCoordinator, extractJsonObject, type CollaborationDispatchFn, type CollaborationDispatchResultLike } from '../src/orchestration/collaboration-coordinator.ts';
import { validateCollabJson, COLLAB_SKILL_SCHEMAS } from '../src/orchestration/collaboration-skills.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g084-coord-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function participants(): CollabParticipantInput[] {
  return [
    { seat: 'A', adapter_id: 'fixture-a', is_coordinator: true },
    { seat: 'B', adapter_id: 'fixture-b' },
  ];
}

function materials(): CollabMaterialInput[] {
  return [
    { material_id: 'm1', name: '材料一', source: 'owner', content: '材料一内容', allowed_seats: ['A'] },
    { material_id: 'm2', name: '材料二', source: 'owner', content: '材料二内容', allowed_seats: ['B'] },
  ];
}

/** 阶段感知 fixture：从 prompt 解析阶段/席位/回应对象标记，按场景文件输出。 */
function phaseAwareFixture(root: string): { script: string; scenarioFile: string; counterFile: string } {
  const script = path.join(root, 'phase-aware.mjs');
  const scenarioFile = path.join(root, 'scenario.txt');
  const counterFile = path.join(root, 'counts.json');
  writeFileSync(script, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    'const prompt = args[args.length - 1];',
    'const marker = (re) => { const m = prompt.match(re); return m ? m[1] : ""; };',
    'const phase = marker(/【阶段】(\\w+)/);',
    'const seat = marker(/【席位】(\\w+)/);',
    'const respondTo = marker(/【回应对象】(vp_[0-9a-f-]+)/);',
    'const scenario = readFileSync(args[0], "utf8").trim();',
    'const counterFile = args[1];',
    'let counts = {}; try { counts = JSON.parse(readFileSync(counterFile, "utf8")); } catch {}',
    'const key = phase + "-" + seat;',
    'counts[key] = (counts[key] ?? 0) + 1;',
    'writeFileSync(counterFile, JSON.stringify(counts));',
    'const n = counts[key];',
    'const base = {',
    '  coordination: { a_focus: "A focus", b_focus: "B focus", material_plan: { A: ["m1"], B: ["m2"] }, notes: "plan" },',
    '  proposal: { body: "proposal-" + seat, stance: "support", evidence: seat === "A" ? ["m1"] : ["m2"], reserved_disagreements: "" },',
    '  review: { body: "review-" + seat, stance: "qualified", responds_to: respondTo, evidence: [], flaws: ["gap"], suggestions: ["add boundary"], reserved_disagreements: "" },',
    '  revision: { body: "revision-" + seat, stance: "revised", changes: ["adopt boundary"], reserved_disagreements: "keep X" },',
    '};',
    'let out = base[phase] ?? {};',
    'if (phase === "proposal" && seat === "A") {',
    '  if (scenario === "runner-fail") { console.log(JSON.stringify(base.proposal)); process.exit(3); }',
    '  if (scenario === "retry-exhausted") out = { wrong: true };',
    '  else if (scenario === "retry-then-valid" && n === 1) out = { wrong: true };',
    '}',
    'if (phase === "coordination" && scenario === "hang") { const t = Date.now(); while (Date.now() - t < 1500) {} }',
    'if (scenario === "agy-finish-required" && seat === "B") {',
    '  const finishRequested = prompt.includes("【agy结束协议】") && prompt.includes("finish");',
    '  const response = finishRequested ? JSON.stringify(out) : JSON.stringify(out) + "\\n" + JSON.stringify({ ...out, body: "native continuation instead of finishing" });',
    '  console.log(JSON.stringify({ event: "result", result: { status: "SUCCESS", response } }));',
    '} else { console.log(JSON.stringify(out)); }',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(scenarioFile, 'happy');
  return { script, scenarioFile, counterFile };
}

function fixtureContract(adapterId: string, root: string, paths: { script: string; scenarioFile: string; counterFile: string }): AdapterContract {
  return validateAdapterContract({
    adapter_id: adapterId,
    executable: process.execPath,
    arguments: [paths.script, paths.scenarioFile, paths.counterFile],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: `${adapterId}-model`,
    tool_restriction_args: ['--restricted'],
  });
}

function makeSession(root: string, bb: CollaborationBlackboard, snapshotOverrides: Record<string, unknown> = {}): string {
  const { session_id } = bb.createSession({
    topic: '协调器测试议题',
    workspace_root: root,
    participants: participants(),
    materials: materials(),
    ...snapshotOverrides,
  });
  bb.authorizeSession(session_id);
  return session_id;
}

test('固定阶段协调器：恰好 7 次调用、材料按席位引用、双方修订齐备才完成', async () => {
  const root = fixtureRoot('happy');
  const paths = phaseAwareFixture(root);
  const bb = CollaborationBlackboard.open(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb,
    contracts: {
      'fixture-a': fixtureContract('fixture-a', root, paths),
      'fixture-b': fixtureContract('fixture-b', root, paths),
    },
  });
  const sessionId = makeSession(root, bb);
  const coordinator = new CollaborationCoordinator(bb, (req, internal) => pipeline.dispatch(req, internal));

  const outcome = await coordinator.run(sessionId);
  assert.deepEqual(outcome, { status: 'completed', dispatch_ids: outcome.dispatch_ids });
  assert.equal(outcome.dispatch_ids.length, 7, '正常路径恰好 7 次调用');

  const session = bb.getSession(sessionId);
  assert.equal(session.status, 'completed');
  assert.equal(session.call_count, 7, '复用会话额度机制，无另建计数器');
  assert.equal(session.retry_count, 0);

  const log = bb.getExecutionLog(sessionId);
  assert.equal(log.length, 7);
  assert.ok(log.every((r) => r.status === 'pass'));

  const a = bb.getVisibleContext(sessionId, 'A');
  const b = bb.getVisibleContext(sessionId, 'B');
  assert.deepEqual(a.own.map((v) => v.kind), ['assignment', 'proposal', 'review', 'revision']);
  assert.deepEqual(b.own.map((v) => v.kind), ['proposal', 'review', 'revision']);
  // 材料引用语义核验已生效：A 的提案 evidence 只含 m1。
  const proposalA = a.own.find((v) => v.kind === 'proposal')!;
  assert.deepEqual(proposalA.evidence.map((e) => e.material_id), ['m1']);
});

test('agy 结束协议：真实管线逐轮说明已有 finish 提交，聚合终局不通过，其他通道不注入', async () => {
  const root = fixtureRoot('agy-finish');
  const paths = phaseAwareFixture(root);
  writeFileSync(paths.scenarioFile, 'agy-finish-required');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb, { participants: [
    { seat: 'A', adapter_id: 'fixture-a', is_coordinator: true },
    { seat: 'B', adapter_id: 'agy' },
  ] });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'), collabBlackboard: bb,
    contracts: { 'fixture-a': fixtureContract('fixture-a', root, paths), agy: fixtureContract('agy', root, paths) },
  });
  const coordinator = new CollaborationCoordinator(bb, (request, internal) => pipeline.dispatch(request, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed', outcome.reason);
  assert.equal(bb.getSession(sessionId).call_count, 7);
  assert.equal(bb.getSession(sessionId).retry_count, 0);
  const records = outcome.dispatch_ids.map(id => pipeline.get(id)!);
  assert.equal(records.filter(record => record.adapter_id === 'agy').length, 3);
  for (const record of records) {
    const prompt = record.request!.prompt;
    assert.equal(prompt.includes('【agy结束协议】'), record.adapter_id === 'agy');
    if (record.adapter_id === 'agy') {
      assert.match(prompt, /只通过原生 finish 工具/);
      assert.match(prompt, /不得先输出/);
      assert.match(prompt, /其它工具仍全部禁止/);
    }
  }
  assert.deepEqual(bb.getVisibleContext(sessionId, 'B').own.map(v => v.kind), ['proposal', 'review', 'revision']);
  const earlier = { body: 'EARLIER' };
  const aggregate = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: JSON.stringify(earlier) + '\n' + JSON.stringify({ body: 'OTHER' }) } });
  assert.equal(extractJsonObject({ status: 'PASS', structured_output: earlier }, aggregate), undefined, '结束提示不得放宽 D92 或用缓存草稿绕过聚合终局');
  bb.close();
});

test('共享重试：首次格式无效消耗一次全场重试（共 8 次），重试成功后完成', async () => {
  const root = fixtureRoot('retry');
  const paths = phaseAwareFixture(root);
  writeFileSync(paths.scenarioFile, 'retry-then-valid');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb,
    contracts: {
      'fixture-a': fixtureContract('fixture-a', root, paths),
      'fixture-b': fixtureContract('fixture-b', root, paths),
    },
  });
  const sessionId = makeSession(root, bb);
  const coordinator = new CollaborationCoordinator(bb, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed');
  const session = bb.getSession(sessionId);
  assert.equal(session.call_count, 8, '7 正常 + 1 共享重试');
  assert.equal(session.retry_count, 1);
  const log = bb.getExecutionLog(sessionId);
  // execution_log 记录 runner 级结果：无效输出的那次运行 runner 本身成功，
  // 如实留 pass；无效输出的证据在派发记录（stdout_tail/回执）中。
  assert.equal(log.filter((r) => r.status === 'pass').length, 8);
  assert.equal(log.filter((r) => r.status === 'fail').length, 0);
});

test('重试耗尽：连续无效输出 → 会话转 failed，不再派发', async () => {
  const root = fixtureRoot('retry-exhausted');
  const paths = phaseAwareFixture(root);
  writeFileSync(paths.scenarioFile, 'retry-exhausted');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb,
    contracts: {
      'fixture-a': fixtureContract('fixture-a', root, paths),
      'fixture-b': fixtureContract('fixture-b', root, paths),
    },
  });
  const sessionId = makeSession(root, bb);
  const coordinator = new CollaborationCoordinator(bb, (req, internal) => pipeline.dispatch(req, internal));
  const outcome = await coordinator.run(sessionId);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.reason ?? '', /proposal 席位 A 输出无效且共享重试已用尽/);
  const session = bb.getSession(sessionId);
  assert.equal(session.status, 'failed');
  assert.equal(session.call_count, 3, '协调 1 + 提案 A 正常 1 + 重试 1，之后停止');
});

function scriptedCoordinator(bb: CollaborationBlackboard, responses: Array<(prompt: string) => CollaborationDispatchResultLike>): { coordinator: CollaborationCoordinator; prompts: string[]; calls: () => number } {
  const prompts: string[] = [];
  let i = 0;
  const dispatch: CollaborationDispatchFn = async (req, internal) => {
    void internal;
    prompts.push(req.prompt);
    const handler = responses[i];
    i += 1;
    if (handler === undefined) throw new Error(`unexpected extra dispatch #${i}`);
    return handler(req.prompt);
  };
  return { coordinator: new CollaborationCoordinator(bb, dispatch), prompts, calls: () => i };
}

function resultOf(json: unknown, status = 'PASS'): CollaborationDispatchResultLike {
  return { status, stdout_tail: { text: JSON.stringify(json), truncated: false } };
}

test('模板哈希每轮检查：快照哈希与当前注册表不一致 → 启动即失败、零派发', async () => {
  const root = fixtureRoot('hash-drift');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb, { skill_registry_sha256: 'stale-registry-hash' });
  const scripted = scriptedCoordinator(bb, []);
  const outcome = await scripted.coordinator.run(sessionId);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.reason ?? '', /skill 模板注册表与批准快照不一致/);
  assert.equal(scripted.calls(), 0, '哈希不一致时一次派发都不发生');
  assert.equal(bb.getSession(sessionId).status, 'failed');
});

test('重启不重派：未确认结束的调用标记 interrupted，协调器拒绝继续', async () => {
  const root = fixtureRoot('restart');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  // 模拟重启前的在途调用：已占额、未结算。
  bb.occupyCall(sessionId, 'normal', 'A');
  const scripted = scriptedCoordinator(bb, []);
  const outcome = await scripted.coordinator.run(sessionId);
  assert.equal(outcome.status, 'interrupted');
  assert.match(outcome.reason ?? '', /不自动重派/);
  const log = bb.getExecutionLog(sessionId);
  assert.equal(log.length, 1);
  assert.equal(log[0].status, 'interrupted', '未确认调用被标记中断');
  assert.equal(scripted.calls(), 0, '不自动重派');
  assert.equal(bb.getSession(sessionId).status, 'interrupted');
});

test('材料计划拒绝并反馈：引用不存在材料 → 重试提示携带拒绝原因（不静默剔除）', async () => {
  const root = fixtureRoot('plan-feedback');
  const bb = CollaborationBlackboard.open(root);
  const responses: Array<(prompt: string) => CollaborationDispatchResultLike> = [
    // 第一次分配建议引用了不存在的材料 mX。
    () => resultOf({ a_focus: 'A', b_focus: 'B', material_plan: { A: ['mX'], B: ['m2'] }, notes: '' }),
    // 反馈后给出合法版本。
    () => resultOf({ a_focus: 'A', b_focus: 'B', material_plan: { A: ['m1'], B: ['m2'] }, notes: '' }),
    () => resultOf({ body: 'p-A', stance: 's', evidence: ['m1'], reserved_disagreements: '' }),
    () => resultOf({ body: 'p-B', stance: 's', evidence: ['m2'], reserved_disagreements: '' }),
    (prompt) => resultOf({ body: 'r-A', stance: 's', responds_to: prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)![1], evidence: [], flaws: [], suggestions: [], reserved_disagreements: '' }),
    (prompt) => resultOf({ body: 'r-B', stance: 's', responds_to: prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)![1], evidence: [], flaws: [], suggestions: [], reserved_disagreements: '' }),
    () => resultOf({ body: 'v-A', stance: 's', changes: [], reserved_disagreements: '' }),
    () => resultOf({ body: 'v-B', stance: 's', changes: [], reserved_disagreements: '' }),
  ];
  const scripted = scriptedCoordinator(bb, responses);
  const sessionId = makeSession(root, bb);
  const outcome = await scripted.coordinator.run(sessionId);
  assert.equal(outcome.status, 'completed');
  const feedbackPrompt = scripted.prompts.find((p) => p.includes('【上次输出被拒绝】'));
  assert.ok(feedbackPrompt !== undefined, '重试轮必须携带拒绝反馈');
  assert.match(feedbackPrompt, /引用了不存在的材料 mX/);
  // 校验器直接锁定：非法材料计划与合法计划。
  assert.match(
    validateCollabJson({ a_focus: 'A', b_focus: 'B', material_plan: { A: 'm1', B: [] }, notes: '' }, COLLAB_SKILL_SCHEMAS.coordination) ?? 'null',
    /material_plan\.A 必须是数组/,
  );
});

// ---- 2026-10-01 Codex 复核轮五（owner 转呈）：材料/模型/输出边界/异常收口/并发启动 ----

function phaseJson(prompt: string): Record<string, unknown> {
  const phase = (prompt.match(/【阶段】(\w+)/) ?? [])[1] ?? '';
  const seat = (prompt.match(/【席位】(\w+)/) ?? [])[1] ?? '';
  const respondTo = (prompt.match(/【回应对象】(vp_[0-9a-f-]+)/) ?? [])[1] ?? '';
  const base: Record<string, Record<string, unknown>> = {
    coordination: { a_focus: 'A focus', b_focus: 'B focus', material_plan: { A: ['m1'], B: ['m2'] }, notes: '' },
    proposal: { body: `proposal-${seat}`, stance: 'support', evidence: seat === 'A' ? ['m1'] : ['m2'], reserved_disagreements: '' },
    review: { body: `review-${seat}`, stance: 'qualified', responds_to: respondTo, evidence: [], flaws: ['gap'], suggestions: ['fix'], reserved_disagreements: '' },
    revision: { body: `revision-${seat}`, stance: 'revised', changes: ['adopt'], reserved_disagreements: 'keep' },
  };
  return base[phase] ?? {};
}

test('材料正文入提示词：提案/评审提示包含获准冻结正文，清单与实际发送对应', async () => {
  const root = fixtureRoot('material-content');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  const prompts: string[] = [];
  const dispatch: CollaborationDispatchFn = async (req) => {
    prompts.push(req.prompt);
    return resultOf(phaseJson(req.prompt));
  };
  const outcome = await new CollaborationCoordinator(bb, dispatch).run(sessionId);
  assert.equal(outcome.status, 'completed');
  const proposalA = prompts.find((p) => p.includes('【阶段】proposal') && p.includes('【席位】A'))!;
  assert.match(proposalA, /材料一内容/, '材料正文必须出现在提案提示中（不只是 ID 和名称）');
  const reviewA = prompts.find((p) => p.includes('【阶段】review') && p.includes('【席位】A'))!;
  assert.match(reviewA, /材料一内容/);
  // A 的提示不得出现 B 专属材料正文。
  assert.doesNotMatch(proposalA, /材料二内容/);
});

test('批准模型与阶段 Schema 随轮传递；长输出从完整通道读取而非截断 tail', async () => {
  const root = fixtureRoot('model-schema-long');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb, {
    participants: [
      { seat: 'A', adapter_id: 'fixture-a', model_id: 'fm2', is_coordinator: true },
      { seat: 'B', adapter_id: 'fixture-b', model_id: 'fm2' },
    ],
  });
  const captured: Array<{ modelId?: string; schema: unknown; tailTruncated: boolean }> = [];
  const longNotes = 'N'.repeat(4000);
  let callIndex = 0;
  const dispatch: CollaborationDispatchFn = async (req, internal) => {
    callIndex += 1;
    const phase = (req.prompt.match(/【阶段】(\w+)/) ?? [])[1] ?? '';
    captured.push({ modelId: req.model_id, schema: internal.outputSchema, tailTruncated: false });
    const json = phaseJson(req.prompt);
    if (phase === 'coordination') (json as { notes: string }).notes = longNotes;
    const full = JSON.stringify(json);
    // 模拟真实通道：完整输出经 onStdout 累积；stdout_tail 只有前 100 字符。
    internal.onStdout?.(full);
    return { status: 'PASS', stdout_tail: { text: full.slice(0, 100), truncated: true } };
  };
  const outcome = await new CollaborationCoordinator(bb, dispatch).run(sessionId);
  assert.equal(outcome.status, 'completed', '4000 字符合法 JSON 不得因 tail 截断被误判');
  assert.equal(captured.length, 7);
  assert.ok(captured.every((c) => c.modelId === 'fm2'), '批准模型随每轮派发传递');
  assert.equal(captured[0].schema, COLLAB_SKILL_SCHEMAS.coordination);
  assert.equal(captured[1].schema, COLLAB_SKILL_SCHEMAS.proposal);
  assert.equal(captured[2].schema, COLLAB_SKILL_SCHEMAS.proposal);
  const assignment = bb.getVisibleContext(sessionId, 'A').own.find((v) => v.kind === 'assignment')!;
  assert.ok(assignment.body.includes(longNotes), '完整长输出被保留在观点中');
});

test('runner 失败不形成观点：合法 JSON + 非零退出 → 可重试，耗尽则会话 failed', async () => {
  const root = fixtureRoot('runner-fail');
  const paths = phaseAwareFixture(root);
  writeFileSync(paths.scenarioFile, 'runner-fail');
  const bb = CollaborationBlackboard.open(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb,
    contracts: {
      'fixture-a': fixtureContract('fixture-a', root, paths),
      'fixture-b': fixtureContract('fixture-b', root, paths),
    },
  });
  const sessionId = makeSession(root, bb);
  const outcome = await new CollaborationCoordinator(bb, (req, internal) => pipeline.dispatch(req, internal)).run(sessionId);
  assert.equal(outcome.status, 'failed');
  const session = bb.getSession(sessionId);
  assert.equal(session.status, 'failed');
  assert.equal(session.call_count, 3, '协调 1 + 提案 A 正常 1 + 重试 1');
  // runner 失败的两次派发不得形成观点（提案 A 无 proposal 观点）。
  const a = bb.getVisibleContext(sessionId, 'A');
  assert.equal(a.own.some((v) => v.kind === 'proposal'), false, '失败派发不得形成有效观点');
});

test('派发异常收口：协调器异常 → 会话转 failed 后原样上抛（不停留 authorized）', async () => {
  const root = fixtureRoot('dispatch-throw');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  const dispatch: CollaborationDispatchFn = async () => {
    throw new Error('pipeline exploded');
  };
  await assert.rejects(
    new CollaborationCoordinator(bb, dispatch).run(sessionId),
    /pipeline exploded/,
  );
  assert.equal(bb.getSession(sessionId).status, 'failed', '异常后不得停留在 authorized');
});

test('并发启动拒绝：活跃运行未结束时再次 run() 被拒，且不误伤首次运行', async () => {
  const root = fixtureRoot('concurrent');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted = false;
  const dispatch: CollaborationDispatchFn = async (req) => {
    if (!firstStarted) {
      firstStarted = true;
      await gate; // 首次运行的第一轮挂起，模拟仍在执行
    }
    return resultOf(phaseJson(req.prompt));
  };
  const coordinator = new CollaborationCoordinator(bb, dispatch);
  const run1 = coordinator.run(sessionId); // 不 await——仍在执行
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    coordinator.run(sessionId),
    /已有活跃运行，拒绝并发启动/,
    '并发启动必须被拒绝，不得误判为重启恢复',
  );
  release();
  const outcome = await run1;
  assert.equal(outcome.status, 'completed', '首次运行不受并发启动影响');
  assert.equal(bb.getSession(sessionId).status, 'completed');
});

test('修订阶段发送获准材料正文，manifest 由实际组装内容生成', async () => {
  const root = fixtureRoot('revision-material');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  const prompts: string[] = [];
  const dispatch: CollaborationDispatchFn = async (req) => {
    prompts.push(req.prompt);
    return resultOf(phaseJson(req.prompt));
  };
  const outcome = await new CollaborationCoordinator(bb, dispatch).run(sessionId);
  assert.equal(outcome.status, 'completed');
  const revisionA = prompts.find((p) => p.includes('【阶段】revision') && p.includes('【席位】A'))!;
  assert.match(revisionA, /材料一内容/, '修订提示必须包含获准材料正文（此前只有 ID/名称）');
  const revisionB = prompts.find((p) => p.includes('【阶段】revision') && p.includes('【席位】B'))!;
  assert.match(revisionB, /材料二内容/);
  // manifest 与实际发送对应：A 修订观点登记 m1、B 登记 m2。
  const aRevision = bb.getVisibleContext(sessionId, 'A').own.find((v) => v.kind === 'revision')!;
  assert.deepEqual(aRevision.material_manifest.map((m) => m.material_id), ['m1']);
  const bRevision = bb.getVisibleContext(sessionId, 'B').own.find((v) => v.kind === 'revision')!;
  assert.deepEqual(bRevision.material_manifest.map((m) => m.material_id), ['m2']);
});

test('同库双句柄：活跃标记跨句柄共享——第二次启动被拒，第一次仍能完成', async () => {
  const root = fixtureRoot('two-handles');
  const bb1 = CollaborationBlackboard.open(root);
  const bb2 = CollaborationBlackboard.open(root); // 同一数据库的第二个句柄
  const sessionId = makeSession(root, bb1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted = false;
  const dispatch: CollaborationDispatchFn = async (req) => {
    if (!firstStarted) {
      firstStarted = true;
      await gate; // 句柄 1 的第一轮挂起
    }
    return resultOf(phaseJson(req.prompt));
  };
  const coordinator1 = new CollaborationCoordinator(bb1, dispatch);
  const run1 = coordinator1.run(sessionId); // 不 await——活跃运行（占额尚未发生，脚本化派发绕过管线）
  await new Promise((resolve) => setImmediate(resolve));
  // 句柄 2 看到同一会话：必须判为"已有活跃运行"而非可接管的会话。
  const coordinator2 = new CollaborationCoordinator(bb2, dispatch);
  await assert.rejects(
    coordinator2.run(sessionId),
    /已有活跃运行，拒绝并发启动/,
  );
  assert.equal(bb2.getSession(sessionId).status, 'authorized', '被拒的第二次启动不得改动会话状态');
  release();
  const outcome = await run1;
  assert.equal(outcome.status, 'completed', '第一次运行完整完成');
  const log = bb2.getExecutionLog(sessionId);
  assert.ok(log.every((r) => r.status === 'pass'), '没有任何调用被误标 interrupted');
  assert.equal(bb2.getSession(sessionId).status, 'completed');
});

test('同库双句柄（真管线 in_progress 活跃运行）：第二次启动被拒，第一次仍能完成', async () => {
  const root = fixtureRoot('two-handles-pipeline');
  const paths = phaseAwareFixture(root);
  writeFileSync(paths.scenarioFile, 'hang');
  const bb1 = CollaborationBlackboard.open(root);
  const bb2 = CollaborationBlackboard.open(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    collabBlackboard: bb1,
    contracts: {
      'fixture-a': fixtureContract('fixture-a', root, paths),
      'fixture-b': fixtureContract('fixture-b', root, paths),
    },
  });
  const sessionId = makeSession(root, bb1);
  const run1 = new CollaborationCoordinator(bb1, (req, internal) => pipeline.dispatch(req, internal)).run(sessionId);
  // 等待首次真实占额（会话转 in_progress）——此时句柄 2 试图启动。
  for (let i = 0; i < 100 && bb2.getSession(sessionId).status !== 'in_progress'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(bb2.getSession(sessionId).status, 'in_progress');
  await assert.rejects(
    new CollaborationCoordinator(bb2, (req, internal) => pipeline.dispatch(req, internal)).run(sessionId),
    /已有活跃运行，拒绝并发启动/,
    '跨句柄活跃标记必须生效：in_progress 不得误判为重启遗留',
  );
  const outcome = await run1;
  assert.equal(outcome.status, 'completed', '第一次运行完整完成');
  const log = bb2.getExecutionLog(sessionId);
  assert.equal(log.filter((r) => r.status === 'interrupted').length, 0, '没有任何调用被误标 interrupted');
  assert.equal(bb2.getSession(sessionId).status, 'completed');
});

test('agy output_parser 管线接线：包装/NDJSON 形状七轮完成（裸 JSON 不再是唯一可完成形状）', async () => {
  // owner 独立复核缺口 1（2026-10-03）：默认 T1 分支此前不调 parseAgyOutput——
  // 裸 JSON 靠协调器整段 parse 侥幸完成；包装 JSON 与 NDJSON 的包装对象不满足
  // 协作 schema，两次调用后共享重试耗尽转 failed。管线接线（合同 output_parser
  // → runner structuredParser → 记录 structured_output → extractJsonObject 第一
  // 优先）后三形状都应七轮完成。
  for (const shape of ['bare', 'wrapped', 'ndjson'] as const) {
    const root = fixtureRoot(`agy-shape-${shape}`);
    const script = path.join(root, 'shape-emit.mjs');
    const shapeFile = path.join(root, 'shape.txt');
    writeFileSync(shapeFile, shape);
    writeFileSync(script, [
      "import { readFileSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      "const shape = readFileSync(args[0], 'utf8').trim();",
      'const prompt = args[args.length - 1];',
      // writeFileSync 字符串内 `\\w` 落盘为 `\w`（正则 \w）；单 `\w` 会被 JS 字符串
      // 转义吞掉反斜杠，正则退化为匹配字母 w，阶段永远 fallback 到 coordination。
      "const phase = prompt.match(/【阶段】(\\w+)/)?.[1] ?? 'coordination';",
      "const seat = prompt.match(/【席位】(\\w+)/)?.[1] ?? 'A';",
      "const respondTo = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1] ?? 'vp_x';",
      'const base = {',
      '  coordination: { a_focus: "A focus", b_focus: "B focus", material_plan: { A: ["m1"], B: ["m2"] }, notes: "plan" },',
      '  proposal: { body: "proposal-" + seat, stance: "support", evidence: seat === "A" ? ["m1"] : ["m2"], reserved_disagreements: "" },',
      '  review: { body: "review-" + seat, stance: "qualified", responds_to: respondTo, evidence: [], flaws: ["gap"], suggestions: ["add"], reserved_disagreements: "" },',
      '  revision: { body: "revision-" + seat, stance: "revised", changes: ["adopt"], reserved_disagreements: "keep" },',
      '};',
      'const line = JSON.stringify(base[phase] ?? {});',
      "if (shape === 'bare') console.log(line);",
      "else if (shape === 'wrapped') console.log(JSON.stringify({ conversation_id: 'c', model: 'fixture-model', status: 'SUCCESS', response: line }));",
      "else { console.log(JSON.stringify({ event: 'init', conversation_id: 'c' })); console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'c', status: 'SUCCESS', response: line } })); }",
      '',
    ].join('\n'), 'utf8');
    const shapeContract = (adapterId: string): AdapterContract => validateAdapterContract({
      adapter_id: adapterId,
      executable: process.execPath,
      arguments: [script, shapeFile],
      protocol: 't1',
      prompt_transport: 'argument',
      prompt_flag: '-p',
      expected_provider: 'google',
      expected_model_id: `${adapterId}-model`,
      output_parser: 'agy',
      tool_restriction_args: ['--sandbox'],
    });
    const bb = CollaborationBlackboard.open(root);
    const pipeline = new DispatchPipeline({
      workspaceRoot: root,
      approvalRoot: path.join(root, 'approvals'),
      ledgerPath: path.join(root, 'budget-ledger.jsonl'),
      collabBlackboard: bb,
      contracts: { 'fixture-a': shapeContract('fixture-a'), 'fixture-b': shapeContract('fixture-b') },
    });
    const sessionId = makeSession(root, bb);
    const coordinator = new CollaborationCoordinator(bb, (req, internal) => pipeline.dispatch(req, internal));
    const outcome = await coordinator.run(sessionId);
    assert.equal(outcome.status, 'completed', `${shape}: 管线解析接线后七轮应完成`);
    assert.equal(bb.getSession(sessionId).call_count, 7, `${shape}: 恰好七次调用`);
    assert.equal(bb.getSession(sessionId).retry_count, 0, `${shape}: 无重试（结构化结果第一优先命中）`);
    bb.close();
  }
});
