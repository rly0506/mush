/**
 * mush loop 层（M4 dogfood）— 半自动调度状态机与可回放事件链。
 *
 * 流程：SCAN → RECOMMEND → CONFIRM(owner) → DISPATCH → EXECUTE → REPORT →
 *       REVIEW → ACCEPT
 * 治理依据：DECISIONS D6（半自动：扫描→推荐→一句话确认→沿用）+ 宪法 §2
 * （append-only、哈希锚点、可重建审计链）。
 * 非法迁移 fail-closed；ACCEPT 为终态；每个事件带 canonical JSON 哈希并锚定
 * 前一事件（genesis previous_sha256=null）。
 */

import { canonicalJson, sha256Hex } from '../core/event-log.ts';

export type LoopState =
  | 'SCAN'
  | 'RECOMMEND'
  | 'CONFIRM'
  | 'DISPATCH'
  | 'EXECUTE'
  | 'REPORT'
  | 'REVIEW'
  | 'ACCEPT';

const ALLOWED_TRANSITIONS: Record<LoopState, LoopState[]> = {
  SCAN: ['RECOMMEND'],
  RECOMMEND: ['CONFIRM'],
  CONFIRM: ['DISPATCH'],
  DISPATCH: ['EXECUTE'],
  EXECUTE: ['REPORT'],
  REPORT: ['REVIEW'],
  REVIEW: ['ACCEPT'],
  ACCEPT: [],
};

export interface LoopEvent {
  readonly sequence: number;
  readonly from: LoopState;
  readonly to: LoopState;
  readonly atUtc: string;
  readonly meta: Record<string, unknown>;
  readonly sha256: string;
  readonly previous_sha256: string | null;
}

function eventBody(event: Omit<LoopEvent, 'sha256'>): string {
  return canonicalJson({
    sequence: event.sequence,
    from: event.from,
    to: event.to,
    at_utc: event.atUtc,
    meta: event.meta,
    previous_sha256: event.previous_sha256,
  });
}

export class LoopStateMachine {
  readonly runId: string;
  private _state: LoopState = 'SCAN';
  private _events: LoopEvent[] = [];

  constructor(runId: string) {
    if (typeof runId !== 'string' || runId.trim() === '') {
      throw new Error('loop run_id must be non-empty');
    }
    this.runId = runId;
  }

  static fromEvents(runId: string, events: readonly LoopEvent[]): LoopStateMachine {
    const machine = new LoopStateMachine(runId);
    for (const event of events) {
      machine.verifyChain();
      if (event.sequence !== machine._events.length + 1) {
        throw new Error(`loop event sequence must be contiguous: got ${event.sequence}`);
      }
      const previous = machine._events[machine._events.length - 1];
      if (event.previous_sha256 !== (previous?.sha256 ?? null)) {
        throw new Error(`loop chain anchor broken at sequence ${event.sequence}`);
      }
      const recomputed = sha256Hex(eventBody(event));
      if (recomputed !== event.sha256) {
        throw new Error(`loop event hash mismatch at sequence ${event.sequence}`);
      }
      if (event.from !== machine._state) {
        throw new Error(`loop event from-state mismatch at sequence ${event.sequence}`);
      }
      if (machine._state === 'REVIEW' && event.to === 'ACCEPT' && previous?.meta.verdict !== 'PASS') {
        throw new Error(`loop review verdict is not PASS at sequence ${event.sequence}; FAIL may never reach ACCEPT`);
      }
      if (!ALLOWED_TRANSITIONS[machine._state].includes(event.to)) {
        throw new Error(
          `loop illegal transition ${machine._state} -> ${event.to} at sequence ${event.sequence}`,
        );
      }
      machine._events.push(event);
      machine._state = event.to;
    }
    return machine;
  }

  get state(): LoopState {
    return this._state;
  }

  get sequence(): number {
    return this._events.length;
  }

  events(): readonly LoopEvent[] {
    return Object.freeze([...this._events]);
  }

  transition(next: LoopState, meta: Record<string, unknown>): LoopEvent {
    if (this._state === 'REVIEW' && next === 'ACCEPT') {
      const reviewEvent = this._events[this._events.length - 1];
      if (reviewEvent?.meta.verdict !== 'PASS') {
        throw new Error('loop review verdict is not PASS; FAIL may never reach ACCEPT');
      }
    }
    if (!ALLOWED_TRANSITIONS[this._state].includes(next)) {
      throw new Error(`loop illegal transition: ${this._state} -> ${next}`);
    }
    if (this._state === 'ACCEPT') {
      throw new Error('loop is in terminal state ACCEPT; no further transitions');
    }
    const previous = this._events[this._events.length - 1];
    const body: Omit<LoopEvent, 'sha256'> = {
      sequence: this._events.length + 1,
      from: this._state,
      to: next,
      atUtc: new Date().toISOString(),
      meta: { ...meta },
      previous_sha256: previous === undefined ? null : previous.sha256,
    };
    const event: LoopEvent = Object.freeze({
      ...body,
      sha256: sha256Hex(eventBody(body)),
    });
    this._events.push(event);
    this._state = next;
    return event;
  }

  /** 全链重算：连续 sequence、锚点、哈希。 */
  verifyChain(): void {
    let previous: string | null = null;
    let expectedSequence = 1;
    for (const event of this._events) {
      if (event.sequence !== expectedSequence) {
        throw new Error(`loop chain sequence broken at ${event.sequence}`);
      }
      if (event.previous_sha256 !== previous) {
        throw new Error(`loop chain anchor broken at sequence ${event.sequence}`);
      }
      if (sha256Hex(eventBody(event)) !== event.sha256) {
        throw new Error(`loop chain hash mismatch at sequence ${event.sequence}`);
      }
      previous = event.sha256;
      expectedSequence += 1;
    }
  }
}
