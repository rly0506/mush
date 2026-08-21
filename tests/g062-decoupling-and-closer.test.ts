import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('GOAL-062: Codebase Decoupling & DoD Closer Tool', () => {
  const closerPath = path.resolve('scripts/close-goal.cjs');
  assert.ok(fs.existsSync(closerPath), 'scripts/close-goal.cjs exists');
  const content = fs.readFileSync(closerPath, 'utf8');
  assert.match(content, /syncGoalsDirectoryToTasks/, 'closer automatically synchronizes tasks');
  assert.match(content, /receiptsDir/, 'closer writes completion receipts');
});
