import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeJsonlCommand,
  assertWireFraming,
  stripOuterJsonFence,
} from '../src/core/pi-rpc-wire.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-rpc.tests.ps1
//     Assert-WireFraming L290-L307（GOAL010-T8-PI-RPC-002 线级 framing）
//   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1
//     ConvertFrom-ManagedPiFencedCompletionText L95-L106
//     （GOAL010-T8-PI-FENCED-JSON-COMPLETION-001；由测试 L413-L436 验证）

function commandBytes(commands: Record<string, unknown>[]): Uint8Array {
  return new TextEncoder().encode(commands.map((command) => encodeJsonlCommand(command)).join(''));
}

test('wire framing accepts BOM-free LF-delimited JSONL (PS L296-L307)', () => {
  const bytes = commandBytes([
    { id: 's1', type: 'get_state' },
    { id: 'p1', type: 'prompt', message: '{}' },
  ]);
  assert.doesNotThrow(() => assertWireFraming(bytes));
});

test('first command byte must be 0x7B (PS L297)', () => {
  assert.throws(() => assertWireFraming(new TextEncoder().encode('[1]\n{}\n')), /first command byte|0x7B/i);
});

test('CR bytes are rejected; commands are LF-only JSONL (PS L298)', () => {
  assert.throws(() => assertWireFraming(new TextEncoder().encode('{}\r\n{}\n')), /CR|LF-only/i);
});

test('at least get_state + prompt JSONL lines are required (PS L300-L301)', () => {
  assert.throws(() => assertWireFraming(new TextEncoder().encode('{}\n')), /at least/i);
});

test('every command line must be valid JSON (PS L302-L306)', () => {
  assert.throws(() => assertWireFraming(new TextEncoder().encode('{}\nnot-json\n')), /valid JSON/i);
});

test('encoder emits no BOM and LF-only separators (PS L284, L296-L298)', () => {
  const bytes = commandBytes([{ a: 1 }, { b: 2 }]);
  assert.equal(bytes[0], 0x7b);
  assert.equal(bytes.includes(0x0d), false);
});

test('complete outer ```json fence is stripped; a partial fence is untouched (wrapper L103-L105)', () => {
  const inner = '{"verdict":"PASS"}';
  assert.equal(stripOuterJsonFence('```json\n' + inner + '\n```'), inner);
  assert.equal(stripOuterJsonFence('```json\n' + inner), '```json\n' + inner);
});
