/**
 * GOAL-047: Contract Net 悬赏招投标市场与动态撮合引擎 (Bounty Market Engine)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

export type BountyStatus = 'OPEN' | 'BIDDING' | 'AWARDED' | 'SETTLED' | 'CANCELLED';

export interface DogBid {
  bid_id: string;
  adapter_id: string;
  estimated_cost_usd: number;
  estimated_time_ms: number;
  confidence_score: number; // 0.0 ~ 1.0
  bid_rationale: string;
  submitted_at_utc: string;
}

export interface BountyTask {
  bounty_id: string;
  title: string;
  description: string;
  tags: string[];
  max_cap_usd: number;
  deadline_seconds: number;
  status: BountyStatus;
  bids: DogBid[];
  awarded_bid?: DogBid;
  settlement_summary?: string;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface CreateBountyParams {
  title: string;
  description: string;
  tags?: string[];
  maxCapUsd: number;
  deadlineSeconds?: number;
}

export class BountyMarketEngine {
  private runtimeRoot: string;
  private bountiesDir: string;
  private cache: Map<string, BountyTask> = new Map();

  constructor(runtimeRoot: string) {
    this.runtimeRoot = runtimeRoot;
    this.bountiesDir = path.join(runtimeRoot, 'bounties');
    if (!existsSync(this.bountiesDir)) {
      try {
        mkdirSync(this.bountiesDir, { recursive: true });
      } catch {}
    }
    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.bountiesDir)) return;
    try {
      const files = readdirSync(this.bountiesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const raw = readFileSync(path.join(this.bountiesDir, file), 'utf-8');
            const data = JSON.parse(raw) as BountyTask;
            if (data && data.bounty_id) {
              this.cache.set(data.bounty_id, data);
            }
          } catch {}
        }
      }
    } catch {}
  }

  public createBounty(params: CreateBountyParams): BountyTask {
    const bountyId = `bounty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const bounty: BountyTask = {
      bounty_id: bountyId,
      title: params.title,
      description: params.description,
      tags: params.tags || ['feature'],
      max_cap_usd: params.maxCapUsd,
      deadline_seconds: params.deadlineSeconds ?? 3600,
      status: 'OPEN',
      bids: [],
      created_at_utc: now,
      updated_at_utc: now,
    };

    this.cache.set(bountyId, bounty);
    this.saveBounty(bounty);
    return bounty;
  }

  public getBounty(bountyId: string): BountyTask | undefined {
    return this.cache.get(bountyId);
  }

  public listBounties(statusFilter?: BountyStatus): BountyTask[] {
    const list = Array.from(this.cache.values());
    if (statusFilter) {
      return list.filter((b) => b.status === statusFilter);
    }
    return list.sort((a, b) => new Date(b.created_at_utc).getTime() - new Date(a.created_at_utc).getTime());
  }

  public submitBid(bountyId: string, bidParams: Omit<DogBid, 'bid_id' | 'submitted_at_utc'>): DogBid {
    const bounty = this.cache.get(bountyId);
    if (!bounty) {
      throw new Error(`Bounty not found: ${bountyId}`);
    }
    if (bounty.status !== 'OPEN' && bounty.status !== 'BIDDING') {
      throw new Error(`Cannot submit bid to bounty in status: ${bounty.status}`);
    }

    const bidId = `bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const bid: DogBid = {
      bid_id: bidId,
      adapter_id: bidParams.adapter_id,
      // GOAL-068（A3）：负值 cost/time 会让撮合公式 (1-normCost) 满分/超界被
      // 操纵——非有限数与负值一律钳为 0。
      estimated_cost_usd: Math.max(0, Number.isFinite(bidParams.estimated_cost_usd) ? bidParams.estimated_cost_usd : 0),
      estimated_time_ms: Math.max(0, Number.isFinite(bidParams.estimated_time_ms) ? bidParams.estimated_time_ms : 0),
      confidence_score: Math.max(0, Math.min(1.0, bidParams.confidence_score)),
      bid_rationale: bidParams.bid_rationale,
      submitted_at_utc: now,
    };

    bounty.bids.push(bid);
    bounty.status = 'BIDDING';
    bounty.updated_at_utc = now;

    this.saveBounty(bounty);
    return bid;
  }

  public collectAutomaticBids(bountyId: string, roster: string[] = ['agy', 'claude-code', 'kimi-code', 'deepseek-code']): DogBid[] {
    const bounty = this.cache.get(bountyId);
    if (!bounty) {
      throw new Error(`Bounty not found: ${bountyId}`);
    }

    const createdBids: DogBid[] = [];
    for (const dog of roster) {
      let baseCost = bounty.max_cap_usd * 0.4;
      let baseTime = 120000;
      let confidence = 0.85;
      let rationale = `基于犬只 ${dog} 专长匹配`;

      if (dog === 'agy') {
        baseCost = bounty.max_cap_usd * 0.35;
        baseTime = 90000;
        confidence = 0.95;
        rationale = 'AGY 具备原生会话与工具链高吞吐执行能力';
      } else if (dog === 'claude-code') {
        baseCost = bounty.max_cap_usd * 0.5;
        baseTime = 110000;
        confidence = 0.92;
        rationale = 'Claude-Code 擅长高维抽象与复杂重构';
      } else if (dog === 'kimi-code') {
        baseCost = bounty.max_cap_usd * 0.25;
        baseTime = 150000;
        confidence = 0.88;
        rationale = 'Kimi-Code 具备超长上下文推理与高性价比';
      } else if (dog === 'deepseek-code') {
        baseCost = bounty.max_cap_usd * 0.2;
        baseTime = 100000;
        confidence = 0.90;
        rationale = 'DeepSeek-Code 擅长底层算法与破局测试';
      }

      const bid = this.submitBid(bountyId, {
        adapter_id: dog,
        estimated_cost_usd: Number(baseCost.toFixed(2)),
        estimated_time_ms: baseTime,
        confidence_score: confidence,
        bid_rationale: rationale,
      });
      createdBids.push(bid);
    }

    return createdBids;
  }

  public matchOptimalBid(bountyId: string): DogBid {
    const bounty = this.cache.get(bountyId);
    if (!bounty) {
      throw new Error(`Bounty not found: ${bountyId}`);
    }
    if (bounty.bids.length === 0) {
      throw new Error(`No bids available to match for bounty: ${bountyId}`);
    }

    const maxCost = Math.max(...bounty.bids.map((b) => b.estimated_cost_usd), 0.01);
    const maxTime = Math.max(...bounty.bids.map((b) => b.estimated_time_ms), 1);

    let optimalBid = bounty.bids[0];
    let highestScore = -1;

    for (const bid of bounty.bids) {
      const normCost = bid.estimated_cost_usd / maxCost;
      const normTime = bid.estimated_time_ms / maxTime;
      // 多因子撮合公式：置信度 50% + 成本经济性 30% + 耗时敏捷性 20%
      const score = bid.confidence_score * 0.5 + (1 - normCost) * 0.3 + (1 - normTime) * 0.2;

      if (score > highestScore) {
        highestScore = score;
        optimalBid = bid;
      }
    }

    return optimalBid;
  }

  public awardBounty(bountyId: string, bidId?: string): BountyTask {
    const bounty = this.cache.get(bountyId);
    if (!bounty) {
      throw new Error(`Bounty not found: ${bountyId}`);
    }

    let targetBid: DogBid | undefined;
    if (bidId) {
      targetBid = bounty.bids.find((b) => b.bid_id === bidId);
      if (!targetBid) {
        throw new Error(`Bid not found: ${bidId}`);
      }
    } else {
      targetBid = this.matchOptimalBid(bountyId);
    }

    const now = new Date().toISOString();
    bounty.awarded_bid = targetBid;
    bounty.status = 'AWARDED';
    bounty.updated_at_utc = now;

    this.saveBounty(bounty);
    return bounty;
  }

  public settleBounty(bountyId: string, summary: string): BountyTask {
    const bounty = this.cache.get(bountyId);
    if (!bounty) {
      throw new Error(`Bounty not found: ${bountyId}`);
    }

    const now = new Date().toISOString();
    bounty.status = 'SETTLED';
    bounty.settlement_summary = summary;
    bounty.updated_at_utc = now;

    this.saveBounty(bounty);
    return bounty;
  }

  private saveBounty(bounty: BountyTask): void {
    try {
      if (!existsSync(this.bountiesDir)) {
        mkdirSync(this.bountiesDir, { recursive: true });
      }
      const filePath = path.join(this.bountiesDir, `${bounty.bounty_id}.json`);
      writeFileSync(filePath, JSON.stringify(bounty, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[bounty-market] failed to persist bounty:', err);
    }
  }
}
