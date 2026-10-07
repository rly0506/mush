import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

test('G083: both npm test modes preload an isolated environment', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const name of ['test', 'test:isolated']) {
    assert.match(pkg.scripts[name], /--import[= ]\.\/tests\/setup\.ts/, name);
  }
});

test('G083: tests keep home and the master ledger inside a process-specific fixture', () => {
  const ledger = process.env.MUSH_MASTER_LEDGER_PATH;
  assert.ok(ledger, 'test setup must supply a master ledger');
  const fixtures = path.join(repoRoot, '.test-fixtures', 'test-env');
  const relative = path.relative(fixtures, homedir());
  assert.ok(relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(ledger, path.join(homedir(), '.mush', 'master-ledger.jsonl'));
  assert.equal(process.env.USERPROFILE, homedir());
  assert.equal(process.env.HOME, homedir());
});

test('G083: a child test process replaces inherited home and ledger paths', () => {
  const inheritedHome = path.join(repoRoot, '.test-fixtures', 'host-home');
  const inheritedLedger = path.join(inheritedHome, 'do-not-write.jsonl');
  const result = spawnSync(process.execPath, [
    '--import', new URL('./setup.ts', import.meta.url).href,
    fileURLToPath(new URL('./fixtures/test-env-report.cjs', import.meta.url)),
  ], {
    env: { ...process.env, HOME: inheritedHome, USERPROFILE: inheritedHome, MUSH_MASTER_LEDGER_PATH: inheritedLedger },
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { home: string; ledger: string };
  assert.notEqual(report.home, homedir(), 'each process gets a fresh home');
  assert.notEqual(report.home, inheritedHome);
  assert.notEqual(report.ledger, inheritedLedger);
  assert.equal(report.ledger, path.join(report.home, '.mush', 'master-ledger.jsonl'));
});
