import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  runT1,
  type ChildProcessLike,
  type SpawnFn,
} from '../src/adapters/t1-runner.ts';
import { validateAdapterContract } from '../src/adapters/contract.ts';

// GOAL-003 U1：T1 单发 headless + 文件落盘回报通用底座。
// 沙箱对 piped-stdio 子进程 spawn 返回 EPERM（AD-02），因此 runner 接受可注入
// spawn；本测试用 fake 子进程验证运行器语义，生产路径同代码仅换 spawn 实现。

const WORKSPACE = path.resolve(process.cwd(), '.test-fixtures', 'adapters');
const RECEIPT = path.join(WORKSPACE, 't1-receipt.json');

function makeContract(overrides: Record<string, unknown> = {}) {
  return validateAdapterContract({
    adapter_id: 'fake-t1',
    executable: 'fake.exe',
    arguments: ['--headless'],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'fake-provider',
    expected_model_id: 'fake-model',
    ...overrides,
  });
}

interface FakeChildHandle extends ChildProcessLike {
  stdinData: string;
  stdinEnded: boolean;
  killed: boolean;
  exitListeners: Array<(code: number | null) => void>;
  emitExit(code: number | null): void;
}

function makeFakeChild(script: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  autoExitAfterMs?: number;
  hang?: boolean;
}): FakeChildHandle {
  const handle: FakeChildHandle = {
    stdinData: '',
    stdinEnded: false,
    killed: false,
    exitListeners: [],
    stdinWrite(chunk: string): void {
      handle.stdinData += chunk;
    },
    stdinEnd(): void {
      handle.stdinEnded = true;
    },
    onStdout(listener: (chunk: string) => void): void {
      if (script.stdout !== undefined) setTimeout(() => listener(script.stdout as string), 1);
    },
    onStderr(listener: (chunk: string) => void): void {
      if (script.stderr !== undefined) setTimeout(() => listener(script.stderr as string), 1);
    },
    onExit(listener: (code: number | null) => void): void {
      handle.exitListeners.push(listener);
      if (!script.hang) {
        setTimeout(() => handle.emitExit(script.exitCode ?? 0), script.autoExitAfterMs ?? 2);
      }
    },
    emitExit(code: number | null): void {
      for (const listener of [...handle.exitListeners]) listener(code);
    },
    kill(): void {
      handle.killed = true;
      handle.emitExit(null);
    },
  };
  return handle;
}

test('T1 stdin transport writes the exact prompt and captures stdout/stderr/exit code', async () => {
  let child: FakeChildHandle | null = null;
  const spawn: SpawnFn = (executable, args) => {
    assert.equal(executable, 'fake.exe');
    assert.deepEqual(args, ['--headless']);
    child = makeFakeChild({ stdout: 'fixture-stdout', stderr: 'fixture-stderr', exitCode: 0 });
    return child;
  };
  const result = await runT1({
    contract: makeContract(),
    prompt: 'fixture prompt 测试',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  assert.equal((child as FakeChildHandle).stdinData, 'fixture prompt 测试', 'prompt must be written to stdin exactly');
  assert.equal((child as FakeChildHandle).stdinEnded, true, 'stdin must close after prompt');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'fixture-stdout');
  assert.equal(result.stderr, 'fixture-stderr');
});

test('T1 argument transport appends the prompt as the final argument', async () => {
  let args: string[] = [];
  const spawn: SpawnFn = (executable, gotArgs) => {
    args = gotArgs;
    return makeFakeChild({ stdout: '', exitCode: 0 });
  };
  await runT1({
    contract: makeContract({ prompt_transport: 'argument' }),
    prompt: 'prompt-as-arg',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  assert.deepEqual(args, ['--headless', 'prompt-as-arg']);
});

test('T1 writes a file-based receipt with stream hash anchors', async () => {
  const spawn: SpawnFn = () =>
    makeFakeChild({ stdout: 'receipt-stdout', stderr: 'receipt-stderr', exitCode: 0 });
  const result = await runT1({
    contract: makeContract(),
    prompt: 'p',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  assert.ok(existsSync(RECEIPT), 'receipt file must be written');
  const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.adapter_id, 'fake-t1');
  assert.equal(receipt.exit_code, 0);
  assert.equal(receipt.timed_out, false);
  assert.equal(receipt.stdout_sha256, createHash('sha256').update('receipt-stdout').digest('hex').toUpperCase());
  assert.equal(receipt.stderr_sha256, createHash('sha256').update('receipt-stderr').digest('hex').toUpperCase());
  assert.equal(result.receiptPath, RECEIPT);
});

test('T1 timeout kills the child and reports timed_out fail-closed', async () => {
  let child: FakeChildHandle | null = null;
  const spawn: SpawnFn = () => {
    child = makeFakeChild({ hang: true });
    return child;
  };
  const result = await runT1({
    contract: makeContract(),
    prompt: 'p',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 20,
    spawn,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.childKilled, true);
  assert.equal(result.exitCode, 124);
  assert.equal((child as FakeChildHandle).killed, true);
});

test('T1 identity verifier is fail-closed: mismatch throws and is recorded in the receipt', async () => {
  const spawn: SpawnFn = () => makeFakeChild({ stdout: 'identity-wrong', exitCode: 0 });
  await assert.rejects(
    () =>
      runT1({
        contract: makeContract(),
        prompt: 'p',
        workspaceRoot: WORKSPACE,
        receiptPath: RECEIPT,
        timeoutMs: 1000,
        spawn,
        identityVerifier: ({ stdout }) => {
          if (!stdout.includes('expected-marker')) throw new Error('identity mismatch: runtime model');
        },
      }),
    /identity mismatch/i,
  );
  const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.identity_fail_closed, true);
});

test('T1 identity verifier passes matching runtime evidence; non-t1 protocols are rejected by the T1 runner', async () => {
  const spawn: SpawnFn = () => makeFakeChild({ stdout: 'expected-marker ok', exitCode: 0 });
  await assert.doesNotReject(() =>
    runT1({
      contract: makeContract(),
      prompt: 'p',
      workspaceRoot: WORKSPACE,
      receiptPath: RECEIPT,
      timeoutMs: 1000,
      spawn,
      identityVerifier: ({ stdout }) => {
        if (!stdout.includes('expected-marker')) throw new Error('identity mismatch');
      },
    }),
  );
  await assert.rejects(
    () =>
      runT1({
        contract: makeContract({ protocol: 'pi-rpc' }),
        prompt: 'p',
        workspaceRoot: WORKSPACE,
        receiptPath: RECEIPT,
        timeoutMs: 1000,
        spawn,
      }),
    /t1/i,
  );
});

// DEF-02 回归：spawn 失败（可执行不存在，真实 node spawn ENOENT 路径）必须
// 受控收尾——回执落盘且带 spawn_error 标记、抛 BLOCKED_ENV、宿主进程不崩溃。
test('DEF-02: real spawn ENOENT is contained as BLOCKED_ENV with spawn_error receipt (no crash)', async () => {
  const receiptPath = path.join(WORKSPACE, 'def02-spawn-enoent-receipt.json');
  await assert.rejects(
    runT1({
      contract: { ...makeContract(), executable: 'mush-def02-missing-exe-xyz' },
      prompt: 'probe',
      workspaceRoot: WORKSPACE,
      receiptPath,
      timeoutMs: 5000,
    }),
    /spawn failed \(BLOCKED_ENV\)/,
  );
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { exit_code: number; spawn_error?: string };
  assert.equal(receipt.exit_code, 127);
  // 环境自适应（AD-02）：普通环境 ENOENT、沙箱 EPERM 均为合法 spawn 失败路径。
  assert.match(receipt.spawn_error ?? '', /ENOENT|EPERM|mush-def02-missing-exe-xyz/);
});
