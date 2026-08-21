const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('=== Checking ~/.dsh contents and npm-global dsh-tui ===');

const dshHome = path.join(os.homedir(), '.dsh');
console.log('dshHome exists:', fs.existsSync(dshHome));
if (fs.existsSync(dshHome)) {
  console.log('dshHome files:', fs.readdirSync(dshHome, { recursive: true }));
}

// Check npm-global dsh-tui wrapper script or bin
const dshTuiPath = 'D:\\npm-global\\node_modules\\@deepseek-ai\\dsh-tui';
console.log('dsh-tui pkg exists:', fs.existsSync(dshTuiPath));
if (fs.existsSync(dshTuiPath)) {
  console.log('dsh-tui pkg files:', fs.readdirSync(dshTuiPath));
  const pkgJson = path.join(dshTuiPath, 'package.json');
  if (fs.existsSync(pkgJson)) {
    console.log('package.json:', fs.readFileSync(pkgJson, 'utf-8'));
  }
}
