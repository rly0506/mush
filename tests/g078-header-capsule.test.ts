import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-078：胶囊合一与首屏减负——渲染层回归钉。
describe('GOAL-078: header capsule merge & declutter', () => {
  const html = renderBoardPage();

  test('1. 顶栏头犬/工作区胶囊为可点按钮并各自携带 popover 容器', () => {
    assert.match(html, /<button id="head-dog-badge"[^>]*type="button"/);
    assert.match(html, /<button id="workspace-current"[^>]*type="button"/);
    assert.match(html, /id="head-dog-pop"/);
    assert.match(html, /id="workspace-pop"/);
  });

  test('2. 级联控件 ID 迁移至胶囊 popover（设置面板不再持有）', () => {
    const headPop = html.split('id="head-dog-pop"')[1]?.split('</header>')[0] ?? '';
    assert.ok(headPop.includes('id="chat-head-select"'), 'chat-head-select 应在头犬 popover 内');
    assert.ok(headPop.includes('id="chat-head-provider"'), 'chat-head-provider 应在头犬 popover 内');
    assert.ok(headPop.includes('id="chat-head-variant"'), 'chat-head-variant 应在头犬 popover 内');
    assert.ok(headPop.includes('id="chat-probe-btn"'), '探测按钮应在头犬 popover 内');
    const wsPop = html.split('id="workspace-pop"')[1]?.split('</header>')[0] ?? '';
    assert.ok(wsPop.includes('id="chat-workspace-select"'), 'chat-workspace-select 应在工作区 popover 内');
    // 设置面板段内不得再出现级联控件
    const settings = html.split('id="chat-settings-panel"')[1]?.split('id="chat-stream"')[0] ?? '';
    assert.ok(!settings.includes('id="chat-head-select"'), '设置面板不应再含头犬级联');
    assert.ok(!settings.includes('id="chat-workspace-select"'), '设置面板不应再含工作区选择');
  });

  test('3. 顶栏减负：#generated 挪出 header，#sse-status 默认隐藏', () => {
    const header = html.split('<header>')[1]?.split('</header>')[0] ?? '';
    assert.ok(!header.includes('id="generated"'), 'header 不应再含快照时间');
    assert.ok(header.includes('id="sse-status"'), 'sse-status 元素保留（断线提示用）');
    assert.match(header, /id="sse-status"[^>]*style="display:none"/, 'sse-status 应默认隐藏');
    const settings = html.split('id="chat-settings-panel"')[1]?.split('id="chat-stream"')[0] ?? '';
    assert.ok(settings.includes('id="generated"'), '快照时间应收进设置面板');
  });

  test('4. 遥测胶囊压缩为短码占位（📊 …），长串遥测只出现在 tooltip/JS', () => {
    const toolbar = html.split('id="chat-context-gauge"')[0]?.slice(-200) ?? '';
    assert.match(html, /id="chat-context-gauge"[^>]*>📊 …</, '初始占位应为短码');
    assert.ok(!toolbar.includes('💰'), '工具栏胶囊不应再常显费用');
  });

  test('5. 卡片溢出菜单：renderTasks 含 data-task-menu 与 data-task-mark-done', () => {
    assert.ok(html.includes("data-task-menu"), '应含溢出菜单按钮');
    assert.ok(html.includes('data-task-mark-done'), '应含手动标记完成按钮');
    assert.ok(html.includes('/mark-done'), '应含 mark-done API 调用');
  });

  test('6. Bug1 回归钉：nav 视图切换选择器带 [data-view] 过滤', () => {
    assert.ok(html.includes("querySelectorAll('nav button[data-view]')"),
      '视图切换必须只绑带 data-view 的 nav 按钮（否则收起钮误关视图）');
  });
});
