const fs = require('node:fs');
const path = require('node:path');

const brainDir = 'C:\\Users\\任锂帅\\.gemini\\antigravity\\brain';

const dirs = fs.readdirSync(brainDir);
console.log('Conversations in brain:', dirs.length);

for (const d of dirs) {
  const logDir = path.join(brainDir, d, '.system_generated', 'logs');
  const fullLog = path.join(logDir, 'transcript.jsonl');
  if (fs.existsSync(fullLog)) {
    const text = fs.readFileSync(fullLog, 'utf-8');
    const userInputs = [];
    text.split('\n').forEach(line => {
      if (line.includes('"type":"USER_INPUT"')) {
        try {
          const parsed = JSON.parse(line);
          userInputs.push(parsed.content);
        } catch {}
      }
    });
    console.log(`Conv ${d}: ${userInputs.length} user inputs`);
    userInputs.forEach(u => {
      if (typeof u === 'string' && (u.includes('框架') || u.includes('合作') || u.includes('agent') || u.includes('设计') || u.includes('架构') || u.includes('思考'))) {
        console.log(`  -> ${u.substring(0, 150)}`);
      }
    });
  }
}
