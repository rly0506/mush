const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const targetBase = path.join(os.homedir(), '.gemini', 'config', 'skills');
console.log('targetBase exists:', fs.existsSync(targetBase));

if (fs.existsSync(targetBase)) {
  const entries = fs.readdirSync(targetBase, { withFileTypes: true });
  console.log('Existing entries in targetBase:');
  entries.forEach(e => {
    console.log(`  ${e.name} (isDir: ${e.isDirectory()}, isSymbolicLink: ${e.isSymbolicLink()})`);
  });
}
