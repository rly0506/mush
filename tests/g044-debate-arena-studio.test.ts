/**
 * tests/g044-debate-arena-studio.test.ts
 *
 * 验证 GOAL-044：圆桌辩论对席排版与自动仲裁工作台
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DebateEngine } from '../src/orchestration/debate-engine.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-044: Debate Arena Studio', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g044-test-'));
  const approvalRoot = path.join(tmpDir, 'approvals');
  let server: BoardServer | null = null;

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. DebateEngine Core State Machine: Create, Add Turn, Distill Consensus, Arbitrate', () => {
    const engine = new DebateEngine(tmpDir);

    // 1. 创建辩论
    const session = engine.createDebate({
      topic: '采用单文件内联还是多文件解耦',
      proDog: 'claude-code',
      conDog: 'deepseek-chat',
      workspaceRoot: tmpDir,
    });

    assert.ok(session.debate_id.startsWith('debate-'));
    assert.strictEqual(session.status, 'ACTIVE');
    assert.strictEqual(session.current_phase, 'PROPOSE');
    assert.strictEqual(session.turns.length, 0);

    // 2. 正方立论
    engine.addTurn(session.debate_id, {
      round: 1,
      phase: 'PROPOSE',
      dog_id: 'claude-code',
      role: 'PRO',
      title: '立论：提议拆分为关注点分离的子模块',
      content: '将 3300 行 page.ts 拆分到 styles/icons/views 可以大幅降低心智负担。',
    });

    // 3. 反方质询
    const updated = engine.addTurn(session.debate_id, {
      round: 1,
      phase: 'CROSS_EXAMINE',
      dog_id: 'deepseek-chat',
      role: 'CON',
      title: '质询：过度拆分会增加编译开销与模板粘连风险',
      content: '如果拆分不当可能导致构建步骤增加，需保证零依赖纯原生。',
    });

    assert.strictEqual(updated.turns.length, 2);
    assert.ok(updated.consensus.length >= 2);
    assert.ok(updated.disputes.length >= 2);

    // 4. 人类仲裁
    const settled = engine.arbitrateDebate(session.debate_id, 'MERGED', '采纳兼顾零依赖与模块解耦的折中方案');
    assert.strictEqual(settled.status, 'SETTLED');
    assert.strictEqual(settled.final_decision?.chosen_plan, 'MERGED');
    assert.strictEqual(settled.final_decision?.winning_dog, 'claude-code+deepseek-chat');

    // 5. 重新读取持久化数据
    const reloaded = engine.getDebate(session.debate_id);
    assert.strictEqual(reloaded?.debate_id, session.debate_id);
    assert.strictEqual(reloaded?.status, 'SETTLED');
  });

  await t.test('2. Server Endpoints: Full Debate Lifecycle API', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-debate-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/debates (未鉴权 -> 401)
    const unauthedPost = await fetch(`${base}/api/debates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '架构选型辩论' }),
    });
    assert.strictEqual(unauthedPost.status, 401);

    // 2. POST /api/debates (有效鉴权 -> 200)
    const createRes = await fetch(`${base}/api/debates`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        topic: '采用 Ponytail 极简模式还是完备 OOP 抽象',
        pro_dog: 'claude-code',
        con_dog: 'deepseek-chat',
      }),
    });
    assert.strictEqual(createRes.status, 200);
    const createData = (await createRes.json()) as { ok: boolean; debate: { debate_id: string; topic: string } };
    assert.strictEqual(createData.ok, true);
    const debateId = createData.debate.debate_id;

    // 3. GET /api/debates
    const listRes = await fetch(`${base}/api/debates`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; debates: Array<{ debate_id: string }>; total: number };
    assert.strictEqual(listData.ok, true);
    assert.ok(listData.total >= 1);

    // 4. GET /api/debates/:id
    const detailRes = await fetch(`${base}/api/debates/${debateId}`);
    assert.strictEqual(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { ok: boolean; debate: { debate_id: string; status: string } };
    assert.strictEqual(detailData.debate.debate_id, debateId);
    assert.strictEqual(detailData.debate.status, 'ACTIVE');

    // 5. POST /api/debates/:id/turn (增加立论)
    const turnRes = await fetch(`${base}/api/debates/${debateId}/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        round: 1,
        phase: 'PROPOSE',
        dog_id: 'claude-code',
        role: 'PRO',
        title: '立论：Ponytail 极简方案',
        content: '最好的代码是没有写的代码，优先标准库。',
      }),
    });
    assert.strictEqual(turnRes.status, 200);
    const turnData = (await turnRes.json()) as { ok: boolean; debate: { turns: unknown[] } };
    assert.strictEqual(turnData.debate.turns.length, 1);

    // 6. POST /api/debates/:id/arbitrate (人类仲裁)
    const arbitrateRes = await fetch(`${base}/api/debates/${debateId}/arbitrate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        chosen_plan: 'PRO',
        notes: '人类一致同意采纳 Ponytail 极简路线',
      }),
    });
    assert.strictEqual(arbitrateRes.status, 200);
    const arbitrateData = (await arbitrateRes.json()) as { ok: boolean; debate: { status: string; final_decision: { chosen_plan: string } } };
    assert.strictEqual(arbitrateData.debate.status, 'SETTLED');
    assert.strictEqual(arbitrateData.debate.final_decision.chosen_plan, 'PRO');
  });
});
