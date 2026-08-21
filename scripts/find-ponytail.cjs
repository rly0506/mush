const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('=== Searching for ponytail skill across local paths ===');

const userHome = os.homedir();
const searchRoots = [
  userHome,
  path.join(userHome, '.gemini'),
  path.join(userHome, '.dsh'),
  path.join(userHome, '.claude'),
  path.join(userHome, '.codex'),
  path.join(userHome, '.agents'),
  path.join(userHome, '.skills'),
  path.join(userHome, 'skills'),
  path.join(userHome, 'Desktop'),
  path.join(userHome, 'Documents'),
  path.join(userHome, 'Downloads'),
  'D:/',
];

const matches = [];

function searchDir(d, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return;
  try {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      const lower = e.name.toLowerCase();
      if (lower.includes('ponytail') || lower.endsWith('.skill')) {
        matches.push({ path: full, isDir: e.isDirectory(), name: e.name });
      }
      if (e.isDirectory() && !e.name.startsWith('$') && e.name !== 'node_modules' && e.name !== '.git') {
        searchDir(full, depth + 1, maxDepth);
      }
    }
  } catch {}
}

for (const root of searchRoots) {
  if (fs.existsSync(root)) {
    console.log(`Searching root: ${root}`);
    searchDir(root, 0, root === userHome ? 3 : 4);
  }
}

console.log(`\nFound ${matches.length} matches:`);
matches.forEach(m => console.log(`  [${m.isDir ? 'DIR' : 'FILE'}] ${m.path}`));
