import test from 'node:test';
import assert from 'node:assert/strict';
import { getHarnessHierarchy, getModelThinkingSpec, probeHttpModels } from '../src/adapters/live-probe.ts';
import { renderBoardPage } from '../src/web/page.ts';
import { renderEloRankingsHtml } from '../src/web/ui/views/elo-view.ts';

test('Harness -> Provider -> Model 3-tier Hierarchy Tests', async (t) => {
  await t.test('1. getHarnessHierarchy returns structured providers for all harnesses', () => {
    const list = ['claude-code', 'codex', 'deepseek-dsh', 'opencode', 'agy', 'kimi-code', 'zcode', 'pi'];
    for (const id of list) {
      const h = getHarnessHierarchy(id);
      assert.equal(h.harness_id, id);
      assert.ok(Array.isArray(h.providers));
      assert.ok(h.providers.length > 0, `Harness ${id} should have at least 1 provider`);
      
      // Each provider must have id, name, models, is_current
      for (const p of h.providers) {
        assert.ok(typeof p.id === 'string' && p.id.length > 0);
        assert.ok(typeof p.name === 'string' && p.name.length > 0);
        assert.ok(Array.isArray(p.models) && p.models.length > 0);
        assert.ok(typeof p.is_current === 'boolean');
      }

      // First provider should be the active provider if any is active
      const hasActive = h.providers.some(p => p.is_current);
      if (hasActive) {
        assert.equal(h.providers[0].is_current, true, `${id} active provider should be first`);
      }
    }
  });

  await t.test('2. Specific Harness provider checks', () => {
    const agyH = getHarnessHierarchy('agy');
    const oauthP = agyH.providers.find((p) => p.id === 'oauth');
    assert.ok(oauthP?.models.includes('claude-sonnet-4-6'), 'AGY OAuth should include claude-sonnet-4-6');
    assert.ok(oauthP?.models.includes('claude-opus-4-6-thinking'), 'AGY OAuth should include claude-opus-4-6-thinking');
    assert.ok(oauthP?.models.includes('gpt-oss-120b'), 'AGY OAuth should include gpt-oss-120b');
    assert.ok(oauthP?.models.includes('gemini-3.7-flash-high'), 'AGY OAuth should include gemini-3.7-flash-high');

    const dshH = getHarnessHierarchy('deepseek-dsh');
    assert.ok(dshH.providers.some(p => p.id === 'poke2api' || p.id === 'official'));

    const zcodeH = getHarnessHierarchy('zcode');
    assert.ok(zcodeH.providers.some(p => p.models.includes('glm-5.3') || p.models.includes('glm-4-plus')), 'ZCode should include glm-5.3');

    const codexH = getHarnessHierarchy('codex');
    assert.ok(codexH.providers.some(p => p.models.includes('gpt-5.6-sol')), 'Codex should include gpt-5.6-sol');

    const kimiH = getHarnessHierarchy('kimi-code');
    assert.ok(kimiH.providers.some(p => p.models.includes('kimi-k1.5') || p.models.includes('tbtk-kimi-k3')));
  });

  await t.test('3. Thinking Spec accuracy for Codex and GLM', () => {
    const codexSpec = getModelThinkingSpec('gpt-5.6-sol');
    assert.equal(codexSpec.type, 'categorical');
    assert.equal(codexSpec.default_value, 'max');
    assert.ok(codexSpec.options?.some(o => o.value === 'ultra'), 'Codex must support ultra effort');
    assert.ok(codexSpec.options?.some(o => o.value === 'xhigh'), 'Codex must support xhigh effort');

    const glmSpec = getModelThinkingSpec('glm-5.3');
    assert.equal(glmSpec.type, 'categorical');
    assert.equal(glmSpec.default_value, 'max');
    assert.ok(glmSpec.options?.some(o => o.value === 'max'), 'GLM-5.3 must support max reasoning');
  });

  await t.test('4. Board page HTML renders provider selector elements', () => {
    const html = renderBoardPage();

    assert.ok(html.includes('id="chat-head-provider"'), 'Page must contain chat-head-provider select');
    assert.ok(html.includes('id="dispatch-provider"'), 'Page must contain dispatch-provider select');
    assert.ok(html.includes('id="chat-probe-btn"'), 'Page must contain chat-probe-btn');
    assert.ok(html.includes('id="dispatch-probe-btn"'), 'Page must contain dispatch-probe-btn');
    assert.ok(html.includes('harness-tree-card'), 'Page must contain 3-tier harness-tree-card styles');
    assert.ok(html.includes('provider-card-item'), 'Page must contain provider-card-item styles');
  });

  await t.test('5. ELO view renders 3-tier columns and harness filter bar', () => {
    const eloHtml = renderEloRankingsHtml();
    assert.ok(eloHtml.includes('id="elo-harness-filters"'), 'ELO view must have harness filter bar');
    assert.ok(eloHtml.includes('<th>Harness 犬系</th>'), 'ELO table must have Harness column');
    assert.ok(eloHtml.includes('<th>Provider 渠道</th>'), 'ELO table must have Provider column');
    assert.ok(eloHtml.includes('<th>Model 变体</th>'), 'ELO table must have Model column');
  });

  await t.test('6. probeHttpModels exists and fails safely on invalid url', async () => {
    const res = await probeHttpModels('http://127.0.0.1:99999/invalid');
    assert.equal(res, null);
  });
});
