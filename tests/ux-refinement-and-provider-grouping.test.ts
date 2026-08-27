import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseDshSettings, discoverHarnessGroupedModels, classifyModelTier } from '../src/adapters/live-probe.ts';
import { buildDeepSeekContract } from '../src/adapters/deepseek.ts';
import { renderBoardPage } from '../src/web/page.ts';

describe('UX Refinement, Multi-Source Provider Grouping & Task Auto-Sync Tests', () => {
  test('1. parseDshSettings extracts providers and models safely from yaml', () => {
    const yamlSample = `
agent-default-model:
  provider: poke2api
  model: deepseek-v4-flash
llm-pi-ai:
  providers:
    tbtk:
      displayName: tbtk
      apiKeyEnv: TBTK_API_KEY
      api: openai-responses
      baseURL: https://tbtk.asia/v1
      models:
        - id: deepseek-v4-flash
        - id: deepseek-v4-flash-0731
        - id: deepseek-v4-pro
    poke2api:
      displayName: poke2api
      apiKeyEnv: POKE2API_API_KEY
      api: openai-responses
      baseURL: https://www.poke2api.com/v1
      models:
        - id: deepseek-v4-flash
`;

    const parsed = parseDshSettings(yamlSample);
    assert.strictEqual(parsed.defaultProvider, 'poke2api');
    assert.strictEqual(parsed.defaultModel, 'deepseek-v4-flash');
    assert.ok(parsed.providers.tbtk);
    assert.deepStrictEqual(parsed.providers.tbtk.models, [
      'deepseek-v4-flash',
      'deepseek-v4-flash-0731',
      'deepseek-v4-pro',
    ]);
    assert.ok(parsed.providers.poke2api);
    assert.deepStrictEqual(parsed.providers.poke2api.models, ['deepseek-v4-flash']);
  });

  test('2. discoverHarnessGroupedModels returns grouped models and variants for deepseek-dsh', () => {
    const contract = buildDeepSeekContract('dsh');
    const result = discoverHarnessGroupedModels(contract);

    assert.ok(result.grouped['DeepSeek (官方)']);
    assert.ok(result.grouped['DeepSeek (官方)'].includes('deepseek-v4-flash'));
    assert.ok(result.grouped['DeepSeek (官方)'].includes('deepseek-v4-pro'));

    // 严禁包含 dsh-tui, headless, web 伪模型
    assert.ok(!result.models.includes('dsh-tui'));
    assert.ok(!result.models.includes('headless'));
    assert.ok(!result.models.includes('web'));

    // classifyModelTier should classify configured models as T2_CONFIGURED
    const tier1 = classifyModelTier(contract, 'deepseek-v4-flash');
    assert.strictEqual(tier1, 'T2_CONFIGURED');
    const tier2 = classifyModelTier(contract, 'deepseek-v4-flash-0731');
    assert.strictEqual(tier2, 'T2_CONFIGURED');
    const tier3 = classifyModelTier(contract, 'deepseek-v4-pro');
    assert.strictEqual(tier3, 'T2_CONFIGURED');
  });

  test('3. renderBoardPage renders streamlined collapsible sidebar navbar and task refresh button', () => {
    const html = renderBoardPage('test-caller-token-123');

    // 1. Sidebar navbar (G076 rework2: collapsible, 6 entries after content split)
    assert.ok(html.includes('data-view="chat"'));
    assert.ok(html.includes('data-view="workbench"'));
    assert.ok(html.includes('id="nav-collapse"'));

    // 2. Task pool has manual refresh button and status
    assert.ok(html.includes('id="btn-tasks-refresh"'));
    assert.ok(html.includes('id="tasks-refresh-status"'));

    // 3. Collaboration pair popup exists
    assert.ok(html.includes('id="collab-pair-selector-pop"'));
    assert.ok(html.includes('id="select-primary-dog"'));
    assert.ok(html.includes('id="select-opposing-dog"'));
    assert.ok(html.includes('id="btn-apply-pair"'));

    // 4. View panel IDs are normalized
    assert.ok(html.includes('id="view-debate"'));
    assert.ok(html.includes('id="view-pipeline"'));
    assert.ok(html.includes('id="view-redblue"'));
    assert.ok(html.includes('id="view-tasks"'));

    // 5. Zero sensitive words in HTML
    assert.ok(!/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}/.test(html));
  });
});
