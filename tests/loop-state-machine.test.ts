import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoopStateMachine, type LoopState } from '../src/loop/loop.ts';

// GOAL-004 U1：半自动调度状态机 SCAN→RECOMMEND→CONFIRM→DISPATCH→EXECUTE→
// REPORT→REVIEW→ACCEPT；每步 append-only 事件 + 哈希链锚点，可回放。
// D6 半自动流程 + 宪法 §2 证据纪律（append-only、哈希锚点）。

const HAPPY_PATH: LoopState[] = ['RECOMMEND', 'CONFIRM', 'DISPATCH', 'EXECUTE', 'REPORT', 'REVIEW', 'ACCEPT'];

test('loop starts at SCAN with an empty event chain', () => {
  const loop = new LoopStateMachine('run-loop-fixture');
  assert.equal(loop.state, 'SCAN');
  assert.equal(loop.sequence, 0);
  assert.equal(loop.events().length, 0);
  assert.doesNotThrow(() => loop.verifyChain());
});

test('happy path transitions are contiguous and hash-chained', () => {
  const loop = new LoopStateMachine('run-loop-fixture');
  let previous: string | null = null;
  for (const next of HAPPY_PATH) {
    const event = loop.transition(next, next === 'REVIEW' ? { verdict: 'PASS' } : { step: next.toLowerCase() });
    assert.equal(event.sequence, loop.sequence);
    assert.equal(event.from, previous === null ? 'SCAN' : event.from);
    assert.equal(event.to, next);
    assert.equal(event.previous_sha256, previous);
    previous = event.sha256;
  }
  assert.equal(loop.sequence, 7);
  assert.equal(loop.events().length, 7);
  assert.doesNotThrow(() => loop.verifyChain());
});

test('illegal transitions fail closed and leave the chain unchanged', () => {
  const loop = new LoopStateMachine('run-loop-fixture');
  assert.throws(() => loop.transition('DISPATCH', {}), /transition|SCAN/i);
  loop.transition('RECOMMEND', {});
  assert.throws(() => loop.transition('SCAN', {}), /transition|RECOMMEND/i);
  assert.throws(() => loop.transition('EXECUTE', {}), /transition|RECOMMEND/i);
  assert.equal(loop.sequence, 1, 'rejected transitions must not append events');
});

test('events are frozen snapshots and verifyChain detects a broken anchor', () => {
  const loop = new LoopStateMachine('run-loop-fixture');
  const first = loop.transition('RECOMMEND', { candidate: 'm5-board' });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.meta.candidate, 'm5-board');
  loop.transition('CONFIRM', {});
  assert.doesNotThrow(() => loop.verifyChain());
  const forged = [
    { ...loop.events()[0], sha256: 'A'.repeat(64), sequence: 1 },
    { ...loop.events()[1], sequence: 2 },
  ] as never as LoopState[];
  assert.throws(() => LoopStateMachine.fromEvents('run-loop-fixture', forged as unknown as Parameters<typeof LoopStateMachine.fromEvents>[1]), /chain|anchor|hash/i);
});

test('ACCEPT is terminal; replay rebuilds the exact terminal state and chain', () => {
  const loop = new LoopStateMachine('run-loop-fixture');
  for (const next of HAPPY_PATH) loop.transition(next, next === 'REVIEW' ? { verdict: 'PASS' } : {});
  assert.equal(loop.state, 'ACCEPT');
  assert.throws(() => loop.transition('REVIEW', {}), /terminal|ACCEPT/i);
  const replay = LoopStateMachine.fromEvents('run-loop-fixture', loop.events());
  assert.equal(replay.state, 'ACCEPT');
  assert.equal(replay.sequence, 7);
  assert.equal(replay.events()[6].sha256, loop.events()[6].sha256);
  assert.doesNotThrow(() => replay.verifyChain());
});
