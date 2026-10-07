import type { TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function installCcSwitchFixture(t: TestContext): void {
  const fixtures = fileURLToPath(new URL('../../.test-fixtures/ccswitch/', import.meta.url));
  mkdirSync(fixtures, { recursive: true });
  const home = mkdtempSync(path.join(fixtures, 'home-'));
  const config = path.join(home, '.cc-switch');
  mkdirSync(config);
  const db = new DatabaseSync(path.join(config, 'cc-switch.db'));
  try {
    db.exec('CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, category TEXT, is_current INTEGER, settings_config TEXT)');
    const insert = db.prepare('INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('claude-fixture', 'claude', 'Claude Fixture', 'custom', 1, JSON.stringify({ model: 'claude-sonnet-4-6' }));
    insert.run('codex-fixture', 'codex', 'OpenAI Fixture', 'custom', 1, JSON.stringify({ model: 'gpt-5.6-sol' }));
  } finally {
    db.close();
  }
  writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ currentProviderClaude: 'claude-fixture', currentProviderCodex: 'codex-fixture' }));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
}
