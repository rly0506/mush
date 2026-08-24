import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexContract, evaluateCodexIdentity, parseCodexJsonlOutput } from '../src/adapters/codex.ts';
import { buildOpencodeContract, evaluateOpencodeIdentity, normalizeOpencodeEvents, parseOpencodeEvents, parseOpencodeOutput } from '../src/adapters/opencode.ts';

// GOAL-008 U1：codex / opencode T1 合同与身份证据解析（fake/录制级）。
// 通道依据：docs/capability-probes/harness-landscape-2026-08-16.md
//   codex exec（非交互 T1）；opencode run（headless T1，ACP/HTTP 后续升级项不实现）。
// 凭据边界：只调 executable，mush 不注入/不读取/不存储任何密钥（cc-switch profile 自理）。

test('codex contract is T1 codex exec with prompt as final argument', () => {
  const contract = buildCodexContract();
  assert.equal(contract.adapter_id, 'codex');
  assert.equal(contract.executable, 'codex');
  assert.deepEqual(contract.arguments, ['exec']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.expected_model_id, 'UNKNOWN');
});

test('opencode contract is T1 opencode run with -m free default model injection (GOAL-070)', () => {
  const contract = buildOpencodeContract();
  assert.equal(contract.adapter_id, 'opencode');
  assert.equal(contract.executable, 'opencode');
  assert.deepEqual(contract.arguments, ['run', '--thinking', '--format', 'json', '-m', 'opencode/x-preview-f-free']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.expected_model_id, 'opencode/x-preview-f-free');
  assert.equal(contract.output_format, 'ndjson-events', 'GOAL-075 切片2：结构化事件流声明');
  assert.equal(contract.cwd_flag, '--dir');
  assert.equal(contract.model_flag, '-m');
  assert.ok(contract.variants?.includes('opencode/x-preview-f-free'));
  assert.equal(contract.effort_injection?.name, '--variant');
});

test('codex JSONL output parser extracts model and text fields', () => {
  const text = [
    '{"type":"event","payload":{"model":"gpt-5.6-codex","content":"thinking"}}',
    '{"type":"turn","payload":{"model":"gpt-5.6-codex","text":"fixture answer"}}',
  ].join('\n');
  const parsed = parseCodexJsonlOutput(text);
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.modelId, 'gpt-5.6-codex');
  assert.equal(parsed.text, 'fixture answer');
});

test('opencode output parser extracts model and text fields (JSON or plain)', () => {
  const parsed = parseOpencodeOutput('{"model":"anthropic/claude-sonnet-4-5","text":"fixture answer"}');
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.modelId, 'anthropic/claude-sonnet-4-5');
  assert.equal(parsed.text, 'fixture answer');
  const plain = parseOpencodeOutput('plain text without machine identity');
  assert.equal(plain.parsed, false);
  assert.equal(plain.modelId, 'UNKNOWN');
  assert.equal(plain.text, 'plain text without machine identity');
});

test('identity stays UNKNOWN without machine-readable model proof (D13)', () => {
  assert.equal(evaluateCodexIdentity('{"model":"gpt-5.6-codex"}').proven, true);
  assert.equal(evaluateCodexIdentity('no json here').proven, false);
  assert.equal(evaluateOpencodeIdentity('{"model":"anthropic/claude-sonnet-4-5"}').modelId, 'anthropic/claude-sonnet-4-5');
  assert.equal(evaluateOpencodeIdentity('no json here').modelId, 'UNKNOWN');
});

test('GOAL-075 切片2：parseOpencodeEvents 解析实测 NDJSON 事件流（探针夹具）', () => {
  const fixture = [
    '{"type":"step_start","timestamp":1787573414876,"sessionID":"ses_fcc5299c8ffeHTwSpqem5ibY5Q","part":{"id":"prt_a","messageID":"msg_x","sessionID":"ses_fcc5299c8ffeHTwSpqem5ibY5Q","type":"step-start"}}',
    '{"type":"text","timestamp":1787573423392,"sessionID":"ses_fcc5299c8ffeHTwSpqem5ibY5Q","part":{"id":"prt_b","type":"text","text":"1073","time":{"start":1,"end":2}}}',
    '{"type":"step_finish","timestamp":1787573423690,"sessionID":"ses_fcc5299c8ffeHTwSpqem5ibY5Q","part":{"reason":"stop","tokens":{"total":39068,"input":24,"output":4,"reasoning":0,"cache":{"write":0,"read":39040}},"cost":0}}',
  ].join('\n');
  const ev = parseOpencodeEvents(fixture);
  assert.equal(ev.isEvents, true);
  assert.equal(ev.text, '1073');
  assert.equal(ev.sessionId, 'ses_fcc5299c8ffeHTwSpqem5ibY5Q');
  assert.deepEqual(ev.tokens, { input: 24, output: 4, reasoning: 0, cache_read: 39040, cache_write: 0 });

  // 普通 JSON 回答/纯文本不误判为事件流
  assert.equal(parseOpencodeEvents('{"ok":true,"calc":611}').isEvents, false);
  assert.equal(parseOpencodeEvents('pong').isEvents, false);
});

test('GOAL-075 切片2：normalizeOpencodeEvents 思维前置 + 真实 token 计量', () => {
  const raw = [
    '{"type":"step_start","sessionID":"ses_abc","part":{"type":"step-start"}}',
    '{"type":"reasoning","sessionID":"ses_abc","part":{"type":"reasoning","text":"37*29 = 37*30 - 37 = 1073"}}',
    '{"type":"text","sessionID":"ses_abc","part":{"type":"text","text":"1073"}}',
    '{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop","tokens":{"input":24,"output":9,"reasoning":7,"cache":{"read":39040,"write":0}}}}',
  ].join('\n');
  const n = normalizeOpencodeEvents(raw, 'opencode/x-preview-f-free');
  assert.match(n.thinking, /37\*30 - 37/);
  assert.equal(n.text, '1073');
  assert.equal(n.sessionId, 'ses_abc');
  assert.ok(n.telemetry);
  assert.equal(n.telemetry?.input_tokens, 24);
  assert.equal(n.telemetry?.output_tokens, 9);
  assert.equal(n.telemetry?.cache_read_tokens, 39040);
});
