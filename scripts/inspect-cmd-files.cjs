const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('=== Checking dsh-tui.cmd ===');

const cmdFile = 'D:\\npm-global\\dsh-tui.cmd';
if (fs.existsSync(cmdFile)) {
  console.log('dsh-tui.cmd content:', fs.readFileSync(cmdFile, 'utf-8'));
}

const dshCmdFile = 'D:\\npm-global\\dsh.cmd';
if (fs.existsSync(dshCmdFile)) {
  console.log('dsh.cmd content:', fs.readFileSync(dshCmdFile, 'utf-8'));
}

const dshHome = path.join(os.homedir(), '.dsh');
if (fs.existsSync(dshHome)) {
  const list = fs.readdirSync(dshHome);
  console.log('.dsh subdirs:', list);
  const profilesDir = path.join(dshHome, 'profiles');
  if (fs.existsSync(profilesDir)) {
    console.log('profiles:', fs.readdirSync(profilesDir));
  }
}
