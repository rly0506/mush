/**
 * GOAL-041: 看板审计日志归档导出器 (Audit Log Export)
 *
 * GOAL-067（P0-5）口径纠偏——旧实现统计全面失真，本版对齐真实持久化 schema：
 * - 事件链读 runtime/event-log-*.jsonl（旧版读不存在的 events.jsonl → 恒 0）；
 * - 派发统计读 runtime/dispatches/*.jsonl 头 + 生命周期事件投影（终态以末事件
 *   为准，与 dispatch.ts DEF-05 回放口径一致；旧版把台账行当派发计数）；
 * - 累计消费只累计 meta.kind === 'ACTUAL_COST' 台账行（预估/被拒金额不再混入
 *   实际花费）；台账哈希链状态按 BoardPersistence.verifyLedgerChain 实测给出，
 *   不再无条件宣称 VALID；
 * - time_range 为真过滤（today = UTC 当日起；week = 最近 7 天），不再只进标题；
 * - 审批计数排除 .owner-response.json（与 sources.ts 口径一致，一条审批计 1）。
 */

import path from 'node:path';
import fs from 'node:fs';
import { BoardPersistence } from './persistence.ts';

export type AuditTimeRange = 'today' | 'week' | 'all';

export interface AuditReportOptions {
  time_range?: AuditTimeRange;
  runtime_root: string;
  /** 审批请求目录（生产 = goals/receipts/approval-requests）；缺省回退 runtime/approvals。 */
  approval_root?: string;
}

export interface AuditSummary {
  total_dispatches: number;
  pass_dispatches: number;
  failed_dispatches: number;
  terminal_dispatches: number;
  success_rate: number;
  total_cost_usd: number;
  actual_cost_entries: number;
  total_events: number;
  event_chain_files: number;
  ledger_chain_status: 'VALID' | 'BROKEN' | 'EMPTY';
  total_approvals: number;
}

export interface AuditReport {
  generated_at_utc: string;
  time_range: AuditTimeRange;
  summary: AuditSummary;
  markdown_content: string;
  file_name: string;
}

/** 与 dispatch.ts TERMINAL 集合保持一致。 */
const TERMINAL_STATUSES = new Set([
  'PASS',
  'FAIL',
  'DRY_RUN',
  'TIMEOUT',
  'BLOCKED_WAITING_OWNER',
  'BLOCKED_ENV',
  'INTERRUPTED',
  'REJECTED',
  'SUPERSEDED',
]);
/** 计入成功率分母的执行性失败终态（BLOCKED/REJECTED/SUPERSEDED 属治理态，不算失败）。 */
const HARD_FAILURES = new Set(['FAIL', 'TIMEOUT', 'INTERRUPTED']);

function parseJsonLineSafe(line: string, source: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    process.stderr.write(`[mush:audit] torn line skipped in ${source}: ${line.slice(0, 120)}\n`);
    return null;
  }
}

function readJsonlRecords(file: string): Array<Record<string, unknown>> {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    const row = parseJsonLineSafe(line, path.basename(file));
    if (row !== null) rows.push(row);
  }
  return rows;
}

function rangeCutoffUtc(range: AuditTimeRange, now: Date): string | null {
  if (range === 'today') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  if (range === 'week') {
    return new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  }
  return null;
}

/** 无时间戳的记录不排除（fail-open）：过滤是展示口径，不是证据删除。 */
function withinRange(atUtc: unknown, cutoffIso: string | null): boolean {
  if (cutoffIso === null) return true;
  if (typeof atUtc !== 'string' || atUtc.trim() === '') return true;
  return atUtc >= cutoffIso;
}

function isMetaKind(row: Record<string, unknown>, kind: string): boolean {
  const meta = row.meta;
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>).kind === kind
    : false;
}

/** 聚合全量审计数据源并生成标准化 Markdown 报告 */
export function generateAuditReport(options: AuditReportOptions): AuditReport {
  const runtimeRoot = path.resolve(options.runtime_root);
  const timeRange: AuditTimeRange =
    options.time_range === 'today' || options.time_range === 'week' || options.time_range === 'all'
      ? options.time_range
      : 'all';
  const now = new Date();
  const nowUtc = now.toISOString();
  const cutoff = rangeCutoffUtc(timeRange, now);

  // 1. 事件链节点数：runtime/event-log-*.jsonl 全量聚合（GOAL-067 纠偏）。
  let eventChainFiles: string[] = [];
  try {
    eventChainFiles = fs.existsSync(runtimeRoot)
      ? fs.readdirSync(runtimeRoot).filter((f) => /^event-log-.+\.jsonl$/.test(f))
      : [];
  } catch {
    eventChainFiles = [];
  }
  let totalEvents = 0;
  for (const name of eventChainFiles) {
    totalEvents += readJsonlRecords(path.join(runtimeRoot, name)).length;
  }

  // 2. 派发统计：dispatches/*.jsonl 投影（终态以末生命周期事件为准）。
  let totalDispatches = 0;
  let passDispatches = 0;
  let failedDispatches = 0;
  let terminalDispatches = 0;
  const dispatchDir = path.join(runtimeRoot, 'dispatches');
  let dispatchFiles: string[] = [];
  try {
    dispatchFiles = fs.existsSync(dispatchDir)
      ? fs.readdirSync(dispatchDir).filter((f) => f.endsWith('.jsonl'))
      : [];
  } catch {
    dispatchFiles = [];
  }
  for (const name of dispatchFiles) {
    const rows = readJsonlRecords(path.join(dispatchDir, name));
    let header: Record<string, unknown> | null = null;
    const events: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      if (row.kind === 'header') header = row;
      else if (row.kind === 'event') events.push(row);
    }
    if (header === null) continue;
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const status = String(lastEvent?.status ?? header.status ?? '');
    const atUtc = lastEvent?.at_utc;
    if (!withinRange(atUtc, cutoff)) continue;
    totalDispatches += 1;
    if (TERMINAL_STATUSES.has(status)) terminalDispatches += 1;
    if (status === 'PASS') passDispatches += 1;
    else if (HARD_FAILURES.has(status)) failedDispatches += 1;
  }

  // 3. 台账：实际消费只计 ACTUAL_COST 行 + 哈希链完整性实测。
  let actualCostEntries = 0;
  let totalCostUsd = 0;
  for (const row of readJsonlRecords(path.join(runtimeRoot, 'budget-ledger.jsonl'))) {
    if (!isMetaKind(row, 'ACTUAL_COST')) continue;
    if (!withinRange(row.at_utc, cutoff)) continue;
    actualCostEntries += 1;
    if (typeof row.amount_usd === 'number') totalCostUsd += row.amount_usd;
  }
  let ledgerChainStatus: AuditSummary['ledger_chain_status'] = 'EMPTY';
  try {
    const persistence = new BoardPersistence(runtimeRoot);
    if (persistence.loadLedgerLines().length === 0) {
      ledgerChainStatus = 'EMPTY';
    } else {
      persistence.verifyLedgerChain();
      ledgerChainStatus = 'VALID';
    }
  } catch {
    ledgerChainStatus = 'BROKEN';
  }

  // 4. 审批流水：只计请求文件（排除 .owner-response.json，对齐 sources.ts 口径）。
  // GOAL-067：生产审批根在 goals/receipts/approval-requests（与 runtime 分离），
  // 由调用方显式传入；缺省回退旧布局 runtime/approvals。
  let totalApprovals = 0;
  const approvalsDir = options.approval_root
    ? path.resolve(options.approval_root)
    : path.join(runtimeRoot, 'approvals');
  try {
    if (fs.existsSync(approvalsDir)) {
      totalApprovals = fs
        .readdirSync(approvalsDir)
        .filter((name) => name.endsWith('.json') && !name.endsWith('.owner-response.json')).length;
    }
  } catch {}

  const rateDenominator = passDispatches + failedDispatches;
  const successRate = rateDenominator > 0 ? Number(((passDispatches / rateDenominator) * 100).toFixed(1)) : 100.0;

  const fileName = `audit-report-${nowUtc.replace(/[:.]/g, '-')}.md`;
  const ledgerChainText =
    ledgerChainStatus === 'VALID'
      ? 'SHA-256 哈希链逐行校验通过'
      : ledgerChainStatus === 'BROKEN'
        ? '校验失败：存在断链或行级损坏，需人工核查'
        : '空台账（尚无记账条目）';
  const markdown = [
    `# mush 运营审计与证据链归档报告`,
    `> 生成时间: ${nowUtc} · 统计范围: ${timeRange.toUpperCase()} · 台账哈希链: ${ledgerChainStatus}`,
    '',
    '## 1. 核心运营概览',
    '| 指标 | 统计数值 | 说明 |',
    '| :--- | :--- | :--- |',
    `| **总派发次数** | ${totalDispatches} 次 | 范围内派发单（终态以末事件投影为准）|`,
    `| **终态 / 通过 / 执行失败** | ${terminalDispatches} / ${passDispatches} / ${failedDispatches} | BLOCKED、REJECTED、SUPERSEDED 属治理态不计失败 |`,
    `| **任务成功率** | ${successRate}% | PASS 占「PASS + 执行性失败」比例；无终态单时记 100% |`,
    `| **累计消费** | $${totalCostUsd.toFixed(4)} | 仅 ACTUAL_COST 实付行（${actualCostEntries} 条），不含预估与被拒金额 |`,
    `| **事件链总节点** | ${totalEvents} 个 | 聚合 ${eventChainFiles.length} 个 event-log-*.jsonl 链文件 |`,
    `| **审批门决策流水** | ${totalApprovals} 条 | Owner 授权请求（不含应答文件）|`,
    '',
    '## 2. 证据链完整性状态',
    `- **预算台账**: ${ledgerChainText}；`,
    '- **密钥隔离**: 本报告仅含聚合统计与路径引用，无 prompt 明文与凭据；',
    '- **口径说明**: 统计基于本地 JSONL 台账回放，未做合规推断。',
    '',
    '## 3. 归档凭证摘要',
    `- **Runtime Root**: \`${runtimeRoot}\``,
    `- **哈希锚点**: \`${fileName}\``,
    '',
    '---',
    '*mush Head-Dog Automated Audit Generator*',
  ].join('\n');

  return {
    generated_at_utc: nowUtc,
    time_range: timeRange,
    summary: {
      total_dispatches: totalDispatches,
      pass_dispatches: passDispatches,
      failed_dispatches: failedDispatches,
      terminal_dispatches: terminalDispatches,
      success_rate: successRate,
      total_cost_usd: totalCostUsd,
      actual_cost_entries: actualCostEntries,
      total_events: totalEvents,
      event_chain_files: eventChainFiles.length,
      ledger_chain_status: ledgerChainStatus,
      total_approvals: totalApprovals,
    },
    markdown_content: markdown,
    file_name: fileName,
  };
}

/** 保存报告至 runtime/exports/ */
export function saveAuditReport(runtimeRoot: string, report: AuditReport): string {
  const dir = path.join(runtimeRoot, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, report.file_name);
  fs.writeFileSync(fullPath, report.markdown_content, 'utf-8');
  return fullPath;
}

/** 列出所有归档报告 */
export function listAuditReports(runtimeRoot: string): Array<{ file_name: string; path: string; created_at_utc: string }> {
  const dir = path.join(runtimeRoot, 'exports');
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    return files.map((f) => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return {
        file_name: f,
        path: fullPath,
        created_at_utc: stat.mtime.toISOString(),
      };
    });
  } catch {
    return [];
  }
}
