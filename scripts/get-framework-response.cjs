const fs = require('node:fs');
const transcriptFile = 'C:\\Users\\任锂帅\\.gemini\\antigravity\\brain\\ea0ffc9a-3eb5-48f7-bfe4-703300f11e77\\.system_generated\\logs\\transcript_full.jsonl';

const text = fs.readFileSync(transcriptFile, 'utf-8');
const lines = text.split('\n');

for (let i = 1350; i < Math.min(lines.length, 1430); i++) {
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.type === 'PLANNER_RESPONSE' && typeof obj.content === 'string') {
      console.log(`=== PLANNER RESPONSE AT LINE ${i} ===`);
      console.log(obj.content);
      console.log('\n====================================\n');
    }
  } catch (e) {}
}
