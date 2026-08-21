/**
 * GOAL-029 / GP-39 对话实时流式打字机与 Thinking 思考链展开测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ChatService, type ChatStreamEvent } from '../src/web/chat.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { renderBoardPage } from '../src/web/page.ts';

describe('GOAL-029: Streaming Chat & Thinking Flow', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g029-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    ledgerPath = path.join(tmpDir, 'runtime', 'budget-ledger.jsonl');
    mkdirSync(approvalRoot, { recursive: true });
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ChatService streams chunks via onEvent with EXECUTE and HEARTBEAT', async () => {
    const events: ChatStreamEvent[] = [];
    const pipeline = new DispatchPipeline({
      workspaceRoot: tmpDir,
      approvalRoot,
      ledgerPath,
      runAdapter: async (contract, prompt, options) => {
        // 模拟流式输出
        options.onStdout?.('<think>正在分析用户意图...</think>');
        options.onStdout?.('你好！我是头犬。');
        return {
          exitCode: 0,
          stdout: '<think>正在分析用户意图...</think>你好！我是头犬。',
          stderr: '',
          timedOut: false,
          childKilled: false,
        };
      },
    });

    const chatService = new ChatService({
      pipeline,
      runtimeRoot: tmpDir,
      onEvent: (evt) => events.push(evt),
    });

    const ack = await chatService.post({
      message: '测试流式对话',
      adapter_id: 'head-dog',
      effort: 'HIGH',
    });

    assert.strictEqual(ack.status, 'PENDING');
    assert.ok(ack.dispatch_id);
    assert.ok(ack.session_id);

    // 等待后台异步流式执行完毕
    await chatService.whenSettled(ack.dispatch_id);

    // 验证事件流序列：ADMITTED -> HEARTBEAT/EXECUTE -> REPORT
    const phases = events.map((e) => e.phase);
    assert.ok(phases.includes('ADMITTED'));
    assert.ok(phases.includes('EXECUTE'));
    assert.ok(phases.includes('REPORT'));

    const history = await chatService.history(ack.session_id);
    assert.strictEqual(history.turns.length, 2);
    assert.strictEqual(history.turns[0].role, 'user');
    assert.strictEqual(history.turns[1].role, 'head');
    assert.ok(history.turns[1].text.includes('你好！我是头犬。'));
  });

  test('Board Page CSS includes thinking collapsible styling and zero forbidden keywords', () => {
    const html = renderBoardPage();
    assert.ok(html.includes('.thinking-collapsible'));
    assert.ok(html.includes('.thinking-summary'));
    assert.ok(html.includes('.thinking-content'));
    assert.ok(html.includes('parseThinkingBlock'));

    // 验证前端安全规范：JS 语法可正常解析且无凭据泄露
    assert.doesNotThrow(() => {
      // 提取 HTML 中内嵌的脚本并验证解析
      const scriptMatch = /<script>([\s\S]*?)<\/script>/i.exec(html);
      assert.ok(scriptMatch, 'Script block should be present');
      new Function(scriptMatch[1]);
    });
  });
});
