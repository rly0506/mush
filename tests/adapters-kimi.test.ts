import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKimiContract } from '../src/adapters/kimi.ts';

// GOAL-013 U3：kimi-code 适配器 T1 合同（kimi -p）。
// 通道依据 docs/capability-probes/kimi-2026-08-17.md + 本机 kimi --help。

test('kimi-code contract is T1 kimi -p with prompt as final argument and executor role', () => {
  const contract = buildKimiContract();
  assert.equal(contract.adapter_id, 'kimi-code');
  assert.equal(contract.executable, 'kimi');
  assert.deepEqual(contract.arguments, ['-p']);
  assert.equal(contract.protocol, 't1');
  assert.equal(contract.prompt_transport, 'argument');
  assert.equal(contract.role, 'executor');
  assert.equal(contract.expected_model_id, 'UNKNOWN');
});

test('kimi-code declares thinking effort low/medium/high with none injection placeholder', () => {
  const contract = buildKimiContract();
  assert.deepEqual(contract.effort_levels, ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(contract.effort_injection, { kind: 'none' });
});
