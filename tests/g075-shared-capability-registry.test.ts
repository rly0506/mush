import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

// D82 批次修复回归：能力注册表（通道实证）与模型实测探针缓存是机器级事实，
// 热切换工作区后必须保持——不得随 per-project runtime 被清零。
test('hot-switched workspace contexts share machine-level capability and probe state', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g075-'));
  const wsA = path.join(root, 'ws-a');
  const wsB = path.join(root, 'ws-b');
  const sharedDir = path.join(root, 'shared');
  for (const dir of [wsA, wsB, path.join(wsA, 'runtime'), sharedDir]) mkdirSync(dir, { recursive: true });
  const approvalA = path.join(wsA, 'goals', 'receipts', 'approval-requests');
  mkdirSync(approvalA, { recursive: true });

  const now = new Date().toISOString();
  const registryPath = path.join(sharedDir, 'capability-registry.json');
  writeFileSync(
    registryPath,
    JSON.stringify({
      schema_version: 1,
      probed_at_utc: now,
      adapters: [
        { adapter_id: 'opencode', provider: 'opencode', models: ['x-preview-f-free'], source: 'test', probed_at_utc: now, verified: true },
        { adapter_id: 'codex', provider: 'codex', models: ['gpt-5'], source: 'test', probed_at_utc: now, verified: true },
      ],
    }),
    'utf8',
  );
  const liveProbesPath = path.join(sharedDir, 'live-probes.json');
  writeFileSync(
    liveProbesPath,
    JSON.stringify({
      schema_version: 1,
      probes: {
        opencode: { adapter_id: 'opencode', status: 'ONLINE', live_models: ['x-preview-f-free'], checked_at_utc: now },
        codex: { adapter_id: 'codex', status: 'ONLINE', live_models: ['gpt-5'], checked_at_utc: now },
      },
    }),
    'utf8',
  );

  const pipeline = new DispatchPipeline({
    workspaceRoot: wsA,
    approvalRoot: approvalA,
    ledgerPath: path.join(wsA, 'runtime', 'budget-ledger.jsonl'),
    registryPath,
    liveProbesPath,
  });
  const server = await startBoardServer({
    approvalRoot: approvalA,
    runId: 'g075-shared-registry',
    assignmentEpoch: 1,
    workspaceRoot: wsA,
    ledgerPath: path.join(wsA, 'runtime', 'board-ledger.jsonl'),
    dispatch: pipeline,
    port: 0,
    host: '127.0.0.1',
  });
  const base = `http://127.0.0.1:${server.port}`;
  const verifiedMap = (snapshot: any) =>
    Object.fromEntries((snapshot.roster as Array<{ adapter_id: string; verified: boolean }>).map((r) => [r.adapter_id, r.verified]));

  // 缺省上下文：两通道实证在册
  const before = verifiedMap(await (await fetch(`${base}/api/snapshot`)).json());
  assert.equal(before.opencode, true, 'opencode must be verified before switch');
  assert.equal(before.codex, true, 'codex must be verified before switch');

  // 热切换到全新工作区 wsB
  const sel = await fetch(`${base}/api/workspaces/select`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: wsB }),
  });
  assert.equal(sel.status, 201);

  const after = verifiedMap(await (await fetch(`${base}/api/snapshot`)).json());
  assert.equal(after.opencode, true, 'opencode verification must survive workspace hot-switch');
  assert.equal(after.codex, true, 'codex verification must survive workspace hot-switch');

  // 机器级文件不得被复制进新工作区 runtime
  assert.ok(!existsSync(path.join(wsB, 'runtime', 'capability-registry.json')), 'registry must stay machine-global');
  assert.ok(!existsSync(path.join(wsB, 'runtime', 'live-probes.json')), 'probe cache must stay machine-global');

  await server.close();
});
