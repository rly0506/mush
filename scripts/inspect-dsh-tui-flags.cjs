const { execSync } = require('node:child_process');

console.log('=== Checking dsh profiles and tui profile flags ===');

try {
  const dump = execSync('dsh --dump-config', { encoding: 'utf-8', timeout: 5000 });
  console.log('dsh default config dump:', dump.substring(0, 400));
} catch (e) {
  console.log('dump-config error:', e.message);
}

try {
  const helpTui = execSync('dsh --profile tui --help', { encoding: 'utf-8', timeout: 5000 });
  console.log('dsh --profile tui --help output:');
  console.log(helpTui);
} catch (e) {
  console.log('tui help error:', e.message);
}
