/**
 * mush Board API v1 — loop 生命周期 → SSE 桥（GOAL-006 任务5）。
 * LoopStateMachine 本身无订阅机制；桥接管 transition，迁移成功后发出
 * kind=loop 事件（与 dispatch 生命周期统一进 /api/stream）。
 */

import type { LoopEvent, LoopState, LoopStateMachine } from '../loop/loop.ts';

export interface LoopStreamEvent {
  kind: 'loop';
  run_id: string;
  sequence: number;
  from: LoopState;
  to: LoopState;
  sha256: string;
  at_utc: string;
}

export interface LoopBridge {
  transition(next: LoopState, meta: Record<string, unknown>): LoopEvent;
}

export function createLoopBridge(
  loop: LoopStateMachine,
  onEvent: (event: LoopStreamEvent) => void,
): LoopBridge {
  return {
    transition(next, meta) {
      const event = loop.transition(next, meta);
      onEvent({
        kind: 'loop',
        run_id: loop.runId,
        sequence: event.sequence,
        from: event.from,
        to: event.to,
        sha256: event.sha256,
        at_utc: event.atUtc,
      });
      return event;
    },
  };
}
