import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

test('GOAL-058: Universal Workspace Mounting & Chat Selector', () => {
  const html = renderBoardPage();
  assert.match(html, /id="chat-workspace-select"/, 'chat toolbar includes workspace selector');
  assert.match(html, /renderChatWorkspaceOptions|updateChatWorkspace/, 'chat workspace binding logic present');
});
