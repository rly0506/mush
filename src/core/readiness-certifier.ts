/**
 * GOAL-074：无人值守放闸就绪认证引擎（RM-011 M4 终局）
 *
 * 聚合 RM-011 全程证据并逐项机检；任一项缺失/不达标 → 整体 NOT_READY
 * （fail-closed）。每项证据带 SHA-256 哈希锚点，供认证报告回放。
 * 红线：本引擎只出证据与结论，绝不自动变更 D8 默认值（档位提升权归 owner）。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './event-log.ts';
import type { CircuitBreaker } from './circuit-breaker.ts';

export interface ReadinessItem {
  id: string;
  title: string;
  passed: boolean;
  /** 决定性证据工件的内容哈希锚点（文件缺失时缺省）。 */
  evidence_hash?: string;
  /** 决定性工件之外的伴随证据锚点（如 E4 的 soak 摘要）。 */
  aux_sha256?: string;
  detail?: string;
}

export interface ReadinessInput {
  /** 仓库根（docs/ 所在）。 */
  repoRoot: string;
  /** 运行时根（soak 摘要与熔断状态所在）。 */
  runtimeRoot: string;
  breaker?: CircuitBreaker;
}

export interface ReadinessReport {
  generated_at_utc: string;
  ready: boolean;
  items: ReadinessItem[];
}

function shaOfFile(p: string): string | undefined {
  try {
    if (!existsSync(p)) return undefined;
    return sha256Hex(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

function readOf(p: string): string | undefined {
  try {
    if (!existsSync(p)) return undefined;
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * GOAL-072 口径的 soak 判定：≥480min 完成，且 RSS/句柄曲线均无增长趋势。
 * 逐轮指标齐备（≥10 条有效 round 行且无坏行）才走曲线判定；
 * 指标含损坏/非法行或采样不足 → fail-closed 退回严格口径（必须零失败）。
 */
function evaluateSoak(summaryRaw: string, metricsRaw: string | undefined): { passed: boolean; detail: string } {
  let s: { minutes?: unknown; fail?: unknown };
  try {
    s = JSON.parse(summaryRaw) as { minutes?: unknown; fail?: unknown };
  } catch {
    return { passed: false, detail: 'soak 摘要损坏，无法解析' };
  }
  const minutes = typeof s.minutes === 'number' && Number.isFinite(s.minutes) ? s.minutes : NaN;
  const minutesOk = minutes >= 480;
  const minutesTxt = Number.isFinite(minutes) ? `${Math.round(minutes)}min` : 'minutes?';
  const fail = typeof s.fail === 'number' && Number.isFinite(s.fail) ? Math.round(s.fail) : NaN;
  const failTxt = Number.isNaN(fail) ? 'fail?' : String(fail);

  if (!metricsRaw) {
    const passed = minutesOk && fail === 0;
    return {
      passed,
      detail: passed
        ? `8h+ 完成 · ${minutesTxt} · 零失败（无逐轮指标，严格口径）`
        : `无逐轮指标，退回严格口径：${minutesTxt} · fail=${failTxt}`,
    };
  }

  const rss: number[] = [];
  const handles: number[] = [];
  let malformed = 0;
  for (const line of metricsRaw.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      const row = JSON.parse(t) as { kind?: unknown; rss_mb?: unknown; handles?: unknown };
      if (row.kind === 'start' || row.kind === 'summary') continue; // 已知非轮次元数据行
      const isRound = typeof row.kind === 'string' && row.kind.startsWith('round');
      const rssVal = row.rss_mb;
      if (!isRound || typeof rssVal !== 'number' || !Number.isFinite(rssVal) || rssVal < 0) {
        malformed += 1;
        continue;
      }
      rss.push(rssVal);
      // handles=-1 为旧版 runner 的「未采集」哨兵，跳过不计坏行
      if (typeof row.handles === 'number' && Number.isFinite(row.handles) && row.handles >= 0) handles.push(row.handles);
    } catch {
      malformed += 1;
    }
  }

  if (rss.length >= 10 && malformed === 0) {
    const startRss = rss[0];
    const endRss = rss[rss.length - 1];
    const peakRss = Math.max(...rss);
    const rssFree = endRss - startRss <= 50; // 结束不高于起点 50MB = 无泄漏趋势
    let handlesFree = true;
    let handlesNote = ' · 句柄采样不足(不参与判定)';
    if (handles.length >= 10) {
      const hStart = handles[0];
      const hEnd = handles[handles.length - 1];
      handlesFree = hEnd - hStart <= 20;
      handlesNote = ` · 句柄 ${hStart}→${hEnd}${handlesFree ? ' 平稳' : ' 增长异常'}`;
    }
    const verdict = !rssFree ? (handlesFree ? 'RSS 疑似泄漏趋势' : 'RSS/句柄均异常') : handlesFree ? '无泄漏趋势' : '句柄增长异常';
    return {
      passed: minutesOk && rssFree && handlesFree,
      detail: `${minutesTxt} · RSS ${startRss}→${endRss}MB(峰${peakRss}) ${verdict}${handlesNote} · 失败 ${failTxt} 次`,
    };
  }

  const badNote = malformed > 0 ? `指标含 ${malformed} 行损坏/非法` : '有效轮次采样不足(<10)';
  const passed = minutesOk && fail === 0;
  return { passed, detail: `${badNote}，退回严格口径：${minutesTxt} · fail=${failTxt}` };
}

/** 逐项机检。任何一项 passed=false → 整体 notReady。 */
export function certifyUnattendedReadiness(input: ReadinessInput): ReadinessReport {
  const docsDir = path.join(input.repoRoot, 'docs', 'dispatch');
  const items: ReadinessItem[] = [];

  // E1：四阶段演练战报（S1-S4 全绿）
  const drillPath = path.join(docsDir, 'rm011-m1-drill-report.md');
  const drill = readOf(drillPath);
  const drillOk = drill !== undefined && drill.includes('实战绿');
  items.push({
    id: 'E1-four-stage-drill',
    title: 'RM-011 M1 四阶段演练战报（实战绿）',
    passed: drillOk,
    ...(drill !== undefined ? { evidence_hash: shaOfFile(drillPath) } : {}),
    detail: drillOk ? undefined : `缺少 ${drillPath} 或未含「实战绿」结论`,
  });

  // E2：双项目观察态演练战报（17 断言全绿）
  const dualPath = path.join(docsDir, 'rm011-m1-dual-drill.md');
  const dual = readOf(dualPath);
  const dualOk = dual !== undefined && dual.includes('17/17');
  items.push({
    id: 'E2-dual-project-drill',
    title: 'GOAL-071 双项目演练战报（17/17 全绿）',
    passed: dualOk,
    ...(dual !== undefined ? { evidence_hash: shaOfFile(dualPath) } : {}),
    detail: dualOk ? undefined : `缺少 ${dualPath} 或未含「17/17」判定`,
  });

  // E3：混沌注入矩阵测试在库（四类用例齐备）
  const chaosPath = path.join(input.repoRoot, 'tests', 'g072-chaos-injection.test.ts');
  const chaos = readOf(chaosPath);
  const chaosOk =
    chaos !== undefined &&
    ['中途击杀', '服务重启', '竞争写入', '重复消费'].every((k) => chaos.includes(k));
  items.push({
    id: 'E3-chaos-matrix',
    title: '混沌注入矩阵（击杀/重启/撕裂/双花）测试在库',
    passed: chaosOk,
    ...(chaos !== undefined ? { evidence_hash: shaOfFile(chaosPath) } : {}),
    detail: chaosOk ? undefined : `${chaosPath} 缺失或用例不全`,
  });

  // E4：soak 完成 ≥8h 且句柄/RSS 双零泄漏趋势（GOAL-072 原文口径）。
  // 失败数如实记录；判定逻辑见 evaluateSoak（含 fail-closed 回退）。
  const summaryPath = path.join(input.runtimeRoot, 'soak-summary.json');
  const metricsPath = path.join(input.runtimeRoot, 'soak-metrics.jsonl');
  const soakRaw = readOf(summaryPath);
  const metricsRaw = readOf(metricsPath);
  const soakEval = soakRaw !== undefined
    ? evaluateSoak(soakRaw, metricsRaw)
    : { passed: false, detail: `${summaryPath} 不存在（8h soak 未完成或未启动）` };
  items.push({
    id: 'E4-soak-8h-clean',
    title: '8h soak 完成（句柄/RSS 双零泄漏趋势）',
    passed: soakEval.passed,
    ...(soakRaw !== undefined
      ? {
          evidence_hash: metricsRaw !== undefined ? shaOfFile(metricsPath) : shaOfFile(summaryPath),
          ...(metricsRaw !== undefined ? { aux_sha256: shaOfFile(summaryPath) } : {}),
        }
      : {}),
    detail: soakEval.detail,
  });

  // E5：熔断器事件链完整（含停机/恢复演练痕迹即可，未触发也视为链完好）
  const breakerIntact = input.breaker === undefined ? false : input.breaker.verifyEventChain();
  items.push({
    id: 'E5-breaker-chain',
    title: '失控熔断器事件链完整',
    passed: breakerIntact,
    detail: breakerIntact ? undefined : '熔断器未接线或事件链校验失败',
  });

  // E6：分级授权策略文件可解析且档位合法（默认 L0 即通过——认证的是能力就绪）
  const policyPath = path.join(input.runtimeRoot, 'unattended-policy.json');
  const policyRaw = readOf(policyPath);
  let policyOk = policyRaw !== undefined;
  if (policyRaw !== undefined) {
    try {
      const p = JSON.parse(policyRaw) as { level?: unknown };
      policyOk = p.level === 'L0' || p.level === 'L1' || p.level === 'L2';
    } catch {
      policyOk = false;
    }
  }
  items.push({
    id: 'E6-policy-persisted',
    title: '分级授权策略持久化可解析（默认 L0 即达标）',
    passed: policyOk,
    ...(policyRaw !== undefined ? { evidence_hash: shaOfFile(policyPath) } : {}),
    detail: policyOk ? undefined : `${input.runtimeRoot}\\unattended-policy.json 缺失或非法`,
  });

  return {
    generated_at_utc: new Date().toISOString(),
    ready: items.every((i) => i.passed),
    items,
  };
}

/** 认证报告 Markdown 渲染。 */
export function renderReadinessMarkdown(report: ReadinessReport): string {
  const rows = report.items
    .map((i) => `| ${i.passed ? '✅' : '❌'} | ${i.id} | ${i.title} | ${i.detail ?? ''} | ${i.evidence_hash?.slice(0, 16) ?? '-'} |`)
    .join('\n');
  return [
    '# RM-011 无人值守放闸就绪认证报告',
    '',
    `- 生成时间：${report.generated_at_utc}`,
    `- 总体判定：**${report.ready ? 'READY（证据链完备）' : 'NOT_READY（fail-closed）'}**`,
    '',
    '| 判定 | 项 | 标题 | 说明 | 证据锚点 |',
    '|---|---|---|---|---|',
    rows,
    '',
    '> 本报告只聚合证据，不自动变更 D8 默认值；开启与否由 owner 终裁。',
    '',
  ].join('\n');
}
