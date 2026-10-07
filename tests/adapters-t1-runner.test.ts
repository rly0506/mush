import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  runT1,
  resolveWindowsShim,
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
  assert.equal((child as unknown as FakeChildHandle).stdinData, 'fixture prompt 测试', 'prompt must be written to stdin exactly');
  assert.equal((child as unknown as FakeChildHandle).stdinEnded, true, 'stdin must close after prompt');
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
  assert.equal((child as unknown as FakeChildHandle).killed, true);
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

// DEF-12：垫片入口匹配必须覆盖 .mjs（kimi = dist/main.mjs）与 .js（dsh）。
// win32 门内直测（本仓开发环境即 win32；非 win32 平台跳过）。
test('resolveWindowsShim handles .mjs and .js entries (DEF-12 regression)', { skip: process.platform !== 'win32' }, () => {
  // 不与真实 PATH 撞名的可执行名，垫片放临时目录并临时前置 PATH。
  const dir = path.join(WORKSPACE, 'shim-def12-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const kimiShim = [
    '@ECHO off',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@moonshot-ai\\kimi-code\\dist\\main.mjs" %*',
  ].join('\r\n');
  writeFileSync(path.join(dir, 'mush-def12-mjs.cmd'), kimiShim, 'utf8');
  const jsShim = 'node "%~dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*\r\n';
  writeFileSync(path.join(dir, 'mush-def12-js.cmd'), jsShim, 'utf8');
  writeFileSync(path.join(dir, 'mush-def12-none.cmd'), '@ECHO off\r\nno entry here\r\n', 'utf8');

  const previousPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + previousPath;
  try {
    const mjs = resolveWindowsShim('mush-def12-mjs');
    assert.ok(mjs, '.mjs entry must resolve');
    assert.equal(mjs.kind, 'node');
    assert.ok(mjs.kind === 'node' && path.basename(mjs.entry) === 'main.mjs');
    assert.ok(mjs.kind === 'node' && mjs.entry.toLowerCase().includes('node_modules'));
    const js = resolveWindowsShim('mush-def12-js');
    assert.ok(js, '.js entry must still resolve');
    assert.ok(js.kind === 'node' && path.basename(js.entry) === 'bin.js');
    // D82 批次：原生 exe 垫片（opencode 形态）→ exe 计划
    const exeShim = [
      '@ECHO off',
      '""%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*',
    ].join('\r\n');
    writeFileSync(path.join(dir, 'mush-d82-exe.cmd'), exeShim, 'utf8');
    const exe = resolveWindowsShim('mush-d82-exe');
    assert.ok(exe, 'exe-target shim must resolve');
    assert.equal(exe.kind, 'exe');
    assert.ok(exe.kind === 'exe' && path.basename(exe.exe) === 'opencode.exe');
    assert.ok(exe.kind === 'exe' && exe.exe.toLowerCase().includes('node_modules'));
    assert.equal(resolveWindowsShim('mush-def12-none'), null, 'no-entry shim resolves null');
  } finally {
    process.env.PATH = previousPath;
  }
});

test('D82 修订：argument 运输 spawn 后立即关闭 stdin 写端（opencode 非 TTY 恒挂回归）', async () => {
  let child: FakeChildHandle | null = null;
  const spawn: SpawnFn = (executable, args) => {
    assert.equal(executable, 'fake.exe');
    assert.deepEqual(args, ['--headless', 'fixture prompt']);
    child = makeFakeChild({ stdout: 'ok', exitCode: 0 });
    return child;
  };
  await runT1({
    contract: makeContract({ prompt_transport: 'argument' }),
    prompt: 'fixture prompt',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  const handle = child as unknown as FakeChildHandle;
  assert.equal(handle.stdinData, '', 'argument transport must not write stdin');
  assert.equal(handle.stdinEnded, true, 'stdin write-end must close immediately: EOF-waiting CLIs (opencode) otherwise hang forever');
});

test('D82 批次：stderr 增量透传（opencode 工具活动走 stderr）', async () => {
  const chunks: string[] = [];
  const spawn: SpawnFn = () => makeFakeChild({ stdout: 'ok', stderr: '$ ls -1 | wc -l\n20', exitCode: 0 });
  await runT1({
    contract: makeContract(),
    prompt: 'p',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
    onStderr: (chunk) => chunks.push(chunk),
  });
  assert.ok(chunks.join('').includes('$ ls -1'), 'stderr chunks must reach the host callback');
});

test('D82 修订（DEF-14）：cwd_flag 通道显式注入工作目录到 argv', async () => {
  const captured: string[][] = [];
  const spawn: SpawnFn = (_exe, args) => {
    captured.push([...args]);
    return makeFakeChild({ stdout: 'ok', exitCode: 0 });
  };
  await runT1({
    contract: makeContract({ prompt_transport: 'argument', cwd_flag: '--dir' }),
    prompt: 'count files',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  assert.deepEqual(captured[0], ['--headless', '--dir', WORKSPACE, 'count files'],
    'cwd flag+dir must sit between base args and the prompt');
  // 未声明 cwd_flag 的通道保持原样（不注入）
  await runT1({
    contract: makeContract({ prompt_transport: 'argument' }),
    prompt: 'no cwd',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  assert.deepEqual(captured[1], ['--headless', 'no cwd']);
});

test('GOAL-075 切片2：ndjson-events 通道归一化——stdout 人类可读 + sessionId + 真实计量', async () => {
  const ndjson = [
    '{"type":"step_start","sessionID":"ses_fix","part":{"type":"step-start"}}',
    '{"type":"reasoning","sessionID":"ses_fix","part":{"type":"reasoning","text":"37*29 = 1073"}}',
    '{"type":"text","sessionID":"ses_fix","part":{"type":"text","text":"1073"}}',
    '{"type":"step_finish","sessionID":"ses_fix","part":{"reason":"stop","tokens":{"input":24,"output":4,"reasoning":7,"cache":{"read":39040,"write":0}}}}',
  ].join('\n');
  const spawn: SpawnFn = () => makeFakeChild({ stdout: ndjson, stderr: '', exitCode: 0 });
  const result = await runT1({
    contract: makeContract({ prompt_transport: 'argument', output_format: 'ndjson-events' }),
    prompt: 'p',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
    outputFormat: 'ndjson-events',
    outputNormalizer: (raw) => {
      const ev = JSON.stringify(raw).length > 0 ? raw : '';
      // 测试注入的简化归一化器：与生产 normalizeOpencodeEvents 同构
      const lines = ev.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const text = lines.filter((l) => l.type === 'text').map((l) => l.part.text).join('\n');
      const thinking = lines.filter((l) => l.type === 'reasoning').map((l) => l.part.text).join('\n');
      const finish = lines.find((l) => String(l.type).startsWith('step_finish'));
      const t = finish && finish.part && finish.part.tokens;
      return {
        text,
        thinking,
        sessionId: 'ses_fix',
        telemetry: t ? { input_tokens: t.input, output_tokens: t.output, cache_creation_tokens: t.cache.write, cache_read_tokens: t.cache.read, total_cost_usd: 0, cache_savings_usd: 0 } : undefined,
      };
    },
  });
  assert.match(result.stdout, /^Thinking: /, 'thinking block must be prefixed for CLI-parity display');
  assert.ok(result.stdout.includes('1073'));
  assert.equal(result.sessionId, 'ses_fix');
  assert.equal(result.receipt.telemetry?.input_tokens, 24);
  assert.equal(result.receipt.telemetry?.cache_read_tokens, 39040);

  // 未声明 output_format 时原样透传（不归一化）
  const raw2 = await runT1({
    contract: makeContract({ prompt_transport: 'argument' }),
    prompt: 'p2',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
    outputNormalizer: () => ({ text: 'SHOULD-NOT-APPLY' }),
  });
  assert.match(raw2.stdout, /"type":"step_start"/, 'without declared format stdout must stay raw');
});

test('GOAL-084：prompt_flag 通道——能力注入参数落在收尾值参旗标之前，prompt 恒紧随旗标', async () => {
  // agy 形态：`-p <prompt>` 为收尾值参；若把旗标插在 `-p` 与 prompt 之间，
  // agy 会把旗标当 prompt（2026-09-06 实弹教训）。runner 必须拼成
  // [...args, ...capability, '-p', prompt]。
  const captured: string[][] = [];
  const spawn: SpawnFn = (_exe, args) => {
    captured.push([...args]);
    return makeFakeChild({ stdout: 'ok', exitCode: 0 });
  };
  const contract = makeContract({
    prompt_transport: 'argument',
    prompt_flag: '-p',
    tool_restriction_args: ['--sandbox'],
  });
  await runT1({
    contract,
    prompt: 'discuss the design',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
    restrictTools: true,
  });
  assert.deepEqual(captured[0], ['--headless', '--sandbox', '-p', 'discuss the design']);
  // 未声明 prompt_flag 的通道保持原样（prompt 直接收尾）
  await runT1({
    contract: makeContract({ prompt_transport: 'argument' }),
    prompt: 'plain prompt',
    workspaceRoot: WORKSPACE,
    receiptPath: RECEIPT,
    timeoutMs: 1000,
    spawn,
  });
  assert.deepEqual(captured[1], ['--headless', 'plain prompt']);
});
