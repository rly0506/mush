import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCli } from '../src/cli.ts';

// GOAL-003 U5/U6：D21 CLI 三命令（status/dispatch/review）+ --workspace 贯通；
// U6 预算记账接入：dry-run dispatch 先 UsdBudgetLedger.admit 再执行。
// 沙箱 piped-spawn EPERM（AD-02）→ CLI 用 runCli(argv) 直接函数调用测试；
// bin/mush.js 只做薄壳转发同一函数。

const MUSH_ROOT = path.resolve(process.cwd());
const TEST_WS = path.resolve(MUSH_ROOT, '.test-fixtures', 'cli-workspace');

test('status works on the mush repo and on a non-mush workspace directory (read-only)', async () => {
  const here = await runCli(['status']);
  assert.equal(here.exitCode, 0);
  assert.match(here.stdout, /"workspace"/);
  assert.match(here.stdout, /ok/);
  const other = await runCli(['status', '--workspace', 'D:\\意向项目']);
  assert.equal(other.exitCode, 0);
  assert.match(other.stdout, /D:\\\\意向项目/);
});

test('dispatch dry-run writes a receipt under the workspace and records budget admission first', async () => {
  mkdirSync(TEST_WS, { recursive: true });
  const result = await runCli([
    'dispatch',
    '--workspace',
    TEST_WS,
    '--adapter',
    'fake-t1',
    '--prompt',
    'fixture task',
    '--dry-run',
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /receipt/);
  const parsed = JSON.parse(result.stdout) as { receipt_path: string; admission: { decision: string; remaining_usd: number } };
  assert.ok(existsSync(parsed.receipt_path), 'dispatch receipt file must be written');
  assert.equal(parsed.admission.decision, 'ADMITTED');
  const receipt = JSON.parse(readFileSync(parsed.receipt_path, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.adapter_id, 'fake-t1');
  assert.equal(receipt.prompt, 'fixture task');
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.admission_decision, 'ADMITTED');
});

test('dispatch dry-run over cap is DENIED by the admission gate and still records the event', async () => {
  mkdirSync(TEST_WS, { recursive: true });
  const result = await runCli([
    'dispatch',
    '--workspace',
    TEST_WS,
    '--adapter',
    'fake-t1',
    '--prompt',
    'over cap fixture',
    '--dry-run',
    '--cap-usd',
    '5',
    '--amount-usd',
    '6',
  ]);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout) as { admission: { decision: string; remaining_usd: number } };
  assert.equal(parsed.admission.decision, 'DENIED');
  assert.equal(parsed.admission.remaining_usd, 5);
  const receipt = JSON.parse(
    readFileSync((JSON.parse(result.stdout) as { receipt_path: string }).receipt_path, 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(receipt.admission_decision, 'DENIED', 'denied admission must still be event-ized in the receipt');
});

test('real dispatch without an owner D6 approval record is BLOCKED_WAITING_OWNER (no execution)', async () => {
  const result = await runCli([
    'dispatch',
    '--workspace',
    TEST_WS,
    '--adapter',
    'deepseek-dsh',
    '--prompt',
    'would spend money',
    '--real',
    '--approval-root',
    path.resolve(MUSH_ROOT, '.test-fixtures', 'no-approvals'),
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /BLOCKED_WAITING_OWNER/);
});

test('review reads a receipt and issues a machine verdict PASS/FAIL', async () => {
  mkdirSync(TEST_WS, { recursive: true });
  const receiptPath = path.join(TEST_WS, 'receipt-review.json');
  writeFileSync(
    receiptPath,
    JSON.stringify({ schema_version: 1, adapter_id: 'fake-t1', exit_code: 0, timed_out: false, identity_fail_closed: false }) + '\n',
    'utf8',
  );
  const pass = await runCli(['review', '--receipt', receiptPath]);
  assert.equal(pass.exitCode, 0);
  assert.match(pass.stdout, /PASS/);
  writeFileSync(receiptPath, JSON.stringify({ schema_version: 1, adapter_id: 'fake-t1', exit_code: 63, timed_out: true, identity_fail_closed: false }) + '\n', 'utf8');
  const fail = await runCli(['review', '--receipt', receiptPath]);
  assert.equal(fail.exitCode, 1);
  assert.match(fail.stdout, /FAIL/);
});

test('CLI rejects unknown commands and unknown adapters fail-closed', async () => {
  const unknown = await runCli(['frobnicate']);
  assert.equal(unknown.exitCode, 64);
  assert.match(unknown.stdout, /unknown command/i);
  const badAdapter = await runCli(['dispatch', '--workspace', TEST_WS, '--adapter', 'made-up', '--prompt', 'x', '--dry-run']);
  assert.equal(badAdapter.exitCode, 64);
  assert.match(badAdapter.stdout, /unknown adapter/i);
});
