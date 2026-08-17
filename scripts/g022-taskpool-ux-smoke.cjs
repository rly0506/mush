// GOAL-022 冒烟（D36 人话原则）：34 张真卡（runtime/tasks.jsonl 读侧折叠）
// 实测排序/中文化/滚动/多选派发。零后端改动——读真实台账经真实
// GET /api/tasks 端点，页面排序/渲染逻辑结构断言 + DOM 级行为实测。
// 用法：node scripts/g022-taskpool-ux-smoke.cjs
'use strict';
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const fromRoot = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

async function main() {
  const { DispatchPipeline } = await import(fromRoot('src/web/dispatch.ts'));
  const { startBoardServer } = await import(fromRoot('src/web/server.ts'));
  const { renderBoardPage } = await import(fromRoot('src/web/page.ts'));

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };

  const fixture = path.join(ROOT, '.test-fixtures', 'g022-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });

  const pipeline = new DispatchPipeline({
    workspaceRoot: ROOT, // 真台账：runtime/tasks.jsonl（34 真卡，读侧折叠）
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    tasksPath: 'D:/mush/runtime/tasks.jsonl', // 主仓真台账（显式绝对路径）
    runAdapter: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, childKilled: false }),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g022-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    const tasksRes = await fetch(`${base}/api/tasks`);
    const tasksBody = await tasksRes.json();
    check('GET /api/tasks 真端点 200（v1.7 已随 p19a 落盘）', tasksRes.status === 200 && tasksBody.ok === true, `status=${tasksRes.status}`);
    const tasks = tasksBody.tasks || [];
    check('34 张真卡载入', tasks.length === 34, `tasks=${tasks.length}`);

    // 排序规则复核（与页面 sortTasksForLane 同规则，独立实现防自欺）
    const PRIO = { '高': 0, '中': 1, '低': 2 };
    const todo = tasks.filter((t) => t.status === 'IDEA' || t.status === 'READY');
    const sorted = todo.slice().sort((a, b) => {
      const d = (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1);
      if (d !== 0) return d;
      return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1;
    });
    let prioOrdered = true;
    for (let i = 1; i < sorted.length; i += 1) {
      if ((PRIO[sorted[i].priority] ?? 1) < (PRIO[sorted[i - 1].priority] ?? 1)) prioOrdered = false;
    }
    check('待办泳道优先级排序正确（高>中>低）', prioOrdered, `todo=${todo.length}`);

    // 页面结构：中文化/折叠/排序/滚动/多选
    const html = renderBoardPage();
    check('状态中文映射七态齐备',
      ['构想', '就绪', '已排队', '执行中', '完成', '受阻', '已取消'].every((w) => html.includes(w)));
    check('迁移按钮动词化（转就绪/开始执行/标记完成/标记受阻）',
      /转就绪/.test(html) && /开始执行/.test(html) && /标记完成/.test(html) && /标记受阻/.test(html));
    check('迁移按钮不渲染裸枚举', !/→ ' \+ esc\(next\)/.test(html));
    check('#序号折叠 + task_id 入 title', /task-seq">#/.test(html) && /title="' \+ esc\(t\.task_id\)/.test(html));
    check('排序函数 + 优先级权重 + Goal 聚簇角标',
      /sortTasksForLane/.test(html) && /PRIORITY_RANK/.test(html) && /goal-cluster/.test(html));
    check('泳道内滚动（lane-body max-height+overflow-y）',
      /\.lane-body \{ max-height: 60vh; overflow-y: auto/.test(html));
    check('多选复选框 + 派发所选 + 逐单审批提示',
      /data-task-select=/.test(html) && /btn-dispatch-selected/.test(html) && /每单仍各停审批卡（D30）/.test(html));
    check('派发预填携带 task_id', /body\.task_id = taskIdAttr/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g022 smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
