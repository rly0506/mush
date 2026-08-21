/**
 * tests/g051-dynamic-liquid-squads.test.ts
 *
 * 验证 GOAL-051：液态临时战时攻关小队与指挥犬选举协议
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  LiquidSquadEngine,
  electSquadLead,
} from '../src/orchestration/liquid-squad.ts';
import { SymbolicMemoryGraph } from '../src/orchestration/symbolic-memory.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-051: Dynamic Liquid Squads & Lead Dog Election', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g051-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const runtimeRoot = path.join(tmpDir, 'runtime');
  const approvalRoot = path.join(tmpDir, 'approvals');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(approvalRoot, { recursive: true });

  let server: BoardServer | null = null;

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Core: Multi-Dimensional Lead Election, Squad Assembly & Memory Archival', () => {
    // 1. 测试安全审计导向任务 -> 选出 zcode
    const securityLead = electSquadLead(['agy', 'kimi-code', 'zcode'], {
      security: 0.9,
      testing: 0.8,
      coding: 0.1,
      architecture: 0.1,
    });
    assert.strictEqual(securityLead, 'zcode');

    // 2. 测试宏观架构/代码设计任务 -> 选出 agy
    const archLead = electSquadLead(['agy', 'deepseek-code', 'kimi-code'], {
      architecture: 0.95,
      coding: 0.9,
      debugging: 0.2,
      security: 0.2,
    });
    assert.strictEqual(archLead, 'agy');

    // 3. 组建小队
    const memory = new SymbolicMemoryGraph(runtimeRoot);
    const engine = new LiquidSquadEngine(runtimeRoot, memory);

    const squad = engine.formSquad(
      'task-audit-01',
      '跨模块循环引用与只读区防护安全攻坚',
      ['agy', 'zcode', 'deepseek-code'],
      { security: 0.9, testing: 0.8 }
    );

    assert.strictEqual(squad.lead_dog, 'zcode');
    assert.deepStrictEqual(squad.member_dogs.sort(), ['agy', 'deepseek-code'].sort());
    assert.strictEqual(squad.status, 'ACTIVE');

    // 4. 解散小队并沉淀经验
    const disbanded = engine.disbandSquad(squad.squad_id, '安全漏洞与循环依赖已全部清零');
    assert.strictEqual(disbanded.status, 'DISBANDED');
    assert.ok(disbanded.disbanded_at_utc);

    // 验证记忆图谱沉淀
    const memories = memory.queryByTags(['squad']);
    assert.ok(memories.some((m) => m.content.includes(squad.squad_id)));
  });

  await t.test('2. Server Endpoints: Full Squads REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-squads-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/squads (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/squads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task_id: 'task-rest-101',
        task_description: 'REST API 压力测试',
      }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 2. POST /api/squads (有效鉴权 -> 200)
    const createRes = await fetch(`${base}/api/squads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        task_id: 'task-rest-101',
        task_description: 'REST API 压力测试与吞吐攻关',
        candidates: ['agy', 'claude-code', 'deepseek-code'],
        features: { coding: 0.9, architecture: 0.8 },
      }),
    });
    assert.strictEqual(createRes.status, 200);
    const createData = (await createRes.json()) as { ok: boolean; squad: { squad_id: string; lead_dog: string } };
    assert.strictEqual(createData.ok, true);
    assert.strictEqual(createData.squad.lead_dog, 'agy');

    const squadId = createData.squad.squad_id;

    // 3. GET /api/squads
    const listRes = await fetch(`${base}/api/squads?status=ACTIVE`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; squads: Array<{ squad_id: string }> };
    assert.strictEqual(listData.ok, true);
    assert.ok(listData.squads.some((s) => s.squad_id === squadId));

    // 4. GET /api/squads/:id
    const getRes = await fetch(`${base}/api/squads/${squadId}`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; squad: { squad_id: string } };
    assert.strictEqual(getData.squad.squad_id, squadId);

    // 5. POST /api/squads/:id/disband (鉴权 -> 200)
    const disbandRes = await fetch(`${base}/api/squads/${squadId}/disband`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ summary: '压测完成，小队正常解散' }),
    });
    assert.strictEqual(disbandRes.status, 200);
    const disbandData = (await disbandRes.json()) as { ok: boolean; squad: { status: string } };
    assert.strictEqual(disbandData.squad.status, 'DISBANDED');
  });
});
