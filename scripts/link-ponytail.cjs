const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

console.log('=== Linking ponytail skills to Antigravity config ===');

const userHome = os.homedir();
const targetBase = path.join(userHome, '.gemini', 'config', 'skills');

const ponytailSkillsDir = 'D:\\ponytail\\skills';
const skills = ['ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help', 'ponytail-review'];

for (const s of skills) {
  const src = path.join(ponytailSkillsDir, s);
  const dest = path.join(targetBase, s);
  
  if (fs.existsSync(src)) {
    // If dest exists, remove it first
    if (fs.existsSync(dest)) {
      try {
        fs.rmSync(dest, { recursive: true, force: true });
      } catch (e) {
        console.log(`Failed to remove existing ${dest}: ${e.message}`);
      }
    }
    
    // Create junction using cmd mklink /J
    try {
      execSync(`cmd /c mklink /J "${dest}" "${src}"`, { encoding: 'utf-8' });
      console.log(`[LINKED] ${s} -> ${dest}`);
    } catch (e) {
      console.log(`[ERROR linking ${s}]: ${e.message}`);
    }
  }
}

console.log('\n=== Checking linked ponytail skills in target ===');
for (const s of skills) {
  const checkFile = path.join(targetBase, s, 'SKILL.md');
  console.log(`${s}/SKILL.md exists:`, fs.existsSync(checkFile));
}
