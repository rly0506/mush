/** GOAL-084: host-owned evidence. No HTTP registration and no inference from runner PASS.
 * The host is responsible for reviewing what an artifact proves before registering it.
 * Reads recheck immutable registrations and artifact bytes, including at approval time. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EVIDENCE_BEHAVIOR_METHODS, ISOLATION_DIMENSIONS,
  type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from './collaboration-blackboard.ts';

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const fields = ['source', 'adapter_id', 'dimension', 'method', 'subject', 'coverage', 'tool_version',
  'config_fingerprint', 'artifact_sha256', 'verification', 'result', 'recorded_at_utc'] as const;
/** 记录里允许出现的全部键（verification 可缺省=declared，历史记录不因新增字段失效）。 */
const allowedKeys = new Set<string>([...fields, 'verification']);
function valid(value: unknown): value is EvidenceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (!Object.keys(r).every(key => allowedKeys.has(key))) return false;
  // 除 verification 外，全部字段必须是长度受限的非空字符串；verification 缺省视为 declared。
  const required = fields.filter(key => key !== 'verification');
  const verificationOk = r.verification === undefined || r.verification === 'behavior' || r.verification === 'declared';
  return verificationOk &&
    required.every(key => typeof r[key] === 'string' && (r[key] as string).trim() !== '' && (r[key] as string).length <= 8192) &&
    (ISOLATION_DIMENSIONS as readonly unknown[]).includes(r.dimension) &&
    (EVIDENCE_BEHAVIOR_METHODS as readonly unknown[]).includes(r.method) &&
    /^[0-9a-f]{64}$/i.test(r.config_fingerprint as string) && /^[0-9a-f]{64}$/i.test(r.artifact_sha256 as string) &&
    (r.result === 'pass' || r.result === 'fail' || r.result === 'withdrawn') &&
    Number.isFinite(Date.parse(r.recorded_at_utc as string));
}
/** 显式验证分类：只认 verification 字段，描述文字不参与判定（2026-10-04 owner 裁定）。 */
function readVerification(record: EvidenceRecord): 'behavior' | 'declared' {
  return record.verification === 'behavior' ? 'behavior' : 'declared';
}

export class FileCollaborationEvidenceStore implements EvidenceStoreLike {
  private readonly dataRoot: string;
  private readonly directory: string;
  constructor(dataRoot: string) {
    this.dataRoot = path.resolve(dataRoot);
    this.directory = path.join(this.dataRoot, 'collaboration', 'evidence');
  }

  private contained(file: string): boolean {
    const relative = path.relative(realpathSync(this.dataRoot), realpathSync(file));
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  }

  private read(file: string, limit: number): Buffer {
    if (!this.contained(file) || !statSync(file).isFile() || statSync(file).size > limit) throw new Error('invalid evidence file');
    return readFileSync(file);
  }

  private ensureDirectory(directory: string): void {
    if (!existsSync(directory)) {
      this.ensureDirectory(path.dirname(directory));
      mkdirSync(directory);
    }
    if (!this.contained(directory)) throw new Error('evidence directory escapes data root');
  }

  /** Only trusted host code may register a reviewed artifact. Existing sources cannot be replaced. */
  register(record: EvidenceRecord, artifact: Buffer): void {
    if (!valid(record)) throw new Error('invalid evidence registration');
    if (!Buffer.isBuffer(artifact) || artifact.length > 16 * 1024 * 1024 || hash(artifact) !== record.artifact_sha256.toLowerCase()) {
      throw new Error('evidence artifact hash mismatch or size exceeded');
    }
    const frozen = Object.fromEntries(fields.map(key => [key, record[key]]));
    const bytes = JSON.stringify(frozen) + '\n';
    for (const dir of ['records', 'artifacts']) {
      const destination = path.join(this.directory, dir);
      this.ensureDirectory(destination);
    }
    const artifactPath = path.join(this.directory, 'artifacts', record.artifact_sha256.toLowerCase());
    try { writeFileSync(artifactPath, artifact, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || hash(this.read(artifactPath, 16 * 1024 * 1024)) !== record.artifact_sha256.toLowerCase()) {
        throw new Error('existing evidence artifact invalid; refusing overwrite');
      }
    }
    const recordPath = path.join(this.directory, 'records', hash(record.source) + '.json');
    try { writeFileSync(recordPath, bytes, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || this.read(recordPath, 128 * 1024).toString() !== bytes) {
        throw new Error('evidence source already registered; refusing overwrite');
      }
    }
  }

  private readRecord(source: string): EvidenceRecord | undefined {
    if (typeof source !== 'string' || source.trim() === '' || source.length > 8192) return undefined;
    try {
      const record: unknown = JSON.parse(this.read(path.join(this.directory, 'records', hash(source) + '.json'), 128 * 1024).toString());
      if (!valid(record) || record.source !== source) return undefined;
      const artifact = this.read(path.join(this.directory, 'artifacts', record.artifact_sha256.toLowerCase()), 16 * 1024 * 1024);
      return hash(artifact) === record.artifact_sha256.toLowerCase() ? record : undefined;
    } catch { return undefined; } // Missing, corrupt or inaccessible evidence never grants admission.
  }

  private registrations(): EvidenceRecord[] {
    let names: string[];
    try { names = readdirSync(path.join(this.directory, 'records')).sort(); }
    catch { return []; }
    const entries: EvidenceRecord[] = [];
    for (const name of names) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
      try {
        const raw: unknown = JSON.parse(this.read(path.join(this.directory, 'records', name), 128 * 1024).toString());
        if (!valid(raw) || hash(raw.source) + '.json' !== name) continue;
        entries.push(raw);
      } catch { /* A damaged entry does not hide unrelated valid evidence. */ }
    }
    return entries;
  }

  resolve(source: string): EvidenceRecord | undefined {
    const record = this.readRecord(source);
    if (record?.result === 'pass' && this.registrations().some(r => r.result === 'fail' &&
      r.adapter_id === record.adapter_id && r.config_fingerprint === record.config_fingerprint && r.dimension === record.dimension)) {
      return undefined; // A recorded counterexample cannot be bypassed by selecting an older positive source.
    }
    // 追加更正（owner 裁定通道）：withdrawn 记录精确撤回其 subject 指向的来源
    // （subject === 'withdrawn:' + source），原记录保留不改写；同维度新登记的
    // 独立来源不受株连。
    if (record?.result === 'pass' && this.registrations().some(r => r.result === 'withdrawn' &&
      r.subject === 'withdrawn:' + record.source)) {
      return undefined;
    }
    return record;
  }

  /** D89 必要条件（owner 2026-10-04 复核）：列出同通道 + 同指纹 + 同维度下已登记的反例。
   *  与 `resolve` 的阻断规则同一口径（adapter_id + config_fingerprint + dimension），
   *  供准入在创建/批准/派发前显式拒绝——政策只接受"未验证"，不能覆盖已证实的失败。 */
  failuresFor(adapterId: string, configFingerprint: string, dimension: string): EvidenceRecord[] {
    return this.registrations().filter(r => r.result === 'fail' &&
      r.adapter_id === adapterId && r.config_fingerprint === configFingerprint && r.dimension === dimension);
  }

  forParticipant(adapterId: string, fingerprint: string): CollabCapabilityEvidence[] {
    return this.registrations().filter(r => r.adapter_id === adapterId && r.config_fingerprint === fingerprint)
      .flatMap(raw => {
        const r = this.resolve(raw.source);
        return r === undefined ? [] : [{ source: r.source, adapter_id: r.adapter_id, dimension: r.dimension, subject: r.subject,
          method: r.method, coverage: r.coverage, tool_version: r.tool_version, config_fingerprint: r.config_fingerprint,
          // 显式分类随条目透出，供准入判定使用（不看 coverage 文案）。
          verification: readVerification(r),
          status: (r.result === 'fail' || r.result === 'withdrawn') ? 'unmet' as const
            : (readVerification(r) === 'behavior' && (EVIDENCE_BEHAVIOR_METHODS as readonly string[]).includes(r.method))
              ? 'live_verified' as const : 'declared' as const }];
      });
  }
}
