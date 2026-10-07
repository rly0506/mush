import type { TestContext } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MODELS_FIXTURE = [
  'opencode/big-pickle',
  'opencode/hy3-free',
  'opencode/mimo-v2.5-free',
  'opencode/muse-spark-1.2-contributor-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/x-preview-f-free',
  'botcf/kimi-k3',
  'pixel/grok-4.5',
  'tbtk/glm-5.3',
].join('\n');

export function installModelsFixture(t: TestContext, root: string): void {
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const windows = process.platform === 'win32';
  const script = windows
    ? '@echo off\r\nif not "%~1"=="models" exit /b 2\r\n' + MODELS_FIXTURE.split('\n').map((m) => `echo ${m}\r\n`).join('')
    : '#!/bin/sh\n[ "$1" = "models" ] || exit 2\nprintf "%s\\n" ' + MODELS_FIXTURE.split('\n').map((m) => `'${m}'`).join(' ') + '\n';
  writeFileSync(path.join(bin, windows ? 'opencode.cmd' : 'opencode'), script, { mode: 0o755 });
  const previousPath = process.env.PATH;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
  process.env.PATH = bin + path.delimiter + (previousPath ?? '');
}
