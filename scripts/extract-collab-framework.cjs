const fs = require('node:fs');
const path = require('node:path');

const transcriptFile = 'C:\\Users\\任锂帅\\.gemini\\antigravity\\brain\\ea0ffc9a-3eb5-48f7-bfe4-703300f11e77\\.system_generated\\logs\\transcript_full.jsonl';

const text = fs.readFileSync(transcriptFile, 'utf-8');
const lines = text.split('\n');

let capturing = false;
let count = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('现在mush的框架结构是父级派发') || line.includes('llm-as-a-verifier')) {
    console.log(`=== FOUND AT LINE ${i} ===`);
    for (let j = Math.max(0, i - 1); j < Math.min(lines.length, i + 8); j++) {
      try {
        const obj = JSON.parse(lines[j]);
        console.log(`[Step ${j} - ${obj.type}]`);
        if (typeof obj.content === 'string') {
          console.log(obj.content.substring(0, 1500));
        } else {
          console.log(JSON.stringify(obj).substring(0, 500));
        }
        console.log('\n----------------------------------------\n');
      } catch (e) {
        console.log(`Error parsing line ${j}: ${e.message}`);
      }
    }
  }
}
