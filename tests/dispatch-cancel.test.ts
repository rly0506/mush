import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, type RunAdapterFn } from '../src/web/dispatch.ts';
import { ChatService } from '../src/web/chat.ts';
import { renderBoardPage } from '../src/web/page.ts';

// D84（2026-09-06）：owner 停止运行中的派发——runner 注册树杀句柄 → 管线 cancel()
// 杀子进程 → 终态如实记 INTERRUPTED（不判 FAIL、不触发故障转移、不计熔断）；
// 聊天回合中断后回写会话，UI 思考/生成行提供「停止」按钮。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'dispatch-cancel', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

interface KillHandle {
  promise: Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; childKilled: boolean }>;
  /** registerKill 已被管线调用（句柄注册）。 */
  handleRegistered: boolean;
  /** kill 已被真正调用（cancel 触发）。 */
  killInvoked: boolean;
  triggerKill(): void;
}

/** 可中断的 fake runner：spawn 即注册树杀句柄；kill 触发后以非零码结算（模拟子进程被杀）。 */
function makeCancellableAdapter(): RunAdapterFn & { last: KillHandle } {
  const last: KillHandle = {
    handleRegistered: false,
    killInvoked: false,
    triggerKill() {},
    promise: Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  };
  const adapter: RunAdapterFn = (_contract, _prompt, opts) => {
    let release!: (r: { exitCode: number; stdout: string; stderr: string; timedOut: boolean; childKilled: boolean }) => void;
    last.promise = new Promise((resolve) => {
      release = resolve;
    });
    const kill = () => {
      last.killInvoked = true;
      release({ exitCode: 1, stdout: '', stderr: 'terminated', timedOut: false, childKilled: true });
    };
    opts?.registerKill?.(kill);
    last.handleRegistered = true;
    last.triggerKill = kill;
    return last.promise;
  };
  return Object.assign(adapter, { last });
}

function makePipeline(root: string, runAdapter: RunAdapterFn): DispatchPipeline {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'budget-ledger.jsonl'),
    runAdapter,
  });
}

test('D84: cancel kills the running child and the record honestly ends INTERRUPTED', async () => {
  const root = fixtureRoot();
  const adapter = makeCancellableAdapter();
  const pipeline = makePipeline(root, adapter);
  // 管线只接受 32 位十六进制的外部 dispatchId（其余回落随机 id）。
  const dispatchId = 'd84cd84cd84cd84cd84cd84cd84cd84c';
  const running = pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'long task', real: false }, { dispatchId });
  // 等 runAdapter 被调用（句柄已注册）再请求中断——派发前置有多级异步步骤，轮询等待。
  for (let i = 0; i < 100 && !adapter.last.handleRegistered; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(adapter.last.handleRegistered, 'runner must register its kill handle on spawn');
  const record = pipeline.cancel(dispatchId);
  assert.equal(record.dispatch_id, dispatchId);
  assert.ok(adapter.last.killInvoked, 'cancel must invoke the registered tree-kill handle');
  const settled = await running;
  assert.equal(settled.status, 'INTERRUPTED', 'interrupted run must end INTERRUPTED, not FAIL');
  assert.match(settled.error ?? '', /owner/);
  assert.throws(() => pipeline.cancel(settled.dispatch_id), /already finished/, 'finished dispatch is not cancellable');
  assert.throws(() => pipeline.cancel('nonexistent-id'), /not found/, 'unknown dispatch is not cancellable');
});

test('D84: cancelling a chat turn writes an INTERRUPTED head turn into the session', async () => {
  const root = fixtureRoot();
  const adapter = makeCancellableAdapter();
  const pipeline = makePipeline(path.join(root, 'workspace'), adapter);
  const chat = new ChatService({ pipeline, runtimeRoot: path.join(root, 'runtime') });
  const ack = await chat.post({ message: '长任务' });
  await new Promise((resolve) => setImmediate(resolve));
  pipeline.cancel(ack.dispatch_id);
  await chat.whenSettled();
  const history = await chat.history(ack.session_id);
  assert.equal(history.turns.length, 2, 'user + interrupted head turn');
  assert.equal(history.turns[1].status, 'INTERRUPTED');
  assert.match(history.turns[1].text, /owner|停止/);
  assert.notEqual(history.turns[1].status, 'FAIL');
});

test('D84: board page carries the stop button and cancel endpoint wiring', () => {
  const html = renderBoardPage();
  assert.match(html, /data-chat-stop/, 'thinking row must expose a stop button');
  assert.match(html, /\/api\/dispatches\/cancel/, 'cancel endpoint must be wired');
});
