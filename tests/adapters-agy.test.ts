import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildAgyContract,
  parseAgyOutput,
  evaluateAgyIdentity,
} from '../src/adapters/agy.ts';
import { DispatchPipeline, type RunAdapterFn } from '../src/web/dispatch.ts';

function fixtureRoot(): string {
  const root = path.resolve(
    process.cwd(),
    '.test-fixtures',
    'agy',
    `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk: RunAdapterFn = async () => ({
  exitCode: 0,
  stdout: 'PONG',
  stderr: '',
  timedOut: false,
  childKilled: false,
});

function makePipeline(root: string, overrides: Partial<ConstructorParameters<typeof DispatchPipeline>[0]> = {}) {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: fakeOk,
    ...overrides,
  });
}

test('agy contract is T1 agy with prompt as final argument and executor role', () => {
  const contract = buildAgyContract();
  assert.equal(contract.adapter_id, 'agy');
  assert.equal(contract.executable, 'agy');
  // GOAL-084 受控化（2026-10-03）：`--dangerously-skip-permissions` 移除；
  // `-p` 改经 prompt_flag 声明（收尾值参由 runner 统一拼接）。
  assert.deepEqual(contract.arguments, ['--model', 'gemini-3.7-flash-high', '--effort', 'high']);
  assert.equal(contract.prompt_flag, '-p');
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.expected_provider, 'google');
  assert.equal(contract.expected_model_id, 'gemini-3.7-flash-high');
  assert.equal(contract.role, 'executor');
  assert.equal(contract.model_flag, '--model');
  assert.equal(contract.resume_flag, '--conversation');
  assert.equal(contract.context_management, 'auto-compact');
  assert.ok(contract.variants !== undefined && contract.variants.length > 0);
  assert.ok(contract.variants.includes('gemini-3.7-flash-high'));
  assert.ok(contract.variants.includes('gemini-3.1-pro-high'));
});

test('agy contract declares controlled discussion configuration (help-recorded, live unverified)', () => {
  const contract = buildAgyContract();
  // 本机 agy --help 实录（2026-10-03）：--sandbox（布尔）、--disable-slash-commands、
  // --json-schema <schema|string>。实弹行为未验证。
  assert.deepEqual(contract.tool_restriction_args, ['--sandbox', '--disable-slash-commands']);
  assert.equal(contract.output_schema_flag, '--json-schema');
  assert.equal(contract.output_schema_inline, true);
  // 受控化红线：默认参数不得再含自动放行旗标。
  assert.ok(!contract.arguments.includes('--dangerously-skip-permissions'), 'controlled contract must not auto-approve permissions');
});

test('agy contract accepts custom expectedModelId', () => {
  const contract = buildAgyContract('gemini-3.1-pro-high');
  assert.equal(contract.expected_model_id, 'gemini-3.1-pro-high');
  assert.deepEqual(contract.arguments, ['--model', 'gemini-3.1-pro-high', '--effort', 'high']);
  assert.equal(contract.prompt_flag, '-p');
});

test('agy argv 不变量：全部合同参数在 -p 之前，-p 恒紧邻 prompt（prompt_flag 机制）', () => {
  // 2026-09-06 实弹审计回归（claude-code 503 故障转移到 agy exit 2）：
  // `-p` 与 prompt 之间插入的旗标会被 agy 当作 prompt。GOAL-084 prompt_flag
  // 机制下 runner 组装顺序 = [...arguments, ...capability, ...cwd, '-p', prompt]，
  // 本测试锁合同层不变量；注入后完整 argv 顺序由 g084-runner-capabilities 的
  // 回声 fixture 用例以真实 spawn 验证。
  const contract = buildAgyContract();
  const args = contract.arguments;
  assert.ok(!args.includes('-p'), '合同 arguments 不得含 -p（由 prompt_flag 声明、runner 收尾拼接）');
  const effortIdx = args.indexOf('--effort');
  assert.ok(effortIdx >= 0 && effortIdx + 1 < args.length, '--effort 必须带默认值占位（注入器原地改写）');
  assert.equal(contract.prompt_flag, '-p');
});

test('agy declares thinking effort low/medium/high with flag injection', () => {
  const contract = buildAgyContract();
  assert.deepEqual(contract.effort_levels, ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(contract.effort_injection, { kind: 'flag', name: '--effort' });
});

test('parseAgyOutput handles plain text stdout', () => {
  const output = parseAgyOutput('Hello Antigravity!\n');
  assert.equal(output.parsed, false);
  assert.equal(output.conversationId, null);
  assert.equal(output.modelId, 'UNKNOWN');
  assert.equal(output.text, 'Hello Antigravity!\n');
});

test('parseAgyOutput handles json stdout', () => {
  const jsonStr = JSON.stringify({
    conversation_id: 'conv-12345',
    status: 'SUCCESS',
    model: 'gemini-3.7-flash-high',
    response: 'Here is the answer.',
  });
  const output = parseAgyOutput(jsonStr);
  assert.equal(output.parsed, true);
  assert.equal(output.conversationId, 'conv-12345');
  assert.equal(output.status, 'SUCCESS');
  assert.equal(output.modelId, 'gemini-3.7-flash-high');
  assert.equal(output.text, 'Here is the answer.');
});

test('parseAgyOutput handles JSONL / stream output lines', () => {
  const stream = [
    '{"event":"init","conversation_id":"c-999"}',
    '{"event":"result","result":{"conversation_id":"c-999","status":"SUCCESS","response":"Stream finished"}}',
  ].join('\n');
  const output = parseAgyOutput(stream);
  assert.equal(output.parsed, true);
  assert.equal(output.conversationId, 'c-999');
  assert.equal(output.text, 'Stream finished');
});

test('parseAgyOutput extracts structured_output and embedded JSON response (GOAL-084)', () => {
  // 显式 structured_output 字段优先（对齐 claude 解析语义）。
  const explicit = parseAgyOutput(JSON.stringify({
    conversation_id: 'c-1',
    model: 'gemini-3.7-flash-high',
    structured_output: { body: 'B', stance: '支持' },
    response: 'wrapper text',
  }));
  assert.equal(explicit.parsed, true);
  assert.deepEqual(explicit.structured, { body: 'B', stance: '支持' });
  assert.equal(explicit.text, 'wrapper text');

  // 优先级回归（owner 复核缺口 2）：structured_output 与内嵌 JSON response 并存时，
  // 显式字段必须胜出——内嵌 JSON 先解析会静默占用结果槽位。
  const both = parseAgyOutput(JSON.stringify({
    conversation_id: 'c-1b',
    structured_output: { body: 'EXPLICIT_WINS', stance: '支持' },
    response: JSON.stringify({ body: 'EMBEDDED_LOSES', stance: '反对' }),
  }));
  assert.deepEqual(both.structured, { body: 'EXPLICIT_WINS', stance: '支持' });

  // response 为内嵌 JSON 字符串时尝试一次内层解析（schema enforce 形状之一）。
  const embedded = parseAgyOutput(JSON.stringify({
    conversation_id: 'c-2',
    response: JSON.stringify({ body: 'B2', stance: '反对' }),
  }));
  assert.deepEqual(embedded.structured, { body: 'B2', stance: '反对' });
  assert.equal(embedded.text, JSON.stringify({ body: 'B2', stance: '反对' }));

  // 纯文本 response 不产生 structured。
  const plain = parseAgyOutput(JSON.stringify({ response: 'just text' }));
  assert.equal(plain.structured, undefined);
});

test('parseAgyOutput falls back to raw stdout when a JSON object carries no known text field', () => {
  // schema enforce 后 agy 可能直接输出协作 JSON 对象（无 response/result 字段）——
  // 解析不得报"成功但文本为空"的假象（形状待权限探针实弹核验）。
  const collabShape = JSON.stringify({ body: '提案正文', stance: '支持', evidence: ['m1'] });
  const output = parseAgyOutput(collabShape);
  assert.equal(output.parsed, true);
  assert.equal(output.modelId, 'UNKNOWN', '协作对象无 model 字段，身份保持 UNKNOWN（fail-closed 方向）');
  assert.equal(output.text, collabShape);
  assert.deepEqual(output.structured, { body: '提案正文', stance: '支持', evidence: ['m1'] });
});

test('parseAgyOutput NDJSON 流式优先级：显式字段无条件采用、最终行胜出（owner 复核缺口补）', () => {
  const FALLBACK = { body: 'FALLBACK', stance: 'support' };
  const FINAL = { body: 'FINAL', stance: 'support' };

  // sameEvent：同一 result 事件里 response 内嵌 FALLBACK 与显式 structured_output FINAL 并存。
  const sameEvent = parseAgyOutput([
    '{"event":"init","conversation_id":"c"}',
    JSON.stringify({ event: 'result', result: { response: JSON.stringify(FALLBACK), structured_output: FINAL } }),
  ].join('\n'));
  assert.deepEqual(sameEvent.structured, FINAL, '同行并存时显式 structured_output 必须胜出');

  // acrossEvents：早行 response 内嵌占位，末行显式 structured_output 必须替换。
  const acrossEvents = parseAgyOutput([
    '{"event":"init","conversation_id":"c"}',
    JSON.stringify({ event: 'step_update', step_update: { response: JSON.stringify(FALLBACK) } }),
    JSON.stringify({ event: 'result', result: { structured_output: FINAL } }),
  ].join('\n'));
  assert.deepEqual(acrossEvents.structured, FINAL, '末行显式字段必须替换早行内嵌占位');

  // earlierExplicit：早行显式 FALLBACK，末行显式 FINAL 仍要替换（流式取最终结果行）。
  const earlierExplicit = parseAgyOutput([
    JSON.stringify({ event: 'step_update', step_update: { structured_output: FALLBACK } }),
    JSON.stringify({ event: 'result', result: { structured_output: FINAL } }),
  ].join('\n'));
  assert.deepEqual(earlierExplicit.structured, FINAL, '显式字段之间也是最终行胜出');

  // responseOnlyFinal（owner 复核三轮）：早行显式 DRAFT、末行仅 response 内嵌
  // FINAL——structured 必须随最终行更新为 FINAL，与 text 一致（此前停在 DRAFT）。
  const responseOnlyFinal = parseAgyOutput([
    JSON.stringify({ event: 'step_update', step_update: { structured_output: FALLBACK } }),
    JSON.stringify({ event: 'result', result: { response: JSON.stringify(FINAL) } }),
  ].join('\n'));
  assert.deepEqual(responseOnlyFinal.structured, FINAL, '末行内嵌 JSON 覆盖早行显式占位（最终行权威）');
  assert.equal(responseOnlyFinal.text, JSON.stringify(FINAL));
  assert.deepEqual(responseOnlyFinal.structured, JSON.parse(responseOnlyFinal.text), 'text 与 structured 指向同一最终结果');

  // 四包装回归（owner 复核四轮）：内嵌 JSON 扫描覆盖 response/result/text/output
  // 全部文本候选字段——只查 response 会丢其余包装的结构化结果。
  for (const wrapper of ['response', 'result', 'text', 'output'] as const) {
    const wrapped = parseAgyOutput(JSON.stringify({ conversation_id: 'c', [wrapper]: JSON.stringify(FINAL) }));
    assert.deepEqual(wrapped.structured, FINAL, `${wrapper} 包装的内嵌 JSON 必须提取`);
    assert.equal(wrapped.text, JSON.stringify(FINAL));
  }

  // 无显式字段时内嵌 JSON 仍正常补空位（不回归）。
  const embeddedOnly = parseAgyOutput([
    '{"event":"init"}',
    JSON.stringify({ event: 'result', result: { response: JSON.stringify(FALLBACK) } }),
  ].join('\n'));
  assert.deepEqual(embeddedOnly.structured, FALLBACK);
  assert.equal(embeddedOnly.text, JSON.stringify(FALLBACK));
});

test('evaluateAgyIdentity proves identity when model is present', () => {
  const id1 = evaluateAgyIdentity('PONG');
  assert.equal(id1.provider, 'UNKNOWN');
  assert.equal(id1.proven, false);

  const id2 = evaluateAgyIdentity(JSON.stringify({ model: 'gemini-3.7-flash-high', response: 'ok' }));
  assert.equal(id2.provider, 'google');
  assert.equal(id2.modelId, 'gemini-3.7-flash-high');
  assert.equal(id2.proven, true);
});

test('roster includes agy and exposes verified status and effort metadata', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const agy = pipeline.roster().find((entry) => entry.adapter_id === 'agy');
  assert.ok(agy, 'agy must appear in roster');
  assert.equal(agy?.role, 'executor');
  assert.equal(agy?.verified, true);
  assert.equal(agy?.expected_provider, 'google');
  assert.equal(agy?.expected_model_id, 'gemini-3.7-flash-high');
  assert.deepEqual(agy?.effort_levels, ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(agy?.effort_injection, { kind: 'flag', name: '--effort' });
  assert.ok(agy?.variants && agy.variants.length > 0);
});

test('dispatch executes agy dry-run successfully', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const res = await pipeline.dispatch({
    adapter_id: 'agy',
    prompt: 'test prompt for agy',
    dry_run: true,
    effort: 'HIGH',
    model_id: 'gemini-3.1-pro-high',
  });
  assert.equal(res.status, 'DRY_RUN');
  assert.equal(res.adapter_id, 'agy');
  assert.ok(res.request, 'dry-run record must snapshot the request');
  assert.equal(res.request.effort, 'HIGH');
  assert.equal(res.request.model_id, 'gemini-3.1-pro-high');
});

test('user override template agy allows model_id parameterization', () => {
  const root = fixtureRoot();
  const adaptersPath = path.join(root, 'adapters.json');
  writeFileSync(
    adaptersPath,
    JSON.stringify({
      schema_version: 1,
      adapters: [
        {
          adapter_id: 'my-agy-pro',
          template: 'agy',
          params: { model_id: 'gemini-3.1-pro-high' },
          removed: false,
        },
      ],
    }),
    'utf8',
  );
  const pipeline = makePipeline(root, { adaptersPath });
  const adapters = pipeline.listAdapters();
  const myAgy = adapters.find((entry) => entry.adapter_id === 'my-agy-pro');
  assert.ok(myAgy);
  assert.equal(myAgy?.origin, 'user');
  assert.equal(myAgy?.template, 'agy');
  assert.equal(myAgy?.expected_model_id, 'gemini-3.1-pro-high');
  assert.equal(myAgy?.verified, true);
});


test('agy denied or empty transport envelopes never become structured answers', () => {
  const envelope = { conversation_id: 'synthetic', status: 'SUCCESS', response: '',
    json_schema: { type: 'object' }, denied_actions: [{ action: 'read_file', display_name: 'ViewFile' }] };
  const raw = JSON.stringify(envelope);
  assert.equal(parseAgyOutput(raw).structured, undefined);
  assert.equal(parseAgyOutput(raw).text, raw, 'keep raw failure evidence available');
  const draft = { body: 'DRAFT', stance: 'support' };
  const stream = [JSON.stringify({ event: 'step_update', step_update: { structured_output: draft } }),
    JSON.stringify({ event: 'result', result: envelope })].join('\n');
  assert.equal(parseAgyOutput(stream).structured, undefined, 'empty final result clears earlier draft');
  assert.deepEqual(parseAgyOutput(JSON.stringify(draft)).structured, draft, 'bare valid objects still work');
});

test('agy fenced JSON is unwrapped only when every complete block is the same object', () => {
  const object = { body: 'FINAL', stance: 'support' };
  const block = '```json\n' + JSON.stringify(object) + '\n```\n';
  for (const response of [block, block.repeat(4)]) {
    const parsed = parseAgyOutput(JSON.stringify({ status: 'SUCCESS', response }));
    assert.deepEqual(parsed.structured, object);
    assert.equal(parsed.text, response, 'original transport is retained, including repeated copies');
  }
  const conflicting = block + '```json\n{"body":"OTHER","stance":"oppose"}\n```';
  assert.equal(parseAgyOutput(JSON.stringify({ response: conflicting })).structured, undefined);
  assert.equal(parseAgyOutput(JSON.stringify({ response: 'commentary\n' + block })).structured, undefined);
});

test('agy native validation aggregate uses the final completed response only when exact stream provenance matches', () => {
  const draft = JSON.stringify({ body:'DRAFT',stance:'oppose' })+'\n';
  const final = JSON.stringify({ body:'FINAL',stance:'support' })+'\n';
  const steps = [
    { event:'step_update',step_update:{step_type:'agent_response',step_index:1,state:'DONE',text_delta:draft} },
    { event:'step_update',step_update:{step_type:'agent_response',step_index:3,state:'DONE',text_delta:final} },
  ];
  const parse = (response: string) => parseAgyOutput([...steps,{event:'result',result:{status:'SUCCESS',response}}].map(v=>JSON.stringify(v)).join('\n'));
  assert.deepEqual(parse(draft+final).structured,{body:'FINAL',stance:'support'});
  assert.equal(parse(draft+final).text,final);
  assert.equal(parse(draft+final+'unknown prose').structured,undefined);
});
