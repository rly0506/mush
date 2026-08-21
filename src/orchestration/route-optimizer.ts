/**
 * GOAL-053: 战绩反馈闭环与自适应路由权重自进化 (Self-Evolving Routing Optimizer)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

export type RoutingDomain = 'refactoring' | 'audit' | 'feature' | 'debug' | 'script' | 'general';

export interface TaskOutcomeFeedback {
  task_id: string;
  domain: RoutingDomain;
  adapter_id: string;
  human_accepted: boolean;
  test_passed: boolean;
  cost_usd: number;
  timestamp_utc: string;
}

export const BASELINE_DOMAIN_WEIGHTS: Record<RoutingDomain, Record<string, number>> = {
  refactoring: { agy: 0.4, 'claude-code': 0.3, 'deepseek-code': 0.2, 'kimi-code': 0.1 },
  audit: { zcode: 0.45, 'deepseek-code': 0.25, agy: 0.2, 'kimi-code': 0.1 },
  feature: { agy: 0.35, 'claude-code': 0.35, 'deepseek-code': 0.2, 'kimi-code': 0.1 },
  debug: { 'deepseek-code': 0.4, zcode: 0.3, agy: 0.2, 'kimi-code': 0.1 },
  script: { 'deepseek-code': 0.35, 'kimi-code': 0.35, 'claude-code': 0.15, agy: 0.15 },
  general: { agy: 0.3, 'claude-code': 0.3, 'deepseek-code': 0.25, 'kimi-code': 0.15 },
};

export const ESTIMATED_COST_USD: Record<string, number> = {
  agy: 0.03,
  'claude-code': 0.04,
  'deepseek-code': 0.005,
  'kimi-code': 0.003,
  zcode: 0.015,
};

export class SelfEvolvingRoutingOptimizer {
  private runtimeRoot: string;
  private weightsPath: string;
  private logPath: string;
  private weights: Record<RoutingDomain, Record<string, number>>;
  private feedbackCount = 0;
  private learningRate = 0.1;

  constructor(runtimeRoot: string) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.weightsPath = path.join(this.runtimeRoot, 'routing', 'evolved-weights.json');
    this.logPath = path.join(this.runtimeRoot, 'routing', 'feedback-log.jsonl');

    const dir = path.dirname(this.weightsPath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {}
    }

    // 深拷贝基准权重
    this.weights = JSON.parse(JSON.stringify(BASELINE_DOMAIN_WEIGHTS));
    this.loadWeights();
  }

  private loadWeights(): void {
    if (!existsSync(this.weightsPath)) return;
    try {
      const raw = readFileSync(this.weightsPath, 'utf-8');
      const loaded = JSON.parse(raw) as { weights: Record<RoutingDomain, Record<string, number>>; count: number };
      if (loaded && loaded.weights) {
        this.weights = loaded.weights;
        this.feedbackCount = loaded.count || 0;
      }
    } catch {}
  }

  private saveWeights(): void {
    try {
      const dir = path.dirname(this.weightsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        this.weightsPath,
        JSON.stringify({ weights: this.weights, count: this.feedbackCount }, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.warn('[route-optimizer] failed to save weights:', err);
    }
  }

  public recordFeedback(feedback: Omit<TaskOutcomeFeedback, 'timestamp_utc'>): TaskOutcomeFeedback {
    const record: TaskOutcomeFeedback = {
      ...feedback,
      timestamp_utc: new Date().toISOString(),
    };

    const domain = feedback.domain || 'general';
    if (!this.weights[domain]) {
      this.weights[domain] = { agy: 0.3, 'claude-code': 0.3, 'deepseek-code': 0.25, 'kimi-code': 0.15 };
    }

    const domainWeights = this.weights[domain];
    const dog = feedback.adapter_id;

    if (domainWeights[dog] === undefined) {
      domainWeights[dog] = 0.1;
    }

    // 目标分值
    let targetScore = 0.5;
    if (feedback.human_accepted && feedback.test_passed) {
      targetScore = 1.0;
    } else if (!feedback.human_accepted && !feedback.test_passed) {
      targetScore = 0.0;
    }

    // 在线梯度权重调整
    const currentWeight = domainWeights[dog];
    const newWeight = currentWeight + this.learningRate * (targetScore - currentWeight);
    domainWeights[dog] = Math.max(0.02, newWeight); // 0.02 保底防过拟合与冰封

    // 归一化该领域权重使之和为 1
    const total = Object.values(domainWeights).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const k of Object.keys(domainWeights)) {
        domainWeights[k] = Number((domainWeights[k] / total).toFixed(4));
      }
    }

    this.feedbackCount++;
    this.saveWeights();

    try {
      appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf-8');
    } catch {}

    return record;
  }

  public getDomainWeights(domain: RoutingDomain): Record<string, number> {
    return this.weights[domain] || this.weights.general;
  }

  public getAllWeights(): { weights: Record<RoutingDomain, Record<string, number>>; count: number } {
    return {
      weights: this.weights,
      count: this.feedbackCount,
    };
  }

  public recommendBestDog(
    domain: RoutingDomain,
    capUsd?: number
  ): { adapter_id: string; confidence: number; estimated_cost_usd: number } {
    const weights = this.getDomainWeights(domain);
    let bestDog = 'agy';
    let highestWeight = -1;

    for (const [dog, weight] of Object.entries(weights)) {
      const estimatedCost = ESTIMATED_COST_USD[dog] ?? 0.02;
      if (capUsd !== undefined && estimatedCost > capUsd) {
        continue; // 超过预算上限过滤
      }
      if (weight > highestWeight) {
        highestWeight = weight;
        bestDog = dog;
      }
    }

    // 如果预算严格限制导致全部过滤，fallback 到最便宜的可用犬
    if (highestWeight === -1) {
      let cheapestDog = Object.keys(weights)[0] || 'kimi-code';
      let minCost = 999;
      for (const dog of Object.keys(weights)) {
        const cost = ESTIMATED_COST_USD[dog] ?? 0.02;
        if (cost < minCost) {
          minCost = cost;
          cheapestDog = dog;
        }
      }
      bestDog = cheapestDog;
      highestWeight = weights[cheapestDog] || 0.5;
    }

    return {
      adapter_id: bestDog,
      confidence: Number(highestWeight.toFixed(3)),
      estimated_cost_usd: ESTIMATED_COST_USD[bestDog] ?? 0.02,
    };
  }
}
