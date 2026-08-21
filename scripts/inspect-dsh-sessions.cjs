const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('=== Checking ~/.dsh/sessions and ~/.dsh-tui ===');

const dshTuiDir = path.join(os.homedir(), '.dsh-tui');
console.log('~/.dsh-tui exists:', fs.existsSync(dshTuiDir));
if (fs.existsSync(dshTuiDir)) {
  console.log('~/.dsh-tui contents:', fs.readdirSync(dshTuiDir));
}

const dshSessionsDir = path.join(os.homedir(), '.dsh', 'sessions');
if (fs.existsSync(dshSessionsDir)) {
  const dirs = fs.readdirSync(dshSessionsDir);
  console.log('~/.dsh/sessions subdirs:', dirs);
  dirs.forEach(d => {
    const full = path.join(dshSessionsDir, d);
    try {
      const files = fs.readdirSync(full);
      console.log(`  ${d}:`, files.slice(0, 5));
    } catch {}
  });
}
