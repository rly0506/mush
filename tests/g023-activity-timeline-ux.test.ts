import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-023（D38 信息披露三透镜首批）活动时间线与三透镜抽屉前端 UX 结构断言

const html = renderBoardPage();

test('GOAL-023 #1: 任务卡详情抽屉与遮罩容器结构', () => {
  assert.match(html, /id="task-drawer-overlay"/, '抽屉浮层容器');
  assert.match(html, /id="task-drawer"/, '抽屉主面板');
  assert.match(html, /id="drawer-task-seq"/, '抽屉标题序号 #seq');
  assert.match(html, /id="drawer-task-title"/, '抽屉标题文本');
  assert.match(html, /id="btn-close-task-drawer"/, '抽屉关闭按钮');
  assert.match(html, /id="drawer-task-meta"/, '抽屉元数据（优先级、状态、Goal、估算花费）');
});

test('GOAL-023 #2: 三透镜操作栏（Trace / 直连 / 花费）', () => {
  assert.match(html, /id="task-lenses-bar"/, '三透镜操作栏');
  assert.match(html, /id="btn-lens-trace"/, '透镜一：执行 Trace 入口');
  assert.match(html, /id="btn-lens-chat"/, '透镜二：犬只直连入口');
  assert.match(html, /id="btn-lens-budget"/, '透镜三：花费下钻入口');
  assert.match(html, /执行 Trace/, 'Trace 人话文案');
  assert.match(html, /犬只直连/, '直连人话文案');
  assert.match(html, /花费下钻/, '花费下钻人话文案');
});

test('GOAL-023 #3: 活动时间线与节点容器', () => {
  assert.match(html, /id="task-activity-timeline"/, '任务活动时间线容器');
  assert.match(html, /id="task-context-links"/, '关联信息区');
  assert.match(html, /\.activity-timeline/, '时间线样式');
  assert.match(html, /\.timeline-node/, '时间线节点样式');
  assert.match(html, /\.timeline-dot/, '时间线犬只标识点');
  assert.match(html, /renderActivityTimeline/, '时间线渲染函数');
  assert.match(html, /synthesizeTaskActivities/, '时间线人话合成兜底函数');
});

test('GOAL-023 #4: 最近活动流组件（任务池看板 + 单屏指挥台右栏）', () => {
  assert.match(html, /id="task-recent-activity"/, '任务池顶部最近活动面板');
  assert.match(html, /id="recent-activity-stream"/, '任务池最近活动流');
  assert.match(html, /id="rail-activity"/, '指挥台右栏最近活动流');
  assert.match(html, /最近活动（实时事件转译 · D38）/, '人话提示文案');
  assert.match(html, /renderRecentActivity/, '最近活动渲染函数');
});

test('GOAL-023 #5: 任务卡点击交互与抽屉展开/关闭逻辑', () => {
  assert.match(html, /data-task-id="/, '任务卡携带 data-task-id 属性');
  assert.match(html, /openTaskDrawer/, '打开任务抽屉函数');
  assert.match(html, /closeTaskDrawer/, '关闭任务抽屉函数');
  assert.match(html, /formatTaskCost/, '任务花费计算/占位函数');
  assert.match(html, /key === 'Escape'/, 'Esc 键关闭抽屉');
});
