import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('../.test-fixtures/test-env/', import.meta.url));
mkdirSync(fixtures, { recursive: true });
const home = mkdtempSync(path.join(fixtures, `${process.pid}-`));

// Never inherit a real user's budget ledger or harness configuration in tests.
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.MUSH_MASTER_LEDGER_PATH = path.join(home, '.mush', 'master-ledger.jsonl');
