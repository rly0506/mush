import test from 'node:test';
import assert from 'node:assert/strict';
import { ChildSessionRegistry } from '../src/core/child-sessions.ts';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('GOAL-061: Child Session Persistence & Auto-Resume Registry', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'child-sess-test-'));
  const store = path.join(dir, 'sessions.jsonl');
  const registry = new ChildSessionRegistry(store);

  // 1. 创建或获取 Session
  const sess1 = registry.getOrCreate('claude-worker', 'D:/project-a', 'GOAL-058');
  assert.ok(sess1.session_id.startsWith('csess_claude_worker_'));
  assert.strictEqual(sess1.turn_count, 0);

  // 2. 再次获取应复用同一 Session (Auto-Resume)
  const sess2 = registry.getOrCreate('claude-worker', 'D:/project-a', 'GOAL-058');
  assert.strictEqual(sess2.session_id, sess1.session_id);

  // 3. 记录交互轮次
  registry.recordTurn(sess1.session_id, 1500, 'rec_123');
  const updated = registry.get(sess1.session_id);
  assert.ok(updated);
  assert.strictEqual(updated.turn_count, 1);
  assert.strictEqual(updated.total_tokens, 1500);
  assert.strictEqual(updated.last_receipt_id, 'rec_123');
});
