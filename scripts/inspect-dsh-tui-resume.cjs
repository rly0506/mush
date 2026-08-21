const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('=== ~/.dsh-tui session files ===');

const dshTuiDir = path.join(os.homedir(), '.dsh-tui');
try {
  console.log('resume.txt:', fs.readFileSync(path.join(dshTuiDir, 'resume.txt'), 'utf-8'));
} catch (e) {
  console.log('no resume.txt:', e.message);
}

try {
  const index = fs.readFileSync(path.join(dshTuiDir, 'session-index.json'), 'utf-8');
  console.log('session-index.json:', index.substring(0, 500));
} catch (e) {
  console.log('no session-index.json:', e.message);
}
