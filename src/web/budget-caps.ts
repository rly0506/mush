/**
 * GOAL-017A U3 — per-actor 预算 cap 持久化（runtime/budget-caps.json，schema v1）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface BudgetCapsFile {
  schema_version: 1;
  caps: Record<string, number>;
}

export const DEFAULT_BUDGET_CAP_USD = 5;

export function loadBudgetCaps(capsPath: string): Record<string, number> {
  try {
    if (!existsSync(capsPath)) return {};
    const parsed = JSON.parse(readFileSync(capsPath, 'utf8')) as BudgetCapsFile;
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.caps !== 'object' || parsed.caps === null) {
      return {};
    }
    const caps: Record<string, number> = {};
    for (const [actor, value] of Object.entries(parsed.caps)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) caps[actor] = value;
    }
    return caps;
  } catch {
    // 文件缺失/损坏 fail-closed：回退空表（默认 5）。
    return {};
  }
}

export function saveBudgetCaps(capsPath: string, caps: Record<string, number>): void {
  mkdirSync(path.dirname(path.resolve(capsPath)), { recursive: true });
  const file: BudgetCapsFile = { schema_version: 1, caps };
  writeFileSync(capsPath, JSON.stringify(file, null, 2) + '\n', 'utf8');
}
