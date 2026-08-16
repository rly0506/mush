import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterContract } from '../src/adapters/contract.ts';

// GOAL-003 U1：D5 适配器合同 = executable + 参数 + 协议（语言无关）。
// 通道选档依据 docs/capability-probes/harness-landscape-2026-08-16.md：
//   T1 单发 headless（所有犬通用底座）｜ pi-rpc（黄金参照已由 src/core 覆盖）｜
//   stream-json（claude -p --output-format stream-json）。

test('adapter contract validates executable + arguments + protocol + prompt transport', () => {
  const contract = validateAdapterContract({
    adapter_id: 'deepseek-dsh',
    executable: 'dsh',
    arguments: ['--profile', 'headless'],
    protocol: 't1',
    prompt_transport: 'argument',
    expected_provider: 'deepseek',
    expected_model_id: 'deepseek-v4-pro',
  });
  assert.equal(contract.adapter_id, 'deepseek-dsh');
  assert.equal(contract.executable, 'dsh');
  assert.deepEqual(contract.arguments, ['--profile', 'headless']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.expected_provider, 'deepseek');
  assert.equal(contract.expected_model_id, 'deepseek-v4-pro');
});

test('adapter contract rejects missing/blank fields fail-closed', () => {
  const base = {
    adapter_id: 'x',
    executable: 'cmd',
    arguments: [],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'p',
    expected_model_id: 'm',
  };
  assert.throws(() => validateAdapterContract({ ...base, adapter_id: '' }), /adapter_id/i);
  assert.throws(() => validateAdapterContract({ ...base, executable: ' ' }), /executable/i);
  assert.throws(() => validateAdapterContract({ ...base, expected_provider: '' }), /provider/i);
  assert.throws(() => validateAdapterContract({ ...base, expected_model_id: '' }), /model/i);
});

test('adapter contract rejects unknown protocol and prompt transport (selection fail-closed)', () => {
  const base = {
    adapter_id: 'x',
    executable: 'cmd',
    arguments: ['a'],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'p',
    expected_model_id: 'm',
  };
  assert.throws(() => validateAdapterContract({ ...base, protocol: 'websocket' }), /protocol/i);
  assert.throws(() => validateAdapterContract({ ...base, prompt_transport: 'mailbox' }), /prompt_transport/i);
});

test('adapter contract rejects non-string arguments', () => {
  const base = {
    adapter_id: 'x',
    executable: 'cmd',
    arguments: [1],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'p',
    expected_model_id: 'm',
  };
  assert.throws(() => validateAdapterContract(base), /arguments/i);
});

test('GP-22: adapter contract accepts and preserves effort_levels + effort_injection', () => {
  const contract = validateAdapterContract({
    adapter_id: 'claude-code',
    executable: 'claude',
    arguments: ['-p'],
    protocol: 'stream-json',
    prompt_transport: 'argument',
    expected_provider: 'anthropic',
    expected_model_id: 'claude-sonnet-5',
    effort_levels: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'],
    effort_injection: { kind: 'flag', name: '--effort' },
  });
  assert.deepEqual(contract.effort_levels, ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']);
  assert.deepEqual(contract.effort_injection, { kind: 'flag', name: '--effort' });
});

test('GP-22: adapter contract rejects malformed effort_levels / effort_injection fail-closed', () => {
  const base = {
    adapter_id: 'x',
    executable: 'cmd',
    arguments: [],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'p',
    expected_model_id: 'm',
  };
  assert.throws(() => validateAdapterContract({ ...base, effort_levels: [] }), /effort_levels/i);
  assert.throws(() => validateAdapterContract({ ...base, effort_levels: ['', 'LOW'] }), /effort_levels/i);
  assert.throws(() => validateAdapterContract({ ...base, effort_injection: { kind: 'auto' } }), /effort_injection/i);
  assert.throws(() => validateAdapterContract({ ...base, effort_injection: { kind: 'flag', name: ' ' } }), /effort_injection/i);
});
