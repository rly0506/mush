const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const home = os.homedir();
console.log('User Home:', home);

const candidateDirs = [
  '.cc-switch',
  '.dsh',
  '.pi',
  '.gemini',
  '.claude',
  '.codex',
  '.kimi',
  '.zcode',
  '.opencode',
];

for (const d of candidateDirs) {
  const full = path.join(home, d);
  const exists = fs.existsSync(full);
  console.log(`Directory ${d}: exists=${exists}`);
  if (exists) {
    try {
      const files = fs.readdirSync(full);
      console.log(`  Files:`, files.slice(0, 10));
    } catch (e) {
      console.log(`  Error listing:`, e.message);
    }
  }
}
