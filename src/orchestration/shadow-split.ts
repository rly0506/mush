/**
 * GOAL-040: 跨 Harness 影子分流评测台 (Shadow Split Evaluation Bench)
 */

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

export interface ShadowCandidate {
  adapter_id: string;
  model_id?: string;
  dispatch_id: string;
  status: 'PENDING' | 'RUNNING' | 'PASS' | 'FAIL' | 'TIMEOUT';
  duration_ms: number;
  tokens: { input: number; output: number };
  diff_summary?: { files_changed: number; additions: number; deletions: number };
  output_tail?: string;
}

export interface ShadowEvalReport {
  fastest_adapter: string;
  most_efficient_adapter: string;
  comparison_table: Array<{
    adapter_id: string;
    duration_ms: number;
    total_tokens: number;
    status: string;
  }>;
  consensus_summary: string;
}

export interface ShadowEvaluation {
  eval_id: string;
  prompt: string;
  prompt_sha256: string;
  created_at_utc: string;
  candidates: ShadowCandidate[];
  report?: ShadowEvalReport;
}

/** 创建影子分流评测 */
export function createShadowEvaluation(prompt: string, adapterIds: string[]): ShadowEvaluation {
  const evalId = `eval-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const promptSha = createHash('sha256').update(prompt, 'utf8').digest('hex');

  const candidates: ShadowCandidate[] = adapterIds.map((aid) => ({
    adapter_id: aid,
    dispatch_id: `disp-eval-${aid}-${randomUUID().slice(0, 6)}`,
    status: 'PENDING',
    duration_ms: 0,
    tokens: { input: Math.round(prompt.length / 3), output: 0 },
  }));

  return {
    eval_id: evalId,
    prompt,
    prompt_sha256: promptSha,
    created_at_utc: new Date().toISOString(),
    candidates,
  };
}

/** 完成并生成交叉比对评测报告 */
export function generateShadowReport(evaluation: ShadowEvaluation): ShadowEvalReport {
  let fastest = evaluation.candidates[0]?.adapter_id || 'unknown';
  let minDuration = Infinity;

  let mostEfficient = evaluation.candidates[0]?.adapter_id || 'unknown';
  let minTokens = Infinity;

  const comparisonTable = evaluation.candidates.map((c) => {
    const totalToks = c.tokens.input + c.tokens.output;
    if (c.duration_ms > 0 && c.duration_ms < minDuration) {
      minDuration = c.duration_ms;
      fastest = c.adapter_id;
    }
    if (totalToks > 0 && totalToks < minTokens) {
      minTokens = totalToks;
      mostEfficient = c.adapter_id;
    }

    return {
      adapter_id: c.adapter_id,
      duration_ms: c.duration_ms,
      total_tokens: totalToks,
      status: c.status,
    };
  });

  const passCount = evaluation.candidates.filter((c) => c.status === 'PASS').length;
  const consensusSummary = `评测共涉及 ${evaluation.candidates.length} 只犬，其中 ${passCount} 只通过。最快响应犬为 ${fastest}（耗时 ${minDuration === Infinity ? 0 : minDuration}ms），Token 最优犬为 ${mostEfficient}。`;

  const report: ShadowEvalReport = {
    fastest_adapter: fastest,
    most_efficient_adapter: mostEfficient,
    comparison_table: comparisonTable,
    consensus_summary: consensusSummary,
  };

  evaluation.report = report;
  return report;
}

/** 持久化评测记录 */
export function saveShadowEvaluation(runtimeRoot: string, evaluation: ShadowEvaluation): string {
  const dir = path.join(runtimeRoot, 'evaluations');
  fs.mkdirSync(dir, { recursive: true });
  const targetFile = path.join(dir, `${evaluation.eval_id}.json`);
  fs.writeFileSync(targetFile, JSON.stringify(evaluation, null, 2), 'utf-8');
  return targetFile;
}

/** 读取单条评测 */
export function loadShadowEvaluation(runtimeRoot: string, evalId: string): ShadowEvaluation | null {
  const targetFile = path.join(runtimeRoot, 'evaluations', `${evalId}.json`);
  if (!fs.existsSync(targetFile)) return null;
  try {
    const raw = fs.readFileSync(targetFile, 'utf-8');
    return JSON.parse(raw) as ShadowEvaluation;
  } catch {
    return null;
  }
}

/** 列出所有评测 */
export function listShadowEvaluations(runtimeRoot: string): ShadowEvaluation[] {
  const dir = path.join(runtimeRoot, 'evaluations');
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const list: ShadowEvaluation[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        list.push(JSON.parse(raw) as ShadowEvaluation);
      } catch {}
    }
    return list;
  } catch {
    return [];
  }
}
