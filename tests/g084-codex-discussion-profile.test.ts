import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCodexContract } from '../src/adapters/codex.ts';
import { buildCodexDiscussionProfile, verifyCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
const root = () => mkdtempSync(path.resolve('.test-fixtures/g084-closed-profile-'));
const catalog = () => ({ models: [
  { slug: 'gpt-5.5', apply_patch_tool_type: 'freeform', shell_type: 'unified_exec', base_instructions: 'fixture' },
  { slug: 'gpt-5.6-sol', apply_patch_tool_type: 'freeform', shell_type: 'unified_exec', base_instructions: 'other' },
] });
function make() { return buildCodexDiscussionProfile({ directory: root(), contract: buildCodexContract(), modelId: 'gpt-5.5', catalog: catalog(), nativeVersion: 'codex-cli 0.156.1', mcpNames: ['probe', 'other'] }); }
test('closed profile freezes native catalog without changing model/provider/defaults', () => {
  const base = buildCodexContract(), input = catalog();
  const profile = buildCodexDiscussionProfile({ directory: root(), contract: base, modelId: 'gpt-5.5', catalog: input, nativeVersion: 'codex-cli 0.156.1', mcpNames: ['probe', 'other'] });
  assert.equal(profile.contract.adapter_id, base.adapter_id);
  assert.equal(profile.contract.expected_provider, base.expected_provider);
  assert.equal(profile.contract.expected_model_id, base.expected_model_id);
  assert.deepEqual(profile.contract.arguments, base.arguments);
  const written = JSON.parse(readFileSync(profile.catalogPath, 'utf8'));
  assert.equal(written.models[0].slug, 'gpt-5.5');
  assert.equal(written.models[0].apply_patch_tool_type, null);
  assert.deepEqual(written.models[1], input.models[1]);
  assert.equal(input.models[0].apply_patch_tool_type, 'freeform');
  assert.ok(profile.catalogPath.includes(profile.catalogSha256));
  for (const setting of ['features.shell_tool=false', 'features.view_image=false', 'features.goals=false', 'features.tool_suggest=false', 'mcp_servers.probe.enabled=false']) {
    assert.ok(profile.contract.tool_restriction_args?.includes(setting), setting);
  }
});
test('profile guard rejects modified files, enabled MCP and runtime/model drift', () => {
  const p = make();
  const observed = { nativeVersion: p.nativeVersion, modelId: 'gpt-5.5', mcps: [{ name: 'probe', enabled: false }] };
  assert.doesNotThrow(() => verifyCodexDiscussionProfile(p, observed));
  assert.throws(() => verifyCodexDiscussionProfile(p, { ...observed, modelId: 'gpt-5.6-sol' }), /model/);
  assert.throws(() => verifyCodexDiscussionProfile(p, { ...observed, nativeVersion: 'different-version' }), /version/);
  assert.throws(() => verifyCodexDiscussionProfile(p, { ...observed, mcps: [{ name: 'new-server', enabled: true }] }), /MCP/);
  writeFileSync(p.catalogPath, '{}');
  assert.throws(() => verifyCodexDiscussionProfile(p, observed), /hash/);
});
test('invalid model/channel/MCP names are rejected before assets are created', () => {
  const options = { directory: root(), contract: buildCodexContract(), modelId: 'gpt-5.5', catalog: catalog(), nativeVersion: 'codex-cli 0.156.1', mcpNames: ['probe'] };
  assert.throws(() => buildCodexDiscussionProfile({ ...options, modelId: 'unapproved' }), /model/);
  assert.throws(() => buildCodexDiscussionProfile({ ...options, contract: { ...options.contract, adapter_id: 'other' } }), /codex/);
  assert.throws(() => buildCodexDiscussionProfile({ ...options, mcpNames: ['x.enabled=true'] }), /MCP/);
  assert.throws(() => buildCodexDiscussionProfile({ ...options, catalog: { models: [] } }), /catalog/);
});
