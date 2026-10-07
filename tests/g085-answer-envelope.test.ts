/** GOAL-085 owner 复核边界（2026-10-05）：原生 stdout 的**答案信封**。
 *
 * 现象（可复现）：受控通道的 stdout 是原始事件流，合法答案放在成功 `result`
 * 事件的 `result` 字符串里、且没有 `structured_output` 时，协调器"只跳过同时带
 * type 与 subtype 的行"的倒序扫描会跳过整行；同时只带 `type` 的元事件
 * （system/assistant）反而被当成观点对象。两条都让合法输出连吃两次拒绝、
 * 耗尽全场共享重试、把会话打成 failed。
 *
 * 本文件锁定修复后的口径：优先 `structured_output` → 成功终局事件的答案文本 →
 * 裸 JSON；其余原生事件不作观点；失败终局不冒充观点。集成用例走真实派发管线
 * （fixture 子进程 + 隔离账本，零模型调用），因此 call_count/retry_count 是
 * 黑板真实计数，不是脚本自报。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  extractAnswerFromEvent,
  isNativeEventEnvelope,
  parseAnswerText,
} from '../src/adapters/answer-envelope.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { parseClaudeStreamJson } from '../src/adapters/claude.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, type CollabParticipantInput } from '../src/orchestration/collaboration-blackboard.ts';
import {
  CollaborationCoordinator,
  extractJsonObject,
  type CollaborationDispatchFn,
  type CollaborationDispatchResultLike,
} from '../src/orchestration/collaboration-coordinator.ts';

const ANSWER = { body: 'proposal-A', stance: 'support', evidence: ['m1'], reserved_disagreements: '' };

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-answer-envelope-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function participants(): CollabParticipantInput[] {
  return [
    { seat: 'A', adapter_id: 'fixture-a', is_coordinator: true },
    { seat: 'B', adapter_id: 'fixture-b' },
  ];
}

function makeSession(root: string, bb: CollaborationBlackboard): string {
  const { session_id } = bb.createSession({
    topic: '原生流信封测试',
    workspace_root: root,
    participants: participants(),
    materials: [{ material_id: 'm1', name: '材料一', source: 'owner', content: '内容', allowed_seats: ['A', 'B'] }],
  });
  bb.authorizeSession(session_id);
  return session_id;
}

/** 原生流 fixture 子进程：按 prompt 里的阶段标记输出 `system/init`（+ 可选元事件）
 *  与终局 `result` 事件，答案**只**放在 result 文本里，不提供 structured_output。 */
function envelopeFixture(root: string, withMeta: boolean): { script: string; shapeFile: string } {
  const script = path.join(root, 'envelope-emit.mjs');
  const shapeFile = path.join(root, 'with-meta.txt');
  writeFileSync(shapeFile, withMeta ? 'meta' : 'plain');
  writeFileSync(script, [
    "import { readFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    "const withMeta = readFileSync(args[0], 'utf8').trim() === 'meta';",
    'const prompt = args[args.length - 1];',
    'const marker = (re) => { const m = prompt.match(re); return m ? m[1] : ""; };',
    'const phase = marker(/【阶段】(\\w+)/);',
    'const seat = marker(/【席位】(\\w+)/);',
    'const respondTo = marker(/【回应对象】(vp_[0-9a-f-]+)/);',
    'const base = {',
    '  coordination: { a_focus: "A focus", b_focus: "B focus", material_plan: { A: ["m1"], B: ["m1"] }, notes: "plan" },',
    '  proposal: { body: "proposal-" + seat, stance: "support", evidence: ["m1"], reserved_disagreements: "" },',
    '  review: { body: "review-" + seat, stance: "qualified", responds_to: respondTo, evidence: [], flaws: ["gap"], suggestions: ["add"], reserved_disagreements: "" },',
    '  revision: { body: "revision-" + seat, stance: "revised", changes: ["adopt"], reserved_disagreements: "keep" },',
    '};',
    'console.log(JSON.stringify({ type: "system", subtype: "init", model: "fixture-model", session_id: "s-1" }));',
    'if (withMeta) {',
    '  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "先给出草稿" }] } }));',
    '  console.log(JSON.stringify({ type: "system", subtype: "status", status: "compacting" }));',
    '}',
    'console.log(JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(base[phase] ?? {}), total_cost_usd: 0 }));',
    '',
  ].join('\n'), 'utf8');
  return { script, shapeFile };
}

function envelopeContract(adapterId: string, paths: { script: string; shapeFile: string }): AdapterContract {
  // 刻意**不**声明 output_parser：答案必须靠协调器的信封解析拿到，
  // 这正是此前缺口所在（声明了解析器的通道由 runner 提供 structured_output）。
  return validateAdapterContract({
    adapter_id: adapterId,
    executable: process.execPath,
    arguments: [paths.script, paths.shapeFile],
    protocol: 't1',
    prompt_transport: 'argument',
    prompt_flag: '-p',
    expected_provider: 'fixture',
    expected_model_id: `${adapterId}-model`,
    tool_restriction_args: ['--restricted'],
  });
}

// ---- 模块级：信封解码口径 ----

test('答案信封：成功 result 事件的答案文本被解析，元事件与失败终局不作观点', () => {
  assert.deepEqual(parseAnswerText(JSON.stringify(ANSWER)), ANSWER, '裸 JSON 文本');
  assert.deepEqual(parseAnswerText('```json\n' + JSON.stringify(ANSWER) + '\n```'), ANSWER, '唯一围栏块');
  assert.equal(parseAnswerText('这里是答案：' + JSON.stringify(ANSWER)), undefined, '夹杂散文不采信');
  assert.equal(parseAnswerText('42'), undefined, '标量不是观点');

  const ok = { type: 'result', subtype: 'success', result: JSON.stringify(ANSWER) };
  assert.deepEqual(extractAnswerFromEvent(ok), ANSWER, '成功终局文本');
  const nested = { event: 'result', result: { conversation_id: 'c', status: 'SUCCESS', response: JSON.stringify(ANSWER) } };
  assert.deepEqual(extractAnswerFromEvent(nested), ANSWER, 'agy NDJSON 嵌套终局');

  assert.equal(extractAnswerFromEvent({ type: 'system', subtype: 'init', model: 'm' }), undefined, 'system 元事件');
  assert.equal(extractAnswerFromEvent({ type: 'assistant', message: { content: [] } }), undefined, 'assistant 元事件');
  assert.equal(extractAnswerFromEvent({ type: 'result', subtype: 'error', result: JSON.stringify(ANSWER) }), undefined, '失败终局（subtype）');
  assert.equal(extractAnswerFromEvent({ event: 'result', result: { status: 'FAILED', response: JSON.stringify(ANSWER) } }), undefined, '失败终局（status）');
  assert.equal(extractAnswerFromEvent({ type: 'result', subtype: 'success', is_error: true, result: JSON.stringify(ANSWER) }), undefined, '错误标记');

  const both = { type: 'result', subtype: 'success', structured_output: { body: 'native' }, result: JSON.stringify(ANSWER) };
  assert.deepEqual(extractAnswerFromEvent(both), { body: 'native' }, '显式 structured_output 优先');
  assert.equal(isNativeEventEnvelope({ body: 'x', stance: 's' }), false, '无信封标记的对象是裸答案');
  assert.equal(isNativeEventEnvelope({ type: 'assistant' }), true, '只带 type 也是元事件');
});

// ---- 管线级：GPT 复现形状（答案只在 result 文本里，无 structured_output） ----

for (const withMeta of [false, true]) {
  const label = withMeta ? '含 system/assistant 元事件' : '最小复现（仅 result 信封）';
  test(`协调器：${label} → 七轮完成、零重试（此前元事件/整行跳过导致两次拒绝后 failed）`, async () => {
    const root = fixtureRoot(withMeta ? 'with-meta' : 'result-only');
    const paths = envelopeFixture(root, withMeta);
    const bb = CollaborationBlackboard.open(root);
    const pipeline = new DispatchPipeline({
      workspaceRoot: root,
      approvalRoot: path.join(root, 'approvals'),
      ledgerPath: path.join(root, 'budget-ledger.jsonl'),
      collabBlackboard: bb,
      contracts: {
        'fixture-a': envelopeContract('fixture-a', paths),
        'fixture-b': envelopeContract('fixture-b', paths),
      },
    });
    const sessionId = makeSession(root, bb);
    const outcome = await new CollaborationCoordinator(bb, (req, internal) => pipeline.dispatch(req, internal)).run(sessionId);
    const session = bb.getSession(sessionId);
    assert.equal(outcome.status, 'completed', `未完成：${outcome.reason ?? ''}`);
    assert.equal(outcome.dispatch_ids.length, 7, '恰好七次调用');
    assert.equal(session.call_count, 7, '黑板计数：无共享重试被消耗');
    assert.equal(session.retry_count, 0, '合法输出不得连吃两次拒绝');
    assert.equal(bb.getExecutionLog(sessionId).every((row) => row.status === 'pass'), true, '七轮执行日志全 pass');
    const a = bb.getVisibleContext(sessionId, 'A');
    assert.deepEqual(a.own.map((v) => v.kind), ['assignment', 'proposal', 'review', 'revision'], 'A 席观点齐备');
    assert.deepEqual(bb.getVisibleContext(sessionId, 'B').own.map((v) => v.kind), ['proposal', 'review', 'revision'], 'B 席观点齐备');
    const assignment = a.own.find((v) => v.kind === 'assignment')!;
    assert.deepEqual(JSON.parse(assignment.body).notes, 'plan', '落板的是信封里的答案，不是元事件对象');
    bb.close();
  });
}

/** 各阶段的合法答案（评审的 responds_to 从提示词里取，与真实链路同源）。 */
function phaseAnswer(prompt: string): Record<string, unknown> {
  const phase = (prompt.match(/【阶段】(\w+)/) ?? [])[1] ?? '';
  const seat = (prompt.match(/【席位】(\w+)/) ?? [])[1] ?? '';
  const respondTo = (prompt.match(/【回应对象】(vp_[0-9a-f-]+)/) ?? [])[1] ?? '';
  const base: Record<string, Record<string, unknown>> = {
    coordination: { a_focus: 'A', b_focus: 'B', material_plan: { A: ['m1'], B: ['m1'] }, notes: 'plan' },
    proposal: { body: `proposal-${seat}`, stance: 'support', evidence: ['m1'], reserved_disagreements: '' },
    review: { body: `review-${seat}`, stance: 'qualified', responds_to: respondTo, evidence: [], flaws: ['gap'], suggestions: ['fix'], reserved_disagreements: '' },
    revision: { body: `revision-${seat}`, stance: 'revised', changes: ['adopt'], reserved_disagreements: '' },
  };
  return base[phase] ?? {};
}

// ---- 终局优先级（2026-10-05 独立复核：结构化输出残留不得只留作观察） ----

/** 同一份流上的两条终局：先一条带结构化草稿，后一条只给答案文本（用户复现形状）。 */
function twoTerminals(finalText: string, lastSubtype: 'success' | 'error'): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5' }),
    JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(ANSWER), structured_output: ANSWER }),
    JSON.stringify({ type: 'result', subtype: lastSubtype, result: finalText }),
  ].join('\n') + '\n';
}

test('终局优先级：答案只由最后一个权威终局决定，早期结构化草稿不得胜出', () => {
  const finalAnswer = { ...ANSWER, body: 'FINAL' };
  const okStream = twoTerminals(JSON.stringify(finalAnswer), 'success');
  const parsed = parseClaudeStreamJson(okStream);
  assert.equal(parsed.structuredOutput, undefined, '最后终局没有结构化字段：不得沿用早期字段（残留即缺陷）');
  assert.equal(
    (extractJsonObject({ status: 'PASS', structured_output: parsed.structuredOutput, stdout_tail: { text: okStream, truncated: false } }, okStream) as { body?: string })?.body,
    'FINAL',
    '最后终局文本可解析 → 取该终局的答案，而不是早期结构化草稿',
  );

  // 最后终局只给不可解析的纯文本 → 该段无答案（不拿早期草稿顶替）
  const plainStream = twoTerminals('FINAL', 'success');
  assert.equal(
    extractJsonObject({ status: 'PASS', stdout_tail: { text: plainStream, truncated: false } }, plainStream),
    undefined,
    '最后终局无结构化字段且文本不可解析 → 拒绝，不回退早期终局',
  );

  // 最后终局失败 → 拒绝整段（即使运行侧仍递上缓存的早期结构化字段）
  const failedStream = twoTerminals(JSON.stringify(finalAnswer), 'error');
  const failedParsed = parseClaudeStreamJson(failedStream);
  assert.equal(failedParsed.structuredOutput, undefined, '失败终局不得保留结构化字段');
  assert.equal(
    extractJsonObject({
      status: 'PASS', structured_output: ANSWER, stdout_tail: { text: failedStream, truncated: false },
    }, failedStream),
    undefined,
    '失败终局必须拒绝整段：缓存的早期结构化字段不得绕过拒绝检查',
  );

  // 单终局回归保护：正常形状不受影响
  const single = [JSON.stringify({ type: 'system', subtype: 'init', model: 'm' }),
    JSON.stringify({ type: 'result', subtype: 'success', structured_output: finalAnswer })].join('\n') + '\n';
  assert.deepEqual(parseClaudeStreamJson(single).structuredOutput, finalAnswer);
  // 无终局（fixture 裸 JSON / 通道解析器结果）仍按旧口径
  assert.deepEqual(extractJsonObject({ status: 'PASS', stdout_tail: { text: JSON.stringify(ANSWER), truncated: false } }, ''), ANSWER);
  assert.deepEqual(extractJsonObject({ status: 'PASS', structured_output: ANSWER }, ''), ANSWER);
});

test('终局优先级（协调器）：早期结构化草稿 + 最后终局给答案文本 → 落板的是最后终局', async () => {
  const root = fixtureRoot('terminal-precedence');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  const dispatch: CollaborationDispatchFn = async (req) => {
    const finalAnswer = phaseAnswer(req.prompt);
    const draftKey = 'notes' in finalAnswer ? 'notes' : 'body';
    const draft = { ...finalAnswer, [draftKey]: 'EARLIER_DRAFT' };
    const final = { ...finalAnswer, [draftKey]: 'FINAL' };
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'fixture-model' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(draft), structured_output: draft }),
      JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(final) }),
    ].join('\n') + '\n';
    // 与运行侧同构：structured_output 由通道解析器给出（修复后最后终局无该字段 → undefined）
    const structured = parseClaudeStreamJson(stdout).structuredOutput;
    return {
      status: 'PASS', stdout_tail: { text: stdout, truncated: false },
      ...(structured !== undefined ? { structured_output: structured } : {}),
    } as CollaborationDispatchResultLike;
  };
  const outcome = await new CollaborationCoordinator(bb, dispatch).run(sessionId);
  assert.equal(outcome.status, 'completed', `未完成：${outcome.reason ?? ''}`);
  const bodies = [...bb.getVisibleContext(sessionId, 'A').own, ...bb.getVisibleContext(sessionId, 'B').own].map((v) => v.body);
  assert.equal(bodies.length, 7, '七个观点齐备');
  assert.ok(bodies.every((body) => body.includes('FINAL')), '每条观点都来自最后终局');
  assert.ok(bodies.every((body) => !body.includes('EARLIER_DRAFT')), '早期结构化草稿不得落板');
  bb.close();
});

test('终局优先级（协调器）：最后终局失败 → 整段拒绝，早期结构化草稿不得落板', async () => {
  const root = fixtureRoot('terminal-precedence-failed');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  let calls = 0;
  const dispatch: CollaborationDispatchFn = async () => {
    calls += 1;
    const stdout = twoTerminals('runtime error', 'error');
    return { status: 'PASS', stdout_tail: { text: stdout, truncated: false }, structured_output: ANSWER };
  };
  const outcome = await new CollaborationCoordinator(bb, dispatch).run(sessionId);
  assert.equal(outcome.status, 'failed', '失败终局 + 缓存结构化字段：拒绝整段');
  assert.match(outcome.reason ?? '', /输出不是单个 JSON 对象/);
  assert.equal(calls, 2, '共享重试恰好用掉一次后停止');
  assert.equal(bb.getVisibleContext(sessionId, 'A').own.length, 0, '没有任何观点落板');
  bb.close();
});

// ---- 脚本化 dispatch：失败终局不得让更早的草稿冒充观点 ----

test('协调器：失败终局不得让更早的草稿冒充观点', async () => {
  const root = fixtureRoot('failed-terminal');
  const bb = CollaborationBlackboard.open(root);
  const sessionId = makeSession(root, bb);
  let calls = 0;
  const dispatch: CollaborationDispatchFn = async () => {
    calls += 1;
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'fixture-model' }),
      JSON.stringify({ a_focus: 'A', b_focus: 'B', material_plan: { A: [], B: [] }, notes: 'draft' }),
      JSON.stringify({ type: 'result', subtype: 'error', result: 'runtime error' }),
    ].join('\n') + '\n';
    const res: CollaborationDispatchResultLike = { status: 'PASS', stdout_tail: { text: stdout, truncated: false } };
    return res;
  };
  const outcome = await new CollaborationCoordinator(bb, dispatch).run(sessionId);
  assert.equal(outcome.status, 'failed', '失败终局 + 早行草稿：拒绝而不是采信草稿');
  assert.match(outcome.reason ?? '', /输出不是单个 JSON 对象/);
  assert.equal(calls, 2, '共享重试恰好用掉一次后停止');
  assert.equal(bb.getVisibleContext(sessionId, 'A').own.filter((v) => v.kind === 'assignment').length, 0, '草稿未落板');
  bb.close();
});
