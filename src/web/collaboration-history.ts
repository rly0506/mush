/** Explicitly audited real baselines only; never infer success from fixture output or roster labels. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CollabParticipantInput } from '../orchestration/collaboration-blackboard.ts';
import type { DiscussionChannelCheck } from './dispatch.ts';

export interface RealDiscussionBaseline {
  file: string;
  sha256: string;
  versions: Readonly<Record<string, string>>;
}
const BASELINES: readonly RealDiscussionBaseline[] = [
  { file: 'GOAL-085-d98-dual-review-receipt.json', sha256: 'fc11d31607d49ab7acc31a8054d68f3f019b2702152a50f70028876cea20513b',
    versions: { codex: '0.160.0', agy: '1.2.17' } },
  { file: 'GOAL-085-d99-claude-dual-receipt.json', sha256: '2a262fb61e0ece7ea35e28a531402f39a470d552a1c3c28c01579aa918914840',
    versions: { codex: '0.160.0', 'claude-code': '2.1.290' } },
] as const;
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
// Inspector preserves the native label. Normalize its documented Codex prefix for historical
// lookup only; execution gates still compare the original frozen/observed native strings.
const versionNumber = (value: string | undefined): string | undefined => value?.match(/^(?:codex-cli )?(\d+\.\d+\.\d+)$/)?.[1];

export function realDiscussionBaseline(root: string, participants: CollabParticipantInput[], channels: DiscussionChannelCheck[],
  baselines: readonly RealDiscussionBaseline[] = BASELINES): {
  status: 'VERIFIED' | 'UNTESTED'; session_id?: string; receipt?: string;
} {
  for (const baseline of baselines) {
    try {
      const receiptPath = path.join(root, 'goals', 'receipts', baseline.file);
      const bytes = readFileSync(receiptPath);
      if (digest(bytes) !== baseline.sha256) continue;
      const receipt = JSON.parse(bytes.toString('utf8'));
      const artifact = receipt.evidence.find((e: { file: string }) => path.basename(e.file) === 'final-detail.json');
      if (artifact === undefined) continue;
      const detailPath = path.resolve(artifact.file);
      const relative = path.relative(root, detailPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const detailBytes = readFileSync(detailPath);
      if (digest(detailBytes) !== artifact.sha256.toLowerCase()) continue;
      const detail = JSON.parse(detailBytes.toString('utf8'));
      if (detail.status !== 'completed' || detail.session_id !== receipt.session_id || participants.length !== 2) continue;
      const match = participants.every((p, index) => {
        const recorded = detail.snapshot.participants[index];
        const version = channels.find(c => c.adapter_id === p.adapter_id)?.observed_version;
        return recorded && ['seat', 'adapter_id', 'provider_id', 'model_id', 'effort', 'config_fingerprint'].every(key =>
          recorded[key] === p[key as keyof CollabParticipantInput])
          && versionNumber(version) !== undefined && versionNumber(version) === versionNumber(baseline.versions[p.adapter_id]);
      });
      if (match) return { status: 'VERIFIED', session_id: receipt.session_id, receipt: baseline.file };
    } catch { /* Missing/tampered historical artifacts never upgrade a combination to verified. */ }
  }
  return { status: 'UNTESTED' };
}
