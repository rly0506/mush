import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { runClaudeStreamRun } from '../src/adapters/claude.ts';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';

// GOAL-084 §3.2（2026-10-01）：默认真实 runner 路径的取消接线——此前 registerKill
// 只在注入式适配器测试（dispatch-cancel.test.ts）里生效，默认 runAdapter 的
// runT1/claude 分支从未传入，生产真实派发实际不可中断。本文件不注入 runner：
// 真实 spawn fixture 子进程证明默认路径可被取消。零成本、零网络。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g084-cancel', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function sleepyFixture(root: string, name: string): { script: string; marker: string } {
  const marker = path.join(root, `${name}.marker`);
  const script = path.join(root, `${name}.mjs`);
  writeFileSync(script, [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(marker)}, 'started');`,
    "setTimeout(() => { console.log('done'); process.exit(0); }, 60000);",
    '',
  ].join('\n'), 'utf8');
  return { script, marker };
}

async function waitMarker(marker: string): Promise<void> {
  for (let i = 0; i < 300 && !existsSync(marker); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(existsSync(marker), 'fixture process must have spawned');
}

function t1Contract(executable: string, args: string[]): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'fixture-t1',
    executable,
    arguments: args,
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'fake',
    expected_model_id: 'fixture-t1-model',
  });
}

test('GOAL-084: default runner path (runT1) is cancellable — no injected adapter', async () => {
  const root = fixtureRoot();
  const { script, marker } = sleepyFixture(root, 'sleepy-dog');
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { 'fixture-t1': t1Contract(process.execPath, [script]) },
  });
  const dispatchId = '084c084c084c084c084c084c084c084c';
  const running = pipeline.dispatch(
    { adapter_id: 'fixture-t1', prompt: 'long task', real: true, timeout_s: 60 },
    { dispatchId, originOwner: true },
  );
  await waitMarker(marker);
  const record = pipeline.cancel(dispatchId);
  assert.equal(record.dispatch_id, dispatchId);
  const settled = await running;
  assert.equal(settled.status, 'INTERRUPTED', 'default path cancel must end INTERRUPTED, not FAIL');
  assert.match(settled.error ?? '', /owner/);
  assert.throws(() => pipeline.cancel(dispatchId), /already finished/, 'settled dispatch is not cancellable');
});

test('GOAL-084: claude stream-json runner registers a working kill handle (default spawn)', async () => {
  const root = fixtureRoot();
  const { script, marker } = sleepyFixture(root, 'sleepy-claude');
  const contract = validateAdapterContract({
    adapter_id: 'fixture-claude',
    executable: process.execPath,
    arguments: [script],
    protocol: 'stream-json',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: 'fixture-claude-model',
  });
  let handleRegistered = false;
  let killHandle: (() => void) | null = null;
  const run = runClaudeStreamRun({
    contract,
    prompt: 'long task',
    workspaceRoot: root,
    timeoutMs: 60000,
    registerKill: (kill) => {
      handleRegistered = true;
      killHandle = kill;
    },
  });
  await waitMarker(marker);
  assert.ok(handleRegistered, 'claude runner must register its kill handle on spawn');
  killHandle!(); // 等 fixture 落标记后再触发 kill，避免固定定时与慢启动竞争
  const result = await run;
  assert.equal(result.timedOut, false, 'owner-cancelled run is not a timeout');
  assert.notEqual(result.exitCode, 0, 'killed child settles non-zero');
});

// 2026-10-01 owner 复核补充：完整管线（DispatchPipeline → 默认 runAdapter → claude
// stream-json runner）的取消路径固化——等 fixture 启动标记再取消，不经固定定时。
test('GOAL-084: full pipeline claude dispatch is cancellable — marker-gated cancel', async () => {
  const root = fixtureRoot();
  const { script, marker } = sleepyFixture(root, 'sleepy-claude-pipeline');
  const claudeContract = validateAdapterContract({
    adapter_id: 'fixture-claude-full',
    executable: process.execPath,
    arguments: [script],
    protocol: 'stream-json',
    prompt_transport: 'argument',
    expected_provider: 'fake',
    expected_model_id: 'fixture-claude-full-model',
  });
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    contracts: { 'fixture-claude-full': claudeContract },
  });
  const dispatchId = '084d084d084d084d084d084d084d084d';
  const running = pipeline.dispatch(
    { adapter_id: 'fixture-claude-full', prompt: 'long task', real: true, timeout_s: 60 },
    { dispatchId, originOwner: true },
  );
  await waitMarker(marker);
  const record = pipeline.cancel(dispatchId);
  assert.equal(record.dispatch_id, dispatchId);
  const settled = await running;
  assert.equal(settled.status, 'INTERRUPTED', 'full-pipeline claude cancel must end INTERRUPTED, not FAIL');
  assert.match(settled.error ?? '', /owner/);
});
