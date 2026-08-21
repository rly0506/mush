/**
 * GOAL-042: 符号化记忆图谱与跨犬直连协作协议测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SymbolicMemoryGraph } from '../src/orchestration/symbolic-memory.ts';
import { AgentCollaborationHub } from '../src/orchestration/inter-agent.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-042: Symbolic Memory & Inter-Agent Direct Protocol', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g042-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Symbolic Memory Graph: Node, Edge, Query & Decay', () => {
    const graph = new SymbolicMemoryGraph(tmpDir);

    const n1 = graph.addNode({
      type: 'decision',
      content: '决定采用 32 位强随机 Bearer Token 防跨源伪造',
      tags: ['security', 'token', 'd30'],
    });

    const n2 = graph.addNode({
      type: 'constraint',
      content: '严禁越权修改 CONSTITUTION.md 最高治理宪法',
      tags: ['governance', 'constitution'],
    });

    const edge = graph.addEdge(n1.node_id, n2.node_id, 'depends_on');
    assert.strictEqual(edge.relation, 'depends_on');

    // 标签查询
    const queried = graph.queryByTags(['security']);
    assert.strictEqual(queried.length, 1);
    assert.strictEqual(queried[0].node_id, n1.node_id);

    // 文件查询
    const n3 = graph.addNode({
      type: 'file_change',
      content: '修改了 src/web/server.ts 增加符号记忆路由',
      tags: ['server.ts'],
    });
    const fileMatches = graph.queryByFile('src/web/server.ts');
    assert.strictEqual(fileMatches.length, 1);
    assert.strictEqual(fileMatches[0].node_id, n3.node_id);

    // 记忆衰减测试
    const decayed = graph.applyDecay();
    assert.strictEqual(decayed, 3);
    assert.strictEqual(graph.getNode(n1.node_id)?.decay_level, 1);
  });

  test('2. Inter-Agent Direct Protocol & DAG Progression', () => {
    const hub = new AgentCollaborationHub(tmpDir);

    // 点对点消息
    const msg = hub.sendDirectMessage({
      sender: 'claude-code',
      receiver: 'agy',
      payload_type: 'artifact',
      payload: { diff: '+export const a = 1;' },
    });
    assert.strictEqual(msg.sender, 'claude-code');
    assert.strictEqual(msg.receiver, 'agy');

    const box = hub.getMailbox('agy');
    assert.strictEqual(box.length, 1);
    assert.strictEqual(box[0].payload_type, 'artifact');

    // DAG 拓扑编排
    const dag = hub.createCollaborationDAG('task-pipe-1', [
      { stage_id: 'stage-code', adapter_id: 'claude-code' },
      { stage_id: 'stage-test', adapter_id: 'agy', depends_on: ['stage-code'] },
    ]);

    assert.strictEqual(dag.stages[0].status, 'RUNNING');
    assert.strictEqual(dag.stages[1].status, 'PENDING');

    // 阶段推进 -> 解锁下游
    const unblocked = hub.advanceDAG('task-pipe-1', 'stage-code', { exit_code: 0 });
    assert.strictEqual(unblocked.length, 1);
    assert.strictEqual(unblocked[0].stage_id, 'stage-test');
    assert.strictEqual(unblocked[0].status, 'RUNNING');
  });

  test('3. Server Endpoints: Memory Graph & Collaboration API', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-phase-c-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/memory/nodes
    const nodeRes = await fetch(`${base}/api/memory/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'decision',
        content: '采用 Langfuse 式 Trace 架构',
        tags: ['trace', 'd38'],
      }),
    });
    assert.strictEqual(nodeRes.status, 201);
    const nodeData = (await nodeRes.json()) as { ok: boolean; node: { node_id: string } };
    assert.strictEqual(nodeData.ok, true);

    // 2. GET /api/memory/search
    const searchRes = await fetch(`${base}/api/memory/search?tag=trace`);
    assert.strictEqual(searchRes.status, 200);
    const searchData = (await searchRes.json()) as { ok: boolean; matches: unknown[] };
    assert.strictEqual(searchData.matches.length, 1);

    // 3. POST /api/collaboration/messages
    const msgRes = await fetch(`${base}/api/collaboration/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: 'kimi-code',
        receiver: 'deepseek-code',
        payload_type: 'request',
        payload: { task: 'run unit tests' },
      }),
    });
    assert.strictEqual(msgRes.status, 201);

    // 4. GET /api/collaboration/mailbox/deepseek-code
    const boxRes = await fetch(`${base}/api/collaboration/mailbox/deepseek-code`);
    assert.strictEqual(boxRes.status, 200);
    const boxData = (await boxRes.json()) as { ok: boolean; messages: unknown[] };
    assert.strictEqual(boxData.messages.length, 1);
  });
});
