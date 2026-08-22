/**
 * GOAL-067: 全栈审计修复回归测试
 *
 * 覆盖 P0-P2 修复点：
 * - P0-1  persistence JSONL 撕裂行容错（坏行跳过 + 不崩启动）
 * - P1-7  time-travel 快照读侧/还原写侧路径包含性校验（含兄弟目录前缀绕过）
 * - P1-8  POST /api/memory/distill session_id 白名单
 * - P1-9  GET /api/workspaces/fs-tree UNC 阻断（SMB 探测防线）
 * - P2-12 GET /api/child-sessions 与 GET /api/harness/doctor 契约兑现
 * - P2-16 isGoalIdCompleted 严格 GOAL- 前缀匹配（B7 反例）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoardPersistence } from '../src/web/persistence.ts';
import { TimeTravelKernel } from '../src/orchestration/time-travel.ts';
import { resolveInsideWorkspace } from '../src/core/path-guard.ts';
import { isGoalIdCompleted } from '../src/web/tasks.ts';
import { startBoardServer } from '../src/web/server.ts';

test('GOAL-067 P0-1: persistence loaders skip torn lines instead of crashing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g067-persistence-'));
  try {
    const persistence = new BoardPersistence(root);

    // 派发单：合法 header + 合法事件 + 撕裂半行 → 回放不抛，事件照常入账
    mkdirSync(path.join(root, 'dispatches'), { recursive: true });
    writeFileSync(
      path.join(root, 'dispatches', 'c'.repeat(32) + '.jsonl'),
      JSON.stringify({ kind: 'header', dispatch_id: 'c'.repeat(32), adapter_id: 'kimi', status: 'PASS' }) + '\n' +
        '{"kind":"event","phase":"REPORT","status":"PASS"' + '\n',
      'utf8',
    );
    const records = persistence.loadDispatchRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].dispatch_id, 'c'.repeat(32));

    // 台账：一行好 + 一行撕裂 → 只回好行
    writeFileSync(
      path.join(root, 'budget-ledger.jsonl'),
      JSON.stringify({ at_utc: new Date().toISOString(), actor_id: 'kimi', decision: 'ADMITTED', amount_usd: 0.5 }) + '\n' +
        '{"at_utc":"2026-08-22T00:' + '\n',
      'utf8',
    );
    const ledger = persistence.loadLedgerLines();
    assert.equal(ledger.length, 1);

    // releaseLock 对损坏锁文件静默自愈（close 流程不被锁异常卡死）
    writeFileSync(path.join(root, 'board.lock'), '{broken', 'utf8');
    assert.doesNotThrow(() => persistence.releaseLock());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-067 P1-7: resolveInsideWorkspace rejects traversal and sibling-prefix escapes', () => {
  const ws = path.resolve('D:\\mush-fake-ws');
  assert.equal(resolveInsideWorkspace(ws, 'src/a.ts'), path.resolve(ws, 'src/a.ts'));
  assert.equal(resolveInsideWorkspace(ws, '..\\outside.txt'), null);
  assert.equal(resolveInsideWorkspace(ws, '../../etc/passwd'), null);
  // 兄弟目录前缀绕过（F-AUD-03 同款）：D:\mush-fake-ws-backup 不得通过
  assert.equal(resolveInsideWorkspace(ws, '..\\mush-fake-ws-backup\\x.txt'), null);
});

test('GOAL-067 P1-7: time-travel snapshot read side refuses workspace escape', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g067-tt-'));
  try {
    const ws = path.join(root, 'ws');
    mkdirSync(ws, { recursive: true });

    // 工作区外敏感文件：修复前会被整体吸入快照内容并经 HTTP 回显
    const secretPath = path.join(root, 'secret.txt');
    writeFileSync(secretPath, 'TOPSECRET', 'utf8');

    const kernel = new TimeTravelKernel(ws, path.join(root, 'runtime'));
    const node = kernel.createSnapshot('audit', ['..\\secret.txt', 'local.txt'], 'main');
    assert.equal(node.files.length, 0, 'traversal entry must be dropped from snapshot');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-067 P1-7: time-travel restore write side refuses sibling-prefix directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g067-tt2-'));
  try {
    const ws = path.join(root, 'ws');
    mkdirSync(ws, { recursive: true });
    const kernel = new TimeTravelKernel(ws, path.join(root, 'runtime'));

    // 构造带越界 relative_path 的节点（模拟被篡改/历史脏数据），还原必须拒写
    const node = kernel.createSnapshot('seed', [], 'main');
    (node as { files: unknown[] }).files = [
      { relative_path: '..\\ws-sibling\\injected.txt', hash: '', content: 'pwn' },
    ];
    const result = kernel.travelToNode(node.node_id);
    assert.equal(result.restored_files_count, 0);
    assert.equal(existsSync(path.join(root, 'ws-sibling', 'injected.txt')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-067 P2-16: goal completion uses strict GOAL- prefix matching', () => {
  const empty = new Set<string>();
  // D65 基线：GOAL-001 ~ GOAL-055 视为已交付
  assert.equal(isGoalIdCompleted('GOAL-001', empty), true);
  assert.equal(isGoalIdCompleted('goal-055', empty), true);
  // B7 反例：非 GOAL 编号一律不得借数字误判
  assert.equal(isGoalIdCompleted('EPIC-7', empty), false);
  assert.equal(isGoalIdCompleted('BATCH-30', empty), false);
  assert.equal(isGoalIdCompleted('TASK-12-suffix', empty), false);
  // >55 的 GOAL 编号回到显式集合判定
  assert.equal(isGoalIdCompleted('GOAL-056', empty), false);
  assert.equal(isGoalIdCompleted('GOAL-056', new Set(['GOAL-056'])), true);
});

test('GOAL-067 P1-8/P1-9/P2-12: server route contract suite', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g067-server-'));
  const approvalRoot = path.join(root, 'approvals');
  const workspaceRoot = path.join(root, 'workspace');
  const runtimeRoot = path.join(root, 'runtime');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });

  const callerToken = 'g067_caller_token';
  const server = await startBoardServer({
    approvalRoot,
    workspaceRoot,
    runtimeRoot,
    runId: 'test-g067',
    assignmentEpoch: 1,
    callerToken,
    enforceCallerToken: true,
  });
  t.after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;
  const authHeaders = {
    'content-type': 'application/json',
    'x-mush-caller-auth': callerToken,
    Origin: `http://127.0.0.1:${server.port}`,
  };

  await t.test('P1-9: fs-tree rejects UNC paths (SMB probe guard)', async () => {
    const res = await fetch(`${base}/api/workspaces/fs-tree?path=${encodeURIComponent('\\\\evil.com\\share')}`, {
      headers: { Origin: `http://127.0.0.1:${server.port}` },
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as { ok: boolean; error: string };
    assert.equal(data.ok, false);
    assert.match(data.error, /UNC/);
  });

  await t.test('P1-8: memory/distill enforces session_id whitelist', async () => {
    const bad = await fetch(`${base}/api/memory/distill`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: '..\\..\\evil', messages: [] }),
    });
    assert.equal(bad.status, 400);
    const okShape = await fetch(`${base}/api/memory/distill`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        session_id: 'sess_ok_1',
        messages: [
          { sender: 'user', content: '决定了：采用方案 A，落盘 src/a.ts' },
          { sender: 'head', content: '收到，下一步执行。' },
        ],
      }),
    });
    assert.equal(okShape.status, 201);
  });

  await t.test('P2-12: child-sessions routes are live (previously 404)', async () => {
    const listRes = await fetch(`${base}/api/child-sessions`);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; sessions: unknown[] };
    assert.equal(listData.ok, true);
    assert.ok(Array.isArray(listData.sessions));

    // 无 dog 且会话不存在 → 404 明确指引（不再是无路由的兜底 not found）
    const chatMiss = await fetch(`${base}/api/child-sessions/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 'csess_ghost', prompt: 'hi' }),
    });
    assert.equal(chatMiss.status, 404);

    // 参数校验：非法 session_id 形态 → 400
    const badId = await fetch(`${base}/api/child-sessions/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 'bad id!', prompt: 'hi', dog: 'kimi-code' }),
    });
    assert.equal(badId.status, 400);
  });

  await t.test('P2-12: harness doctor returns the 8-harness roster', async () => {
    const res = await fetch(`${base}/api/harness/doctor`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      ok: boolean;
      harnesses: Array<{ id: string; name: string; status: string; installCmd: string }>;
    };
    assert.equal(data.ok, true);
    assert.equal(data.harnesses.length, 8);
    for (const h of data.harnesses) {
      assert.ok(['READY', 'CONFIG_MISSING', 'NOT_INSTALLED'].includes(h.status));
      assert.ok(h.installCmd.length > 0);
    }
  });
});
