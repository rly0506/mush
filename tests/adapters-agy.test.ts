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
  assert.deepEqual(contract.arguments, [
    '--dangerously-skip-permissions',
    '--model',
    'gemini-3.7-flash-high',
    '-p',
  ]);
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

test('agy contract accepts custom expectedModelId', () => {
  const contract = buildAgyContract('gemini-3.1-pro-high');
  assert.equal(contract.expected_model_id, 'gemini-3.1-pro-high');
  assert.deepEqual(contract.arguments, [
    '--dangerously-skip-permissions',
    '--model',
    'gemini-3.1-pro-high',
    '-p',
  ]);
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
