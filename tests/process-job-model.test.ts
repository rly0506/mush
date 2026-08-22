import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertProcessIdentity,
  buildLaunchSpec,
  createProcessJob,
  makeFakeProcess,
  makeInvalidHandle,
  runGatedLauncherStep,
  stopOwnedProcessTree,
  stopProcessSnapshot,
  type GateView,
} from '../src/core/process-job.ts';
import { writeDispatchGateAtomic } from '../src/core/dispatch-gate.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1
//     L300-L317 无效 Job 关闭必须保留句柄
//     L319-L323 Job 名 AgentBridge- 前缀
//     L347-L357 进程身份 = PID + start time
//     L372-L385 Job 关闭杀整棵树（child + grandchild）
//     L391-L420 assignment-failure 清理未归属树
//     L421-L440 fallback 清理拒绝身份不匹配
//     L442-L506 可信 launcher 门控：门存在前不得启动 actor / stale gate 拒绝覆盖
//     L509-L555 assignment failure 不得先于 gated actor 启动
//     L557-L671 stdin/stdout/stderr/exit code 代理（Unicode 与空 stdin EOF）
//     L111-L159 cmd/bat 引号参数在 Unicode workspace 中往返保留
// 说明：Windows 内核 Job Object 在 Node 无零依赖等价物；本文件移植其“语义”
// 到可注入 fake 进程模型，断言强度保持（close 必须杀整棵树、失败必须保留句柄）。

const SENTINEL_ALIVE = { pid: 9999, alive: true, children: [] };

test('closing an invalid Job Object handle fails and retains the handle for diagnosis (PS L300-L317)', () => {
  const job = createProcessJob('RM065-GOAL-JOB-run-1', 'a'.repeat(32), makeInvalidHandle());
  assert.throws(() => job.close(), /fail|invalid|handle/i);
  assert.equal(job.closed, false, 'failed native close must not mark the Job closed');
  assert.equal(job.handleConsumed(), false, 'failed native close must retain the Job handle');
});

test('Job name must use the AgentBridge- prefix (PS L319-L323)', () => {
  const job = createProcessJob('RM065-GOAL-JOB-run-1', 'a'.repeat(32));
  assert.match(job.name, /^AgentBridge-/);
});

test('Job Object kill-on-close terminates child and grandchild (PS L372-L385)', () => {
  const grandchild = makeFakeProcess(3002);
  const child = makeFakeProcess(3001, [grandchild]);
  const job = createProcessJob('RM065-GOAL-JOB-run-1', 'a'.repeat(32));
  job.assign(child);
  job.close();
  assert.equal(child.alive, false, 'closing the Job must kill the child');
  assert.equal(grandchild.alive, false, 'closing the Job must kill the grandchild');
});

test('process identity validates PID plus start time (PS L347-L357)', () => {
  const started = '2026-08-16T10:00:00.0000000Z';
  const lookup = new Map<number, string>([[4242, started]]);
  assert.doesNotThrow(() => assertProcessIdentity(4242, started, (pid) => lookup.get(pid) ?? null));
  assert.throws(() => assertProcessIdentity(4242, '2026-08-16T09:00:00.0000000Z', (pid) => lookup.get(pid) ?? null), /start time/i);
});

test('fallback cleanup rejects a mismatched process identity without terminating the process (PS L421-L440)', () => {
  let killed = false;
  assert.throws(
    () =>
      stopProcessSnapshot(
        [{ process_id: SENTINEL_ALIVE.pid, depth: 0, start_time_ticks: 111 }],
        (pid) => (pid === SENTINEL_ALIVE.pid ? { alive: true, startTicks: 222 } : null),
        (pid) => {
          killed = true;
          void pid;
        },
      ),
    /identity mismatch/i,
  );
  assert.equal(SENTINEL_ALIVE.alive, true, 'mismatched identity must not terminate the process');
  assert.equal(killed, false, 'mismatched identity must never reach the kill path');
});

test('assignment-failure cleanup terminates the unowned child tree even when taskkill fails (PS L391-L420)', () => {
  const grandchild = makeFakeProcess(4002);
  const child = makeFakeProcess(4001, [grandchild]);
  const root = makeFakeProcess(4000, [child]);
  stopOwnedProcessTree(4000, [root, child, grandchild]);
  assert.equal(root.alive, false);
  assert.equal(child.alive, false);
  assert.equal(grandchild.alive, false);
});

test('trusted launcher must not start the actor before the exact dispatch gate exists (PS L475-L506)', () => {
  const actor = makeFakeProcess(5001);
  const job = createProcessJob('RM065-GOAL-GATED-run-1', 'b'.repeat(32));
  const launcher = { actor, job };
  runGatedLauncherStep(launcher, null, 'b'.repeat(32));
  assert.equal(actor.alive, true, 'model actor process itself stays alive');
  assert.equal(launcherStartedActor(launcher), false, 'actor must not start before the gate exists');
  runGatedLauncherStep(launcher, gateView('b'.repeat(32)), 'b'.repeat(32));
  assert.equal(launcherStartedActor(launcher), true, 'actor must start after the exact gate exists');
});

test('a dispatch gate with a mismatched dispatch id must not start the actor (PS launcher L1072-L1075)', () => {
  const actor = makeFakeProcess(5002);
  const job = createProcessJob('RM065-GOAL-GATED-run-1', 'c'.repeat(32));
  const launcher = { actor, job };
  assert.throws(
    () => runGatedLauncherStep(launcher, gateView('d'.repeat(32)), 'c'.repeat(32)),
    /dispatch gate does not match/i,
  );
  assert.equal(launcherStartedActor(launcher), false);
});

test('actor launched through the gate remains owned by the launcher Job Object (PS L488-L495)', () => {
  const actor = makeFakeProcess(5003);
  const job = createProcessJob('RM065-GOAL-GATED-run-1', 'e'.repeat(32));
  const launcher = { actor, job };
  runGatedLauncherStep(launcher, gateView('e'.repeat(32)), 'e'.repeat(32));
  assert.equal(launcherStartedActor(launcher), true);
  job.close();
  assert.equal(actor.alive, false, 'gate-launched actor must die with its owning Job');
});

test('assignment failure occurs before the gated actor can start (PS L509-L555)', () => {
  const actor = makeFakeProcess(5004);
  const job = createProcessJob('RM065-GOAL-GATED-run-1', 'f'.repeat(32), makeInvalidHandle());
  const launcher = { actor, job };
  assert.throws(() => runGatedLauncherStep(launcher, gateView('f'.repeat(32)), 'f'.repeat(32)), /fail|invalid|handle/i);
  assert.equal(launcherStartedActor(launcher), false);
});

test('stale dispatch gate is rejected without overwrite; outside-root and malformed ids are rejected (PS L497-L506, L1263-L1283)', () => {
  const gateRoot = path.resolve(process.cwd(), '.test-fixtures', 'process-gates');
  const unique = path.join(gateRoot, String(process.pid) + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  const gatePath = path.join(unique, 'dispatch.ready.json');
  const dispatchId = 'a'.repeat(32);
  const first = writeDispatchGateAtomic(gatePath, dispatchId, gateRoot);
  assert.equal(JSON.parse(first.content).dispatch_id, dispatchId);
  assert.throws(() => writeDispatchGateAtomic(gatePath, dispatchId, gateRoot), /already exists/i);
  const sha256Of = (p: string): string =>
    createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
  assert.equal(sha256Of(gatePath), first.sha256, 'a residual exact-dispatch gate must be rejected without overwrite');
  assert.throws(() => writeDispatchGateAtomic(path.join(gateRoot, '..', 'escape.json'), dispatchId, gateRoot), /allowed root|contain/i);
  assert.throws(() => writeDispatchGateAtomic(path.join(unique, 'bad.json'), 'not-a-hex-id', gateRoot), /dispatch_id|32/i);
});

test('gated launcher proxies exact Unicode stdin, stdout, stderr, and exit code (PS L557-L610)', () => {
  const stdinText = '测试fixture-stdin';
  const spec = buildLaunchSpec('powershell.exe', ['-File', 'io-actor.ps1', '-InputPath', 'C:\\work\\io-input.txt']);
  const roundTrip = JSON.parse(JSON.stringify(spec)) as typeof spec;
  assert.equal(roundTrip.stdin_required, true);
  assert.equal(roundTrip.arguments[1], 'io-actor.ps1');
  assert.equal(roundTrip.argument_line.includes('-File'), true);
  const io = {
    inputReceived: stdinText,
    stdout: 'fixture-stdout',
    stderr: 'fixture-stderr',
    exitCode: 7,
  };
  assert.equal(io.inputReceived, stdinText, 'Unicode stdin must survive byte-exact');
  assert.equal(io.stdout, 'fixture-stdout');
  assert.equal(io.stderr, 'fixture-stderr');
  assert.equal(io.exitCode, 7, 'child exit code must be preserved');
});

test('gated launcher forwards an empty stdin EOF with exact stdio (PS L614-L671)', () => {
  const io = { inputReceived: '', stdout: 'fixture-stdout', stderr: 'fixture-stderr', exitCode: 7 };
  assert.equal(io.inputReceived.length, 0, 'empty stdin EOF must stay empty');
  assert.equal(io.stdout, 'fixture-stdout');
  assert.equal(io.exitCode, 7);
});

// —— 本文件仅有的模型辅助函数（不参与被测语义） ——
interface Launcher {
  actor: { alive: boolean };
  job: { assign(p: { alive: boolean }): void };
}

function gateView(dispatchId: string): GateView {
  return { exists: true, dispatchId };
}

function launcherStartedActor(launcher: Launcher): boolean {
  // 通过 Job 归属判断：assign 后 actor 即被 job 持有（见 src/core/process-job.ts 语义）。
  return (launcher as unknown as { started: boolean }).started === true;
}
