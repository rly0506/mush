import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCodexContract } from '../src/adapters/codex.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
function fixture() {
  const root = mkdtempSync(path.resolve('.test-fixtures/g084-profile-gate-'));
  const profile = buildCodexDiscussionProfile({ directory: path.join(root, 'profile'), contract: buildCodexContract(), modelId: 'gpt-5.5', nativeVersion: 'fixture-version', mcpNames: ['probe'], catalog: { models: [{ slug: 'gpt-5.5', apply_patch_tool_type: 'freeform' }] } });
  return { root, profile };
}
test('native profile integrity and metadata gates run before budget and model execution', async () => {
  for (const scenario of ['changed-catalog', 'enabled-mcp', 'changed-version', 'wrong-model']) {
    const { root, profile } = fixture(); let budgets = 0, runs = 0;
    const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger'), contracts: { codex: profile.contract },
      masterGate: { admit: () => { budgets++; throw new Error('budget must not run'); } },
      codexDiscussionInspector: async () => ({ nativeVersion: scenario === 'changed-version' ? 'other-version' : profile.nativeVersion, mcps: [{ name: 'probe', enabled: scenario === 'enabled-mcp' }] }),
      runAdapter: async () => { runs++; throw new Error('model must not run'); } });
    if (scenario === 'changed-catalog') writeFileSync(profile.catalogPath, '{}');
    await assert.rejects(() => pipeline.dispatch({ adapter_id: 'codex', model_id: scenario === 'wrong-model' ? 'gpt-5.6-sol' : 'gpt-5.5', prompt: 'fixture', real: true }, { restrictTools: true }), /catalog hash|MCP|version|profile model/);
    assert.equal(budgets, 0); assert.equal(runs, 0);
  }
});
test('prepared profile defers native inspection; approved replay rechecks frozen assets', async () => {
  const { root, profile } = fixture(); let checks = 0, runs = 0;
  const pipeline = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), ledgerPath: path.join(root, 'ledger'), contracts: { codex: profile.contract },
    codexDiscussionInspector: async () => { checks++; return { nativeVersion: profile.nativeVersion, mcps: [] }; },
    runAdapter: async () => { runs++; return { exitCode: 0, stdout: 'fixture', stderr: '', timedOut: false, childKilled: false }; } });
  const pending = await pipeline.dispatch({ adapter_id: 'codex', model_id: 'gpt-5.5', prompt: 'fixture', real: true }, { prepareOnly: true, restrictTools: true });
  assert.equal(pending.status, 'BLOCKED_WAITING_OWNER'); assert.equal(checks, 0);
  pipeline.grantApprovalToken(pending.dispatch_id);
  writeFileSync(profile.catalogPath, '{}');
  await assert.rejects(() => pipeline.rerun(pending.dispatch_id, { real: true, approved_via: pending.dispatch_id }), /catalog hash/);
  assert.equal(checks, 0); assert.equal(runs, 0);
});
