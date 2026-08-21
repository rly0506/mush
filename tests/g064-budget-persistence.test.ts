import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline, InputError, type RunAdapterFn } from '../src/web/dispatch.ts';
import { BoardPersistence } from '../src/web/persistence.ts';

const fakeOk: RunAdapterFn = async () => ({
  exitCode: 0,
  stdout: 'MUSH-DISPATCH-OK',
  stderr: '',
  timedOut: false,
  childKilled: false,
});

test('GOAL-064 Authoritative Budget, Cost Feedback & Ledger Persistence Suite', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g064-'));
  const approvalRoot = path.join(root, 'approvals');
  const workspaceRoot = path.join(root, 'workspace');
  const runtimeRoot = path.join(root, 'runtime');
  const ledgerPath = path.join(runtimeRoot, 'budget-ledger.jsonl');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });

  const persistence = new BoardPersistence(runtimeRoot);

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('1. Client cannot arbitrarily elevate cap_usd beyond server budget cap', async () => {
    const pipeline = new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      ledgerPath,
      persistence,
      runAdapter: fakeOk,
    });

    // Default cap for fake-t1 is 5. Requesting 15 must be rejected
    await assert.rejects(
      () =>
        pipeline.dispatch({
          adapter_id: 'fake-t1',
          prompt: 'test prompt',
          cap_usd: 15,
        }),
      (err: any) => {
        assert.ok(err instanceof InputError);
        assert.match(err.message, /cannot exceed server configured budget cap/i);
        return true;
      }
    );

    // Requesting cap <= 5 succeeds
    const valid = await pipeline.dispatch({
      adapter_id: 'fake-t1',
      prompt: 'valid prompt',
      cap_usd: 4.5,
    });
    assert.equal(valid.status, 'DRY_RUN');
    assert.equal(valid.request?.cap_usd, 4.5);
  });

  await t.test('2. Telemetry actual cost is accurately fed back to budget ledger', async () => {
    const pipeline = new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      ledgerPath,
      persistence,
      runAdapter: async (_contract, _prompt, _opts) => {
        return {
          exitCode: 0,
          stdout: 'execution success\nsession_id: test_session_123',
          stderr: '',
          timedOut: false,
          childKilled: false,
          receipt: {
            telemetry: {
              input_tokens: 1000,
              output_tokens: 200,
              cache_creation_tokens: 0,
              cache_read_tokens: 0,
              total_cost_usd: 0.045678,
              cache_savings_usd: 0,
            },
          },
        };
      },
    });

    const beforeSpent = pipeline.budgetProjection().actors.find((a) => a.actor_id === 'fake-t1')?.spent_usd ?? 0;

    const record = await pipeline.dispatch(
      {
        adapter_id: 'fake-t1',
        prompt: 'telemetry test task',
        cap_usd: 5,
        real: true,
      },
      { originOwner: true }
    );
    assert.equal(record.status, 'PASS');

    const afterSpent = pipeline.budgetProjection().actors.find((a) => a.actor_id === 'fake-t1')?.spent_usd ?? 0;
    assert.equal(afterSpent, Math.round((beforeSpent + 0.045678) * 1_000_000) / 1_000_000);
  });

  await t.test('3. Budget ledger persists to disk and completely rehydrates on pipeline restart', async () => {
    // Pipeline instance 1 writes several operations
    const pipeline1 = new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      ledgerPath,
      persistence,
      runAdapter: async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        childKilled: false,
        receipt: {
          telemetry: {
            input_tokens: 500,
            output_tokens: 100,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            total_cost_usd: 0.02,
            cache_savings_usd: 0,
          },
        },
      }),
    });

    await pipeline1.dispatch(
      {
        adapter_id: 'fake-t1',
        prompt: 'step 1',
        amount_usd: 0.1,
        real: true,
      },
      { originOwner: true }
    );

    const spent1 = pipeline1.budgetProjection().actors.find((a) => a.actor_id === 'fake-t1')?.spent_usd;
    assert.ok(spent1 !== undefined && spent1 > 0);

    // Pipeline instance 2 (simulating server restart) created fresh from disk
    const pipeline2 = new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      ledgerPath,
      persistence,
      runAdapter: fakeOk,
    });

    const spent2 = pipeline2.budgetProjection().actors.find((a) => a.actor_id === 'fake-t1')?.spent_usd;
    assert.equal(spent2, spent1, 'Rehydrated pipeline must preserve exact spent USD across restarts');

    // Verify cryptographic ledger hash chain integrity
    assert.doesNotThrow(() => {
      persistence.verifyLedgerChain();
    });
  });
});
