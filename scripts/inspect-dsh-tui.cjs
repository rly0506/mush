const { execSync } = require('node:child_process');

console.log('=== Checking for dsh / deepseek binaries on system ===');

const candidates = ['dsh', 'deepseek', 'deepseek-cli', 'dsh-tui'];

for (const cmd of candidates) {
  try {
    const whereOut = execSync(`where ${cmd}`, { encoding: 'utf-8', timeout: 5000 });
    console.log(`[FOUND] ${cmd}:`);
    console.log(whereOut.trim());

    // Try --version
    try {
      const verOut = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 5000 });
      console.log(`  Version: ${verOut.trim()}`);
    } catch (e) {
      console.log(`  --version failed: ${e.message}`);
    }

    // Try --help
    try {
      const helpOut = execSync(`${cmd} --help`, { encoding: 'utf-8', timeout: 5000 });
      console.log(`  Help excerpt (first 500 chars):`);
      console.log(helpOut.substring(0, 500));
      
      // Check if resume is mentioned in help
      const lines = helpOut.split('\n');
      const resumeLines = lines.filter(l => /resume|session|continue|history/i.test(l));
      if (resumeLines.length > 0) {
        console.log(`  Found resume-related flags/options:`);
        resumeLines.forEach(l => console.log(`    ${l.trim()}`));
      }
    } catch (e) {
      console.log(`  --help failed: ${e.message}`);
    }
  } catch (e) {
    console.log(`[NOT FOUND] ${cmd}`);
  }
}
