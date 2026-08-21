import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCcSwitchProviders, getHarnessDoctorReport, discoverHarnessGroupedModels } from '../src/adapters/live-probe.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { renderBoardPage } from '../src/web/page.ts';

test('Harness Multi-Provider & Doctor Suite', async (t) => {
  await t.test('1. parseCcSwitchProviders extracts real third-party providers from cc-switch.db', () => {
    const claudeRes = parseCcSwitchProviders('claude');
    assert.ok(claudeRes.models.length > 0, 'Should find claude models');
    const groupKeys = Object.keys(claudeRes.grouped);
    assert.ok(groupKeys.some(k => k.includes('everyapi claude') || k.includes('Claude')), 'Should include everyapi or official');

    const codexRes = parseCcSwitchProviders('codex');
    assert.ok(codexRes.models.length > 0, 'Should find codex models');
    const codexKeys = Object.keys(codexRes.grouped);
    assert.ok(codexKeys.some(k => k.includes('tbtk') || k.includes('OpenAI')), 'Should include tbtk or OpenAI');
  });

  await t.test('2. getHarnessDoctorReport discovers all 8 harnesses and their recipes', () => {
    const report = getHarnessDoctorReport();
    assert.equal(report.length, 8, 'Should cover all 8 major harnesses');
    const ids = report.map(r => r.id);
    assert.ok(ids.includes('claude-code'));
    assert.ok(ids.includes('codex'));
    assert.ok(ids.includes('deepseek-dsh'));
    assert.ok(ids.includes('opencode'));
    assert.ok(ids.includes('pi'));
    assert.ok(ids.includes('kimi-code'));
    assert.ok(ids.includes('zcode'));
    assert.ok(ids.includes('agy'));

    for (const entry of report) {
      assert.ok(entry.installCmd, `Harness ${entry.id} must have installCmd`);
      assert.ok(entry.updateCmd, `Harness ${entry.id} must have updateCmd`);
      assert.ok(['READY', 'CONFIG_MISSING', 'NOT_INSTALLED'].includes(entry.status));
    }
  });

  await t.test('3. roster contains real unified agy and excludes pseudo agy fragments', () => {
    const pipeline = new DispatchPipeline({
      workspaceRoot: 'D:/mush',
      approvalRoot: 'D:/mush/goals/receipts/approval-requests',
      approvalRequestRoot: 'D:/mush/goals/receipts/approval-requests',
      approvalTokensPath: 'D:/mush/runtime/approval-tokens',
      ledgerPath: 'D:/mush/runtime/ledger.jsonl',
    });

    const roster = pipeline.roster();
    const adapterIds = roster.map(r => r.adapter_id);

    assert.ok(!adapterIds.includes('agy-claude'), 'agy-claude must NOT appear in roster');
    assert.ok(!adapterIds.includes('agy-flash'), 'agy-flash must NOT appear in roster');
    assert.ok(!adapterIds.includes('agy-pro'), 'agy-pro must NOT appear in roster');
    assert.ok(adapterIds.includes('agy'), 'Unified agy must appear in roster');
  });

  await t.test('4. renderBoardPage renders doctor tool button and excludes head-dog from candidate list', () => {
    const html = renderBoardPage({
      snapshot: {
        generated_at_utc: new Date().toISOString(),
        actors: [],
        epochs: [],
        approvals: [],
        roster: [
          { adapter_id: 'head-dog', expected_provider: 'deepseek', expected_model_id: 'v4', role: 'head', verified: true },
          { adapter_id: 'claude-code', expected_provider: 'anthropic', expected_model_id: 'sonnet-5', role: 'executor', verified: true },
          { adapter_id: 'agy-claude', expected_provider: 'google', expected_model_id: 'sonnet-4', role: 'executor', verified: true },
          { adapter_id: 'agy', expected_provider: 'google', expected_model_id: 'gemini-2.5-pro', role: 'executor', verified: true },
        ],
      },
      workspaces: [],
      budget: null,
      trackedDispatches: [],
    });

    assert.ok(html.includes('btn-harness-doctor'), 'Must render harness doctor button');
    assert.ok(!html.includes('HEAD_WHITELIST = { \'head-dog\': 1'), 'Must not whitelist head-dog');
    assert.ok(!html.includes('password') && !html.includes('api_key') && !html.includes('secret'), 'Zero credential leak');
  });
});
