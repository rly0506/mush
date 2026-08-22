import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DispatchPipeline, InputError, type RunAdapterFn } from '../src/web/dispatch.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { runT1, killProcessTree, type ChildProcessLike } from '../src/adapters/t1-runner.ts';
import { runPiRpc, type PiRpcSpawnFn } from '../src/adapters/pi-rpc-runner.ts';
import { buildPiContract } from '../src/adapters/pi.ts';
import { buildDeepSeekContract } from '../src/adapters/deepseek.ts';

test('GOAL-065 Process Resilience, EPIPE Guard, Tree Kill & Fail-Closed Suite', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g065-'));
  const approvalTokensPath = path.join(root, 'runtime', 'approval-tokens');
  const approvalRoot = path.join(root, 'approvals');
  const workspaceRoot = path.join(root, 'workspace');
  const runtimeRoot = path.join(root, 'runtime');
  const ledgerPath = path.join(runtimeRoot, 'budget-ledger.jsonl');
  mkdirSync(approvalTokensPath, { recursive: true });
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });

  const persistence = new BoardPersistence(runtimeRoot);

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('1. Subprocess premature exit + stdin EPIPE is gracefully caught without process crash', async () => {
    const contract = buildDeepSeekContract('dsh');
    // Mock child process that immediately simulates an EPIPE error on stdin
    const mockSpawn = (): ChildProcessLike => {
      const emitter = new EventEmitter();
      return {
        stdinWrite: () => {
          throw new Error('EPIPE: broken pipe');
        },
        stdinEnd: () => {
          throw new Error('EPIPE: broken pipe');
        },
        onStdout: (cb) => emitter.on('stdout', cb),
        onStderr: (cb) => emitter.on('stderr', cb),
        onExit: (cb) => emitter.on('exit', cb),
        onError: (cb) => emitter.on('error', cb),
        kill: () => {},
      };
    };

    const receiptPath = path.join(workspaceRoot, 'receipt.json');
    // Must reject with controlled BLOCKED_ENV / spawn error and not unhandled exception
    await assert.rejects(
      () =>
        runT1({
          contract: { ...contract, protocol: 't1', prompt_transport: 'stdin' },
          prompt: 'test prompt',
          workspaceRoot,
          receiptPath,
          timeoutMs: 1000,
          spawn: mockSpawn,
        }),
      /spawn failed \(BLOCKED_ENV\)/i
    );
  });

  await t.test('2. killProcessTree handles invalid/mock PIDs safely without throwing', () => {
    assert.doesNotThrow(() => {
      killProcessTree(undefined);
      killProcessTree(999999999);
    });
  });

  await t.test('3. pi-rpc runner is strictly fail-closed when child exits 0 before settling', async () => {
    const contract = buildPiContract();
    const mockPiSpawn: PiRpcSpawnFn = () => {
      const outEmitter = new EventEmitter();
      const errEmitter = new EventEmitter();
      const procEmitter = new EventEmitter();

      setTimeout(() => {
        // Child exits with 0 immediately without sending state or completion
        procEmitter.emit('exit', 0);
      }, 20);

      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: { on: (event: string, cb: any) => outEmitter.on(event, cb) },
        stderr: { on: (event: string, cb: any) => errEmitter.on(event, cb) },
        on: (event: string, cb: any) => procEmitter.on(event, cb),
        kill: () => {},
      };
    };

    const result = await runPiRpc(contract, 'test prompt', {
      workspaceRoot,
      receiptPath: path.join(workspaceRoot, 'pi-receipt.json'),
      timeoutMs: 1000,
      spawn: mockPiSpawn,
    });

    assert.equal(result.failClosedReason, 'agent-exited-before-settled');
    assert.notEqual(result.exitCode, 0, 'Exit code must be non-zero when agent exits prematurely');
  });

  await t.test('4. Atomic approval token consumption prevents concurrent double-spending (TOCTOU)', async () => {
    const pipeline = new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      approvalTokensPath,
      ledgerPath,
      persistence,
      runAdapter: async () => ({
        exitCode: 0,
        stdout: 'executed successfully',
        stderr: '',
        timedOut: false,
        childKilled: false,
      }),
    });

    const tokenFor = 'race-token-123';
    const tokenFile = path.join(approvalTokensPath, `dispatch-${tokenFor}.token.json`);
    writeFileSync(
      tokenFile,
      JSON.stringify({
        dispatch_id: tokenFor,
        created_at: new Date().toISOString(),
      }),
      'utf8'
    );

    // Launch 5 concurrent dispatch calls attempting to consume the same approval token
    const results = await Promise.allSettled(
      Array.from({ length: 5 }).map(() =>
        pipeline.dispatch(
          {
            adapter_id: 'fake-t1',
            prompt: 'concurrent test',
            cap_usd: 5,
            real: true,
          },
          { approvedVia: tokenFor }
        )
      )
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly 1 concurrent dispatch must successfully consume the token');
    assert.equal(rejected.length, 4, 'All other concurrent dispatches must be rejected');

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        assert.ok(rej.reason instanceof InputError);
        assert.match(rej.reason.message, /already consumed|not found/i);
      }
    }
  });
});
