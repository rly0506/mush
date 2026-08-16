/**
 * mush loop 层（M4 dogfood）— 扫描、推荐与 owner 一句话确认门（D6）。
 * 未确认即 WAITING_OWNER；确认记录为 append-only 文件，不虚构任何确认。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface TaskCandidate {
  id: string;
  title: string;
  ready: boolean;
  requires_owner_selection: boolean;
}

export function scanNextTask(candidates: TaskCandidate[]): TaskCandidate | null {
  return candidates.find((candidate) => candidate.ready) ?? null;
}

export function emitRecommendation(
  loop: import('./loop.ts').LoopStateMachine,
  chosen: TaskCandidate,
  candidates: TaskCandidate[],
): import('./loop.ts').LoopEvent {
  return loop.transition('RECOMMEND', {
    candidates: candidates.map((candidate) => candidate.id),
    chosen: chosen.id,
    chosen_title: chosen.title,
  });
}

export function confirmOwnerSelection(
  loop: import('./loop.ts').LoopStateMachine,
  candidateId: string,
  ownerEvidence: string,
): import('./loop.ts').LoopEvent {
  return loop.transition('CONFIRM', {
    candidate_id: candidateId,
    owner_evidence: ownerEvidence,
  });
}

export interface OwnerSelectionStatus {
  waiting: boolean;
  selected: string | null;
  reason: string;
}

/** 读取 owner 选择记录（<candidate>.selected.json）；无记录 = WAITING_OWNER。 */
export function ownerSelectionStatus(root: string, candidates: TaskCandidate[]): OwnerSelectionStatus {
  for (const candidate of candidates) {
    const recordPath = path.join(root, candidate.id + '.selected.json');
    if (existsSync(recordPath)) {
      try {
        const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { selected?: string };
        if (typeof record.selected === 'string' && record.selected === candidate.id) {
          return { waiting: false, selected: candidate.id, reason: '' };
        }
      } catch {
        // 损坏的选择记录按未确认处理（fail-closed）。
      }
    }
  }
  return { waiting: true, selected: null, reason: 'no owner selection record' };
}

export interface ScanEvidence {
  schema_version: 1;
  scanned_at_utc: string;
  candidates: string[];
  selected: string | null;
  status: 'WAITING_OWNER' | 'READY';
  reason: string;
}

/** 扫描证据落盘（append-only；重复运行写新文件由调用方决定路径）。 */
export function writeScanEvidence(
  evidencePath: string,
  candidates: TaskCandidate[],
  selected: string | null,
  reason: string,
): ScanEvidence {
  const evidence: ScanEvidence = {
    schema_version: 1,
    scanned_at_utc: new Date().toISOString(),
    candidates: candidates.map((candidate) => candidate.id),
    selected,
    status: selected === null ? 'WAITING_OWNER' : 'READY',
    reason,
  };
  mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence) + '\n', 'utf8');
  return evidence;
}
