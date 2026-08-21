/**
 * tests/g047-bounty-market-studio.test.ts
 *
 * 验证 GOAL-047：Contract Net 悬赏招投标市场与动态撮合池
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BountyMarketEngine } from '../src/orchestration/bounty-market.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-047: Contract Net Bounty Market Studio', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g047-test-'));
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

  await t.test('1. BountyMarketEngine Core: CFP, Auto Bidding, Multi-factor Matching, Awarding & Settlement', () => {
    const engine = new BountyMarketEngine(tmpDir);

    // 1. 发标 (CFP)
    const bounty = engine.createBounty({
      title: '高并发 SSE 路由分发器性能压测与优化',
      description: '优化 SSE 事件分发通道吞吐，需支持 10k 并发且 CPU 占用 < 30%',
      tags: ['performance', 'sse', 'optimization'],
      maxCapUsd: 2.5,
      deadlineSeconds: 1800,
    });

    assert.ok(bounty.bounty_id.startsWith('bounty-'));
    assert.strictEqual(bounty.status, 'OPEN');
    assert.strictEqual(bounty.max_cap_usd, 2.5);
    assert.strictEqual(bounty.bids.length, 0);

    // 2. 全员犬只竞争性竞标 (Auto Bidding)
    const bids = engine.collectAutomaticBids(bounty.bounty_id);
    assert.strictEqual(bids.length, 4);
    assert.strictEqual(bounty.status, 'BIDDING');

    // 3. 多因子性价比撮合 (Optimal Matching)
    const optimalBid = engine.matchOptimalBid(bounty.bounty_id);
    assert.ok(optimalBid);
    assert.ok(['agy', 'deepseek-code', 'kimi-code', 'claude-code'].includes(optimalBid.adapter_id));
    assert.ok(optimalBid.confidence_score >= 0.85);

    // 4. 授标 (Awarding)
    const awardedBounty = engine.awardBounty(bounty.bounty_id);
    assert.strictEqual(awardedBounty.status, 'AWARDED');
    assert.strictEqual(awardedBounty.awarded_bid?.bid_id, optimalBid.bid_id);

    // 5. 履约结算 (Settlement)
    const settledBounty = engine.settleBounty(bounty.bounty_id, '10k 并发压测达成，CPU 占用稳定在 22%');
    assert.strictEqual(settledBounty.status, 'SETTLED');
    assert.ok(settledBounty.settlement_summary?.includes('10k 并发压测达成'));

    // 6. 持久化重新读取校验
    const reloaded = engine.getBounty(bounty.bounty_id);
    assert.strictEqual(reloaded?.bounty_id, bounty.bounty_id);
    assert.strictEqual(reloaded?.status, 'SETTLED');
  });

  await t.test('2. Server Endpoints: Full Bounty Market REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-bounty-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/bounties (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/bounties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '重构配置中心' }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 2. POST /api/bounties (有效鉴权 -> 200)
    const createRes = await fetch(`${base}/api/bounties`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        title: '重构配置中心',
        description: '支持动态热加载与环境变量覆写',
        max_cap_usd: 1.8,
        tags: ['refactor', 'config'],
      }),
    });
    assert.strictEqual(createRes.status, 200);
    const createData = (await createRes.json()) as { ok: boolean; bounty: { bounty_id: string; title: string } };
    assert.strictEqual(createData.ok, true);
    const bountyId = createData.bounty.bounty_id;

    // 3. GET /api/bounties & GET /api/bounties/:id
    const listRes = await fetch(`${base}/api/bounties`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; bounties: unknown[]; total: number };
    assert.ok(listData.total >= 1);

    const detailRes = await fetch(`${base}/api/bounties/${bountyId}`);
    assert.strictEqual(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { ok: boolean; bounty: { bounty_id: string; status: string } };
    assert.strictEqual(detailData.bounty.bounty_id, bountyId);

    // 4. POST /api/bounties/:id/bids (单犬自主投标)
    const bidRes = await fetch(`${base}/api/bounties/${bountyId}/bids`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        adapter_id: 'agy',
        estimated_cost_usd: 0.6,
        estimated_time_ms: 45000,
        confidence_score: 0.96,
        bid_rationale: '原生工程适配能力极佳',
      }),
    });
    assert.strictEqual(bidRes.status, 200);
    const bidData = (await bidRes.json()) as { ok: boolean; bid: { adapter_id: string } };
    assert.strictEqual(bidData.bid.adapter_id, 'agy');

    // 5. POST /api/bounties/:id/auto-bid (全员竞争性投标)
    const autoBidRes = await fetch(`${base}/api/bounties/${bountyId}/auto-bid`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(autoBidRes.status, 200);

    // 6. POST /api/bounties/:id/award (撮合授标)
    const awardRes = await fetch(`${base}/api/bounties/${bountyId}/award`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(awardRes.status, 200);
    const awardData = (await awardRes.json()) as { ok: boolean; bounty: { status: string; awarded_bid: unknown } };
    assert.strictEqual(awardData.bounty.status, 'AWARDED');
    assert.ok(awardData.bounty.awarded_bid);

    // 7. POST /api/bounties/:id/settle (履约结算)
    const settleRes = await fetch(`${base}/api/bounties/${bountyId}/settle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ summary: '配置热加载经测试 100% 正常' }),
    });
    assert.strictEqual(settleRes.status, 200);
    const settleData = (await settleRes.json()) as { ok: boolean; bounty: { status: string; settlement_summary: string } };
    assert.strictEqual(settleData.bounty.status, 'SETTLED');
  });
});
