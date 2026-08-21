const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('=== Checking and Syncing Skills to Antigravity ===');

const userHome = os.homedir();
const geminiConfigSkills = path.join(userHome, '.gemini', 'config', 'skills');
const geminiPlugins = path.join(userHome, '.gemini', 'config', 'plugins');

if (!fs.existsSync(geminiConfigSkills)) {
  fs.mkdirSync(geminiConfigSkills, { recursive: true });
}

console.log('Target Antigravity skills dir:', geminiConfigSkills);

// Source skill directories
const sourceDirs = [
  'D:\\ponytail\\skills',
  path.join(userHome, '.claude', 'skills'),
  path.join(userHome, '.codex', 'skills'),
  path.join(userHome, '.cc-switch', 'skills'),
];

let copied = 0;

for (const sDir of sourceDirs) {
  if (fs.existsSync(sDir)) {
    console.log(`Scanning source: ${sDir}`);
    const entries = fs.readdirSync(sDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const skillName = e.name;
        const srcSkillPath = path.join(sDir, skillName);
        const destSkillPath = path.join(geminiConfigSkills, skillName);
        
        // Verify it has a SKILL.md or relevant skill files
        if (fs.existsSync(path.join(srcSkillPath, 'SKILL.md'))) {
          if (!fs.existsSync(destSkillPath)) {
            console.log(`Copying skill: ${skillName} -> ${destSkillPath}`);
            fs.cpSync(srcSkillPath, destSkillPath, { recursive: true });
            copied++;
          } else {
            console.log(`Updating skill: ${skillName} -> ${destSkillPath}`);
            fs.cpSync(srcSkillPath, destSkillPath, { recursive: true });
          }
        }
      }
    }
  }
}

console.log(`\nSync finished. Active skills in ${geminiConfigSkills}:`);
const active = fs.readdirSync(geminiConfigSkills);
console.log(active);
