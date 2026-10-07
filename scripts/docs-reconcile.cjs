#!/usr/bin/env node
/**
 * docs-reconcile.cjs —— 文档对账机检（零依赖）
 *
 * 背景：2026-09-06 审计发现目标池/Goal 状态行/契约版本存在簿记漂移
 * （详见当次审计报告）。本脚本把"文档与实际一致"从人治变机检，
 * 防止同样的腐烂再次发生。三条校验：
 *
 *   A. docs/goal-pool.md 表格行状态 vs 对应 goals/GOAL-*.md 状态行
 *      - 池 done / AUTO_ACCEPTED ⇒ 文件须为 DONE 或 AUTO_ACCEPTED
 *        （AUTO_ACCEPTED=D15 机检收官、DONE 待 owner；池不区分二者）
 *      - 池 PROPOSED / QUEUED / idea ⇒ 文件不得为 DONE / AUTO_ACCEPTED
 *        （池落后于文件同样算漂移）
 *   B. src/web/api-contract.md：顶部当前版本 = 最大 changelog 节版本，节号唯一
 *   C. DECISIONS.md 表行编号 D1..Dmax 连续；缺口必须在 KNOWN_GAPS 登记
 *      （append-only：缺口只登记不补造）；已定义编号不得留在 KNOWN_GAPS
 *
 * 用法：node scripts/docs-reconcile.cjs   （exit 0=一致 / 1=有漂移，报告走 stdout）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const POOL = path.join(ROOT, 'docs', 'goal-pool.md');
const GOALS_DIR = path.join(ROOT, 'goals');
const CONTRACT = path.join(ROOT, 'src', 'web', 'api-contract.md');
const DECISIONS = path.join(ROOT, 'DECISIONS.md');

/**
 * DECISIONS.md 历史缺口登记（2026-09-06 审计追账）：
 * 这些编号从未定义，按 AGENTS.md"不补造缺失编号"原则仅在此登记为未启用。
 * D82：RM-011 批次编号（docs/rm-011 引用），DECISIONS.md 未补录——交接文档
 * 明确"补录需要可追溯依据，不凭摘要重建 owner 授权"，留待 owner 补录。
 * 若日后 owner 补定义了其中某个编号，请同时从本清单移除。
 */
const KNOWN_GAPS = [35, 68, 69, 70, 77, 82];

const problems = [];
const notes = [];

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

// ---- 校验 A：目标池 vs Goal 文件状态行 -------------------------------

const FILE_DONE_LIKE = new Set(['DONE', 'AUTO_ACCEPTED']);

function goalFileStatus(text) {
  // 取首个状态行（仓库约定状态行唯一，位于文档头部区域）
  const m = text.match(/^(?:[-*]\s*)?(?:状态|status)\s*[:：]\s*(.+)$/im);
  if (!m) return { status: null, line: null };
  const rest = m[1];
  const tick = rest.match(/`([A-Z_]+)`/);
  const word = rest.match(/\b([A-Z_]{3,})\b/);
  return { status: (tick ? tick[1] : word ? word[1] : 'UNPARSEABLE'), line: m[0] };
}

function checkGoalPool() {
  const poolLines = read(POOL).split(/\r?\n/);
  let rows = 0;
  poolLines.forEach((line, i) => {
    if (!line.includes('goals/GOAL-')) return;
    const refs = [...line.matchAll(/goals\/(GOAL-[0-9A-Za-z-]+)\.md/g)].map((m) => m[1]);
    if (refs.length === 0) return;
    const cells = line.split('|').map((c) => c.trim());
    const poolCell = cells.find((c) => /^(done|idea|proposed|queued|in_flight|auto_accepted|active|ready)$/i.test(c));
    if (!poolCell) return; // 无状态列的行（如目录/标题行）跳过
    const poolStatus = poolCell.toUpperCase();
    for (const ref of refs) {
      rows += 1;
      const file = path.join(GOALS_DIR, ref + '.md');
      if (!fs.existsSync(file)) {
        problems.push(`[A] 目标池第 ${i + 1} 行引用的 ${ref}.md 不存在`);
        continue;
      }
      const { status } = goalFileStatus(read(file));
      if (!status) {
        problems.push(`[A] ${ref} 缺状态行（目标池记 ${poolStatus}）`);
        continue;
      }
      if (poolStatus === 'DONE' || poolStatus === 'AUTO_ACCEPTED') {
        if (!FILE_DONE_LIKE.has(status)) {
          problems.push(`[A] ${ref} 目标池记 ${poolStatus}，但文件状态行为 ${status}`);
        }
      } else if (FILE_DONE_LIKE.has(status)) {
        problems.push(`[A] ${ref} 文件已 ${status}，但目标池仍记 ${poolStatus}（池落后）`);
      }
    }
  });
  notes.push(`[A] 目标池共核对 ${rows} 条 Goal 映射`);
}

// ---- 校验 B：契约版本声明一致性 -------------------------------------

function checkContract() {
  const text = read(CONTRACT);
  const head = text.match(/状态[：:]\s*`v(\d+)\.(\d+)`/);
  if (!head) {
    problems.push('[B] api-contract.md 顶部未找到"状态：`vX.Y`"当前版本声明');
    return;
  }
  const current = Number(head[1]) * 1000 + Number(head[2]);
  const sections = [...text.matchAll(/^###\s+v(\d+)\.(\d+)/gm)].map((m) => Number(m[1]) * 1000 + Number(m[2]));
  if (sections.length === 0) {
    problems.push('[B] api-contract.md 未找到任何 "### vX.Y" 版本章节');
    return;
  }
  const seen = new Map();
  for (const v of sections) seen.set(v, (seen.get(v) || 0) + 1);
  for (const [v, n] of seen) {
    if (n > 1) problems.push(`[B] api-contract.md 版本节 v${Math.floor(v / 1000)}.${v % 1000} 出现 ${n} 次`);
  }
  const maxSec = Math.max(...sections);
  if (maxSec !== current) {
    problems.push(`[B] api-contract.md 顶部版本 v${Math.floor(current / 1000)}.${current % 1000} ≠ 最大章节 v${Math.floor(maxSec / 1000)}.${maxSec % 1000}`);
  }
  notes.push(`[B] 契约当前版本 v${Math.floor(current / 1000)}.${current % 1000}，共 ${sections.length} 个版本节`);
}

// ---- 校验 C：DECISIONS.md 编号缺口登记 -------------------------------

function checkDecisions() {
  const text = read(DECISIONS);
  const defined = new Set();
  for (const m of text.matchAll(/^\|\s*D(\d+)\s*\|/gm)) defined.add(Number(m[1]));
  if (defined.size === 0) {
    problems.push('[C] DECISIONS.md 未找到任何 "| D<编号> |" 表行');
    return;
  }
  const max = Math.max(...defined);
  const gaps = [];
  for (let n = 1; n <= max; n++) if (!defined.has(n)) gaps.push(n);
  const unregistered = gaps.filter((n) => !KNOWN_GAPS.includes(n));
  if (unregistered.length > 0) {
    problems.push(`[C] DECISIONS.md 缺号 D${unregistered.join('/D')} 未在 docs-reconcile.cjs KNOWN_GAPS 登记`);
  }
  const stale = KNOWN_GAPS.filter((n) => defined.has(n));
  if (stale.length > 0) {
    problems.push(`[C] KNOWN_GAPS 中的 D${stale.join('/D')} 已有定义，请从登记清单移除`);
  }
  notes.push(`[C] DECISIONS.md 已定义至 D${max}，缺口 ${gaps.length ? 'D' + gaps.join('/D') : '无'}（登记 ${KNOWN_GAPS.length} 个）`);
}

// ---- 入口 ------------------------------------------------------------

checkGoalPool();
checkContract();
checkDecisions();

const unique = [...new Set(problems)];
for (const n of notes) process.stdout.write(`OK   ${n}\n`);
if (unique.length > 0) {
  process.stdout.write(`FAIL 文档对账发现 ${unique.length} 处漂移：\n`);
  for (const p of unique) process.stdout.write(`  - ${p}\n`);
  process.stdout.write('处理约定：状态行以"审计追账"更正（append-only 叙事内联），缺口登记进 KNOWN_GAPS，不补造历史。\n');
  process.exit(1);
}
process.stdout.write('PASS 文档对账一致\n');
