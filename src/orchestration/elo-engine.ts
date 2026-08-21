/**
 * GOAL-052: 影子评测与实战战绩 ELO 天梯榜引擎 (Auto-Benchmark ELO Engine)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export type RankTier = 'Grandmaster' | 'Master' | 'Diamond' | 'Platinum' | 'Gold' | 'Silver';

export function getRankTier(elo: number): RankTier {
  if (elo >= 1800) return 'Grandmaster';
  if (elo >= 1600) return 'Master';
  if (elo >= 1400) return 'Diamond';
  if (elo >= 1200) return 'Platinum';
  if (elo >= 1000) return 'Gold';
  return 'Silver';
}

export type MatchOutcome = 'A_WINS' | 'B_WINS' | 'DRAW';

export interface MatchMetrics {
  pass_at_1: boolean;
  token_cost_usd: number;
  duration_ms: number;
  security_clean: boolean;
}

export interface MatchRecord {
  opponent: string;
  result: 'win' | 'loss' | 'draw';
  elo_before: number;
  elo_after: number;
  elo_change: number;
  timestamp_utc: string;
  notes?: string;
}

export interface DogEloProfile {
  adapter_id: string;
  elo_rating: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  rank_tier: RankTier;
  history: MatchRecord[];
}

export class EloRatingEngine {
  private runtimeRoot: string;
  private storagePath: string;
  private profiles: Map<string, DogEloProfile> = new Map();
  private kFactor = 32;

  constructor(runtimeRoot: string) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.storagePath = path.join(this.runtimeRoot, 'elo', 'rankings.json');

    const dir = path.dirname(this.storagePath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {}
    }

    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf-8');
      const list = JSON.parse(raw) as DogEloProfile[];
      if (Array.isArray(list)) {
        for (const p of list) {
          if (p && p.adapter_id) {
            this.profiles.set(p.adapter_id, p);
          }
        }
      }
    } catch {}
  }

  private saveAll(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const list = Array.from(this.profiles.values());
      writeFileSync(this.storagePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[elo-engine] failed to save rankings:', err);
    }
  }

  public getProfile(dog: string): DogEloProfile {
    let profile = this.profiles.get(dog);
    if (!profile) {
      profile = {
        adapter_id: dog,
        elo_rating: 1200,
        matches_played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        win_rate: 0,
        rank_tier: 'Platinum',
        history: [],
      };
      this.profiles.set(dog, profile);
    }
    return profile;
  }

  public getRankings(): DogEloProfile[] {
    return Array.from(this.profiles.values()).sort((a, b) => b.elo_rating - a.elo_rating);
  }

  public recordMatch(
    dogA: string,
    dogB: string,
    outcome: MatchOutcome,
    notes?: string
  ): { profileA: DogEloProfile; profileB: DogEloProfile; changeA: number; changeB: number } {
    const profA = this.getProfile(dogA);
    const profB = this.getProfile(dogB);

    const eloA = profA.elo_rating;
    const eloB = profB.elo_rating;

    // ELO 期望胜率
    const expA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const expB = 1 / (1 + Math.pow(10, (eloA - eloB) / 400));

    let scoreA = 0.5;
    let scoreB = 0.5;
    let resA: 'win' | 'loss' | 'draw' = 'draw';
    let resB: 'win' | 'loss' | 'draw' = 'draw';

    if (outcome === 'A_WINS') {
      scoreA = 1;
      scoreB = 0;
      resA = 'win';
      resB = 'loss';
      profA.wins++;
      profB.losses++;
    } else if (outcome === 'B_WINS') {
      scoreA = 0;
      scoreB = 1;
      resA = 'loss';
      resB = 'win';
      profA.losses++;
      profB.wins++;
    } else {
      profA.draws++;
      profB.draws++;
    }

    const changeA = Math.round(this.kFactor * (scoreA - expA));
    const changeB = Math.round(this.kFactor * (scoreB - expB));

    profA.elo_rating += changeA;
    profB.elo_rating += changeB;

    profA.matches_played++;
    profB.matches_played++;

    profA.win_rate = Number((profA.wins / profA.matches_played).toFixed(3));
    profB.win_rate = Number((profB.wins / profB.matches_played).toFixed(3));

    profA.rank_tier = getRankTier(profA.elo_rating);
    profB.rank_tier = getRankTier(profB.elo_rating);

    const now = new Date().toISOString();

    profA.history.unshift({
      opponent: dogB,
      result: resA,
      elo_before: eloA,
      elo_after: profA.elo_rating,
      elo_change: changeA,
      timestamp_utc: now,
      notes,
    });

    profB.history.unshift({
      opponent: dogA,
      result: resB,
      elo_before: eloB,
      elo_after: profB.elo_rating,
      elo_change: changeB,
      timestamp_utc: now,
      notes,
    });

    this.saveAll();

    return {
      profileA: profA,
      profileB: profB,
      changeA,
      changeB,
    };
  }

  public recordAutoEval(
    dogA: string,
    dogB: string,
    metricsA: MatchMetrics,
    metricsB: MatchMetrics,
    taskSummary?: string
  ): { outcome: MatchOutcome; changeA: number; changeB: number } {
    // 综合多维评价评分 (0~100)
    const computeScore = (m: MatchMetrics): number => {
      let s = 0;
      if (m.pass_at_1) s += 40;
      if (m.security_clean) s += 15;
      // 成本惩罚 (越低越好, 基准 $0.05)
      const costBonus = Math.max(0, 30 * (1 - m.token_cost_usd / 0.05));
      s += costBonus;
      // 耗时惩罚 (越低越好, 基准 10000ms)
      const timeBonus = Math.max(0, 15 * (1 - m.duration_ms / 10000));
      s += timeBonus;
      return s;
    };

    const scoreA = computeScore(metricsA);
    const scoreB = computeScore(metricsB);

    let outcome: MatchOutcome = 'DRAW';
    if (scoreA > scoreB + 2) {
      outcome = 'A_WINS';
    } else if (scoreB > scoreA + 2) {
      outcome = 'B_WINS';
    }

    const res = this.recordMatch(
      dogA,
      dogB,
      outcome,
      `自动影子盲测: ${taskSummary || '综合工程实战用例'} (A:${scoreA.toFixed(1)} vs B:${scoreB.toFixed(1)})`
    );

    return {
      outcome,
      changeA: res.changeA,
      changeB: res.changeB,
    };
  }
}
