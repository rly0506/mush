import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, InputError, CarveoutAuthError, type RunAdapterFn } from '../src/web/dispatch.ts';
import {
  loadCarveouts,
  readCarveoutToken,
  auditCarveoutPaths,
  hasAgentBridgeSegment,
  isPathWithinRoots,
  type Carveout,
} from '../src/web/carveouts.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

// GOAL-014（rm004-p14a）— M0 carve-out 机制：数据模型 + owner 授权通道 +
// dispatch 声明式写面校验 + 事后 diff 审核（运行时拦截留 GP-14）。

function fixtureRoot(): string {
  const root = path.resolve(
    process.cwd(),
    '.test-fixtures',
    'g014a-carveouts',
    `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

const fakeOk: RunAdapterFn = async () => ({ exitCode: 0, stdout: 'OK', stderr: '', timedOut: false, childKilled: false });

function makePipeline(
  root: string,
  overrides: Partial<ConstructorParameters<typeof DispatchPipeline>[0]> = {},
  tokenPath = path.join(root, '.mush', 'carveout-token'),
) {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    carveoutsPath: path.join(root, 'carveouts.jsonl'),
    carveoutTokenPath: tokenPath,
    runAdapter: fakeOk,
    ...overrides,
  });
}

function tokenOf(pipeline: DispatchPipeline, tokenPath: string): string {
  const token = readCarveoutToken(tokenPath);
  assert.ok(token !== null, 'pipeline must auto-ensure a carve-out token on construction');
  return token;
}

const FUTURE = '2099-01-01T00:00:00.000Z';

test('G014A: grant rejects .agent-bridge paths permanently (golden reference baseline)', () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  const token = tokenOf(pipeline, tokenPath);
  assert.throws(
    () => pipeline.grantCarveout({ task_ref: 'G1', paths: [path.join(root, '.agent-bridge', 'backend')], expires_at: FUTURE }, token),
    /permanently denied/,
  );
  assert.throws(
    () => pipeline.grantCarveout({ task_ref: 'G1', paths: [path.join(root, 'ok'), 'D:/any/repo/.agent-bridge/x'] }, token),
    /permanently denied/,
  );
  // deny 判定是段级（.agent-bridge-copy 是真名字不同，不误伤）。
  assert.equal(hasAgentBridgeSegment(path.join(root, '.agent-bridge-copy', 'f')), false);
  assert.equal(hasAgentBridgeSegment(path.join(root, '.agent-bridge', 'f')), true);
});

test('G014A: dispatch carrying carveout_id without ACTIVE slice is rejected (unauthorized path)', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  await assert.rejects(
    () => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', carveout_id: 'deadbeef', cwd: root }),
    InputError,
  );
  // cwd 必须配合 carveout_id（fail-closed，不能只声明 cwd 绕过切片门）。
  await assert.rejects(
    () => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', cwd: root }),
    /requires carveout_id/,
  );
  // 无 ACTIVE 时 active 为 null。
  assert.equal(pipeline.activeCarveout(), null);
});

test('G014A: ACTIVE within whitelist root dispatches and records carveout_id + whitelist snapshot', async () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const calls: string[] = [];
  const pipeline = makePipeline(
    root,
    {
      runAdapter: async (_c, _p, opts) => {
        calls.push(opts.cwd ?? '<none>');
        return { exitCode: 0, stdout: 'OK', stderr: '', timedOut: false, childKilled: false };
      },
    },
    tokenPath,
  );
  const token = tokenOf(pipeline, tokenPath);
  const sub = path.join(root, 'sub');
  mkdirSync(sub, { recursive: true });
  const carveout = pipeline.grantCarveout(
    { task_ref: 'MUSH-GOAL-015', paths: [root, sub], expires_at: FUTURE },
    token,
  );
  assert.equal(carveout.status, 'ACTIVE');
  assert.equal(pipeline.activeCarveout()?.carveout_id, carveout.carveout_id);

  const record = await pipeline.dispatch({
    adapter_id: 'fake-t1',
    prompt: 'realwork on flagship',
    carveout_id: carveout.carveout_id,
    cwd: path.join(sub, 'backend'),
  });
  assert.equal(record.status, 'DRY_RUN');
  assert.equal(record.carveout_id, carveout.carveout_id);
  assert.equal(record.request?.carveout_id, carveout.carveout_id);
  assert.deepEqual(record.request?.carveout_whitelist?.paths, carveout.paths);
  assert.equal(record.request?.carveout_whitelist?.task_ref, 'MUSH-GOAL-015');
  assert.equal(record.request?.carveout_whitelist?.expires_at, FUTURE);
  assert.deepEqual(calls, [path.join(sub, 'backend')], 'spawn cwd must be the carve-out cwd');
});

test('G014A: dispatch cwd under .agent-bridge subtree is denied even inside a valid whitelist', async () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  const token = tokenOf(pipeline, tokenPath);
  const carveout = pipeline.grantCarveout({ task_ref: 'G2', paths: [root], expires_at: FUTURE }, token);
  await assert.rejects(
    () =>
      pipeline.dispatch({
        adapter_id: 'fake-t1',
        prompt: 'x',
        carveout_id: carveout.carveout_id,
        cwd: path.join(root, '.agent-bridge', 'backend'),
      }),
    /permanently denied/,
  );
});

test('G014A: expired carve-out becomes inactive and blocks dispatch', async () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  let clock = new Date('2026-08-18T00:00:00.000Z');
  const pipeline = makePipeline(root, { now: () => clock }, tokenPath);
  const token = tokenOf(pipeline, tokenPath);
  const carveout = pipeline.grantCarveout(
    { task_ref: 'G3', paths: [root], expires_at: '2026-08-18T01:00:00.000Z' },
    token,
  );
  assert.equal(pipeline.activeCarveout()?.carveout_id, carveout.carveout_id);

  clock = new Date('2026-08-18T02:00:00.000Z'); // 过期
  assert.equal(pipeline.activeCarveout(), null, 'expired slice must disappear');
  const lines = readFileSync(path.join(root, 'carveouts.jsonl'), 'utf8').trim().split('\n');
  const latest = JSON.parse(lines[lines.length - 1]) as Carveout;
  assert.equal(latest.status, 'EXPIRED', 'reap must append an EXPIRED row (append-only)');

  await assert.rejects(
    () =>
      pipeline.dispatch({
        adapter_id: 'fake-t1',
        prompt: 'x',
        carveout_id: carveout.carveout_id,
        cwd: root,
      }),
    /not ACTIVE/,
  );
});

test('G014A: revoke takes effect immediately and blocks dispatch', async () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  const token = tokenOf(pipeline, tokenPath);
  const carveout = pipeline.grantCarveout({ task_ref: 'G4', paths: [root], expires_at: FUTURE }, token);
  // grant 旋转 token → revoke 必须用最新 token。
  const revoked = pipeline.revokeCarveout(carveout.carveout_id, tokenOf(pipeline, tokenPath));
  assert.equal(revoked.status, 'REVOKED');
  assert.equal(pipeline.activeCarveout(), null);
  await assert.rejects(
    () =>
      pipeline.dispatch({
        adapter_id: 'fake-t1',
        prompt: 'x',
        carveout_id: carveout.carveout_id,
        cwd: root,
      }),
    /not ACTIVE/,
  );
});

test('G014A: single-slice grant — second ACTIVE while one is live is rejected', () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  let token = tokenOf(pipeline, tokenPath);
  pipeline.grantCarveout({ task_ref: 'G5a', paths: [root], expires_at: FUTURE }, token);
  // grant 旋转 token → 用最新 token 尝试第二份 → 拒绝。
  token = tokenOf(pipeline, tokenPath);
  assert.throws(
    () => pipeline.grantCarveout({ task_ref: 'G5b', paths: [root], expires_at: FUTURE }, token),
    /already ACTIVE/,
  );
  // 撤销后可以重新授权（新 token）。
  pipeline.revokeCarveout(pipeline.activeCarveout()?.carveout_id ?? '', token);
  assert.equal(pipeline.activeCarveout(), null);
  const next = pipeline.grantCarveout({ task_ref: 'G5c', paths: [root], expires_at: FUTURE }, tokenOf(pipeline, tokenPath));
  assert.equal(next.status, 'ACTIVE');
});

test('G014A: grant rotates the one-time token; stale token is rejected', () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  const t0 = tokenOf(pipeline, tokenPath);
  pipeline.grantCarveout({ task_ref: 'G6', paths: [root], expires_at: FUTURE }, t0);
  const t1 = tokenOf(pipeline, tokenPath);
  assert.notEqual(t1, t0, 'token must rotate on every grant');
  assert.throws(
    () => pipeline.grantCarveout({ task_ref: 'G6b', paths: [root], expires_at: FUTURE }, t0),
    CarveoutAuthError,
    'stale token must fail auth',
  );
  // revoke 也需要当前（最新）token。
  const active = pipeline.activeCarveout();
  assert.ok(active !== null);
  assert.throws(() => pipeline.revokeCarveout(active.carveout_id, t0), CarveoutAuthError);
  assert.equal(pipeline.revokeCarveout(active.carveout_id, t1).status, 'REVOKED');
});

test('G014A: post-hoc audit flags out-of-whitelist and .agent-bridge produced paths as violations', () => {
  const root = fixtureRoot();
  const sub = path.join(root, 'sub');
  mkdirSync(sub, { recursive: true });
  const carveout: Carveout = {
    carveout_id: 'audit1',
    owner_grant_utc: '2026-08-18T00:00:00.000Z',
    task_ref: 'G7',
    paths: [sub],
    expires_at: FUTURE,
    status: 'ACTIVE',
  };
  const within = path.join(sub, 'backend', 'cli.py');
  const outside = path.join(root, 'outside', 'leak.txt');
  const bridge = path.join(root, '.agent-bridge', 'golden.md');
  const result = auditCarveoutPaths([within, outside, bridge], carveout);
  assert.deepEqual(result.allowed, [within]);
  assert.deepEqual(result.violations, [outside, bridge]);
});

test('G014A: HTTP grant/revoke/active end-to-end with token handshake', async () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  const servers: BoardServer[] = [];
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'g014a-http',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  servers.push(server);
  after(async () => {
    for (const s of servers) await s.close();
  });
  const base = `http://127.0.0.1:${server.port}`;

  // 初始无 ACTIVE。
  const empty = (await (await fetch(base + '/api/carveout/active')).json()) as { active: Carveout | null };
  assert.equal(empty.active, null);

  // 无 token / 错误 token → 403。
  const noToken = await fetch(base + '/api/carveout/grant', {
    method: 'POST',
    body: JSON.stringify({ task_ref: 'G8', paths: [root], expires_at: FUTURE }),
  });
  assert.equal(noToken.status, 403);
  const badToken = await fetch(base + '/api/carveout/grant', {
    method: 'POST',
    body: JSON.stringify({ task_ref: 'G8', paths: [root], expires_at: FUTURE, token: 'wrong' }),
  });
  assert.equal(badToken.status, 403);

  // 正确 token → 201。
  const good = await fetch(base + '/api/carveout/grant', {
    method: 'POST',
    body: JSON.stringify({ task_ref: 'G8', paths: [root], expires_at: FUTURE, token: tokenOf(pipeline, tokenPath) }),
  });
  assert.equal(good.status, 201);
  const granted = (await good.json()) as { carveout: Carveout };
  assert.equal(granted.carveout.status, 'ACTIVE');

  const activeRes = (await (await fetch(base + '/api/carveout/active')).json()) as { active: Carveout | null };
  assert.equal(activeRes.active?.carveout_id, granted.carveout.carveout_id);

  // 错误 token revoke → 403；正确 token → 200；active → null；不存在 → 404。
  const revokeBad = await fetch(base + '/api/carveout/revoke', {
    method: 'POST',
    body: JSON.stringify({ carveout_id: granted.carveout.carveout_id, token: 'wrong' }),
  });
  assert.equal(revokeBad.status, 403);
  const revokeGood = await fetch(base + '/api/carveout/revoke', {
    method: 'POST',
    body: JSON.stringify({ carveout_id: granted.carveout.carveout_id, token: tokenOf(pipeline, tokenPath) }),
  });
  assert.equal(revokeGood.status, 200);
  const afterRevoke = (await (await fetch(base + '/api/carveout/active')).json()) as { active: Carveout | null };
  assert.equal(afterRevoke.active, null);
  const revokeMissing = await fetch(base + '/api/carveout/revoke', {
    method: 'POST',
    body: JSON.stringify({ carveout_id: 'nope', token: tokenOf(pipeline, tokenPath) }),
  });
  assert.equal(revokeMissing.status, 404);
});

test('G014A: loadCarveouts folds to latest snapshot; dispatch via rerun re-validates slice', async () => {
  const root = fixtureRoot();
  const tokenPath = path.join(root, '.mush', 'carveout-token');
  const pipeline = makePipeline(root, {}, tokenPath);
  const token = tokenOf(pipeline, tokenPath);
  const carveout = pipeline.grantCarveout({ task_ref: 'G9', paths: [root], expires_at: FUTURE }, token);
  const record = await pipeline.dispatch({
    adapter_id: 'fake-t1',
    prompt: 'rerun me',
    carveout_id: carveout.carveout_id,
    cwd: root,
  });
  const byId = new Map(loadCarveouts(path.join(root, 'carveouts.jsonl')).map((entry) => [entry.carveout_id, entry]));
  assert.equal(byId.get(carveout.carveout_id)?.status, 'ACTIVE');

  // 撤销后 rerun 原单 → 切片不再 ACTIVE → 拒绝（不绕过写面门）。
  pipeline.revokeCarveout(carveout.carveout_id, tokenOf(pipeline, tokenPath));
  await assert.rejects(() => pipeline.rerun(record.dispatch_id), /not ACTIVE/);

  // 重新授权同一路径后 rerun 原单仍拒绝：切片引用是旧 id，写面门严格匹配
  //（不静默沿用新切片——owner 新授权必须显式使用新 id 派发）。
  const renewed = pipeline.grantCarveout({ task_ref: 'G9b', paths: [root], expires_at: FUTURE }, tokenOf(pipeline, tokenPath));
  assert.notEqual(renewed.carveout_id, carveout.carveout_id);
  await assert.rejects(() => pipeline.rerun(record.dispatch_id), /not ACTIVE/);
  // 显式用新切片 id 派发新单放行。
  const fresh = await pipeline.dispatch({
    adapter_id: 'fake-t1',
    prompt: 'fresh',
    carveout_id: renewed.carveout_id,
    cwd: root,
  });
  assert.equal(fresh.status, 'DRY_RUN');
  assert.equal(fresh.carveout_id, renewed.carveout_id);
});
