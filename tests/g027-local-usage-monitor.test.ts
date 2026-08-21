/**
 * GOAL-027 / GP-33 本地会话用量与花费监控（ccusage-like）测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { calculateUsageCost, findPricingRate } from '../src/web/pricing.ts';
import { scanLocalHarnessUsage } from '../src/web/usage-scanner.ts';
import { startBoardServer } from '../src/web/server.ts';
import { renderBoardPage } from '../src/web/page.ts';

describe('GOAL-027: Local Usage & Cost Monitor (ccusage-like)', () => {
  let tmpHome: string;
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(tmpdir(), 'mush-test-home-'));
    tmpWorkspace = mkdtempSync(path.join(tmpdir(), 'mush-test-ws-'));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test('Pricing engine calculates exact model costs including prompt caching discounts', () => {
    // 1. Claude Sonnet 4.6 (3 / 15 / 0.3)
    const claudeCost = calculateUsageCost('claude-sonnet-4-6', {
      inputTokens: 100_000, // 0.1 * $3 = $0.30
      outputTokens: 10_000, // 0.01 * $15 = $0.15
      cacheReadTokens: 500_000, // 0.5 * $0.30 = $0.15
      cacheWriteTokens: 0,
    });
    // total = 0.30 + 0.15 + 0.15 = 0.60
    assert.strictEqual(claudeCost, 0.6);

    // 2. DeepSeek V4 Flash (0.14 / 0.28 / 0.014)
    const dsCost = calculateUsageCost('deepseek-v4-flash', {
      inputTokens: 1_000_000, // 1 * $0.14 = $0.14
      outputTokens: 1_000_000, // 1 * $0.28 = $0.28
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    assert.strictEqual(dsCost, 0.42);

    // 3. Fallback / fuzzy matching
    const rate = findPricingRate('custom-claude-3-7-sonnet');
    assert.strictEqual(rate.inputPerMillion, 3.0);
  });

  test('Usage scanner parses Claude and Pi session logs and aggregates tokens & cost', () => {
    // 1. Setup mock Claude session
    const claudeDir = path.join(tmpHome, '.claude', 'projects', 'mock-proj');
    mkdirSync(claudeDir, { recursive: true });
    const claudeLog = path.join(claudeDir, 'session-1.jsonl');
    const claudeEntries = [
      JSON.stringify({
        timestamp: '2026-08-19T10:00:00.000Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 500_000,
            output_tokens: 20_000,
            cache_read_input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-18T10:00:00.000Z', // Yesterday
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 100_000,
            output_tokens: 5_000,
            cache_read_input_tokens: 0,
          },
        },
      }),
    ];
    writeFileSync(claudeLog, claudeEntries.join('\n'), 'utf8');

    // 2. Setup mock Pi session
    const piDir = path.join(tmpHome, '.pi', 'agent', 'sessions', 'mock-ws');
    mkdirSync(piDir, { recursive: true });
    const piLog = path.join(piDir, 'session-2.jsonl');
    const piEntries = [
      JSON.stringify({
        timestamp: '2026-08-19T11:00:00.000Z',
        message: {
          model: 'deepseek-v4-flash',
          usage: {
            input: 2_000_000,
            output: 100_000,
            cacheRead: 500_000,
          },
        },
      }),
    ];
    writeFileSync(piLog, piEntries.join('\n'), 'utf8');

    // 3. Scan usage
    const summary = scanLocalHarnessUsage({
      customHomeDir: tmpHome,
      workspaceRoot: tmpWorkspace,
      now: () => new Date('2026-08-19T12:00:00.000Z'),
    });

    assert.strictEqual(summary.per_harness_usage['claude-code'].sessions_count, 1);
    assert.strictEqual(summary.per_harness_usage['pi'].sessions_count, 1);
    assert.ok(summary.total_cost_usd > 0, 'Total cost should be calculated');
    assert.ok(summary.today_cost_usd > 0, 'Today cost should be calculated');
    assert.ok(summary.total_tokens > 1_000_000, 'Total tokens aggregated');
    assert.ok(summary.cache_savings_usd > 0, 'Cache savings projected');
    assert.strictEqual(summary.daily_trends.length, 2, 'Two daily entries (yesterday and today)');
  });

  test('GET /api/usage returns valid usage summary via HTTP', async () => {
    const runtimeRoot = path.join(tmpWorkspace, 'runtime');
    mkdirSync(runtimeRoot, { recursive: true });

    const server = await startBoardServer({
      approvalRoot: path.join(runtimeRoot, 'approvals'),
      runId: 'test-run-g027',
      assignmentEpoch: 1,
      port: 0,
      host: '127.0.0.1',
      workspaceRoot: tmpWorkspace,
      runtimeRoot,
    });

    assert.ok(server.port > 0, 'Server should have a port');

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/usage`);
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { ok: boolean; usage: Record<string, unknown> };
      assert.strictEqual(data.ok, true);
      assert.ok(data.usage, 'Usage summary payload present');
      assert.ok(typeof data.usage.today_cost_usd === 'number');
      assert.ok(typeof data.usage.total_cost_usd === 'number');
    } finally {
      await server.close();
    }
  });

  test('Page script includes usage monitor container and refresh handler', () => {
    const html = renderBoardPage();
    assert.ok(html.includes('📊 本地真实会话用量与花费监控 (ccusage)'));
    assert.ok(html.includes('btn-refresh-usage'));
    assert.ok(html.includes('/api/usage'));
  });
});
