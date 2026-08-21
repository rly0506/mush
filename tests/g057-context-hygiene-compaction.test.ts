import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractStructuredInvariant,
  filterExecutionOutput,
  processFileMention,
} from '../src/orchestration/distiller.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-057: 上下文基线透明化、@-mention 门禁与结构化不变式压缩', () => {
  let tmpDir: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g057-'));
    mkdirSync(path.join(tmpDir, 'runtime', 'approvals'), { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. processFileMention 严格执行 300 行安全门禁', () => {
    // 场景 A: 短文件（<= 300 行）全量内联
    const shortContent = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const shortRes = processFileMention('src/core/sample.ts', shortContent);
    assert.equal(shortRes.allowed, true);
    assert.equal(shortRes.lineCount, 50);
    assert.ok(shortRes.injectedContent.includes('<!-- file: src/core/sample.ts (50 lines) -->'));
    assert.ok(shortRes.injectedContent.includes('line 50'));

    // 场景 B: 超大文件（> 300 行）触发安全拦截与切片大纲
    const longContent = Array.from({ length: 500 }, (_, i) => `const row_${i + 1} = ${i + 1};`).join('\n');
    const longRes = processFileMention('src/web/big-page.ts', longContent);
    assert.equal(longRes.allowed, false);
    assert.equal(longRes.lineCount, 500);
    assert.ok(longRes.injectedContent.includes('OVERSIZE GUARD: 500 lines > 300 lines limit'));
    assert.ok(longRes.injectedContent.includes('已触发 300 行安全门禁'));
    assert.ok(longRes.injectedContent.includes('const row_1 = 1;'));
    assert.ok(longRes.injectedContent.includes('const row_500 = 500;'));
  });

  it('2. filterExecutionOutput 实现了 Pass-Quiet 与 Fail-Rich 输出管理', () => {
    // 成功场景：单行/精简摘要 (Pass-Quiet)
    const successLogs = 'Running tests...\n' + Array.from({ length: 200 }, (_, i) => `✔ test ${i + 1} passed`).join('\n') + '\nℹ tests 505\nℹ suites 22\nℹ pass 505\nℹ fail 0';
    const quiet = filterExecutionOutput(successLogs, 0);
    assert.ok(quiet.length < 500, 'Pass-Quiet 应极度精简');
    assert.ok(quiet.includes('505') || quiet.includes('pass'));

    // 失败场景：提取关键错误与错误堆栈 (Fail-Rich)
    const failLogs = 'Building project...\n' + Array.from({ length: 100 }, (_, i) => `info: step ${i + 1}`).join('\n') + '\n✖ failing tests:\n✖ test_sample failed\n  AssertionError: expected 1 to equal 2\n      at sample.test.ts:42:10';
    const rich = filterExecutionOutput(failLogs, 1);
    assert.ok(rich.includes('✖ failing tests:'));
    assert.ok(rich.includes('AssertionError'));
  });

  it('3. extractStructuredInvariant 结构化提取会话不变式', () => {
    const messages = [
      { role: 'user', content: '我们来确立 D69 决议：Prompt Cache 前缀严禁动态修改。' },
      { role: 'assistant', content: '好的，已在 src/core/budget.ts 与 src/adapters/t1-runner.ts 完成代码实现。' },
      { role: 'user', content: '测试结果是 505 / 505 全绿，下一步：完善端点单测。' },
    ];
    const compact = extractStructuredInvariant(messages);
    assert.ok(compact.decisions.some((d) => d.includes('D69')));
    assert.ok(compact.modified_files.includes('src/core/budget.ts'));
    assert.ok(compact.modified_files.includes('src/adapters/t1-runner.ts'));
    assert.ok(compact.raw_summary.includes('结构化会话状态快照'));
  });

  it('4. 看板服务端点集成测试 (Compact, Context-Gauge, Mention-File)', async () => {
    // 准备测试文件
    const sampleFile = path.join(tmpDir, 'sample.ts');
    writeFileSync(sampleFile, 'export const TEST_VALUE = 42;\n', 'utf8');

    server = await startBoardServer({
      approvalRoot: path.join(tmpDir, 'runtime', 'approvals'),
      workspaceRoot: tmpDir,
      runtimeRoot: tmpDir,
      runId: 'test-g057-server',
      assignmentEpoch: 1,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/chat/compact
    const compRes = await fetch(`${base}/api/chat/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'D70: 上下文纪律落地。修改了 src/web/server.ts。' }]
      })
    });
    assert.equal(compRes.status, 200);
    const compData = await compRes.json() as { ok: boolean; compact: { decisions: string[] } };
    assert.equal(compData.ok, true);
    assert.ok(compData.compact.decisions.some((d) => d.includes('D70')));

    // 2. GET /api/chat/context-gauge
    const gaugeRes = await fetch(`${base}/api/chat/context-gauge`);
    assert.equal(gaugeRes.status, 200);
    const gaugeData = await gaugeRes.json() as { ok: boolean; gauge: { total_tokens: number; max_context_tokens: number } };
    assert.equal(gaugeData.ok, true);
    assert.ok(gaugeData.gauge.total_tokens > 0);
    assert.equal(gaugeData.gauge.max_context_tokens, 200000);

    // 3. POST /api/chat/mention-file
    const mentionRes = await fetch(`${base}/api/chat/mention-file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'sample.ts' })
    });
    assert.equal(mentionRes.status, 200);
    const mentionData = await mentionRes.json() as { ok: boolean; allowed: boolean; injectedContent: string };
    assert.equal(mentionData.ok, true);
    assert.equal(mentionData.allowed, true);
    assert.ok(mentionData.injectedContent.includes('TEST_VALUE = 42'));
  });
});
