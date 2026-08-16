import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startBoardServer } from '../src/web/server.ts';
import { DispatchPipeline, InputError } from '../src/web/dispatch.ts';

function rawRequest(port: number, hostHeader: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/snapshot', method: 'GET', headers: { host: hostHeader } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('DEF-04: non-loopback Host header is rejected 403 (DNS rebinding guard)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-sec-'));
  const server = await startBoardServer({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    runId: 'sec-test',
    assignmentEpoch: 1,
    port: 0,
  });
  try {
    const evil = await rawRequest(server.port, 'attacker.example.com');
    assert.equal(evil.status, 403);
    assert.match(evil.body, /DEF-04/);
    // 正常 loopback Host 仍放行
    const ok = await fetch(`http://127.0.0.1:${server.port}/api/snapshot`);
    assert.equal(ok.status, 200);
  } finally {
    await server.close();
  }
});

test('F-41: dispatch to unregistered workspace is rejected (whitelist fail-closed)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-sec-'));
  const rogue = path.join(root, 'rogue-ws');
  mkdirSync(rogue, { recursive: true }); // 存在但未登记
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  await assert.rejects(
    pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', workspace: rogue }),
    (error: unknown) => error instanceof InputError && /not registered/.test(error.message),
  );
  // 登记后放行（selectWorkspace 会 remember）
  pipeline.selectWorkspace(rogue);
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', workspace: rogue });
  assert.notEqual(record.status, undefined);
});

test('F-41/F-39: whitelist comparison is path-form normalized (forward/backslash)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-sec-'));
  const ws = path.join(root, 'ws-a');
  mkdirSync(ws, { recursive: true });
  const mushDir = path.join(root, '.mush');
  mkdirSync(mushDir, { recursive: true });
  writeFileSync(
    path.join(mushDir, 'known-workspaces.json'),
    JSON.stringify({ schema_version: 1, workspaces: [ws.split(path.sep).join('/')] }) + '\n',
    'utf8',
  );
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', workspace: ws });
  assert.notEqual(record.status, undefined); // 正斜杠登记、反斜杠请求 → 放行
});
