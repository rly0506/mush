const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const home = os.homedir();

console.log('=== Inspecting Usage Data Structures Safely ===');

// 1. Claude session sample
try {
  const claudeProjects = path.join(home, '.claude', 'projects');
  if (fs.existsSync(claudeProjects)) {
    const pDirs = fs.readdirSync(claudeProjects);
    for (const pd of pDirs) {
      const pPath = path.join(claudeProjects, pd);
      if (fs.statSync(pPath).isDirectory()) {
        const files = fs.readdirSync(pPath);
        for (const f of files) {
          if (f.endsWith('.jsonl') || f.endsWith('.json')) {
            const raw = fs.readFileSync(path.join(pPath, f), 'utf8');
            const lines = raw.trim().split('\n');
            for (const l of lines.slice(0, 30)) {
              if (l.includes('usage') || l.includes('tokens') || l.includes('input_tokens') || l.includes('cost')) {
                console.log(`Claude [${pd}/${f}] usage line:`, l.slice(0, 200));
                break;
              }
            }
            break;
          }
        }
      }
    }
  }
} catch (e) {
  console.log('Claude error:', e.message);
}

// 2. Kimi session_index sample
try {
  const kimiIndex = path.join(home, '.kimi-code', 'session_index.jsonl');
  if (fs.existsSync(kimiIndex)) {
    const lines = fs.readFileSync(kimiIndex, 'utf8').trim().split('\n');
    console.log('Kimi session_index sample lines:', lines.slice(0, 2));
  }
} catch (e) {
  console.log('Kimi error:', e.message);
}

// 3. Pi session sample
try {
  const piSessions = path.join(home, '.pi', 'agent', 'sessions');
  if (fs.existsSync(piSessions)) {
    const sDirs = fs.readdirSync(piSessions);
    for (const sd of sDirs) {
      const pPath = path.join(piSessions, sd);
      if (fs.statSync(pPath).isDirectory()) {
        const files = fs.readdirSync(pPath);
        for (const f of files) {
          if (f.endsWith('.json') || f.endsWith('.jsonl')) {
            const raw = fs.readFileSync(path.join(pPath, f), 'utf8');
            const lines = raw.trim().split('\n');
            for (const l of lines.slice(0, 30)) {
              if (l.includes('usage') || l.includes('tokens') || l.includes('input') || l.includes('cost')) {
                console.log(`Pi [${sd}/${f}] usage line:`, l.slice(0, 200));
                break;
              }
            }
            break;
          }
        }
      }
    }
  }
} catch (e) {
  console.log('Pi error:', e.message);
}

// 4. ZCode log sample
try {
  const zcodeLogs = path.join(home, '.zcode', 'cli', 'log');
  if (fs.existsSync(zcodeLogs)) {
    const files = fs.readdirSync(zcodeLogs);
    for (const f of files.slice(-2)) {
      const raw = fs.readFileSync(path.join(zcodeLogs, f), 'utf8');
      const lines = raw.trim().split('\n');
      for (const l of lines) {
        if (l.includes('token') || l.includes('usage') || l.includes('prompt_tokens') || l.includes('completion_tokens')) {
          console.log(`ZCode [${f}] usage line:`, l.slice(0, 200));
          break;
        }
      }
    }
  }
} catch (e) {
  console.log('ZCode error:', e.message);
}

// 5. CC-Switch model pricing sample
try {
  const pricingPath = path.join(home, '.cc-switch', 'model-pricing.json');
  if (fs.existsSync(pricingPath)) {
    console.log('CC-Switch pricing:', fs.readFileSync(pricingPath, 'utf8'));
  }
} catch (e) {
  console.log('CC-Switch error:', e.message);
}
