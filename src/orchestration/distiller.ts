/**
 * mush 编排层 — 记忆提炼与结构化不变式压缩器（GOAL-038 & GOAL-057）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export type ContextAlertLevel = 'normal' | 'warning' | 'critical' | 'overflow';

export interface ContextPressureStatus {
  readonly current_tokens: number;
  readonly max_tokens: number;
  readonly usage_pct: number;
  readonly alert_level: ContextAlertLevel;
  readonly session_id?: string;
}

export interface DistilledMemory {
  readonly session_id: string;
  readonly timestamp_utc: string;
  readonly decisions: readonly string[];
  readonly constraints: readonly string[];
  readonly files_touched: readonly string[];
  readonly pending_actions: readonly string[];
  readonly summary_markdown: string;
}

export interface StructuredStateCompact {
  readonly timestamp_utc: string;
  readonly decisions: readonly string[];
  readonly modified_files: readonly string[];
  readonly test_status: string;
  readonly todos: readonly string[];
  readonly open_risks: readonly string[];
  readonly raw_summary: string;
}

/** GOAL-038: 评估上下文压力与告警阈值 */
export function evaluateContextPressure(
  current: number,
  max: number,
  sessionId?: string
): ContextPressureStatus {
  const safeMax = max > 0 ? max : 200000;
  const usage_pct = Math.round((current / safeMax) * 100);
  let alert_level: ContextAlertLevel = 'normal';

  if (usage_pct >= 95) {
    alert_level = 'overflow';
  } else if (usage_pct >= 85) {
    alert_level = 'critical';
  } else if (usage_pct >= 70) {
    alert_level = 'warning';
  }

  return {
    current_tokens: current,
    max_tokens: safeMax,
    usage_pct,
    alert_level,
    ...(sessionId ? { session_id: sessionId } : {}),
  };
}

/** GOAL-038: 会话记录蒸馏提炼 */
export function distillTranscript(
  sessionId: string,
  messages: Array<{ sender?: string; role?: string; content?: string; text?: string }>
): DistilledMemory {
  const timestamp_utc = new Date().toISOString();
  const allText = messages.map((m) => m.content || m.text || '').join('\n');

  const decisions: string[] = [];
  const constraints: string[] = [];
  const files_touched: string[] = [];
  const pending_actions: string[] = [];

  for (const line of allText.split('\n')) {
    const trimmed = line.trim();
    if (/决定|决议|架构|adopt|decide/i.test(trimmed)) decisions.push(trimmed);
    if (/必须|严禁|红线|只能|不能|禁止|constraint|must/i.test(trimmed)) constraints.push(trimmed);
    if (/下一步|TODO|待办|后续|pending/i.test(trimmed)) pending_actions.push(trimmed);
  }

  const fileMatches = allText.matchAll(/(?:src|goals|docs|tests|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|js|md|jsonl|json|css|ps1)/gi);
  for (const m of fileMatches) {
    if (!files_touched.includes(m[0])) files_touched.push(m[0]);
  }

  const summary_markdown = [
    `# 会话蒸馏记忆 (${sessionId})`,
    `- 生成时间：${timestamp_utc}`,
    '',
    '## 1. 敲定决策',
    ...(decisions.length > 0 ? decisions.slice(0, 8).map((d) => `- ${d}`) : ['- 无特定架构决策']),
    '',
    '## 2. 约束边界',
    ...(constraints.length > 0 ? constraints.slice(0, 8).map((c) => `- ${c}`) : ['- 遵守宪法最高治理文件']),
    '',
    '## 3. 触碰文件',
    ...(files_touched.length > 0 ? files_touched.map((f) => '- ' + f) : ['- 无直接文件修改']),
    '',

    '## 4. 待办事项',
    ...(pending_actions.length > 0 ? pending_actions.slice(0, 8).map((a) => `- ${a}`) : ['- 当前无挂起行动项']),
  ].join('\n');

  return {
    session_id: sessionId,
    timestamp_utc,
    decisions: Object.freeze(decisions),
    constraints: Object.freeze(constraints),
    files_touched: Object.freeze(files_touched),
    pending_actions: Object.freeze(pending_actions),
    summary_markdown,
  };
}

export function saveMemory(rootDir: string, memory: DistilledMemory): void {
  const memDir = path.join(rootDir, 'runtime', 'memories');
  mkdirSync(memDir, { recursive: true });
  // GOAL-067（P1-8）纵深防御：session_id 拼入文件名，basename 复核拒绝任何
  // 含路径分隔符/穿越序列的值（server 入口另有白名单正则，此处兜底直调方）。
  if (path.basename(`memory-${memory.session_id}.json`) !== `memory-${memory.session_id}.json`) {
    throw new Error(`invalid memory session_id: ${memory.session_id}`);
  }
  const memFile = path.join(memDir, `memory-${memory.session_id}.json`);
  writeFileSync(memFile, JSON.stringify(memory, null, 2), 'utf8');
}

export function loadMemory(rootDir: string, sessionId: string): DistilledMemory | null {
  const memFile = path.join(rootDir, 'runtime', 'memories', `memory-${sessionId}.json`);
  if (!existsSync(memFile)) return null;
  try {
    return JSON.parse(readFileSync(memFile, 'utf8'));
  } catch {
    return null;
  }
}

export function listMemories(rootDir: string): DistilledMemory[] {
  const memDir = path.join(rootDir, 'runtime', 'memories');
  if (!existsSync(memDir)) return [];
  const files = readdirSync(memDir).filter((f) => f.startsWith('memory-') && f.endsWith('.json'));
  const list: DistilledMemory[] = [];
  for (const f of files) {
    try {
      list.push(JSON.parse(readFileSync(path.join(memDir, f), 'utf8')));
    } catch {}
  }
  return list;
}

/** GOAL-057: 结构化不变式状态压缩提取器 */
export function extractStructuredInvariant(messages: Array<{ role?: string; sender?: string; text?: string; content?: string }>): StructuredStateCompact {
  const allText = messages.map((m) => m.text || m.content || '').join('\n');
  const timestamp_utc = new Date().toISOString();

  const decisions = new Set<string>();
  const dMatches = allText.matchAll(/\b(D\d+)[：:\s]+([^\n]+)/gi);
  for (const m of dMatches) {
    decisions.add(`${m[1].toUpperCase()}: ${m[2].trim()}`);
  }

  const modifiedFiles = new Set<string>();
  const fileMatches = allText.matchAll(/(?:src|goals|docs|tests|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|js|md|jsonl|json|css|ps1)/gi);
  for (const m of fileMatches) {
    modifiedFiles.add(m[0]);
  }

  let test_status = '未知 / 待回归';
  const testMatch = /(\d+\s*\/\s*\d+\s*(?:tests|用例)?\s*(?:PASS|通过|全绿))/i.exec(allText);
  if (testMatch) {
    test_status = testMatch[1];
  } else if (/npm test.*PASS/i.test(allText)) {
    test_status = 'PASS (全部通过)';
  }

  const todos: string[] = [];
  const todoMatches = allText.matchAll(/(?:TODO|下一步|待办)[：:\s]+([^\n]+)/gi);
  for (const m of todoMatches) {
    todos.push(m[1].trim());
  }

  const open_risks: string[] = [];
  const riskMatches = allText.matchAll(/(?:风险|警告|注意|WARNING|CAUTION)[：:\s]+([^\n]+)/gi);
  for (const m of riskMatches) {
    open_risks.push(m[1].trim());
  }

  const raw_summary = [
    '# 📦 结构化会话状态快照 (Structured State Invariant)',
    `- 生成时间：${timestamp_utc}`,
    `- 测试基线：${test_status}`,
    '',
    '## 1. 核心决策与锁定',
    ...(decisions.size > 0 ? [...decisions].map((d) => `- ${d}`) : ['- 无新增独立决策']),
    '',
    '## 2. 涉及与改动文件',
    ...(modifiedFiles.size > 0 ? [...modifiedFiles].slice(0, 10).map((f) => '- ' + f) : ['- 无直接文件改动']),
    '',

    '## 3. 待办事项',
    ...(todos.length > 0 ? todos.slice(0, 5).map((t) => `- ${t}`) : ['- 当前阶段所有任务已闭环']),
    '',
    '## 4. 约束与安全红线',
    ...(open_risks.length > 0 ? open_risks.slice(0, 5).map((r) => `- ⚠️ ${r}`) : ['- 遵守宪法红线：零凭据泄露、纯本地执行']),
  ].join('\n');

  return {
    timestamp_utc,
    decisions: Object.freeze([...decisions]),
    modified_files: Object.freeze([...modifiedFiles]),
    test_status,
    todos: Object.freeze(todos),
    open_risks: Object.freeze(open_risks),
    raw_summary,
  };
}

/** GOAL-057: Pass-Quiet / Fail-Rich 自动化测试与命令输出管道 */
export function filterExecutionOutput(output: string, exitCode: number): string {
  if (exitCode === 0) {
    const summaryMatch = output.match(/ℹ\s*tests[\s\S]*?(?:duration_ms|passed|fail\s*0)[^\n]*/i);
    if (summaryMatch) {
      return summaryMatch[0].trim();
    }
    const lines = output.trim().split('\n').filter(Boolean);
    return lines.slice(-2).join('\n') || '✔ Execution completed successfully (Pass-Quiet).';
  }


  // 失败场景 (Fail-Rich)
  const failIndex = output.indexOf('✖ failing tests:');
  if (failIndex !== -1) {
    return output.slice(failIndex).trim();
  }
  const lines = output.trim().split('\n');
  return lines.slice(-50).join('\n');
}

/** GOAL-057: @-mention 文件门禁 */
export function processFileMention(filePath: string, content: string): { allowed: boolean; lineCount: number; injectedContent: string } {
  const lines = content.split('\n');
  const lineCount = lines.length;
  if (lineCount <= 300) {
    return {
      allowed: true,
      lineCount,
      injectedContent: `<!-- file: ${filePath} (${lineCount} lines) -->\n${content}`,
    };
  }

  const preview = [
    `<!-- file: ${filePath} (OVERSIZE GUARD: ${lineCount} lines > 300 lines limit) -->`,
    `> [!WARNING] 文件 ${filePath} 共 ${lineCount} 行，已触发 300 行安全门禁。为防止上下文膨胀，仅内联前 50 行与后 20 行大纲。如需局部修改，请指示工犬使用工具分片读取。`,
    '\`\`\`',
    ...lines.slice(0, 50),
    `... (${lineCount - 70} lines omitted) ...`,
    ...lines.slice(-20),
    '\`\`\`',
  ].join('\n');

  return {
    allowed: false,
    lineCount,
    injectedContent: preview,
  };
}
