/**
 * GOAL-068: 多项目完全数据隔离与动态热切换回归测试
 *
 * 覆盖 DoD：
 * - 多工程物理隔离：A/B 双目录互切，任务池/派发追踪/聊天历史零残留、毫秒级恢复；
 * - 全局资金总控（D2）：共享 MasterBudgetGate 下跨项目超支被拦截，全局链可验证。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline, type RunAdapterFn } from '../src/web/dispatch.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { MasterBudgetGate } from '../src/core/budget-master.ts';

const fakeOk: RunAdapterFn = async () => ({
  exitCode: 0,
  stdout: 'ok session_id=g068sess',
  stderr: '',
  timedOut: false,
  childKilled: false,
});

test('GOAL-068 multi-project full data isolation & hot-switching suite', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g068-'));
  const wsA = path.join(root, 'project-a');
  const wsB = path.join(root, 'project-b');
  mkdirSync(path.join(wsA, 'goals', 'receipts'), { recursive: true });
  mkdirSync(path.join(wsB, 'goals', 'receipts'), { recursive: true });
  mkdirSync(path.join(wsA, 'runtime'), { recursive: true });
  // GOAL-068（D2）：把 master ledger 指到测试临时目录，避免污染真实 ~/.mush。
  const previousLedgerPath = process.env.MUSH_MASTER_LEDGER_PATH;
  let server: BoardServer | undefined;
  t.after(async () => {
    try {
      await server?.close();
    } finally {
      if (previousLedgerPath === undefined) delete process.env.MUSH_MASTER_LEDGER_PATH;
      else process.env.MUSH_MASTER_LEDGER_PATH = previousLedgerPath;
      rmSync(root, { recursive: true, force: true });
    }
  });
  process.env.MUSH_MASTER_LEDGER_PATH = path.join(root, 'master-ledger.jsonl');

  // 缺省上下文：注入 fake runner 管线（沙箱 piped-spawn 不可用，AD-02）。
  const injectedPipeline = new DispatchPipeline({
    workspaceRoot: wsA,
    approvalRoot: path.join(wsA, 'goals', 'receipts', 'approval-requests'),
    ledgerPath: path.join(wsA, 'runtime', 'budget-ledger.jsonl'),
    persistence: new BoardPersistence(path.join(wsA, 'runtime')),
    runAdapter: fakeOk,
  });

  server = await startBoardServer({
    approvalRoot: path.join(wsA, 'approvals'),
    workspaceRoot: wsA,
    runtimeRoot: path.join(wsA, 'runtime'),
    runId: 'g068-iso',
    assignmentEpoch: 1,
    callerToken: 'g068_caller_token',
    enforceCallerToken: true,
    masterCapUsd: 1,
    dispatch: injectedPipeline,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const headers = {
    'content-type': 'application/json',
    'x-mush-caller-auth': 'g068_caller_token',
    Origin: base,
  };

  await t.test('P1 A-context: task lands in project-a runtime only', async () => {
    const created = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'A-only task' }),
    });
    assert.equal(created.status, 201);

    const list = (await (await fetch(`${base}/api/tasks`)).json()) as { tasks: Array<{ title: string }> };
    assert.equal(list.tasks.length, 1);
    assert.ok(existsSync(path.join(wsA, 'runtime', 'tasks.jsonl')), 'A 任务池必须落 A 的 runtime');
    assert.equal(existsSync(path.join(wsB, 'runtime', 'tasks.jsonl')), false, 'B 不得出现 A 的任务池文件');
  });

  await t.test('P2 hot-switch to B: zero residue; back to A: instant restore', async () => {
    // A 视角先建立聊天历史（resume 固定 session id，便于跨切换断言）
    const chatRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello project A', resume: 'g068iso' }),
    });
    assert.ok(chatRes.status === 202 || chatRes.status === 200, 'chat accepted');

    const selB = await fetch(`${base}/api/workspaces/select`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: wsB }),
    });
    assert.equal(selB.status, 201);

    // 任务池：B 为空，A 数据不可见
    const listB = (await (await fetch(`${base}/api/tasks`)).json()) as { tasks: unknown[] };
    assert.equal(listB.tasks.length, 0);
    assert.equal(existsSync(path.join(wsB, 'runtime', 'tasks.jsonl')), false);

    // 派发追踪：B 上下文零残留
    const snap = (await (await fetch(`${base}/api/snapshot`)).json()) as { dispatches?: unknown[] };
    assert.equal((snap.dispatches ?? []).length, 0);

    // 聊天历史：同一 session 在 B 视角不存在（空 turns 或 not-found 均视为隔离）
    const histB = await fetch(`${base}/api/chat/history?session=g068iso`);
    if (histB.status === 200) {
      const data = (await histB.json()) as { turns?: unknown[] };
      assert.equal((data.turns ?? []).length, 0, 'B 视角不得看到 A 的聊天历史');
    }

    // 切回 A：任务毫秒级恢复（磁盘回放），聊天历史原样
    const selA = await fetch(`${base}/api/workspaces/select`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: wsA }),
    });
    assert.equal(selA.status, 201);
    const listA2 = (await (await fetch(`${base}/api/tasks`)).json()) as { tasks: Array<{ title: string }> };
    assert.equal(listA2.tasks.length, 1);
    const histA2 = (await (await fetch(`${base}/api/chat/history?session=g068iso`)).json()) as {
      turns?: Array<{ text?: string }>;
    };
    assert.ok((histA2.turns ?? []).length >= 1, '切回 A 后聊天历史恢复');
  });

  await t.test('D2 master cap blocks cross-project overspend via shared gate', async () => {
    const gate = new MasterBudgetGate({ filePath: path.join(root, 'cap', 'master-ledger.jsonl'), capUsd: 1 });
    const mkPipe = (ws: string) =>
      new DispatchPipeline({
        workspaceRoot: ws,
        approvalRoot: path.join(ws, 'approvals'),
        ledgerPath: path.join(ws, 'runtime', 'budget-ledger.jsonl'),
        runAdapter: fakeOk,
        masterGate: gate,
      });
    const pipeA = mkPipe(path.join(root, 'cap-a'));
    const pipeB = mkPipe(path.join(root, 'cap-b'));

    // 项目 A 花掉 0.60 —— 总控余量剩 0.40
    const r1 = await pipeA.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'p1', amount_usd: 0.6 });
    assert.notEqual(r1.status, 'FAIL');
    // 项目 B 再申请 0.60 —— 跨项目合计 1.20 > Master Cap 1.00 → DENIED
    const r2 = await pipeB.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'p2', amount_usd: 0.6 });
    assert.equal(r2.status, 'FAIL');
    assert.match(r2.error ?? '', /master budget/i);
    // B 的项目台账留证（kind=MASTER_CAP_EXCEEDED），全局链完整
    assert.ok(existsSync(path.join(root, 'cap-b', 'runtime', 'budget-ledger.jsonl')));
    const bRows = readFileSync(path.join(root, 'cap-b', 'runtime', 'budget-ledger.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { meta?: Record<string, unknown> });
    assert.ok(bRows.some((row) => row.meta?.kind === 'MASTER_CAP_EXCEEDED'));
    gate.verifyChain();
    assert.equal(gate.spentAll(), 0.6);
  });
});
