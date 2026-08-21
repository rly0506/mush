const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dshProfiles = path.join(os.homedir(), '.dsh', 'profiles');
if (fs.existsSync(dshProfiles)) {
  console.log('dsh profiles:', fs.readdirSync(dshProfiles));
} else {
  console.log('dsh profiles dir not found');
}
