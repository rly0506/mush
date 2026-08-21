const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

console.log('=== Inspecting dsh-tui.js package ===');

const pkgPath = 'D:\\npm-global\\node_modules\\@deepseek-harness-tui\\dsh-tui';
if (fs.existsSync(pkgPath)) {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'));
  console.log('Package Name:', pkgJson.name);
  console.log('Package Version:', pkgJson.version);
  console.log('Binaries:', pkgJson.bin);
  console.log('Dependencies:', pkgJson.dependencies);
}

// Check bin/dsh-tui.js
const binJs = path.join(pkgPath, 'bin', 'dsh-tui.js');
if (fs.existsSync(binJs)) {
  console.log('bin/dsh-tui.js content excerpt (first 1000 chars):');
  console.log(fs.readFileSync(binJs, 'utf-8').substring(0, 1000));
}

// Test dsh --profile dsh-tui --help
try {
  const out = execSync('dsh --profile dsh-tui --help', { encoding: 'utf-8', timeout: 5000 });
  console.log('dsh --profile dsh-tui --help output:');
  console.log(out);
} catch (e) {
  console.log('dsh --profile dsh-tui --help failed:', e.message);
}
