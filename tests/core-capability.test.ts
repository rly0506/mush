import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityRegistry,
  normalizeCapabilityRecord,
  redactSecretValues,
} from '../src/core/capability.ts';

// PS 源追溯（黄金参照，只读）：
//   BridgeCapabilityRegistry.psm1 L98-L116
//     字段表：adapter_id…quota_value/quota_checked_at/checked_at；空值一律 UNKNOWN；
//     confidence 大写；supported_roles 过滤空白
//   BridgeCapabilityRegistry.psm1 L95（ConvertTo-BridgeCapabilitySafeValue：密钥值脱敏）
//   BridgeCapabilityRegistry.psm1 L243-L248（按 adapter 选择、credential_status 必须 PRESENT）
//   D20：capability 含 model/思考强度档位字段，供派发按任务复杂度路由（fake-provider 结构测试）

test('capability record normalizes blank fields to UNKNOWN and uppercases confidence (PS L99-L109)', () => {
  const record = normalizeCapabilityRecord({ adapter_id: '', model_id: '  ', confidence: 'high', supported_roles: ['backend_executor', '  ', ''] });
  assert.equal(record.adapter_id, 'UNKNOWN');
  assert.equal(record.model_id, 'UNKNOWN');
  assert.equal(record.confidence, 'HIGH');
  assert.deepEqual(record.supported_roles, ['backend_executor']);
});

test('quota fields default to UNKNOWN/null and become ISO timestamps when provided (PS L110-L114)', () => {
  const absent = normalizeCapabilityRecord({});
  assert.equal(absent.quota_value, 'UNKNOWN');
  assert.equal(absent.quota_unit, 'UNKNOWN');
  assert.equal(absent.quota_checked_at, null);
  assert.equal(typeof absent.checked_at, 'string');
  assert.ok(!Number.isNaN(Date.parse(absent.checked_at)));
  const provided = normalizeCapabilityRecord({
    quota_value: 4,
    quota_unit: 'requests',
    quota_checked_at: new Date('2026-08-17T00:00:00.000Z'),
  });
  assert.equal(provided.quota_value, 4);
  assert.equal(provided.quota_checked_at, '2026-08-17T00:00:00.000Z');
});

test('secret values are redacted from capability metadata before storage (PS L95)', () => {
  const redacted = redactSecretValues(
    { nested: { token: 'sk-secret-value' }, list: ['ok', 'PASSWORD secret'] },
    ['sk-secret-value', 'PASSWORD secret'],
  );
  assert.equal(redacted.nested.token, '[REDACTED]');
  assert.equal(redacted.list[1], '[REDACTED]');
  assert.equal(redacted.list[0], 'ok');
});

test('registry assigns a stable 32-hex capability_id and retrieves by it', () => {
  const registry = new CapabilityRegistry();
  const record = normalizeCapabilityRecord({
    adapter_id: 'pi',
    provider: 'deepseek',
    model_id: 'deepseek-v4-pro',
    credential_status: 'PRESENT',
    model_tier: 'HIGH',
    thinking_level: 'XHIGH',
  });
  const registered = registry.register(record);
  assert.match(registered.capability_id, /^[0-9A-F]{32}$/i);
  assert.equal(registry.get(registered.capability_id)?.model_id, 'deepseek-v4-pro');
  assert.equal(registry.get(registered.capability_id)?.model_tier, 'HIGH');
  assert.equal(registry.get(registered.capability_id)?.thinking_level, 'XHIGH');
});

test('dispatch selection is fail-closed: credential must be PRESENT and runtime identity exact (PS L243-L248 + wrapper L351-L352)', () => {
  const registry = new CapabilityRegistry();
  const present = registry.register(
    normalizeCapabilityRecord({
      adapter_id: 'pi',
      provider: 'deepseek',
      model_id: 'deepseek-v4-pro',
      credential_status: 'PRESENT',
    }),
  );
  assert.doesNotThrow(() =>
    registry.selectForDispatch({
      adapterId: 'pi',
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
      expectedProvider: 'deepseek',
      expectedModelId: 'deepseek-v4-pro',
    }),
  );
  const absent = registry.register(
    normalizeCapabilityRecord({
      adapter_id: 'pi',
      provider: 'deepseek',
      model_id: 'deepseek-chat',
      credential_status: 'ABSENT',
    }),
  );
  assert.throws(
    () =>
      registry.selectForDispatch({
        adapterId: 'pi',
        provider: 'deepseek',
        modelId: 'deepseek-chat',
        expectedProvider: 'deepseek',
        expectedModelId: 'deepseek-chat',
      }),
    /credential/i,
  );
  assert.throws(
    () =>
      registry.selectForDispatch({
        adapterId: 'pi',
        provider: 'deepseek',
        modelId: 'wrong-model',
        expectedProvider: 'deepseek',
        expectedModelId: 'deepseek-v4-pro',
      }),
    /identity|model/i,
  );
  assert.equal(present.capability_id.length, 32);
});

test('fake provider probe registers observed models with tiers; UNKNOWN is recorded honestly (D20 structure)', () => {
  const catalog = [
    { model_id: 'gpt-5.6-sol-xhigh', model_tier: 'HIGH', thinking_level: 'XHIGH' },
    { model_id: 'gpt-5.3-light', model_tier: 'LOW', thinking_level: 'LOW' },
  ];
  const registry = new CapabilityRegistry();
  const probed = registry.probeFakeProvider({
    adapterId: 'fake-cli',
    provider: 'gpt',
    cliPath: 'C:\\fake\\cli.exe',
    cliVersion: '1.0',
    credentialStatus: 'PRESENT',
    catalog,
  });
  assert.equal(probed.length, 2);
  assert.equal(probed[0].model_tier, 'HIGH');
  assert.equal(probed[1].thinking_level, 'LOW');
  const unknown = registry.probeFakeProvider({
    adapterId: 'fake-cli',
    provider: 'unknown-provider',
    cliPath: 'C:\\fake\\cli.exe',
    cliVersion: '1.0',
    credentialStatus: 'UNKNOWN',
    catalog: null,
  });
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].provider, 'UNKNOWN');
  assert.equal(unknown[0].model_id, 'UNKNOWN');
  assert.equal(unknown[0].credential_status, 'UNKNOWN');
});
