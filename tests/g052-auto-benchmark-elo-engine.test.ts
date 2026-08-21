/**
 * tests/g052-auto-benchmark-elo-engine.test.ts
 *
 * 验证 GOAL-052：影子评测与实战战绩 ELO 天梯榜引擎
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EloRatingEngine, getRankTier } from '../src/orchestration/elo-engine.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-052: Auto-Benchmark & Dog ELO Rating Engine', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g052-test-'));
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

  await t.test('1. Core: ELO Mathematics, Rank Tiers & Auto Multi-Metric Evaluation', () => {
    // 1. 测试段位划分
    assert.strictEqual(getRankTier(1900), 'Grandmaster');
    assert.strictEqual(getRankTier(1650), 'Master');
    assert.strictEqual(getRankTier(1450), 'Diamond');
    assert.strictEqual(getRankTier(1250), 'Platinum');
    assert.strictEqual(getRankTier(1050), 'Gold');
    assert.strictEqual(getRankTier(850), 'Silver');

    // 2. 积分计算与胜负更新
    const engine = new EloRatingEngine(runtimeRoot);

    const matchRes = engine.recordMatch('agy', 'claude-code', 'A_WINS', '实战对局');
    assert.ok(matchRes.changeA > 0);
    assert.ok(matchRes.changeB < 0);
    assert.strictEqual(matchRes.profileA.wins, 1);
    assert.strictEqual(matchRes.profileB.losses, 1);
    assert.strictEqual(matchRes.profileA.win_rate, 1);

    // 3. 自动多维指标评测
    const evalRes = engine.recordAutoEval(
      'deepseek-code',
      'kimi-code',
      { pass_at_1: true, token_cost_usd: 0.005, duration_ms: 1200, security_clean: true },
      { pass_at_1: false, token_cost_usd: 0.02, duration_ms: 4500, security_clean: true },
      '异步网络通信高并发测试'
    );
    assert.strictEqual(evalRes.outcome, 'A_WINS');
    assert.ok(evalRes.changeA > 0);
    assert.ok(evalRes.changeB < 0);

    // 4. 排行榜排序
    const rankings = engine.getRankings();
    assert.ok(rankings.length >= 4);
    assert.ok(rankings[0].elo_rating >= rankings[1].elo_rating);
  });

  await t.test('2. Server Endpoints: Full ELO REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot,
      runtimeRoot,
      runId: 'test-elo-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/elo/rankings
    const getRes = await fetch(`${base}/api/elo/rankings`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; rankings: Array<{ adapter_id: string; elo_rating: number }> };
    assert.strictEqual(getData.ok, true);

    // 2. POST /api/elo/match (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/elo/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dog_a: 'agy',
        dog_b: 'zcode',
        outcome: 'A_WINS',
      }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 3. POST /api/elo/match (有效鉴权 -> 200)
    const matchRes = await fetch(`${base}/api/elo/match`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        dog_a: 'agy',
        dog_b: 'zcode',
        outcome: 'A_WINS',
        notes: '单次实战代码重构',
      }),
    });
    assert.strictEqual(matchRes.status, 200);
    const matchData = (await matchRes.json()) as { ok: boolean; result: { changeA: number } };
    assert.strictEqual(matchData.ok, true);
    assert.ok(matchData.result.changeA > 0);

    // 4. GET /api/elo/profiles/:dog
    const profRes = await fetch(`${base}/api/elo/profiles/agy`);
    assert.strictEqual(profRes.status, 200);
    const profData = (await profRes.json()) as { ok: boolean; profile: { adapter_id: string; matches_played: number } };
    assert.strictEqual(profData.profile.adapter_id, 'agy');
    assert.ok(profData.profile.matches_played >= 1);

    // 5. POST /api/elo/auto-eval (鉴权 -> 200)
    const autoRes = await fetch(`${base}/api/elo/auto-eval`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        dog_a: 'zcode',
        dog_b: 'deepseek-code',
        metrics_a: { pass_at_1: true, token_cost_usd: 0.01, duration_ms: 1500, security_clean: true },
        metrics_b: { pass_at_1: true, token_cost_usd: 0.008, duration_ms: 1100, security_clean: true },
        summary: '安全审计基准盲测',
      }),
    });
    assert.strictEqual(autoRes.status, 200);
    const autoData = (await autoRes.json()) as { ok: boolean; result: { outcome: string } };
    assert.strictEqual(autoData.ok, true);
  });
});
