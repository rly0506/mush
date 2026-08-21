import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  recordActivity,
  queryActivities,
  translateDispatchEvent,
  translateTaskCreate,
  translateTaskTransition,
  translateApprovalResponse,
  translateStreamHandoff,
  type ActivityItem,
} from '../src/web/activity.ts';
import { startBoardServer } from '../src/web/server.ts';

test('GOAL-023 Unit: translateDispatchEvent 转译派发生命周期为人话', () => {
  const admitAct = translateDispatchEvent(
    {
      dispatch_id: 'disp-001',
      adapter_id: 'agy',
      phase: 'ADMITTED',
      status: 'ADMITTED',
      at_utc: '2026-08-18T15:00:00.000Z',
    },
    { task_id: 'task-101', goal_id: 'MUSH-GOAL-023' },
  );
  assert.ok(admitAct);
  assert.equal(admitAct.actor, 'agy');
  assert.equal(admitAct.kind, 'dispatch_start');
  assert.match(admitAct.text_zh, /agy 开始执行任务/);
  assert.equal(admitAct.task_id, 'task-101');
  assert.equal(admitAct.source_event?.dispatch_id, 'disp-001');

  const passAct = translateDispatchEvent(
    {
      dispatch_id: 'disp-001',
      adapter_id: 'agy',
      status: 'PASS',
      payload: { elapsed_sec: 185 },
      at_utc: '2026-08-18T15:03:05.000Z',
    },
    { task_id: 'task-101', goal_id: 'MUSH-GOAL-023', amount_usd: 0.04 },
  );
  assert.ok(passAct);
  assert.equal(passAct.kind, 'dispatch_pass');
  assert.match(passAct.text_zh, /agy 执行完成（耗时 185 秒）/);
  assert.equal(passAct.amount_usd, 0.04);

  const failAct = translateDispatchEvent({
    dispatch_id: 'disp-002',
    adapter_id: 'deepseek-dsh',
    status: 'FAIL',
  });
  assert.ok(failAct);
  assert.equal(failAct.kind, 'dispatch_fail');
  assert.match(failAct.text_zh, /deepseek-dsh 执行失败/);
});

test('GOAL-023 Unit: 任务变迁与审批响应转译为人话', () => {
  const taskCreate = translateTaskCreate({
    task_id: 'task-1',
    title: '重构时间线',
    goal_id: 'GOAL-023',
  });
  assert.equal(taskCreate.kind, 'task_create');
  assert.match(taskCreate.text_zh, /创建了任务卡「重构时间线」/);

  const taskTrans = translateTaskTransition(
    { task_id: 'task-1', title: '重构时间线', goal_id: 'GOAL-023' },
    'READY',
    'IN_FLIGHT',
  );
  assert.equal(taskTrans.kind, 'task_transition');
  assert.match(taskTrans.text_zh, /任务「重构时间线」转入执行中/);

  const appApprove = translateApprovalResponse('req-01', 'APPROVED', 'owner');
  assert.equal(appApprove.kind, 'approval_response');
  assert.match(appApprove.text_zh, /审批请求已批准/);

  const appReject = translateApprovalResponse('req-02', 'REJECTED', 'owner');
  assert.match(appReject.text_zh, /审批请求已否决/);

  const handoff = translateStreamHandoff('stream-1', 'kimi-code');
  assert.equal(handoff.kind, 'stream_handoff');
  assert.match(handoff.text_zh, /kimi-code 工作流换窗续跑，交接已归档/);
});

test('GOAL-023 Persistence: recordActivity 与 queryActivities 过滤和倒序', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-act-test-'));
  try {
    const act1: ActivityItem = {
      activity_id: 'act-1',
      task_id: 'task-A',
      goal_id: 'GOAL-1',
      actor: 'owner',
      kind: 'task_create',
      text_zh: '创建了任务 A',
      at_utc: '2026-08-18T10:00:00.000Z',
    };
    const act2: ActivityItem = {
      activity_id: 'act-2',
      task_id: 'task-B',
      goal_id: 'GOAL-1',
      actor: 'agy',
      kind: 'dispatch_start',
      text_zh: 'agy 开始执行 B',
      at_utc: '2026-08-18T10:05:00.000Z',
    };
    const act3: ActivityItem = {
      activity_id: 'act-3',
      task_id: 'task-A',
      goal_id: 'GOAL-2',
      actor: 'claude',
      kind: 'dispatch_pass',
      text_zh: 'claude 完成 A',
      at_utc: '2026-08-18T10:10:00.000Z',
    };

    recordActivity(tmpDir, act1);
    recordActivity(tmpDir, act2);
    recordActivity(tmpDir, act3);

    // 全量查询（倒序：act3 -> act2 -> act1）
    const all = queryActivities(tmpDir);
    assert.equal(all.length, 3);
    assert.equal(all[0].activity_id, 'act-3');
    assert.equal(all[1].activity_id, 'act-2');
    assert.equal(all[2].activity_id, 'act-1');

    // 按 task_id 过滤
    const taskA = queryActivities(tmpDir, { task_id: 'task-A' });
    assert.equal(taskA.length, 2);
    assert.equal(taskA[0].activity_id, 'act-3');
    assert.equal(taskA[1].activity_id, 'act-1');

    // 按 limit 限制
    const limited = queryActivities(tmpDir, { limit: 1 });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].activity_id, 'act-3');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-023 Server: GET /api/activity 接口联调与事件自动转译落盘', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mush-srv-act-'));
  const approvalRoot = path.join(tmpDir, 'approvals');
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const runtimeRoot = path.join(tmpDir, 'runtime');

  const board = await startBoardServer({
    approvalRoot,
    workspaceRoot,
    runtimeRoot,
    runId: 'act-test-run',
    assignmentEpoch: 1,
  });

  try {
    const baseUrl = `http://${board.host}:${board.port}`;

    // 1. 初始查询活动列表为空
    const res1 = await fetch(`${baseUrl}/api/activity`);
    assert.equal(res1.status, 200);
    const data1 = (await res1.json()) as { ok: boolean; activities: ActivityItem[] };
    assert.equal(data1.ok, true);
    assert.equal(data1.activities.length, 0);

    // 2. 创建任务卡 -> 触发 translateTaskCreate
    const resTask = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '自动化测试任务', priority: '高', goal_id: 'GOAL-023' }),
    });
    assert.equal(resTask.status, 201);
    const taskData = (await resTask.json()) as { ok: boolean; task: { task_id: string } };

    // 3. 验证 GET /api/activity 出现任务创建条目
    const res2 = await fetch(`${baseUrl}/api/activity?task_id=${taskData.task.task_id}`);
    assert.equal(res2.status, 200);
    const data2 = (await res2.json()) as { ok: boolean; activities: ActivityItem[] };
    assert.equal(data2.activities.length, 1);
    assert.equal(data2.activities[0].kind, 'task_create');
    assert.match(data2.activities[0].text_zh, /创建了任务卡「自动化测试任务」/);

    // 4. 任务状态迁移 -> 触发 translateTaskTransition
    const resTrans = await fetch(`${baseUrl}/api/tasks/${taskData.task.task_id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'READY' }),
    });
    assert.equal(resTrans.status, 200);

    // 5. 验证 GET /api/activity 出现迁移条目
    const res3 = await fetch(`${baseUrl}/api/activity?task_id=${taskData.task.task_id}`);
    const data3 = (await res3.json()) as { ok: boolean; activities: ActivityItem[] };
    assert.equal(data3.activities.length, 2);
    assert.equal(data3.activities[0].kind, 'task_transition');
    assert.match(data3.activities[0].text_zh, /转入就绪/);
  } finally {
    await board.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
