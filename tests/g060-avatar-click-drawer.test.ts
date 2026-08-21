import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

test('GOAL-060: Avatar Click-to-Chat & Worker Drawer', () => {
  const html = renderBoardPage();
  assert.match(html, /id="child-dog-drawer"/, 'child dog drawer exists in DOM');
  assert.match(html, /openChildDogDrawer/, 'openChildDogDrawer function declared');
  assert.match(html, /child-dog-drawer-send/, 'child dog drawer send button exists');
});
