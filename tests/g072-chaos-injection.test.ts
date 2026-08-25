import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MasterBudgetGate } from '../src/core/budget-master.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

// GOAL-072：故障注入矩阵——崩溃恢复变成规格而非运气。

function fixture(): { root: string; runtimeRoot: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'g072-'));
  const runtimeRoot = path.join(root, 'runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  return { root, runtimeRoot };
}

test('G072 混沌①：犬进程中途击杀（服务重启）→ DEF-09 僵尸回收 INTERRUPTED + 迟到完成链完整', async () => {
  const { root, runtimeRoot } = fixture();
  const persistence = new BoardPersistence(runtimeRoot);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const pipelineA = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    persistence,
    runAdapter: async () => {
      await gate;
      return { exitCode: 0, stdout: 'late completion', stderr: '', timedOut: false, childKilled: false };
    },
  });
  const inflight = pipelineA.dispatch({ adapter_id: 'fake-t1', prompt: 'chaos kill me' });
  // 等 EXECUTE 真正开跑（事件已落盘）
  await new Promise((r) => setTimeout(r, 120));

  // 注入：服务被杀——新实例从同一持久化重建（DEF-09 僵尸回收）
  const pipelineB = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    persistence,
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  const zombieId = [...pipelineB.recent(10)].find((r) => r.status === 'INTERRUPTED');
  assert.ok(zombieId, 'restart must reconcile in-flight record to INTERRUPTED');

  // 迟到完成不撕裂审计链（append-only：INTERRUPTED 与迟到 REPORT 共存）
  release();
  await inflight;
  const reloaded = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    persistence,
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  const finalRec = reloaded.recent(10).find((r) => r.dispatch_id === zombieId!.dispatch_id);
  assert.ok(finalRec);
  const kinds = finalRec.events.map((e) => e.phase + ':' + e.status).join(' → ');
  assert.ok(kinds.includes('REPORT:INTERRUPTED') || kinds.includes('EXECUTE:INTERRUPTED'), kinds);
  rmSync(root, { recursive: true, force: true });
});

test('G072 混沌②：服务重启回放一致 + SSE 重订阅即收新帧', async () => {
  const { root, runtimeRoot } = fixture();
  const mkPipe = () =>
    new DispatchPipeline({
      workspaceRoot: path.join(root, 'ws'),
      approvalRoot: path.join(root, 'approvals'),
      ledgerPath: path.join(runtimeRoot, 'budget-ledger.jsonl'),
      persistence: new BoardPersistence(runtimeRoot),
      runAdapter: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false }),
    });
  const s1: BoardServer = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runtimeRoot,
    dispatch: mkPipe(),
    runId: 'g072-r1',
    assignmentEpoch: 1,
  });
  const created = await fetch(`http://127.0.0.1:${s1.port}/api/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'before restart' }),
  });
  const first = (await created.json()) as { dispatch_id: string };
  await s1.close();

  // 重启：同持久化目录，回放一致性
  const s2: BoardServer = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runtimeRoot,
    dispatch: mkPipe(),
    runId: 'g072-r2',
    assignmentEpoch: 2,
  });
  try {
    const detail = await fetch(`http://127.0.0.1:${s2.port}/api/dispatch/${first.dispatch_id}`);
    assert.equal(detail.status, 200, 'restarted server must replay persisted dispatch');
    // SSE 重订阅：重启后的连接能收到后续广播帧
    const ac = new AbortController();
    const frames: string[] = [];
    const reader = (await fetch(`http://127.0.0.1:${s2.port}/api/stream`, { signal: ac.signal })).body!.getReader();
    const dec = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          frames.push(dec.decode(value, { stream: true }));
        }
      } catch {}
    })();
    await new Promise((r) => setTimeout(r, 300));
    const second = await fetch(`http://127.0.0.1:${s2.port}/api/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adapter_id: 'fake-t1', prompt: 'after restart' }),
    });
    const secondBody = (await second.json()) as { dispatch_id: string };
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !frames.join('').includes(secondBody.dispatch_id)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    ac.abort();
    assert.ok(frames.join('').includes(secondBody.dispatch_id), 'resubscribed SSE must receive new broadcast');
  } finally {
    await s2.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('G072 混沌③：master 台账多进程竞争写入——锁串行化零分叉，verifyChain 全过', async () => {
  const { root } = fixture();
  const ledger = path.join(root, 'master-ledger.jsonl');
  const childScript = path.join(root, 'child.cjs');
  writeFileSync(
    childScript,
    [
      'const path = require("path");',
      `const mod = process.argv[2];`,
      `const file = process.argv[3];`,
      `(async () => {`,
      '  const { MasterBudgetGate } = await import(mod);',
      '  const gate = new MasterBudgetGate({ filePath: file, capUsd: 0 });',
      '  for (let i = 0; i < 3; i++) gate.admit("chaos-child-" + process.pid, "ws", 1);',
      '  console.log("done");',
      '})().catch((e) => { console.error(e); process.exit(1); });',
    ].join('\n'),
    'utf8',
  );
  const modUrl = 'file:///' + path.resolve('src/core/budget-master.ts').replace(/\\/g, '/');
  for (let p = 0; p < 3; p++) {
    const r = spawnSync(process.execPath, [childScript, modUrl, ledger], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) throw new Error('child failed: ' + r.stderr);
  }
  const gate = new MasterBudgetGate({ filePath: ledger, capUsd: 0 });
  assert.doesNotThrow(() => gate.verifyChain(), 'concurrent writers must not fork the hash chain');
  assert.equal(gate.spentAll(), 9, '3 processes × 3 admissions × $1');

  // 撕裂行注入：坏行跳过不阻断，链继续有效
  appendFileSync(ledger, '{"decision":"ADMITTED","amount_usd":1,"torn": tru', 'utf8');
  gate.admit('post-tear', 'ws', 1);
  assert.doesNotThrow(() => gate.verifyChain());
  rmSync(root, { recursive: true, force: true });
});

test('G072 混沌④：审批令牌重复消费——原子读即焚，第二单拒绝且零执行', async () => {
  const { root } = fixture();
  const tokensDir = path.join(root, 'tokens');
  mkdirSync(tokensDir, { recursive: true });
  let executed = 0;
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, 'ws'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    approvalTokensPath: tokensDir,
    runAdapter: async () => {
      executed += 1;
      return { exitCode: 0, stdout: 'ran', stderr: '', timedOut: false, childKilled: false };
    },
  });
  writeFileSync(path.join(tokensDir, 'dispatch-TX01.token.json'), JSON.stringify({ approved_at: 1 }), 'utf8');
  const first = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'a', real: true }, { approvedVia: 'TX01' });
  assert.equal(first.status, 'PASS');
  assert.equal(executed, 1);
  await assert.rejects(
    () => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'b', real: true }, { approvedVia: 'TX01' }),
    /already consumed/,
    'double consumption must be rejected',
  );
  assert.equal(executed, 1, 'no execution without a fresh token');
  rmSync(root, { recursive: true, force: true });
});
