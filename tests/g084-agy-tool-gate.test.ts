import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('real hook process denies every resource/delegation namespace and never logs tool arguments', () => {
  const root = mkdtempSync(path.resolve('.test-fixtures/g084-agy-gate-'));
  const file = path.join(root, 'gate.mjs');
  copyFileSync(path.resolve('src/adapters/agy-discussion-gate.mjs'), file);
  for (const name of ['view_file', 'write_to_file', 'run_command', 'call_mcp_tool', 'invoke_subagent', 'browser_subagent', 'schedule', 'ask_permission', 'send_message', 'finish']) {
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', input: JSON.stringify({ toolCall: { name, args: { secret: 'SYNTHETIC_DO_NOT_LOG' } } }) });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).decision, name === 'finish' ? 'allow' : 'deny');
  }
  const audit = readFileSync(path.join(root, 'tool-gate.jsonl'), 'utf8');
  assert.ok(!audit.includes('SYNTHETIC_DO_NOT_LOG'));
  assert.equal(audit.trim().split('\n').length, 10);
});

test('hook malformed/unknown calls return deny successfully rather than failing open', () => {
  const root = mkdtempSync(path.resolve('.test-fixtures/g084-agy-gate-'));
  const file = path.join(root, 'gate.mjs'); copyFileSync(path.resolve('src/adapters/agy-discussion-gate.mjs'), file);
  for (const input of ['{bad', '{}', '{"toolCall":{"name":"Finish"}}']) {
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', input });
    assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).decision, 'deny');
  }
});
