import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline, InputError } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { loadTasks, type Task } from '../src/web/tasks.ts';

// GOAL-019（rm004-p19a）— 任务池后端。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g019a', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function makePipeline(root: string, overrides: Partial<ConstructorParameters<typeof DispatchPipeline>[0]> = {}) {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    tasksPath: path.join(root, 'tasks.jsonl'),
    runAdapter: async () => ({ exitCode: 0, stdout: 'OK', stderr: '', timedOut: false, childKilled: false }),
    ...overrides,
  });
}

test('U1/U2: createTask appends and listTasks folds latest snapshot', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const task = pipeline.createTask({ title: 'GP test', detail: 'd', priority: '高' });
  assert.equal(task.status, 'IDEA');
  assert.deepEqual(task.dispatch_ids, []);
  const tasks = pipeline.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].task_id, task.task_id);
  assert.ok(existsSync(path.join(root, 'tasks.jsonl')));
});

test('U2: transitionTask validates whitelist and append-only keeps history', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const task = pipeline.createTask({ title: 'state' });
  const ready = pipeline.transitionTask(task.task_id, 'READY');
  assert.equal(ready.status, 'READY');
  assert.throws(() => pipeline.transitionTask(task.task_id, 'DONE'), /illegal transition/);
  const lines = readFileSync(path.join(root, 'tasks.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'create + transition = two append-only rows');
  const folded = loadTasks(path.join(root, 'tasks.jsonl'));
  assert.equal(folded[0].status, 'READY');
});

test('U3: dispatch with task_id links dispatch_id into task record', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const task = pipeline.createTask({ title: 'link me' });
  const record = await pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'do it', task_id: task.task_id });
  assert.equal(record.status, 'DRY_RUN');
  assert.equal(record.task_id, task.task_id);
  const after = pipeline.listTasks().find((entry) => entry.task_id === task.task_id);
  assert.ok(after?.dispatch_ids.includes(record.dispatch_id));
});

test('U4: HTTP tasks API create/list/transition works and rejects illegal', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'g019a-api',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const createRes = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'API task', priority: '中' }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { task: Task };
  const taskId = created.task.task_id;

  const listRes = await fetch(base + '/api/tasks');
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { tasks: Task[] };
  assert.ok(list.tasks.some((task) => task.task_id === taskId));

  const transitionRes = await fetch(base + `/api/tasks/${taskId}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'READY' }),
  });
  assert.equal(transitionRes.status, 200);
  const transitioned = (await transitionRes.json()) as { task: Task };
  assert.equal(transitioned.task.status, 'READY');

  const illegalRes = await fetch(base + `/api/tasks/${taskId}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'DONE' }),
  });
  assert.equal(illegalRes.status, 400);
  const illegal = (await illegalRes.json()) as { ok: boolean; error: string };
  assert.equal(illegal.ok, false);
  assert.match(illegal.error, /illegal transition/);

  const missingRes = await fetch(base + '/api/tasks/nope/transition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'READY' }),
  });
  assert.equal(missingRes.status, 404);
});
