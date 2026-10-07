import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOnboardingStatus } from '../src/core/onboarding.ts';

test('onboarding separates local setup from supplier quota and API access', () => {
  const status = deriveOnboardingStatus([
    { adapter_id: 'codex', probe_status: 'ONLINE', providers: [
      { id: 'official', name: 'OpenAI Official', is_current: false },
      { id: 'poke', name: 'Poke', is_current: true },
    ] },
  ], [{ id: 'codex', installed: true, configExists: true }]);
  assert.deepEqual(status.local_ready, ['codex']);
  assert.equal(status.channels.length, 2);
  for (const channel of status.channels) {
    assert.equal(channel.availability, 'UNKNOWN', 'harness-level ONLINE cannot certify a provider');
    assert.equal(channel.quota, 'UNKNOWN');
    assert.equal(channel.api_access, 'UNKNOWN');
  }
  assert.equal(status.channels.find((c) => c.provider_id === 'poke')?.active, true);
});

test('uninstalled or unconfigured channels are not ready for a first task', () => {
  const status = deriveOnboardingStatus([
    { adapter_id: 'opencode' }, { adapter_id: 'agy' },
  ], [
    { id: 'opencode', installed: false, configExists: false },
    { id: 'agy', installed: true, configExists: false },
  ]);
  assert.deepEqual(status.local_ready, []);
  assert.equal(status.channels[0].local_status, 'NOT_INSTALLED');
  assert.equal(status.channels[1].local_status, 'CONFIG_MISSING');
  assert.equal(status.zero_config, true);
});
