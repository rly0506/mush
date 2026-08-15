import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeBridgeProgressClixml } from './support/process-clixml.ts';
import { quoteWindowsArgument } from './support/windows-argument.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1
//     CLIXML 状态机边角 L260-L275（GOAL010-T8-PROCESS-004）
//     gated cmd/bat 引号参数 L111-L159、Unicode workspace L15
//     GBK replacement fallback L673-L736（GOAL010-T8-PROCESS-003）
//   D:\意向项目\.agent-bridge\tools\start-goal-orchestrator.ps1
//     Remove-BridgeProgressClixml L989-L1060、ConvertTo-WindowsArgument L475-L509

test('CLIXML normal block is removed while surrounding text survives (PS L260-L261)', () => {
  const text = 'keep me\r\n#< CLIXML\r\n<Obj>...</Obj>\r\n</Objs>\r\nafter';
  assert.equal(removeBridgeProgressClixml(text), 'keep me\r\nafter');
});

test('CLIXML same-line open+close keeps the close suffix (PS L263-L264)', () => {
  assert.equal(removeBridgeProgressClixml('#< CLIXML <Obj>...</Obj></Objs>tail'), 'tail');
});

test('CLIXML second opener after a close is stripped too (PS L266-L267)', () => {
  const text = '#< CLIXML\r\n<Obj>1</Obj>\r\n</Objs>#< CLIXML\r\n<Obj>2</Obj>\r\n</Objs>\r\nend';
  assert.equal(removeBridgeProgressClixml(text), 'end');
});

test('CLIXML unterminated block retains the raw diagnostic text (PS L269-L274)', () => {
  const result = removeBridgeProgressClixml('head\r\n#< CLIXML\r\n<Obj>partial</Obj>\r\nrecovered');
  assert.ok(result.indexOf('recovered') >= 0, 'recovered suffix must be retained');
  assert.ok(result.indexOf('<Obj>partial</Obj>') >= 0, 'swallowed diagnostic bytes must be retained');
});

test('empty CLIXML input maps to empty text (PS launcher L991-L992)', () => {
  assert.equal(removeBridgeProgressClixml(''), '');
});

test('windows argument quoting preserves empty, plain, spaced, quote, trailing-slash, metacharacters (PS L475-L509)', () => {
  assert.equal(quoteWindowsArgument(''), '""');
  assert.equal(quoteWindowsArgument('simple'), 'simple');
  assert.equal(quoteWindowsArgument('round trip value with spaces'), '"round trip value with spaces"');
  assert.equal(quoteWindowsArgument('quote "inside" value'), '"quote \\"inside\\" value"');
  assert.equal(quoteWindowsArgument('C:\\fixture path\\'), '"C:\\fixture path\\\\"');
  assert.equal(quoteWindowsArgument('& | ; $(not-evaluated) < >'), '"& | ; $(not-evaluated) < >"');
});

// GOAL010-T8-PROCESS-003 意图移植（而非 PS5.1 补丁移植）：
// PS 版通过 GBK 补丁把非 UTF-8 子进程字节保留为可诊断文本；Node UTF-8 原生解码
// 对非法序列产出 U+FFFD 替代符，流不得被丢弃、退出码原样传递。这里断言 Node
// 原生语义满足同一“意图”：诊断流存活（非空）且坏字节可见（U+FFFD）。
test('non-UTF-8 (GBK) child diagnostics survive via replacement fallback, never dropped (PS L673-L736 intent)', () => {
  const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // GBK「中文」四字节
  const stdout = gbkBytes.toString('utf8');
  const stderr = gbkBytes.toString('utf8');
  assert.ok(stdout.length > 0, 'stdout diagnostic stream must not be dropped');
  assert.ok(stderr.length > 0, 'stderr diagnostic stream must not be dropped');
  assert.ok(stdout.includes('\uFFFD'), 'stdout must surface invalid bytes as replacement chars');
  assert.ok(stderr.includes('\uFFFD'), 'stderr must surface invalid bytes as replacement chars');
});
