#!/usr/bin/env node
// GOAL-072 长时序稳定性 soak 执行器（RM-011 M2）
//
// 用法：
//   node scripts/soak-runner.mjs [--minutes 480] [--workspace D:\path] [--model opencode/x-preview-f-free] [--interval 30]
//
// 行为：复用 DispatchPipeline 以 free 模型零成本连续派发；每轮记录
// RSS/堆/句柄曲线与派发结果到 <runtime>/soak-metrics.jsonl（append-only）；
// 结束输出摘要。设计为独立进程长跑（PowerShell Start-Process 脱离会话）。
//
// 红线：仅在指定 workspace 派发与分析类任务，不触碰冻结区与生产台账。

import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const minutes = Number(arg('minutes', '480'));
const intervalSec = Number(arg('interval', '30'));
const model = String(arg('model', 'opencode/x-preview-f-free'));
const adapter = String(arg('adapter', 'opencode'));
const effort = String(arg('effort', 'LOW'));
const workspace = String(arg('workspace', '')) || mkdtempSync(path.join(tmpdir(), 'g072-soak-'));
mkdirSync(workspace, { recursive: true });

const runtimeDir = path.join(workspace, 'runtime');
mkdirSync(runtimeDir, { recursive: true });
const metricsPath = path.join(runtimeDir, 'soak-metrics.jsonl');

const pipeline = new DispatchPipeline({
  workspaceRoot: workspace,
  approvalRoot: path.join(workspace, '.soak-approvals'),
  ledgerPath: path.join(runtimeDir, 'budget-ledger.jsonl'),
});

// --model default = 不传 model_id，走合同缺省（不支持 -m 切模型的通道必用此项）
const MODEL_ARG = model === 'default' || model === '' ? {} : { model_id: model };

const PROMPTS = [
  '只回复一个词：ok',
  '计算 13*17 并只回复数字。',
  '列出当前目录顶层条目数，只回复数字。',
  '用一句话解释什么是幂等性。',
];

const startedAt = Date.now();
const deadline = startedAt + minutes * 60_000;
let round = 0;
let pass = 0;
let fail = 0;

console.log(`[soak] start=${new Date().toISOString()} minutes=${minutes} interval=${intervalSec}s model=${model}`);
console.log(`[soak] workspace=${workspace} metrics=${metricsPath}`);

function metric(kind, extra) {
  const mem = process.memoryUsage();
  let handles = -1;
  try { handles = (process)._getActiveHandles ? (process)._getActiveHandles().length : -1; } catch {}
  const row = {
    at_utc: new Date().toISOString(),
    kind,
    round,
    elapsed_s: Math.round((Date.now() - startedAt) / 1000),
    rss_mb: Math.round((mem.rss / 1048576) * 10) / 10,
    heap_mb: Math.round((mem.heapUsed / 1048576) * 10) / 10,
    handles,
    pass,
    fail,
    ...extra,
  };
  try { appendFileSync(metricsPath, JSON.stringify(row) + '\n', 'utf8'); } catch {}
  return row;
}

metric('start');

while (Date.now() < deadline) {
  round += 1;
  const prompt = PROMPTS[round % PROMPTS.length];
  const t0 = Date.now();
  try {
    const rec = await pipeline.dispatch({
      adapter_id: adapter,
      ...MODEL_ARG,
      prompt,
      dry_run: true,
      effort,
      cap_usd: 0.1,
      timeout_s: 120,
      goal_id: 'G072-SOAK',
      new_stream: round % 20 === 0, // 周期性强开新窗，压测流生命周期
    });
    if (['PASS', 'DRY_RUN'].includes(rec.status)) pass += 1; else fail += 1;
    const m = metric(rec.status === 'DRY_RUN' || rec.status === 'PASS' ? 'round_ok' : 'round_fail', {
      dispatch_status: rec.status,
      duration_ms: Date.now() - t0,
      dispatch_id: rec.dispatch_id,
      ...(rec.status !== 'PASS' && rec.status !== 'DRY_RUN'
        ? {
            error_head: String(rec.error || '').slice(0, 160),
            stderr_head: String(rec.stderr_tail?.text || '').replace(/\x1b\[[0-9;]*m/g, '').slice(0, 200),
          }
        : {}),
    });
    console.log(`[soak] r${round} ${rec.status} ${m.rss_mb}MB handles=${m.handles} (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (err) {
    fail += 1;
    metric('round_error', { error: String(err).slice(0, 200) });
    console.log('[soak] r' + round + ' ERROR ' + err);
  }
  const remain = deadline - Date.now();
  if (remain <= 0) break;
  await new Promise((r) => setTimeout(r, Math.min(intervalSec * 1000, remain)));
}

const summary = metric('summary');
writeFileSync(path.join(runtimeDir, 'soak-summary.json'), JSON.stringify({
  started_at_utc: new Date(startedAt).toISOString(),
  finished_at_utc: new Date().toISOString(),
  minutes,
  rounds: round,
  pass,
  fail,
  rss_mb_end: summary.rss_mb,
  rss_mb_delta_note: '对比 start 行与 summary 行的 rss_mb 判断泄漏趋势',
  metrics_file: metricsPath,
}, null, 2) + '\n', 'utf8');
console.log(`[soak] done rounds=${round} pass=${pass} fail=${fail} rss=${summary.rss_mb}MB`);
