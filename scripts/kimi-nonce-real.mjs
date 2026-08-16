// GOAL-013 U3: kimi nonce registration via board API (real bounded dispatch).
// Writes evidence to goals/receipts/dispatch-events/kimi-real-002.json.
// Run from worktree root: node scripts/kimi-nonce-real.mjs

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { startBoardServer } from '../src/web/server.ts';
import { BoardPersistence } from '../src/web/persistence.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const temp = path.join(root, '.test-fixtures', 'kimi-nonce-real', `${process.pid}-${Date.now()}`);
mkdirSync(temp, { recursive: true });

const nonce = randomBytes(16).toString('hex');
const expectedSha256 = createHash('sha256').update(nonce, 'utf8').digest('hex');
const prompt =
  'Nonce identity probe. Compute the SHA-256 (lowercase hex) of this exact string: ' +
  nonce +
  '. Reply with exactly one line containing the 64-hex digest.';

const persistence = new BoardPersistence(path.join(temp, 'runtime'));
const pipeline = new DispatchPipeline({
  workspaceRoot: root,
  approvalRoot: path.join(temp, 'approvals'),
  ledgerPath: path.join(temp, 'budget-ledger.jsonl'),
  dispatchApprovalRoot: path.join(root, 'goals', 'receipts', 'dispatch-approvals'),
  persistence,
});

const server = await startBoardServer({
  approvalRoot: path.join(temp, 'approvals'),
  runId: 'kimi-nonce-real-002',
  assignmentEpoch: 1,
  dispatch: pipeline,
  workspaceRoot: root,
  runtimeRoot: path.join(temp, 'runtime'),
  persistence,
});

const base = `http://127.0.0.1:${server.port}`;
let evidence;
try {
  const response = await fetch(base + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      adapter_id: 'kimi-code',
      prompt,
      real: true,
      timeout_s: 300,
      cap_usd: 5,
      effort: 'MEDIUM',
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    evidence = {
      schema_version: 1,
      dispatch_id: null,
      adapter_id: 'kimi-code',
      channel: 't1 (-p headless)',
      purpose: 'D13 nonce registration (GOAL-013 U3)',
      nonce,
      expected_sha256: expectedSha256,
      observed: null,
      matched: false,
      verdict: `BLOCKED_HTTP_${response.status}`,
      error: body.error ?? 'unknown board API error',
      recorded_at_utc: new Date().toISOString(),
    };
  } else {
    const dispatchId = body.dispatch_id;
    const detailResponse = await fetch(base + '/api/dispatch/' + dispatchId);
    const detail = await detailResponse.json();
    const record = detail.dispatch ?? {};
    const stdout = record.stdout_tail?.text ?? '';
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[0-9a-fA-F]{64}$/.test(line));
    const observed = lines.length > 0 ? lines[lines.length - 1].toLowerCase() : null;
    const matched = observed === expectedSha256;
    evidence = {
      schema_version: 1,
      dispatch_id: dispatchId,
      adapter_id: 'kimi-code',
      channel: 't1 (-p headless) via board API',
      purpose: 'D13 nonce registration (GOAL-013 U3)',
      nonce,
      expected_sha256: expectedSha256,
      observed,
      matched,
      exit_code: record.exit_code ?? record.status ?? 'UNKNOWN',
      timed_out: record.timed_out ?? false,
      stdout_sha256: record.stdout_sha256 ?? 'UNKNOWN',
      stderr_sha256: record.stderr_sha256 ?? 'UNKNOWN',
      status: record.status,
      verdict: matched ? 'PASS' : record.status === 'BLOCKED_ENV' ? 'BLOCKED_ENV' : 'FAIL',
      recorded_at_utc: new Date().toISOString(),
    };
  }
} catch (error) {
  evidence = {
    schema_version: 1,
    dispatch_id: null,
    adapter_id: 'kimi-code',
    channel: 't1 (-p headless) via board API',
    purpose: 'D13 nonce registration (GOAL-013 U3)',
    nonce,
    expected_sha256: expectedSha256,
    observed: null,
    matched: false,
    verdict: 'BLOCKED_ENV',
    error: error instanceof Error ? error.message : String(error),
    recorded_at_utc: new Date().toISOString(),
  };
} finally {
  await server.close();
}

const evidencePath = path.join(root, 'goals', 'receipts', 'dispatch-events', 'kimi-real-002.json');
mkdirSync(path.dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(evidence, null, 2));
