// GOAL-018 联调批冒烟（p18a 已合并）：真 v1.6 流 API 全链路。
// 起板（fake runner）→ 两次同 goal 派发（自动归流）→ GET /api/streams 真数据
// → GET /api/streams/:id 时间线（events+handoffs）→ POST handoff 外部补写 →
// 时间线含交接块 → 页面消费结构对齐。
// 用法：node scripts/g018-integration-smoke.cjs
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

  const fixture = path.join(ROOT, '.test-fixtures', 'g018-integration', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });

  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter: async () => ({
      exitCode: 0,
      stdout: 'dry-run output session_id=sess-int-1',
      stderr: '',
      timedOut: false,
      childKilled: false,
    }),
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g018-integration',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    const post = (url, body) => fetch(base + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 同 goal 两次 dry-run 派发 → 自动归流（窗口键 = 犬×Goal）
    const d1 = await (await post('/api/dispatch', { adapter_id: 'zcode', prompt: '第一步', goal_id: 'GOAL-INT' })).json();
    const d2 = await (await post('/api/dispatch', { adapter_id: 'zcode', prompt: '第二步', goal_id: 'GOAL-INT' })).json();
    check('两次派发受理', !!d1.dispatch_id && !!d2.dispatch_id, `${d1.status}/${d2.status}`);

    const list = await (await fetch(`${base}/api/streams`)).json();
    check('GET /api/streams 真数据（非 404 mock 空态）', list.ok === true && Array.isArray(list.streams) && list.streams.length > 0,
      `streams=${(list.streams || []).length}`);
    const stream = (list.streams || [])[0] || {};
    check('自动归流：同流含两次派发事件', Array.isArray(stream.events) && stream.events.length >= 2,
      `events=${(stream.events || []).length}`);
    check('流关联 Goal（窗口键）', stream.goal_id === 'GOAL-INT');

    const detail = await (await fetch(`${base}/api/streams/${stream.stream_id}`)).json();
    check('GET /api/streams/:id 时间线（events[] 实形）',
      detail.ok && detail.stream && Array.isArray(detail.stream.events));

    // 外部补写 HANDOFF（暴毙代写兜底入口）
    const handoffRes = await post(`/api/streams/${stream.stream_id}/handoff`, {
      done: '完成了联调派发两步',
      decided: '用自动归流',
      files: 'src/web/workstreams.ts',
      next: '头犬验收',
      open_issues: '无',
    });
    check('POST handoff 外部补写 201', handoffRes.status === 201, `status=${handoffRes.status}`);
    const handoff = (await handoffRes.json()).handoff;
    check('handoff 实字段 open_issues（前端对齐点）', handoff && typeof handoff.open_issues === 'string');

    const detail2 = await (await fetch(`${base}/api/streams/${stream.stream_id}`)).json();
    check('时间线 handoffs[] 含补写交接块',
      Array.isArray(detail2.stream.handoffs) && detail2.stream.handoffs.length >= 1,
      `handoffs=${(detail2.stream.handoffs || []).length}`);

    // 页面消费结构：实字段 open_issues / events+handoffs 合并时间线 / session 链推断
    const html = renderBoardPage();
    check('页面 HANDOFF 消费实字段 open_issues', /handoff\.open_issues/.test(html));
    check('页面时间线 events+handoffs 合并排序', /s\.events \|\| \[\]/.test(html) && /s\.handoffs \|\| \[\]/.test(html));
    check('页面会话链标记（真续跑/缝合）', /真续跑/.test(html) && /缝合/.test(html));
    check('页面流统计现场计算（events 长度回退）', /dispatch_count !== undefined \? stats\.dispatch_count : events\.length/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g018 integration smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
