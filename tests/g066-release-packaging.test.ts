import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('GOAL-066 MVP Desktop Packaging & Pilot Release Suite', async (t) => {
  const root = path.resolve(__dirname, '..');

  await t.test('1. LICENSE exists, specifies Apache-2.0, and contains copyright attribution', () => {
    const licensePath = path.join(root, 'LICENSE');
    assert.ok(existsSync(licensePath), 'LICENSE file must exist');
    const content = readFileSync(licensePath, 'utf8');
    assert.match(content, /Apache License/i);
    assert.match(content, /Version 2\.0/i);
    assert.match(content, /Copyright 2026 mush contributors/i);
  });

  await t.test('2. EULA.md exists, contains commercial terms and AI execution liability limitations', () => {
    const eulaPath = path.join(root, 'EULA.md');
    assert.ok(existsSync(eulaPath), 'EULA.md file must exist');
    const content = readFileSync(eulaPath, 'utf8');
    assert.match(content, /最终用户许可协议/);
    assert.match(content, /本地授权软件/);
    assert.match(content, /BYOK/);
    assert.match(content, /免责声明/);
    assert.match(content, /责任限制/);
  });

  await t.test('3. package.json contains v0.1.1-pilot version and Apache-2.0 license', () => {
    const pkgPath = path.join(root, 'package.json');
    assert.ok(existsSync(pkgPath));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '0.1.1-pilot');
    assert.equal(pkg.license, 'Apache-2.0');
    assert.ok(pkg.scripts?.start);
    assert.ok(pkg.scripts?.['build:desktop']);
    assert.ok(pkg.bin?.mush);
  });

  await t.test('4. docs/PILOT_RELEASE_GUIDE.md exists and articulates Native Harness Federation UVP', () => {
    const guidePath = path.join(root, 'docs', 'PILOT_RELEASE_GUIDE.md');
    assert.ok(existsSync(guidePath), 'PILOT_RELEASE_GUIDE.md must exist');
    const content = readFileSync(guidePath, 'utf8');
    assert.match(content, /原厂战衣联邦/);
    assert.match(content, /Claude Code/);
    assert.match(content, /dsh/);
    assert.match(content, /agy/);
    assert.match(content, /安装 mush|快速上手/);
    assert.match(content, /纯本地运行/);
  });

  await t.test('5. scripts/board-up.cmd and scripts/board-up.ps1 are portable and ASCII-only', () => {
    const cmdPath = path.join(root, 'scripts', 'board-up.cmd');
    const ps1Path = path.join(root, 'scripts', 'board-up.ps1');
    assert.ok(existsSync(cmdPath));
    assert.ok(existsSync(ps1Path));

    const cmdContent = readFileSync(cmdPath, 'utf8');
    const ps1Content = readFileSync(ps1Path, 'utf8');

    // Must not contain hardcoded D:\mush
    assert.doesNotMatch(cmdContent, /cd \/d D:\\mush/i);
    assert.doesNotMatch(ps1Content, /\$root = 'D:\\mush'/i);

    // ASCII check for ps1
    assert.ok(/^[\x00-\x7F]*$/.test(ps1Content), 'board-up.ps1 must be pure ASCII');
  });
});
