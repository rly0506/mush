/**
 * mush 生产 schema（M2 骨架）— epoch 索引类型：把一个 assignment epoch 的
 * 状态与其事件链连接为可校验的最小结构。
 */

import type { BridgeEventV2 } from './events.ts';
import type { OrchestratorStateV2 } from './state.ts';

export interface EpochIndex {
  assignment_epoch: number;
  run_id: string;
  event_count: number;
  first_sequence: number;
  last_sequence: number;
  last_event_id: string;
  event_ids: string[];
}

/** 由已解析状态 + 事件链构建 epoch 索引；序列必须严格递增且状态闭环。 */
export function buildEpochIndex(state: OrchestratorStateV2, events: BridgeEventV2[]): EpochIndex {
  if (events.length === 0) {
    throw new Error('epoch index requires at least one event');
  }
  for (const event of events) {
    if (event.assignment_epoch !== state.assignment_epoch) {
      throw new Error(
        `epoch event ${event.event_id} assignment_epoch ${event.assignment_epoch} != state ${state.assignment_epoch}`,
      );
    }
    if (event.run_id !== state.run_id) {
      throw new Error(`epoch event ${event.event_id} run_id does not match state run_id`);
    }
  }
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].sequence <= sorted[index - 1].sequence) {
      throw new Error('epoch event sequences must be strictly increasing');
    }
  }
  if (state.last_event_id !== sorted[sorted.length - 1].event_id) {
    throw new Error(
      `state.last_event_id ${state.last_event_id} must equal the last epoch event ${sorted[sorted.length - 1].event_id}`,
    );
  }
  return {
    assignment_epoch: state.assignment_epoch,
    run_id: state.run_id,
    event_count: sorted.length,
    first_sequence: sorted[0].sequence,
    last_sequence: sorted[sorted.length - 1].sequence,
    last_event_id: sorted[sorted.length - 1].event_id,
    event_ids: sorted.map((event) => event.event_id),
  };
}
