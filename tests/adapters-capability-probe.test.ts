import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/core/capability.ts';
import {
  enumerateCcSwitchProviders,
  runD20CapabilityProbe,
  type ModelProbeResult,
} from '../src/adapters/capability-probe.ts';

// GOAL-003 U4：D20 实测能力注册。
// cc-switch provider 目录只读枚举；凭据文件不打开、不复制、不入任何输出。
// 本测试用 fake lister/probe 验证注册语义与密钥不进 record；真实枚举证据另落盘。

test('cc-switch provider enumeration returns providers or an unavailable reason (never throws)', () => {
  const available = enumerateCcSwitchProviders(() => ['gpt', 'deepseek', 'claude']);
  assert.equal(available.available, true);
  assert.deepEqual(available.providers, ['gpt', 'deepseek', 'claude']);
  const unavailable = enumerateCcSwitchProviders(() => null);
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.providers, []);
  assert.match(unavailable.reason, /unavailable/i);
});

test('D20 probe registers probed models with model/thinking tier fields', async () => {
  const registry = new CapabilityRegistry();
  const probed: ModelProbeResult[] = [
    { model_id: 'gpt-5.6-sol-xhigh', model_tier: 'HIGH', thinking_level: 'XHIGH' },
    { model_id: 'gpt-5.3-light', model_tier: 'LOW', thinking_level: 'LOW' },
  ];
  const records = await runD20CapabilityProbe({
    adapterId: 'cc-switch',
    cliPath: 'C:\\fake\\cc-switch.exe',
    cliVersion: '1.0',
    registry,
    providerLister: () => ['gpt'],
    modelProbe: (provider) => Promise.resolve(provider === 'gpt' ? probed : null),
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].provider, 'gpt');
  assert.equal(records[0].model_tier, 'HIGH');
  assert.equal(records[1].thinking_level, 'LOW');
  assert.equal(records.every((record) => record.identity_source === 'cc-switch-readonly'), true);
  assert.equal(registry.get(records[0].capability_id as string)?.model_id, 'gpt-5.6-sol-xhigh');
});

test('D20 probe records UNKNOWN honestly when a provider probe returns nothing (D13/D20)', async () => {
  const registry = new CapabilityRegistry();
  const records = await runD20CapabilityProbe({
    adapterId: 'cc-switch',
    cliPath: 'C:\\fake\\cc-switch.exe',
    cliVersion: '1.0',
    registry,
    providerLister: () => ['unknown-provider'],
    modelProbe: () => Promise.resolve(null),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, 'UNKNOWN');
  assert.equal(records[0].model_id, 'UNKNOWN');
  assert.equal(records[0].credential_status, 'UNKNOWN');
  assert.equal(records[0].model_tier, 'UNKNOWN');
  assert.equal(records[0].thinking_level, 'UNKNOWN');
});

test('D20 probe registers one honest UNKNOWN record when cc-switch is unavailable', async () => {
  const registry = new CapabilityRegistry();
  const records = await runD20CapabilityProbe({
    adapterId: 'cc-switch',
    cliPath: 'C:\\fake\\cc-switch.exe',
    cliVersion: '1.0',
    registry,
    providerLister: () => null,
    modelProbe: () => Promise.resolve(null),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, 'UNKNOWN');
  assert.equal(records[0].identity_source, 'cc-switch-readonly');
});

test('D20 probe only copies whitelisted fields — credential material never enters capability records', async () => {
  const registry = new CapabilityRegistry();
  const records = await runD20CapabilityProbe({
    adapterId: 'cc-switch',
    cliPath: 'C:\\fake\\cc-switch.exe',
    cliVersion: '1.0',
    registry,
    providerLister: () => ['gpt'],
    modelProbe: () =>
      Promise.resolve([
        {
          model_id: 'gpt-5.6-sol-xhigh',
          model_tier: 'HIGH',
          thinking_level: 'XHIGH',
          api_key: 'sk-should-never-land-in-record',
        } as ModelProbeResult,
      ]),
  });
  assert.equal(records.length, 1);
  const serialized = JSON.stringify(records[0]);
  assert.ok(!serialized.includes('sk-should-never-land-in-record'), 'credential material must be dropped');
  assert.ok(!serialized.includes('api_key'), 'probe-only fields must not be copied');
});
