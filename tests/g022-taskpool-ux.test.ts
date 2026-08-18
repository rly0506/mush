import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-022（D36 人话原则首批）任务池人因 UX —— 结构断言（jsdom-free）。

const html = renderBoardPage();

test('任务1 全面中文化：状态徽标中文映射 + 迁移按钮动词化', () => {
  assert.match(html, /IDEA: '构想'/, '构想');
  assert.match(html, /READY: '就绪'/, '就绪');
  assert.match(html, /QUEUED: '已排队'/, '已排队');
  assert.match(html, /IN_FLIGHT: '执行中'/, '执行中');
  assert.match(html, /DONE: '完成'/, '完成');
  assert.match(html, /BLOCKED: '受阻'/, '受阻');
  assert.match(html, /CANCELLED: '已取消'/, '已取消');
  assert.match(html, /READY: '转就绪'/, '动词化：转就绪');
  assert.match(html, /IN_FLIGHT: '开始执行'/, '动词化：开始执行');
  assert.match(html, /DONE: '标记完成'/, '动词化：标记完成');
  assert.match(html, /BLOCKED: '标记受阻'/, '动词化：标记受阻');
  // 迁移按钮不再渲染裸枚举（→ READY 之类）
  assert.doesNotMatch(html, /→ ' \+ esc\(next\)/, '迁移按钮不渲染裸状态枚举');
});

test('任务2 机器语言折叠：#序号 + 原始 ID 入悬浮 title', () => {
  assert.match(html, /taskSeq/, '序号函数（创建顺序）');
  assert.match(html, /<span class="task-seq">#/, '卡片显示 #序号');
  assert.match(html, /title="' \+ esc\(t\.task_id\)/, '原始 task_id 折叠进悬浮 title');
});

test('任务3 排序：优先级>创建时间 + 同 Goal 聚簇角标', () => {
  assert.match(html, /sortTasksForLane/, '泳道排序函数');
  assert.match(html, /PRIORITY_RANK/, '优先级权重表');
  assert.match(html, /'高': 0, '中': 1, '低': 2/, '高>中>低');
  assert.match(html, /created_at_utc/, '创建时间次级排序');
  assert.match(html, /goal-cluster/, '同 Goal 聚簇角标');
});

test('任务4 泳道内滚动：lane-body max-height + overflow-y（页面不拉长）', () => {
  assert.match(html, /\.lane-body \{ max-height: 60vh; overflow-y: auto/, '泳道内滚动容器');
});

test('任务5 多选批量派发：复选框 + 派发所选 + 逐单审批语义', () => {
  assert.match(html, /data-task-select=/, '待办卡片复选框');
  assert.match(html, /id="btn-dispatch-selected"/, '派发所选按钮');
  assert.match(html, /taskSelection/, '多选选择集');
  assert.match(html, /dispatchQueue/, '逐单队列');
  assert.match(html, /每单仍各停审批卡（D30）/, '逐单审批卡语义提示');
  assert.match(html, /advanceDispatchQueue/, '逐单推进钩子');
});
