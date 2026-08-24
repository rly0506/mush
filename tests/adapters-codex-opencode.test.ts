import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexContract, evaluateCodexIdentity, parseCodexJsonlOutput } from '../src/adapters/codex.ts';
import { buildOpencodeContract, evaluateOpencodeIdentity, parseOpencodeOutput } from '../src/adapters/opencode.ts';

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
  assert.deepEqual(contract.arguments, ['run', '--thinking', '-m', 'opencode/x-preview-f-free']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.expected_model_id, 'opencode/x-preview-f-free');
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
