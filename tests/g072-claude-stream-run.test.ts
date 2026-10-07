import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { runClaudeStreamRun } from '../src/adapters/claude.ts';

// GOAL-072 通道修复：claude-code stream-json 泛用执行路径。

const FIXTURE = [
  '{"type":"system","model":"claude-sonnet-5","session_id":"sess_fix_1"}',
  '{"type":"assistant","message":{"role":"assistant"}}',
  '{"type":"result","subtype":"success","result":"42","total_cost_usd":0.0123,"session_id":"sess_fix_1"}',
].join('\n');

test('G072：runClaudeStreamRun 提取 result/会话/成本，且保留原始流', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g072-claude-'));
  try {
    let sawPrompt: string | null = null;
    const res = await runClaudeStreamRun({
      contract: buildClaudeContract('claude-sonnet-5'),
      prompt: 'deep question',
      workspaceRoot: root,
      timeoutMs: 5000,
      spawn: (exe, args) => {
        void exe;
        sawPrompt = args[args.length - 1] ?? null;
        return {
          stdinWrite() {}, stdinEnd() {},
          onStdout(l) { setTimeout(() => l(FIXTURE), 1); },
          onStderr() {},
          onExit(l) { setTimeout(() => l(0), 2); },
          onError() {}, kill() {},
        };
      },
    });
    assert.equal(res.exitCode, 0);
    // GOAL-085（2026-10-05，独立审核发现的归因缺陷）：stdout 不再被压成 final text——
    // 原始 stream-json 必须保留，否则原生 system/init（模型身份）、tool_use/tool_result、
    // permission_denied、task_* 这些**可核验事实**全部丢失，判断只能退化为相信模型自报。
    // 解析结果仍以 resultText / structuredOutput 提供（协调器直接读后者）。
    assert.ok(res.stdout.includes('"type"') || res.stdout.includes('"result"'),
      'stdout 必须保留原始流：' + JSON.stringify(res.stdout.slice(0, 200)));
    assert.equal(res.resultText, '42');
    assert.equal(res.sessionId, 'sess_fix_1');
    assert.equal(res.totalCostUsd, 0.0123);
    assert.equal(sawPrompt, 'deep question', 'prompt rides as final argument (argument transport)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('G072：超时路径 fail-closed（timedOut 标记 + 非零退出）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g072-claude-t-'));
  try {
    const res = await runClaudeStreamRun({
      contract: buildClaudeContract('claude-sonnet-5'),
      prompt: 'hang',
      workspaceRoot: root,
      timeoutMs: 80,
      spawn: () => ({
        stdinWrite() {}, stdinEnd() {}, onStdout() {}, onStderr() {},
        onExit() {}, onError() {}, kill() {},
      }),
    });
    assert.equal(res.timedOut, true);
    assert.notEqual(res.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
