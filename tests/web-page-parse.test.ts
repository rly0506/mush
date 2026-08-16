import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderBoardPage } from '../src/web/page.ts';

// DEF-07 回归：页面脚本必须可解析。GP-02 曾把含反斜杠正则的辅助函数写进
// 模板字符串，模板层吃掉一层反斜杠后产出了 `.replace(///g, '\')` 这类废码，
// 浏览器整段脚本解析失败——SSE 永远"连接中"、页面全部控件无响应。
// 结构断言（字符串包含）测不出这类缺陷，必须真解析。
test('DEF-07: rendered board page script parses as JavaScript (template-escape regression)', () => {
  const html = renderBoardPage();
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match !== null, 'page must contain a <script> block');
  assert.doesNotThrow(() => new vm.Script(match[1], { filename: 'board-page-inline.js' }));
});
