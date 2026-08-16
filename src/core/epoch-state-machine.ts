/**
 * mush 核心（M2）— epoch 状态机：事件驱动推进 + epoch 关闭/推进。
 *
 * PS 源（黄金参照，只读）：
 *   start-goal-orchestrator.ps1 L1540-L1541（sequence = State.sequence + 1）
 *   start-goal-orchestrator.ps1 L1858-L1868（事件与状态 tuple 绑定校验）
 *   state.json schema v2（epoch 状态字段，见 src/schema/state.ts）
 */

import { buildEpochIndex, type EpochIndex } from '../schema/epoch.ts';
import { EventLog, type EventLogEntry } from './event-log.ts';

export interface EpochView {
  readonly assignmentEpoch: number;
  readonly runId: string;
  readonly sequence: number;
  readonly status: string;
  readonly lastEventId: string | null;
  readonly lastPacketPath: string | null;
  readonly terminalReason: string | null;
  readonly isClosed: boolean;
}

export class EpochStateMachine {
  readonly runId: string;
  private _log: EventLog;
  private _sequence = 0;
  private _status = 'IDLE';
  private _lastEventId: string | null = null;
  private _lastPacketPath: string | null = null;
  private _terminalReason: string | null = null;
  private _closed = false;

  constructor(runId: string, initialEpoch: number) {
    this.runId = runId;
    this._log = new EventLog(runId, initialEpoch);
  }

  get assignmentEpoch(): number {
    return this._log.assignmentEpoch;
  }

  get log(): EventLog {
    return this._log;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  view(): EpochView {
    return {
      assignmentEpoch: this.assignmentEpoch,
      runId: this.runId,
      sequence: this._sequence,
      status: this._status,
      lastEventId: this._lastEventId,
      lastPacketPath: this._lastPacketPath,
      terminalReason: this._terminalReason,
      isClosed: this._closed,
    };
  }

  applyEvent(input: unknown): EventLogEntry {
    if (this._closed) throw new Error('epoch is closed; no further events may be appended');
    const entry = this._log.append(input);
    this._sequence = entry.event.sequence;
    this._lastEventId = entry.event.event_id;
    this._lastPacketPath = entry.event.packet_path;
    return entry;
  }

  /** 关闭 epoch：事件链必须闭合（state.last_event_id == 链尾事件 id）。 */
  closeEpoch(terminalReason: string): EpochIndex {
    if (this._closed) throw new Error('epoch is already closed');
    if (this._log.length === 0) throw new Error('cannot close an empty epoch');
    if (this._lastEventId === null) throw new Error('epoch has no last event');
    const index = buildEpochIndex(
      {
        assignment_epoch: this.assignmentEpoch,
        run_id: this.runId,
        last_event_id: this._lastEventId,
      },
      this._log.events().map((entry) => entry.event),
    );
    this._closed = true;
    this._status = 'DONE';
    this._terminalReason = terminalReason;
    return index;
  }

  /** 推进到下一个 epoch（必须已关闭）；新 epoch 为空日志、sequence 归零。 */
  advance(nextEpoch: number = this.assignmentEpoch + 1): EpochView {
    if (!this._closed) throw new Error('epoch must be closed before advancing');
    if (!Number.isInteger(nextEpoch) || nextEpoch <= this.assignmentEpoch) {
      throw new Error(`next epoch must be greater than ${this.assignmentEpoch}`);
    }
    this._log = new EventLog(this.runId, nextEpoch);
    this._sequence = 0;
    this._status = 'IDLE';
    this._lastEventId = null;
    this._lastPacketPath = null;
    this._terminalReason = null;
    this._closed = false;
    return this.view();
  }
}
