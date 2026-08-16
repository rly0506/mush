import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GP-02（packet 008）前端结构断言：F-40 workspace 自主登记 + F-39 显示归一 + 安全提示层。

const html = renderBoardPage();

test('F-40: workspace area has a free-text path input + register button', () => {
  assert.match(html, /id="workspace-register-path"/, '路径输入框');
  assert.match(html, /id="btn-workspace-register"/, '登记按钮');
  assert.match(html, /\/api\/workspaces\/select/, '登记走既有 select 端点');
});

test('F-40: missing directory prompts explicit confirm, then POST /api/workspaces/create', () => {
  assert.match(html, /目录不存在，是否新建并登记/, '显式确认文案');
  assert.match(html, /\/api\/workspaces\/create/, '新建走 create 端点');
  assert.match(html, /workspace-create-dialog|confirm-create/, '确认对话框');
});

test('safety: dialogs warn that registration opens the directory to the dog team', () => {
  assert.match(html, /登记后此目录将对犬队开放写入/, '登记/新建确认对话框必须含开放写入提示');
});

test('safety: 意向项目 subtree is refused client-side (golden reference frozen zone)', () => {
  assert.match(html, /意向项目/, '意向项目子树检查');
  assert.match(html, /黄金参照冻结区|冻结区/, '拒绝提示');
});

test('F-39: displayed workspace paths use the normalized backslash form', () => {
  // 前端展示统一反斜杠形态（与后端 path.resolve 归一对齐）
  assert.match(html, /replace\(\/\[\\\\\/\]\/|replace\(\/\//, '正斜杠归一为反斜杠的展示处理');
});
