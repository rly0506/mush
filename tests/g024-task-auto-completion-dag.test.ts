import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, advanceTaskToStatus, loadTasks } from '../src/web/tasks.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { renderBoardPage } from '../src/web/page.ts';

test('GOAL-024 Unit: advanceTaskToStatus 状态机平滑跃迁', () => {
  const now = () => new Date('2026-08-18T15:00:00.000Z');
  const task = createTask({ title: '测试任务', priority: '高' }, now);
  assert.equal(task.status, 'IDEA');

  // IDEA -> IN_FLIGHT
  const inFlight = advanceTaskToStatus(task, 'IN_FLIGHT', now);
  assert.equal(inFlight.status, 'IN_FLIGHT');

  // IN_FLIGHT -> DONE
  const done = advanceTaskToStatus(inFlight, 'DONE', now);
  assert.equal(done.status, 'DONE');

  // DONE 保持终态（不可逆）
  const doneStay = advanceTaskToStatus(done, 'READY', now);
  assert.equal(doneStay.status, 'DONE');

  // IDEA 直接跃迁至 DONE
  const task2 = createTask({ title: '快速任务' }, now);
  const doneDirect = advanceTaskToStatus(task2, 'DONE', now);
  assert.equal(doneDirect.status, 'DONE');

  // IN_FLIGHT -> BLOCKED
  const task3 = createTask({ title: '异常任务' }, now);
  const inflight3 = advanceTaskToStatus(task3, 'IN_FLIGHT', now);
  const blocked = advanceTaskToStatus(inflight3, 'BLOCKED', now);
  assert.equal(blocked.status, 'BLOCKED');
});

test('GOAL-024 Pipeline: 派发执行完成自动将任务放入完成池 (DONE) 或受阻池 (BLOCKED)', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-g024-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const approvalRoot = path.join(tmpDir, 'approvals');
  const ledgerPath = path.join(tmpDir, 'budget-ledger.jsonl');

  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
    runAdapter: async (contract, prompt) => {
      if (prompt.includes('FAIL_ME')) {
        return { exitCode: 1, stdout: '', stderr: 'mock failure', timedOut: false, childKilled: false };
      }
      return { exitCode: 0, stdout: 'mock success', stderr: '', timedOut: false, childKilled: false };
    },
  });

  try {
    // 1. 创建任务
    const task1 = pipeline.createTask({ title: '成功任务', priority: '高' });
    assert.equal(task1.status, 'IDEA');

    // 2. 成功派发
    const disp1 = await pipeline.dispatch({
      adapter_id: 'fake-t1',
      prompt: 'do work',
      task_id: task1.task_id,
      real: false,
    });
    assert.equal(disp1.status, 'DRY_RUN');

    // 3. 验证任务自动跃迁至 DONE（完成池）
    const tasksAfterPass = pipeline.listTasks();
    const updatedTask1 = tasksAfterPass.find((t) => t.task_id === task1.task_id);
    assert.ok(updatedTask1);
    assert.equal(updatedTask1.status, 'DONE');

    // 4. 创建第二个任务并派发失败
    const task2 = pipeline.createTask({ title: '失败任务', priority: '中' });
    const disp2 = await pipeline.dispatch({
      adapter_id: 'fake-t1',
      prompt: 'FAIL_ME please',
      task_id: task2.task_id,
      real: false,
    });
    assert.equal(disp2.status, 'FAIL');

    // 5. 验证任务自动跃迁至 BLOCKED（受阻池）
    const tasksAfterFail = pipeline.listTasks();
    const updatedTask2 = tasksAfterFail.find((t) => t.task_id === task2.task_id);
    assert.ok(updatedTask2);
    assert.equal(updatedTask2.status, 'BLOCKED');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-024 Frontend: 任务路径导图 / 思维导图与四态色彩渲染结构断言', () => {
  const html = renderBoardPage();

  // 1. 视图切换容器与按钮
  assert.match(html, /class="tasks-view-switch"/);
  assert.match(html, /id="btn-tasks-board"/);
  assert.match(html, /id="btn-tasks-dag"/);
  assert.match(html, /switchTasksView\('board'\)/);
  assert.match(html, /switchTasksView\('dag'\)/);

  // 2. 导图画布容器
  assert.match(html, /id="tasks-dag-container"/);
  assert.match(html, /id="tasks-dag-canvas"/);

  // 3. 四态色彩样式与体系主轴样式断言
  assert.match(html, /\.dag-node\.node-done/);
  assert.match(html, /\.dag-node\.node-inflight/);
  assert.match(html, /\.dag-node\.node-ready/);
  assert.match(html, /\.dag-node\.node-blocked/);
  assert.match(html, /\.dag-stream-card/);
  assert.match(html, /\.dag-layer-badge/);

  // 4. 导图 JavaScript 渲染与体系主轴分类函数断言
  assert.match(html, /function renderTasksDag\(\)/);
  assert.match(html, /function detectTaskDomain\(/);
  assert.match(html, /function detectTaskLayer\(/);
  assert.match(html, /function detectTaskDependencies\(/);
  assert.match(html, /function switchTasksView\(mode\)/);
  assert.match(html, /window\.switchTasksView = switchTasksView/);
});

test('GOAL-024 Reconciliation: 历史与人工目检任务随 Goal 验收回执自动对账升入 DONE', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-reconcile-test-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const approvalRoot = path.join(tmpDir, 'approvals');
  const ledgerPath = path.join(tmpDir, 'budget-ledger.jsonl');
  const receiptsDir = path.join(workspaceRoot, 'goals', 'receipts');

  const pipeline = new DispatchPipeline({
    workspaceRoot,
    approvalRoot,
    ledgerPath,
  });

  try {
    // 1. 创建关联 MUSH-GOAL-019 的冒烟卡和 MUSH-GOAL-020 的目检卡
    const task1 = pipeline.createTask({ title: '冒烟：任务池验收卡', goal_id: 'MUSH-GOAL-019' });
    const task2 = pipeline.createTask({ title: 'owner 目检：雪原主题与任务池', goal_id: 'MUSH-GOAL-020' });
    const task3 = pipeline.createTask({ title: '未来未完成任务', goal_id: 'MUSH-GOAL-999' });

    assert.equal(task1.status, 'IDEA');
    assert.equal(task2.status, 'IDEA');
    assert.equal(task3.status, 'IDEA');

    // 2. 模拟写入 GOAL-019 和 GOAL-020 验收回执
    mkdirSync(receiptsDir, { recursive: true });
    writeFileSync(path.join(receiptsDir, 'GOAL-019A-completion.json'), '{"verdict":"PASS"}\n', 'utf8');
    writeFileSync(path.join(receiptsDir, 'GOAL-020-completion.json'), '{"verdict":"PASS"}\n', 'utf8');

    // 3. 触发 pipeline.listTasks() 进行全局对账
    const tasks = pipeline.listTasks();
    const r1 = tasks.find((t) => t.task_id === task1.task_id);
    const r2 = tasks.find((t) => t.task_id === task2.task_id);
    const r3 = tasks.find((t) => t.task_id === task3.task_id);

    assert.equal(r1?.status, 'DONE');
    assert.equal(r2?.status, 'DONE');
    assert.equal(r3?.status, 'IDEA');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

