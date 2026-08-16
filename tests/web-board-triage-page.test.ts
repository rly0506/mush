import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-007B 前端结构断言：D1 workspace 反馈 / D2 状态更新与计时 / D3 roster 最近派发 / D4 变体 hint。
// 模式与 tests/web-board-page.test.ts 一致（服务端渲染 HTML + 内联 JS 静态断言）。

const html = renderBoardPage();

test('D1: workspace selector shows explicit unselected copy and marks selected item', () => {
  assert.match(html, /（未选择，默认服务目录）/, '歧义空项已改为明确文案');
  assert.ok(!html.includes('（默认：当前已选）'), '旧歧义文案必须移除');
  assert.ok(!html.includes('（默认：服务 cwd）'), '旧缺省文案必须移除');
  assert.match(html, /w\.selected/, '选中项依赖 selected 字段（E2 后端已补）');
  assert.match(html, /workspace-current/, 'header 高亮联动');
  // select 成功后立即重拉列表重渲染
  assert.match(html, /workspaces\/select[\s\S]{0,400}loadWorkspaces\(\)/, 'POST select 成功后 loadWorkspaces');
});

test('D2: trackDispatch is upsert (existing card status updates, terminal toast once)', () => {
  assert.match(html, /TERMINAL_STATUSES/, '终态集合');
  assert.match(html, /upsert：SSE 后续帧/, 'upsert 语义注释');
  assert.match(html, /existing\.status = status/, '已存在卡片更新状态而非丢弃');
  assert.match(html, /toast\('完成：' \+ status/, '完成时明确 toast');
  assert.match(html, /started_ms/, '本地起始时间戳');
  assert.match(html, /class="elapsed"/, '已耗时显示');
  assert.match(html, /setInterval\(function \(\) \{[\s\S]{0,300}renderDispatches\(\)/, 'RUNNING 卡片计时每秒刷新');
});

test('D2: dispatch detail shows stdout_tail/stderr_tail with truncation marker (E1)', () => {
  assert.match(html, /d\.stdout_tail/, 'detail 消费 stdout_tail');
  assert.match(html, /d\.stderr_tail/, 'detail 消费 stderr_tail');
  assert.match(html, /已截断/, '截断标记渲染');
  assert.match(html, /ev\.phase \|\| ev\.kind/, '事件时间线含 phase');
});

test('D3: roster fallback rows aggregate recent dispatch activity per adapter', () => {
  assert.match(html, /dispatchStats/, '按 adapter 聚合函数');
  assert.match(html, /最近派发/, 'roster 表头含最近派发列');
  assert.match(html, /次 · /, '计数+状态+时间渲染');
  assert.match(html, /（未活动，注册在册）/, '无活动回退文案保留');
  assert.match(html, /snapshot\.dispatches/, '数据源为 snapshot.dispatches');
});

test('D4: model variant dropdown carries expectation hint (not a live inventory)', () => {
  assert.match(html, /变体 = 身份期望（合同声明），非实时能力清单/, 'hint 文案');
  assert.match(html, /data-variants/, 'variants 数组渲染（G009 既有）');
});
