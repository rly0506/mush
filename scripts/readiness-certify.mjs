#!/usr/bin/env node
// GOAL-074：生成/刷新无人值守放闸就绪认证报告 → docs/dispatch/rm011-readiness-certification.md
// 用法：node scripts/readiness-certify.mjs   （8h soak 收官后重跑以刷新 E4）
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { certifyUnattendedReadiness, renderReadinessMarkdown } from '../src/core/readiness-certifier.ts';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';
import { saveUnattendedPolicy } from '../src/core/unattended-policy.ts';

const repoRoot = process.cwd();
const runtimeRoot = path.join(repoRoot, 'runtime');
const breaker = new CircuitBreaker(path.join(runtimeRoot, 'unattended-breaker.json'));
// E6 引导：策略文件缺省时落一份默认 L0（fail-closed 语义不变）
if (!existsSync(path.join(runtimeRoot, 'unattended-policy.json'))) {
  saveUnattendedPolicy(runtimeRoot, { level: 'L0', auto_approve_cap_usd: 0, daily_auto_budget_usd: 0, task_whitelist_prefixes: [] });
}
const report = certifyUnattendedReadiness({ repoRoot, runtimeRoot, breaker });
let md = renderReadinessMarkdown(report);
if (!report.ready) {
  md += '\n---\n\n> 附注：本报告为过程归档。未达标项（见上表 ❌）达成后重跑本脚本刷新；\n> E4 未达成前整体维持 NOT_READY（fail-closed）。\n';
}
const outDir = path.join(repoRoot, 'docs', 'dispatch');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'rm011-readiness-certification.md');
writeFileSync(outPath, md, 'utf8');
console.log('ready:', report.ready, '| 报告:', outPath);
for (const i of report.items) console.log(' ', i.passed ? '✅' : '❌', i.id, '|', i.detail ?? '');
