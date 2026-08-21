const fs = require('node:fs');
const path = require('node:path');

const brainDir = 'C:\\Users\\任锂帅\\.gemini\\antigravity\\brain';

console.log('Searching transcripts in brain directory for framework / collaboration discussions...');

function searchDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      searchDir(full);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (l.includes('框架') || l.includes('合作') || l.includes('协作') || l.includes('framework') || l.includes('protocol') || l.includes('agent-team')) {
            try {
              const parsed = JSON.parse(l);
              if (parsed.type === 'USER_INPUT' || (parsed.content && (parsed.content.includes('框架') || parsed.content.includes('合作')))) {
                const preview = typeof parsed.content === 'string' ? parsed.content.substring(0, 300) : JSON.stringify(parsed).substring(0, 300);
                console.log(`[${e.name}:${i}] ${parsed.type || 'STEP'}: ${preview}\n---`);
              }
            } catch {}
          }
        }
      } catch {}
    }
  }
}

searchDir(brainDir);
