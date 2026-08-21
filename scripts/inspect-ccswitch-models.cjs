const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const pricingPath = path.join(os.homedir(), '.cc-switch', 'model-pricing.json');
if (fs.existsSync(pricingPath)) {
  try {
    const raw = fs.readFileSync(pricingPath, 'utf8');
    const parsed = JSON.parse(raw);
    console.log('cc-switch model-pricing keys count:', Object.keys(parsed).length);
    console.log('Sample model keys:', Object.keys(parsed).slice(0, 10));
  } catch (e) {
    console.log('Error reading pricing:', e.message);
  }
} else {
  console.log('model-pricing.json not found');
}
