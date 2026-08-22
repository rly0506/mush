import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_PROVIDER_COLUMNS,
  buildCapabilityRegistry,
  probeCcSwitch,
  type CcSwitchProbeResult,
} from '../src/adapters/ccswitch-probe.ts';
import { buildContracts, type RegistryFile } from '../src/web/dispatch.ts';

// GOAL-010：cc-switch 只读全量模型枚举（D20 落地）。
// 红线：绝不读取 providers.settings_config（密钥列）——白名单硬编码并测试断言。

function makeFakeDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, category TEXT, is_current INTEGER, settings_config TEXT);
    CREATE TABLE proxy_request_logs (id INTEGER, app_type TEXT, provider_id TEXT, request_model TEXT, created_at TEXT);
    CREATE TABLE model_pricing (model_id TEXT, display_name TEXT);
    INSERT INTO providers VALUES
      ('claude-main','claude','Claude 主用','llm',1,'{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-secret-a"}}'),
      ('codex-main','codex','Codex 主用','llm',1,'{"env":{"OPENAI_API_KEY":"sk-secret-b"}}'),
      ('grok','grokbuild','Grok','llm',0,'{"env":{"XAI_API_KEY":"sk-secret-c"}}');
    INSERT INTO proxy_request_logs VALUES
      (1,'claude','claude-main','claude-sonnet-5','2026-08-17T01:00:00Z'),
      (2,'claude','claude-main','claude-opus-4-8','2026-08-17T01:01:00Z'),
      (3,'codex','codex-main','gpt-5.6-codex','2026-08-17T01:02:00Z');
    INSERT INTO model_pricing VALUES ('claude-sonnet-5','Sonnet 5'),('gpt-5.6-codex','GPT-5.6 Codex');
  `);
  db.close();
}

function fixtureDb(): string {
  const dir = path.resolve(process.cwd(), '.test-fixtures', 'ccswitch-probe');
  mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, `fake-${process.pid}-${Date.now()}.db`);
  makeFakeDb(dbPath);
  return dbPath;
}

test('provider column whitelist never includes the credential-bearing settings_config', () => {
  assert.ok(ALLOWED_PROVIDER_COLUMNS.includes('app_type'));
  assert.ok(ALLOWED_PROVIDER_COLUMNS.includes('name'));
  // GOAL-069：宽化为 readonly string[] 以表达“密钥列不在白名单”的负向断言。
  const columns: readonly string[] = ALLOWED_PROVIDER_COLUMNS;
  assert.equal(columns.includes('settings_config'), false);
});

test('probe enumerates providers and recent models without touching secret columns', () => {
  const dbPath = fixtureDb();
  const result = probeCcSwitch(dbPath);
  assert.equal(result.providers.length, 3);
  assert.equal(result.providers.find((p) => p.app_type === 'claude')?.name, 'Claude 主用');
  assert.equal(result.recentModels.length, 3);
  assert.ok(result.recentModels.some((m) => m.model === 'claude-opus-4-8'));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('sk-secret-a'));
  assert.ok(!serialized.includes('sk-secret-b'));
  assert.ok(!serialized.includes('settings_config'));
});

test('registry groups models per adapter with cc-switch source and verified=false until nonce', () => {
  const dbPath = fixtureDb();
  const registry = buildCapabilityRegistry(probeCcSwitch(dbPath), '2026-08-17T02:00:00.000Z');
  const claude = registry.adapters.find((a) => a.adapter_id === 'claude-code');
  const codex = registry.adapters.find((a) => a.adapter_id === 'codex');
  assert.deepEqual([...(claude?.models ?? [])].sort(), ['claude-opus-4-8', 'claude-sonnet-5']);
  assert.deepEqual(codex?.models, ['gpt-5.6-codex']);
  assert.equal(claude?.source, 'cc-switch');
  assert.equal(claude?.verified, false);
});

test('contracts synthesize variants from registry; missing registry falls back to static contracts', () => {
  const dbPath = fixtureDb();
  const registry = buildCapabilityRegistry(probeCcSwitch(dbPath), '2026-08-17T02:00:00.000Z');
  const withRegistry = buildContracts(registry as unknown as RegistryFile);
  const claudeContract = withRegistry['claude-code'];
  assert.ok(claudeContract.variants?.includes('claude-opus-4-8'));
  assert.ok(claudeContract.variants?.includes('claude-sonnet-5'));
  const codexContract = withRegistry.codex;
  assert.ok(codexContract.variants?.includes('gpt-5.6-codex'));
  const fallback = buildContracts(undefined);
  assert.ok(fallback['claude-code'].expected_model_id.length > 0);
  assert.ok(fallback.codex !== undefined);
});

test('registry file round-trips without any key/token material (desensitization check)', () => {
  const dir = path.resolve(process.cwd(), '.test-fixtures', 'ccswitch-probe');
  const dbPath = fixtureDb();
  const registry = buildCapabilityRegistry(probeCcSwitch(dbPath), '2026-08-17T02:00:00.000Z');
  const outPath = path.join(dir, `registry-${process.pid}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(registry) + '\n', 'utf8');
  const text = readFileSync(outPath, 'utf8');
  assert.ok(!/sk-|token|api_key/i.test(text), 'registry must be free of credential-like material');
  assert.ok(existsSync(outPath));
});
