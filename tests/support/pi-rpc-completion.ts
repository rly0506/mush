/**
 * M1 fixture-reference（非生产实现）：
 * 把黄金参照 invoke-managed-pi-agent.ps1 的 task-packet / completion 严格校验
 * 语义翻译为 Node/TS 可执行参考件；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1
 *     task-packet 校验 L191-L201
 *     completion 校验 L405-L462
 *   D:\意向项目\.agent-bridge\tools\tests\fake-pi-rpc-agent.ps1
 *     New-FakeCompletion L111-L135
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REQUIRED_COMPLETION_FIELDS = [
  'summary',
  'changed_paths',
  'tests_run',
  'test_results',
  'evidence_paths_and_hashes',
  'open_findings',
  'requested_decision',
  'next_step',
] as const;

export type CompletionScenario =
  | 'valid'
  | 'settle-only'
  | 'missing-fields'
  | 'empty-evidence'
  | 'missing-evidence-path'
  | 'missing-evidence-sha256'
  | 'malformed-evidence-hash'
  | 'duplicate-evidence'
  | 'unexpected-evidence'
  | 'fabricated-evidence'
  | 'wrong-hash'
  | 'out-of-scope'
  | 'in-scope-nonempty'
  | 'terminal-text-only'
  | 'stale-before-prompt'
  | 'two-message'
  | 'non-assistant'
  | 'user-then-assistant'
  | 'tool-call-then-completion'
  | 'tool-call-then-settle'
  | 'post-completion-extra-message'
  | 'fenced-json'
  | 'fenced-json-incomplete'
  | 'tool-budget-exceeded';

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function has(value: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isBlank(value: string): boolean {
  return /^\s*$/.test(value);
}

function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9A-Fa-f]{64}$/.test(value);
}

export interface PathResolver {
  fullPath(p: string): string;
  /** 文件不存在返回 null；存在返回大写 SHA-256 十六进制。 */
  existsSha256(p: string): string | null;
}

export function makeRealPathResolver(): PathResolver {
  return {
    fullPath(p: string): string {
      return path.resolve(String(p));
    },
    existsSha256(p: string): string | null {
      try {
        const bytes = readFileSync(p);
        return createHash('sha256').update(bytes).digest('hex').toUpperCase();
      } catch {
        return null;
      }
    },
  };
}

/**
 * task-packet 契约校验（移植 wrapper L193-L200，缺失/错型一律无效）。
 * 返回 null 表示通过；否则返回 fail-closed reason。
 */
export function validateTaskPacket(packet: unknown): string | null {
  const p = asObject(packet);
  if (p === null) return 'completion-task-packet-invalid';
  const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  if (Number(asString(p.schema_version)) !== 1) return 'completion-task-packet-invalid';
  if (asString(p.packet_type) !== 'managed_pi_task') return 'completion-task-packet-invalid';
  if (isBlank(asString(p.objective))) return 'completion-task-packet-invalid';
  if (count(p.allowed_paths_and_hashes) < 1) return 'completion-task-packet-invalid';
  if (!asArray(p.allowed_operations).map(asString).includes('read')) return 'completion-task-packet-invalid';
  if (count(p.required_evidence) < 1) return 'completion-task-packet-invalid';
  if (count(p.stop_conditions) < 1) return 'completion-task-packet-invalid';
  return null;
}

export interface CompletionValidationContext {
  packet: Record<string, unknown>;
  runRoot: string;
  resolver: PathResolver;
}

export type CompletionValidationResult =
  | { ok: true; completion: Record<string, unknown> }
  | { ok: false; reason: string };

function entryShapeInvalid(entry: unknown): boolean {
  const item = asObject(entry);
  if (item === null) return true;
  if (!has(item, 'path') || !has(item, 'sha256')) return true;
  if (typeof item.path !== 'string' || isBlank(item.path)) return true;
  return !isSha256(item.sha256);
}

/**
 * completion 严格校验（移植 wrapper L405-L462 的完整判定顺序与 reason 文本）。
 * PS 断言强度不降低：reason 一一对应 PS 版的 fail-closed 分支。
 */
export function validateCompletion(
  candidate: unknown,
  ctx: CompletionValidationContext,
): CompletionValidationResult {
  const c = asObject(candidate);
  if (c === null) return { ok: false, reason: 'completion-object-missing-or-ambiguous' };

  for (const field of REQUIRED_COMPLETION_FIELDS) {
    if (!has(c, field)) return { ok: false, reason: `completion-missing-field-${field}` };
  }
  if (
    Number(asString(c.schema_version)) !== 1 ||
    isBlank(asString(c.summary)) ||
    isBlank(asString(c.requested_decision)) ||
    isBlank(asString(c.next_step))
  ) {
    return { ok: false, reason: 'completion-shape-invalid' };
  }

  // allowed_paths_and_hashes：形状 → 真实文件 → 哈希一致 → 无重复（wrapper L414-L422）
  const allowedPaths = new Map<string, string>();
  for (const entry of asArray(ctx.packet.allowed_paths_and_hashes)) {
    if (entryShapeInvalid(entry)) {
      return { ok: false, reason: 'completion-task-packet-path-shape-invalid' };
    }
    const item = asObject(entry) as Record<string, unknown>;
    const full = ctx.resolver.fullPath(asString(item.path));
    const actual = ctx.resolver.existsSha256(full);
    if (actual === null || actual !== asString(item.sha256).toUpperCase()) {
      return { ok: false, reason: 'completion-allowed-path-hash-mismatch' };
    }
    const key = full.toLowerCase();
    if (allowedPaths.has(key)) return { ok: false, reason: 'completion-task-packet-path-duplicate' };
    allowedPaths.set(key, asString(item.sha256).toUpperCase());
  }

  // changed_paths 必须全部落在 allowlist（wrapper L424-L427）
  for (const changedPath of asArray(c.changed_paths)) {
    const full = ctx.resolver.fullPath(asString(changedPath));
    if (!allowedPaths.has(full.toLowerCase())) {
      return { ok: false, reason: 'completion-out-of-scope-path' };
    }
  }

  // required_evidence：非空 → 形状 → 去重 → 必须在 allowlist 内（wrapper L429-L439）
  const requiredEvidence = asArray(ctx.packet.required_evidence);
  if (requiredEvidence.length < 1) return { ok: false, reason: 'completion-task-packet-evidence-empty' };
  const expectedEvidence = new Map<string, string>();
  for (const required of requiredEvidence) {
    if (entryShapeInvalid(required)) {
      return { ok: false, reason: 'completion-task-packet-evidence-shape-invalid' };
    }
    const item = asObject(required) as Record<string, unknown>;
    const key = ctx.resolver.fullPath(asString(item.path)).toLowerCase();
    const expectedHash = asString(item.sha256).toUpperCase();
    if (expectedEvidence.has(key)) return { ok: false, reason: 'completion-task-packet-evidence-duplicate' };
    if (!allowedPaths.has(key) || allowedPaths.get(key) !== expectedHash) {
      return { ok: false, reason: 'completion-task-packet-evidence-outside-allowlist' };
    }
    expectedEvidence.set(key, expectedHash);
  }

  // completion evidence：覆盖数 → 形状 → 去重 → 与期望一致 → 文件存在 → 哈希一致
  // （wrapper L441-L460）
  const completionEvidence = asArray(c.evidence_paths_and_hashes);
  if (completionEvidence.length !== expectedEvidence.size) {
    return { ok: false, reason: 'completion-evidence-coverage-mismatch' };
  }
  const seenEvidence = new Set<string>();
  for (const evidence of completionEvidence) {
    if (entryShapeInvalid(evidence)) return { ok: false, reason: 'completion-evidence-shape-invalid' };
    const item = asObject(evidence) as Record<string, unknown>;
    const full = ctx.resolver.fullPath(asString(item.path));
    const key = full.toLowerCase();
    if (seenEvidence.has(key)) return { ok: false, reason: 'completion-evidence-duplicate' };
    seenEvidence.add(key);
    const evidenceHash = asString(item.sha256).toUpperCase();
    if (!expectedEvidence.has(key) || expectedEvidence.get(key) !== evidenceHash) {
      return { ok: false, reason: 'completion-evidence-unexpected' };
    }
    const actual = ctx.resolver.existsSha256(full);
    if (actual === null) return { ok: false, reason: 'completion-evidence-missing' };
    if (actual !== evidenceHash) return { ok: false, reason: 'completion-evidence-hash-mismatch' };
  }

  // 只读契约：allowed_operations 只有 read 时，changed_paths 必须为空（wrapper L462）
  const operations = asArray(ctx.packet.allowed_operations).map(asString);
  if (operations.filter((op) => op !== 'read').length === 0 && asArray(c.changed_paths).length !== 0) {
    return { ok: false, reason: 'completion-read-only-changed-paths' };
  }

  return { ok: true, completion: c };
}

/**
 * 按 fake-pi-rpc-agent.ps1 New-FakeCompletion L111-L135 生成各场景的
 * completion 对象（golden fake 的输入语义，逐一对应）。
 */
export function buildScenarioCompletion(
  taskPacket: Record<string, unknown>,
  scenario: CompletionScenario,
): Record<string, unknown> {
  const requiredEvidence = asArray(taskPacket.required_evidence);
  const allowedPaths = asArray(taskPacket.allowed_paths_and_hashes);
  const evidencePath =
    requiredEvidence.length > 0 ? asString(asObject(requiredEvidence[0])?.path) : '';
  const evidenceSha256 =
    requiredEvidence.length > 0 ? asString(asObject(requiredEvidence[0])?.sha256) : '';
  const allowedPath = allowedPaths.length > 0 ? asString(asObject(allowedPaths[0])?.path) : '';

  const completion: Record<string, unknown> = {
    schema_version: 1,
    summary: 'Fixture task completed.',
    changed_paths: [],
    tests_run: ['fixture semantic check'],
    test_results: ['PASS'],
    evidence_paths_and_hashes: [{ path: evidencePath, sha256: evidenceSha256 }],
    open_findings: [],
    requested_decision: 'APPROVE',
    next_step: 'Parent review.',
  };

  switch (scenario) {
    case 'missing-fields':
      delete completion.next_step;
      break;
    case 'empty-evidence':
      completion.evidence_paths_and_hashes = [];
      break;
    case 'missing-evidence-path': {
      const first = asArray(completion.evidence_paths_and_hashes)[0] as Record<string, unknown>;
      delete first.path;
      break;
    }
    case 'missing-evidence-sha256': {
      const first = asArray(completion.evidence_paths_and_hashes)[0] as Record<string, unknown>;
      delete first.sha256;
      break;
    }
    case 'malformed-evidence-hash': {
      const first = asArray(completion.evidence_paths_and_hashes)[0] as Record<string, unknown>;
      first.sha256 = 'not-a-sha256';
      break;
    }
    case 'duplicate-evidence':
      asArray(completion.evidence_paths_and_hashes).push({ path: evidencePath, sha256: evidenceSha256 });
      break;
    case 'unexpected-evidence':
      asArray(completion.evidence_paths_and_hashes).push({
        path: path.join(path.dirname(evidencePath), 'unexpected.json'),
        sha256: evidenceSha256,
      });
      break;
    case 'fabricated-evidence': {
      const first = asArray(completion.evidence_paths_and_hashes)[0] as Record<string, unknown>;
      first.path = path.join(path.dirname(evidencePath), 'missing-evidence.json');
      break;
    }
    case 'wrong-hash': {
      const first = asArray(completion.evidence_paths_and_hashes)[0] as Record<string, unknown>;
      first.sha256 = 'F'.repeat(64);
      break;
    }
    case 'out-of-scope':
      completion.changed_paths = [allowedPath + '.outside'];
      break;
    case 'in-scope-nonempty':
      completion.changed_paths = [allowedPath];
      break;
    default:
      break;
  }
  return completion;
}
