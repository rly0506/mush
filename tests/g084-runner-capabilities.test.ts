/** GOAL-084 §3.2：Codex/Claude 默认真实 runner 路径的模型绑定、工具权限与输出 schema
 * 能力注入——从实际合同构造器出发（buildCodexContract/buildClaudeContract），仅把
 * 执行文件替换为本地回声 fixture；真实 spawn，零网络、零模型调用。
 * 旗标已按本机 --help 实录接线（codex 0.156.1 / claude 2.1.281），实弹行为未验证。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { runClaudeStreamRun, parseClaudeStreamJson } from '../src/adapters/claude.ts';
import { buildCodexContract } from '../src/adapters/codex.ts';
import { buildAgyContract } from '../src/adapters/agy.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g084-cap-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** 回声 fixture：首行打印 ARGV JSON；带 --output-schema 时再打印 schema 文件内容。 */
function echoFixture(root: string): string {
  const script = path.join(root, 'echo-argv.mjs');
  writeFileSync(script, [
    "import { readFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    "console.log('ARGV ' + JSON.stringify(args));",
    "const i = args.indexOf('--output-schema');",
    "if (i >= 0) console.log('SCHEMA ' + readFileSync(args[i + 1], 'utf8').trim());",
    '',
  ].join('\n'), 'utf8');
  return script;
}

/** 实际合同构造器 → 只替换执行文件为回声 fixture（owner 指定的测试姿势）。 */
function withEchoExecutable(contract: AdapterContract, echoScript: string): AdapterContract {
  return validateAdapterContract({
    ...contract,
    executable: process.execPath,
    arguments: [echoScript, ...contract.arguments],
  });
}

function contractOf(adapterId: string, script: string, extra: Record<string, unknown>): AdapterContract {
  return validateAdapterContract({
    adapter_id: adapterId,
    executable: process.execPath,
    arguments: [script],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: `${adapterId}-model`,
    ...extra,
  });
}

function parseArgvLine(stdout: string | undefined): string[] {
  const line = (stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('ARGV '));
  assert.ok(line, 'fixture must echo ARGV line');
  return JSON.parse(line.slice('ARGV '.length)) as string[];
}

function parseSchemaLine(stdout: string | undefined): unknown {
  const line = (stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('SCHEMA '));
  return line === undefined ? undefined : JSON.parse(line.slice('SCHEMA '.length));
}

const VIEWPOINT_SCHEMA = {
  type: 'object',
  required: ['body', 'stance', 'responds_to', 'evidence', 'flaws', 'suggestions', 'reserved_disagreements'],
};

async function dispatchAndCollect(
  pipeline: DispatchPipeline,
  adapterId: string,
  internal: Record<string, unknown>,
  body: Record<string, unknown> = {},
): Promise<{ argv: string[]; schema: unknown; stdout: string | undefined }> {
  const record = await pipeline.dispatch(
    { adapter_id: adapterId, prompt: 'long task', real: true, timeout_s: 30, ...body },
    { originOwner: true, ...internal },
  );
  const stdout = record.stdout_tail?.text;
  return { argv: parseArgvLine(stdout), schema: parseSchemaLine(stdout), stdout };
}

test('模型绑定：声明 model_flag 但参数无占位——旗标对补在合同参数尾部、prompt 恒在最后', async () => {
  const root = fixtureRoot('model-append');
  const script = echoFixture(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: {
      'fixture-m': contractOf('fixture-m', script, { model_flag: '-m', variants: ['m1', 'm2'] }),
    },
  });
  const { argv } = await dispatchAndCollect(pipeline, 'fixture-m', {}, { model_id: 'm1' });
  const flagAt = argv.indexOf('-m');
  assert.notEqual(flagAt, -1, 'model flag must reach the CLI');
  assert.equal(argv[flagAt + 1], 'm1');
  assert.equal(argv[argv.length - 1], 'long task', 'prompt stays last (flag-before-positional)');
});

test('模型绑定：占位重写路径不变（G009 回归锁）——有占位时替换值而非追加', async () => {
  const root = fixtureRoot('model-rewrite');
  const script = echoFixture(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: {
      'fixture-r': contractOf('fixture-r', script, {
        model_flag: '--model',
        variants: ['m1'],
        arguments: [script, '--model', 'default-m'],
      }),
    },
  });
  const { argv } = await dispatchAndCollect(pipeline, 'fixture-r', {}, { model_id: 'm1' });
  assert.deepEqual(argv.filter((a) => a === '--model').length, 1, 'exactly one --model flag');
  assert.equal(argv[argv.indexOf('--model') + 1], 'm1');
  assert.equal(argv.filter((a) => a === 'default-m').length, 0, 'placeholder value rewritten');
});

test('codex 实际合同：模型绑定 + --sandbox read-only + --output-schema 文件运输一次性生效', async () => {
  const root = fixtureRoot('codex-real');
  const script = echoFixture(root);
  const schema = { type: 'object', required: ['body', 'stance'] };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { codex: withEchoExecutable(buildCodexContract(), script) },
  });
  const { argv, schema: echoed } = await dispatchAndCollect(
    pipeline, 'codex',
    { restrictTools: true, outputSchema: schema },
    { model_id: 'gpt-5.5' },
  );
  assert.equal(argv[0], 'exec', 'codex subcommand preserved');
  assert.equal(argv[argv.indexOf('-m') + 1], 'gpt-5.5', 'model bound via append path (帮助实录 -m，实弹未验证)');
  assert.equal(argv[argv.indexOf('--sandbox') + 1], 'read-only', 'discussion channel runs read-only (实弹未验证)');
  const schemaAt = argv.indexOf('--output-schema');
  assert.notEqual(schemaAt, -1, '--output-schema 帮助实录 <FILE>，实弹未验证');
  assert.match(argv[schemaAt + 1] ?? '', /output-schema\.json$/, 'file transport lives beside the receipt');
  assert.ok(echoed !== undefined, 'schema file content round-trips to the child');
  assert.deepEqual(echoed, schema);
  // codex context_management=none：prompt 经 D28/D29 dsh 缝合组装（既有行为），
  // 新指令在缝合尾部——能力注入不得破坏该组装。
  assert.ok(argv[argv.length - 1].endsWith('long task'), 'stitched prompt keeps the instruction last');
  assert.ok(argv[argv.length - 1].includes('【mush 流内 dsh 窗口】'), 'none-context stitching preserved');
});

test('claude 实际合同：--model 重写 + --tools "" 禁全内建工具 + --json-schema inline 运输', async () => {
  const root = fixtureRoot('claude-real');
  const script = echoFixture(root);
  const schema = { type: 'object', required: ['body'] };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { 'claude-code': withEchoExecutable(buildClaudeContract('claude-sonnet-5'), script) },
  });
  const { argv, schema: echoed } = await dispatchAndCollect(
    pipeline, 'claude-code',
    { restrictTools: true, outputSchema: schema },
    { model_id: 'claude-sonnet-4-5' },
  );
  assert.equal(argv[0], '-p', 'claude argument shape preserved');
  assert.equal(argv.filter((a) => a === '--model').length, 1);
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-4-5', 'variant rewrite via G009 placeholder path');
  const toolsAt = argv.indexOf('--tools');
  assert.notEqual(toolsAt, -1, '--tools 帮助实录（"Use \\"\\" to disable all"），实弹未验证');
  assert.equal(argv[toolsAt + 1], '', '空字符串是合法旗标值：禁用全部内建工具');
  assert.notEqual(argv.indexOf('--strict-mcp-config'), -1, '组合参数：只认 --mcp-config 声明的 MCP');
  const schemaAt = argv.indexOf('--json-schema');
  assert.notEqual(schemaAt, -1, '--json-schema 帮助实录 <schema>，实弹未验证');
  assert.equal(argv[schemaAt + 1], JSON.stringify(schema), 'inline transport下发 schema 文本而非文件路径');
  assert.equal(echoed, undefined, 'inline 运输不落 schema 文件');
  assert.equal(argv[argv.length - 1], 'long task');
});

test('工具限制：internal.restrictTools 把合同声明的限制参数注入 CLI（internal 专用通道）', async () => {
  const root = fixtureRoot('restrict');
  const script = echoFixture(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: {
      'fixture-s': contractOf('fixture-s', script, { tool_restriction_args: ['--sandbox', 'read-only'] }),
    },
  });
  const { argv } = await dispatchAndCollect(pipeline, 'fixture-s', { restrictTools: true });
  const flagAt = argv.indexOf('--sandbox');
  assert.notEqual(flagAt, -1);
  assert.equal(argv[flagAt + 1], 'read-only');
  assert.equal(argv[argv.length - 1], 'long task');
});

test('工具限制 fail-closed：合同未声明 tool_restriction_args——派发入口即拒（不建审批卡、不进运行时）', async () => {
  const root = fixtureRoot('restrict-refuse');
  const script = echoFixture(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { 'fixture-plain': contractOf('fixture-plain', script, {}) },
  });
  await assert.rejects(
    pipeline.dispatch(
      { adapter_id: 'fixture-plain', prompt: 'long task', real: true, timeout_s: 30 },
      { originOwner: true, restrictTools: true },
    ),
    /does not declare tool_restriction_args/,
  );
});

test('输出 schema（file 运输）：internal.outputSchema 落盘回执旁文件并经合同旗标下发，内容可回读', async () => {
  const root = fixtureRoot('schema-file');
  const script = echoFixture(root);
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: {
      'fixture-schema': contractOf('fixture-schema', script, { output_schema_flag: '--output-schema' }),
    },
  });
  const { argv, schema: echoed } = await dispatchAndCollect(pipeline, 'fixture-schema', { outputSchema: VIEWPOINT_SCHEMA });
  const flagAt = argv.indexOf('--output-schema');
  assert.notEqual(flagAt, -1, 'schema flag must reach the CLI');
  assert.match(argv[flagAt + 1] ?? '', /output-schema\.json$/, 'schema file lives beside the receipt');
  assert.ok(echoed !== undefined, 'schema file content round-trips to the child');
  assert.deepEqual(echoed, VIEWPOINT_SCHEMA);
});

test('claude stream-json 解析：result 事件的 structured_output 与 result 文本并存保留（实弹字段名未验证）', async () => {
  const stdout = [
    JSON.stringify({ type: 'system', model: 'claude-fixture', session_id: 's-1' }),
    JSON.stringify({ type: 'assistant', message: {} }),
    JSON.stringify({
      type: 'result', subtype: 'success',
      result: '正文文本',
      structured_output: { body: '观点正文', stance: '支持', reserved_disagreements: ['X 待定'] },
      total_cost_usd: 0.01, session_id: 's-1',
    }),
    '',
  ].join('\n');
  const parsed = parseClaudeStreamJson(stdout);
  assert.equal(parsed.resultText, '正文文本', 'result 文本照常提取');
  assert.deepEqual(parsed.structuredOutput, { body: '观点正文', stance: '支持', reserved_disagreements: ['X 待定'] },
    'structured_output 不被 result 覆盖、不覆盖 result');
  assert.equal(parsed.sessionId, 's-1');
  assert.equal(parsed.ended, true);

  // runner 层：结构化结果经 runClaudeStreamRun 返回、解析并保留。
  const root = fixtureRoot('claude-structured');
  const script = path.join(root, 'emit-structured.mjs');
  writeFileSync(script, [
    "const lines = [",
    `  ${JSON.stringify(JSON.stringify({ type: 'system', model: 'claude-fixture', session_id: 's-2' }))},`,
    `  ${JSON.stringify(JSON.stringify({ type: 'result', subtype: 'success', result: '正文文本', structured_output: { body: 'x' }, session_id: 's-2' }))},`,
    "];",
    "console.log(lines.join('\\n'));",
    '',
  ].join('\n'), 'utf8');
  const contract = validateAdapterContract({
    adapter_id: 'fixture-claude-structured',
    executable: process.execPath,
    arguments: [script],
    protocol: 'stream-json',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: 'fixture-claude-structured-model',
  });
  const result = await runClaudeStreamRun({
    contract, prompt: 'long task', workspaceRoot: root, timeoutMs: 30000,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.structuredOutput, { body: 'x' }, '结构化结果经 runner 返回并保留');
  assert.equal(result.resultText, '正文文本');
});

test('结构化结果经完整默认管线存活：与超长正文并存、不经 2048 tail、回执持久化（owner 复现路径回归）', async () => {
  const root = fixtureRoot('structured-pipeline');
  const structured = { body: 'BODY_STRUCTURED_MUST_SURVIVE', stance: 'support', evidence: ['m1'] };
  const script = path.join(root, 'emit-structured.mjs');
  writeFileSync(script, [
    'const lines = [',
    `  ${JSON.stringify({ type: 'system', model: 'claude-sonnet-4-5', session_id: 's-1' })},`,
    `  ${JSON.stringify({ type: 'result', subtype: 'success', result: 'x'.repeat(3000), structured_output: structured, session_id: 's-1' })},`,
    '];',
    "for (const line of lines) console.log(JSON.stringify(line));",
    '',
  ].join('\n'), 'utf8');
  const base = buildClaudeContract('claude-sonnet-4-5');
  const contract = validateAdapterContract({
    ...base,
    executable: process.execPath,
    arguments: [script, ...base.arguments],
  });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { 'claude-code': contract },
  });
  const record = await pipeline.dispatch(
    { adapter_id: 'claude-code', prompt: 'fixture only', real: true, timeout_s: 30 },
    { originOwner: true, restrictTools: true, outputSchema: { type: 'object' } },
  );
  assert.equal(record.status, 'PASS');
  assert.deepEqual(record.structured_output, structured, '结构化观点完整对象必须独立于 tail 存活');
  assert.equal(record.stdout_tail?.truncated, true, '正文超 2048 被如实截断');
  assert.ok((record.stdout_tail?.text ?? '').length <= 2048, 'tail 不承担结构化结果运输');
  assert.ok(typeof record.receipt_path === 'string' && record.receipt_path.length > 0);
  const receipt = JSON.parse(readFileSync(record.receipt_path, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(receipt.structured_output, structured, '结构化观点持久化在回执 JSON，协调器可读');
});

test('claude stream-json runner：restrictTools 与 outputSchemaJson 同样生效（默认 spawn 直连）', async () => {
  const root = fixtureRoot('claude-cap');
  const script = echoFixture(root);
  const schema = { type: 'object' };
  const contract = validateAdapterContract({
    adapter_id: 'fixture-claude-cap',
    executable: process.execPath,
    arguments: [script],
    protocol: 'stream-json',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: 'fixture-claude-cap-model',
    tool_restriction_args: ['--disallowedTools', 'Write Edit NotebookEdit'],
    output_schema_flag: '--json-schema',
    output_schema_inline: true,
  });
  const result = await runClaudeStreamRun({
    contract,
    prompt: 'long task',
    workspaceRoot: root,
    timeoutMs: 30000,
    restrictTools: true,
    outputSchemaJson: JSON.stringify(schema),
  });
  assert.equal(result.exitCode, 0);
  const argv = parseArgvLine(result.stdout);
  const toolAt = argv.indexOf('--disallowedTools');
  assert.equal(argv[toolAt + 1], 'Write Edit NotebookEdit');
  const schemaAt = argv.indexOf('--json-schema');
  assert.equal(argv[schemaAt + 1], JSON.stringify(schema), 'inline schema text injected verbatim');
  assert.equal(argv[argv.length - 1], 'long task');
});

test('agy 实际合同：受控 sandbox + slash 禁用 + --json-schema inline + prompt_flag 收尾拼接', async () => {
  // GOAL-084（2026-10-03）：本机 agy --help 实录（--sandbox 布尔、
  // --disable-slash-commands、--json-schema <schema|string>）。实弹行为未验证。
  // prompt_flag 机制：能力注入参数必须落在收尾值参 `-p` 之前——2026-09-06
  // 实弹教训：`-p` 与 prompt 之间插入的旗标会被 agy 当作 prompt。
  const root = fixtureRoot('agy-real');
  const script = echoFixture(root);
  const schema = { type: 'object', required: ['body'] };
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { agy: withEchoExecutable(buildAgyContract(), script) },
  });
  const { argv } = await dispatchAndCollect(
    pipeline, 'agy',
    { restrictTools: true, outputSchema: schema },
    { model_id: 'gemini-3.1-pro-high' },
  );
  assert.ok(!argv.includes('--dangerously-skip-permissions'), '受控讨论不得自动放行权限（默认参数已移除）');
  const pAt = argv.indexOf('-p');
  assert.notEqual(pAt, -1, 'prompt_flag -p must reach the CLI');
  assert.equal(argv[pAt + 1], 'long task', '`-p` 必须紧邻 prompt（agy 值参语义，实弹教训）');
  const sandboxAt = argv.indexOf('--sandbox');
  assert.ok(sandboxAt >= 0 && sandboxAt < pAt, '--sandbox 注入在 `-p` 之前（实弹未验证）');
  assert.ok(argv.includes('--disable-slash-commands'), 'slash 命令/skill 展开禁用（实弹未验证）');
  assert.equal(argv[argv.indexOf('--model') + 1], 'gemini-3.1-pro-high', 'model variant bound in-place');
  const schemaAt = argv.indexOf('--json-schema');
  assert.equal(argv[schemaAt + 1], JSON.stringify(schema), 'inline schema text verbatim');
  assert.ok(schemaAt >= 0 && schemaAt < pAt, 'schema 注入在 `-p` 之前');
});

test('agy output_parser 管线接线：三形状派发记录都携带结构化结果（owner 复核缺口 1）', async () => {
  // owner 独立复现（2026-10-03）：默认 T1 分支此前不调用 parseAgyOutput——
  // 裸 JSON 靠协调器整段 parse 侥幸完成，包装 JSON/NDJSON 在两次调用后重试耗尽。
  // 修复后合同 output_parser:'agy' → runner structuredParser → 记录 structured_output。
  const root = fixtureRoot('agy-parse');
  const collab = { body: '提案正文', stance: '支持', evidence: ['m1'], reserved_disagreements: '' };
  const script = path.join(root, 'emit.mjs');
  writeFileSync(script, [
    "import { readFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    "const shape = readFileSync(args[0], 'utf8').trim();",
    `const collab = ${JSON.stringify(collab)};`,
    'const line = JSON.stringify(collab);',
    "if (shape === 'bare') console.log(line);",
    "else if (shape === 'wrapped') console.log(JSON.stringify({ conversation_id: 'c-1', model: 'gemini-3.7-flash-high', status: 'SUCCESS', response: line }));",
    "else { console.log(JSON.stringify({ event: 'init', conversation_id: 'c-1' })); console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'c-1', status: 'SUCCESS', response: line } })); }",
    '',
  ].join('\n'), 'utf8');
  const base = buildAgyContract();
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: {
      agy: validateAdapterContract({
        ...base,
        executable: process.execPath,
        arguments: [script, path.join(root, 'shape.txt'), ...base.arguments],
      }),
    },
  });
  for (const shape of ['bare', 'wrapped', 'ndjson'] as const) {
    writeFileSync(path.join(root, 'shape.txt'), shape);
    const record = await pipeline.dispatch(
      { adapter_id: 'agy', prompt: 'long task', real: true, timeout_s: 30 },
      { originOwner: true },
    );
    assert.equal(record.status, 'PASS', `${shape}: 派发应成功`);
    assert.deepEqual(record.structured_output, collab, `${shape}: 派发记录必须携带 parseAgyOutput 提取的结构化结果`);
  }
});

test('real contracts encode Codex effort as a config assignment and enable agy JSON only for schema requests', async () => {
  for (const id of ['codex', 'agy'] as const) {
    const root = fixtureRoot('live-cli-syntax-' + id), script = echoFixture(root);
    const base = id === 'codex' ? buildCodexContract() : buildAgyContract();
    const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'approvals'),
      ledgerPath: path.join(root, 'ledger.jsonl'), contracts: { [id]: withEchoExecutable(base, script) } });
    const { argv } = await dispatchAndCollect(pipeline, id, { restrictTools: true, outputSchema: { type: 'object' } },
      { model_id: id === 'codex' ? 'gpt-5.5' : 'gemini-3.7-flash-high', effort: 'LOW' });
    if (id === 'codex') {
      assert.equal(argv[argv.indexOf('--config') + 1], 'model_reasoning_effort=low');
    } else {
      assert.equal(argv[argv.indexOf('--output-format') + 1], 'json');
      assert.ok(argv.indexOf('--output-format') < argv.indexOf('-p'));
      const plain = await dispatchAndCollect(pipeline, id, { restrictTools: true }, { effort: 'LOW' });
      assert.equal(plain.argv.includes('--output-format'), false, 'plain agy output remains unchanged');
    }
  }
});


test('Codex effort preserves unrelated config overrides and rewrites only its own key', async () => {
  const root = fixtureRoot('codex-config-keys'), script = echoFixture(root);
  const base = buildCodexContract();
  for (const existing of [false, true]) {
    const contract = validateAdapterContract({ ...base, arguments: [...base.arguments,
      '--config', 'web_search=disabled', ...(existing ? ['--config', 'model_reasoning_effort=high'] : [])] });
    const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'approvals'),
      ledgerPath: path.join(root, 'ledger.jsonl'), contracts: { codex: withEchoExecutable(contract, script) } });
    const { argv } = await dispatchAndCollect(pipeline, 'codex', { restrictTools: true }, { effort: 'LOW' });
    const values = argv.flatMap((arg, i) => arg === '--config' ? [argv[i + 1]] : []);
    assert.deepEqual(values, ['web_search=disabled', 'model_reasoning_effort=low']);
  }
});


test('agy actual contract retains denied-action evidence without inventing a structured response', async () => {
  const root = fixtureRoot('agy-denied-result');
  const envelope = { conversation_id: 'fixture', status: 'SUCCESS', response: '',
    denied_actions: [{ action: 'read_file', display_name: 'ViewFile' }] };
  const script = path.join(root, 'denied.mjs');
  writeFileSync(script, 'console.log(' + JSON.stringify(JSON.stringify(envelope)) + ');');
  const base = buildAgyContract();
  const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), contracts: { agy: withEchoExecutable(base, script) } });
  const record = await pipeline.dispatch({ adapter_id: 'agy', prompt: 'fixture', effort: 'HIGH', real: true },
    { originOwner: true, restrictTools: true, outputSchema: { type: 'object' } });
  assert.equal(record.status, 'PASS', 'runner exit 0 is preserved independently of schema semantics');
  assert.equal(record.structured_output, undefined);
  assert.ok(record.stdout_tail?.text.includes('denied_actions'));
  const receiptPath = record.events.find(e => e.payload?.receipt_path)?.payload.receipt_path;
  assert.equal(typeof receiptPath, 'string');
  const receipt = JSON.parse(readFileSync(receiptPath as string, 'utf8'));
  assert.equal(Object.hasOwn(receipt, 'structured_output'), false);
});
