const fs = require('node:fs');
const path = require('node:path');

console.log('=== Gathering Project Metrics for Grand Summary ===');

function countStats(dir, extFilter = ['.ts', '.js', '.cjs', '.mjs', '.md']) {
  let files = 0;
  let lines = 0;
  let bytes = 0;

  function walk(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'runtime' || e.name === '.agent-bridge') continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else if (e.isFile()) {
          const ext = path.extname(e.name);
          if (extFilter.includes(ext)) {
            files++;
            const content = fs.readFileSync(full, 'utf-8');
            const l = content.split('\n').length;
            lines += l;
            bytes += content.length;
          }
        }
      }
    } catch {}
  }

  walk(dir);
  return { files, lines, bytes };
}

const srcStats = countStats('D:/mush/src', ['.ts']);
const testsStats = countStats('D:/mush/tests', ['.ts']);
const goalsStats = countStats('D:/mush/goals', ['.md']);
const docsStats = countStats('D:/mush/docs', ['.md']);
const totalStats = countStats('D:/mush');

console.log('src/ (TS):', srcStats);
console.log('tests/ (TS):', testsStats);
console.log('goals/ (MD):', goalsStats);
console.log('docs/ (MD):', docsStats);
console.log('Total codebase:', totalStats);
