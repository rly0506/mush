import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { saveAttachment, readAttachment } from '../src/web/attachments.ts';
import { renderBoardPage } from '../src/web/page.ts';
import { ChatService } from '../src/web/chat.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

test('1. saveAttachment and readAttachment manage local images cleanly', () => {
  const runtimeRoot = path.resolve('runtime/test_att_' + Date.now());
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const att = saveAttachment(runtimeRoot, {
    name: 'test_dot.png',
    data: 'data:image/png;base64,' + samplePngBase64,
    type: 'image/png',
  });

  assert.ok(att.id.startsWith('att_'));
  assert.ok(att.id.endsWith('.png'));
  assert.equal(att.mimeType, 'image/png');
  assert.ok(fs.existsSync(att.localPath));

  // Read back
  const read = readAttachment(runtimeRoot, att.id);
  assert.ok(read !== null);
  assert.equal(read.mimeType, 'image/png');
  assert.equal(read.buffer.length, att.sizeBytes);

  // Path traversal protection
  const hacked = readAttachment(runtimeRoot, '../etc/passwd');
  assert.equal(hacked, null);

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test('2. Board page HTML renders image upload and child dog drawer elements', () => {
  const html = renderBoardPage();
  assert.ok(html.includes('id="chat-attach-btn"'), 'chat-attach-btn must be present');
  assert.ok(html.includes('id="chat-image-previews"'), 'chat-image-previews must be present');
  assert.ok(html.includes('id="chat-file-input"'), 'chat-file-input must be present');
  assert.ok(html.includes('id="child-dog-select"'), 'child-dog-select must be present');
  assert.ok(html.includes('id="child-dog-drawer"'), 'child-dog-drawer must be present');
  assert.ok(html.includes('dog-avatar'), 'dog-avatar class must be present');
});

test('3. ChatService accepts attachments and records in turn JSONL', async () => {
  const runtimeRoot = path.resolve('runtime/test_chat_att_' + Date.now());
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const mockPipeline = {
    roster: () => [{ adapter_id: 'head-dog', verified: true, effort_levels: ['HIGH', 'LOW'] }],
    dispatch: async (req: any, opts: any) => {
      assert.ok(req.prompt.includes('[附加本地图片/多模态视觉文件]'));
      assert.ok(req.prompt.includes('mock_screenshot.png'));
      return { dispatch_id: 'd_test', status: 'PASS', stdout_tail: { text: '收到图片！' } };
    },
  } as unknown as DispatchPipeline;

  const chat = new ChatService({ pipeline: mockPipeline, runtimeRoot });
  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  
  const ack = await chat.post({
    message: '看看这张图',
    attachments: [{
      name: 'mock_screenshot.png',
      data: 'data:image/png;base64,' + samplePngBase64,
      type: 'image/png'
    }]
  });

  assert.equal(ack.status, 'PENDING');
  await chat.whenSettled(ack.dispatch_id);

  const history = await chat.history(ack.session_id);
  assert.equal(history.turns.length, 2);
  assert.equal(history.turns[0].role, 'user');
  assert.ok(history.turns[0].attachments);
  assert.equal(history.turns[0].attachments[0].name, 'mock_screenshot.png');

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});
