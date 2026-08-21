/**
 * GOAL-036: Langfuse 式派发 Trace 步骤树与耗时瀑布数据引擎
 */

import path from 'node:path';
import fs from 'node:fs';

export interface TokenCurvePoint {
  stage: string;
  tokens_in: number;
  tokens_out: number;
  timestamp_utc: string;
}

export interface TraceStep {
  step_id: string;
  name: string; // 'queue' | 'carveout_check' | 'prompt_assemble' | 'execute' | 'verify' | 'receipt'
  status: 'ok' | 'error' | 'skipped';
  start_ms: number; // 相对派发开始的偏移量 (毫秒)
  duration_ms: number;
  summary?: string;
  detail?: string;
  children?: TraceStep[];
}

export interface DispatchTrace {
  dispatch_id: string;
  adapter_id: string;
  started_at_utc: string;
  completed_at_utc?: string;
  total_duration_ms: number;
  steps: TraceStep[];
  token_curve: TokenCurvePoint[];
}

/** 初始化一个派发 Trace */
export function createDispatchTrace(dispatchId: string, adapterId: string): DispatchTrace {
  return {
    dispatch_id: dispatchId,
    adapter_id: adapterId,
    started_at_utc: new Date().toISOString(),
    total_duration_ms: 0,
    steps: [],
    token_curve: [],
  };
}

/** 向 Trace 追加步骤节点 */
export function addTraceStep(trace: DispatchTrace, step: TraceStep): DispatchTrace {
  trace.steps.push(step);
  const stepEndMs = step.start_ms + step.duration_ms;
  if (stepEndMs > trace.total_duration_ms) {
    trace.total_duration_ms = stepEndMs;
  }
  return trace;
}

/** 记录 Token 消耗曲线数据点 */
export function recordTokenPoint(trace: DispatchTrace, point: TokenCurvePoint): DispatchTrace {
  trace.token_curve.push(point);
  return trace;
}

/** 完成 Trace 并计算总耗时 */
export function finishDispatchTrace(trace: DispatchTrace): DispatchTrace {
  trace.completed_at_utc = new Date().toISOString();
  if (trace.steps.length > 0) {
    const lastStep = trace.steps[trace.steps.length - 1];
    trace.total_duration_ms = Math.max(trace.total_duration_ms, lastStep.start_ms + lastStep.duration_ms);
  }
  return trace;
}

/** 持久化 Trace 至 runtime/traces/<dispatch_id>.json */
export function saveDispatchTrace(runtimeRoot: string, trace: DispatchTrace): string {
  const dir = path.join(runtimeRoot, 'traces');
  fs.mkdirSync(dir, { recursive: true });
  const targetFile = path.join(dir, `${trace.dispatch_id}.json`);
  fs.writeFileSync(targetFile, JSON.stringify(trace, null, 2), 'utf-8');
  return targetFile;
}

/** 读取指定派发的 Trace */
export function loadDispatchTrace(runtimeRoot: string, dispatchId: string): DispatchTrace | null {
  const targetFile = path.join(runtimeRoot, 'traces', `${dispatchId}.json`);
  if (!fs.existsSync(targetFile)) return null;
  try {
    const raw = fs.readFileSync(targetFile, 'utf-8');
    return JSON.parse(raw) as DispatchTrace;
  } catch {
    return null;
  }
}

/** 列出所有已记录的 Trace */
export function listDispatchTraces(runtimeRoot: string, limit = 50): DispatchTrace[] {
  const dir = path.join(runtimeRoot, 'traces');
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const traces: DispatchTrace[] = [];
    for (const f of files.slice(-limit)) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        traces.push(JSON.parse(raw) as DispatchTrace);
      } catch {}
    }
    return traces;
  } catch {
    return [];
  }
}
