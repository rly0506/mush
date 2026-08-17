// GOAL-018B 联调批（BATCH-43-kimi）：契约 v1.6 已落盘（g018a 合并）后的真链路冒烟。
// 真实执行：起板（fake runner 模拟犬输出 session_id/HANDOFF 块）→ POST /api/dispatch
// （kimi-code 合同，dry run）→ GET /api/streams 列表 → GET /api/streams/:id 时间线
// → POST handoff 外部代写 → 新流注入最近交接。断言页面渲染消费 v1.6 真实字段。
// 用法：node scripts/g018b-v16-integration-smoke.cjs
'use strict';
const { mkdirSync, writeFileSync } = require('node:fs');
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

  const fixture = path.join(ROOT, '.test-fixtures', 'g018b-v16-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  const approvalDir = path.join(fixture, 'goals', 'receipts', 'dispatch-approvals');
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(path.join(approvalDir, 'head-dog.approved.json'), JSON.stringify({ approved: true }) + '\n', 'utf8');
  // 项目层（U5）：fixture 工作区 AGENTS.md，注入断言用。
  writeFileSync(path.join(fixture, 'AGENTS.md'), '# fixture 项目层简报\n', 'utf8');

  // fake runner：kimi 形态输出（session 行）+ 第二轮带 HANDOFF 块。
  let call = 0;
  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter: async (contract, prompt) => {
      call += 1;
      const handoff = call >= 2
        ? '\nHANDOFF-BEGIN\n做了什么: 完成第一轮任务\n定了什么: 用方案A\n文件在哪: src/a.ts\n下一步: 联调\n未解问题: 无\nHANDOFF-END\n'
        : '';
      return {
        exitCode: 0,
        stdout: `犬回复 ${call}。To resume this session: kimi -r session_v16_${call}` + handoff,
        stderr: '',
        timedOut: false,
        childKilled: false,
      };
    },
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g018b-v16-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;
    const dispatchPost = (body) => fetch(`${base}/api/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 同犬×Goal 自动归流：两发同 stream。
    const d1 = await (await dispatchPost({ adapter_id: 'kimi-code', prompt: '第一轮任务', goal_id: 'GOAL-018' })).json();
    const d2 = await (await dispatchPost({ adapter_id: 'kimi-code', prompt: '第二轮任务', goal_id: 'GOAL-018' })).json();
    check('两发派发均 202 受理', Boolean(d1.ok && d2.ok));

    // GET /api/streams（v1.6 真实端点，非 404 mock 空态）。
    const list = await (await fetch(`${base}/api/streams`)).json();
    check('GET /api/streams 返回真实流', list.ok === true && Array.isArray(list.streams) && list.streams.length >= 1,
      `streams=${(list.streams || []).length}`);
    const stream = (list.streams || []).find((s) => s.goal_id === 'GOAL-018');
    check('自动归流：同犬×Goal 归入同一活动流', Boolean(stream) && stream.events.length === 2,
      stream ? `events=${stream.events.length}` : 'stream missing');
    check('流统计字段可供页面消费（events/handoffs/session_id/context_estimate）',
      Boolean(stream) && typeof stream.events[0].session_id === 'string' && typeof stream.events[0].context_estimate === 'number');
    check('真续跑链路：第二轮携带第一轮 session（resume 注入通道）',
      stream.events[0].session_id === 'session_v16_1' && stream.events[1].session_id === 'session_v16_2',
      `${stream.events[0].session_id} → ${stream.events[1].session_id}`);

    // GET /api/streams/:id 时间线（页面 toggleStreamTimeline 消费的数据源）。
    const detail = await (await fetch(`${base}/api/streams/${stream.stream_id}`)).json();
    check('GET /api/streams/:id 返回流详情（events+handoffs）',
      detail.ok === true && detail.stream.stream_id === stream.stream_id && Array.isArray(detail.stream.events));
    check('HANDOFF 块已从犬输出解析归档（五节+sha256 锚点）',
      detail.stream.handoffs.length === 1 && detail.stream.handoffs[0].done.includes('完成第一轮任务')
        && /^[0-9a-f]{64}$/.test(detail.stream.handoffs[0].sha256));

    // 头犬代写兜底入口（U4）：外部补写 → 落流记录。
    const ext = await (await fetch(`${base}/api/streams/${stream.stream_id}/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: '头犬代写：暴毙前已完成 X', next: '由新窗口接续' }),
    })).json();
    check('POST /api/streams/:id/handoff 外部代写落盘（201）', ext.ok === true && ext.handoff.done.includes('头犬代写'));

    // 新开流（new_stream:true，v1.6 真字段）→ 新流自动注入最近交接（前端展示前提）。
    const d3 = await (await dispatchPost({ adapter_id: 'kimi-code', prompt: '新开流任务', goal_id: 'GOAL-018', new_stream: true })).json();
    check('new_stream:true 派发受理（v1.6 真字段）', d3.ok === true);
    const list2 = await (await fetch(`${base}/api/streams`)).json();
    const goalStreams = list2.streams.filter((s) => s.goal_id === 'GOAL-018');
    check('新开流后同 Goal 存在两条流', goalStreams.length === 2, `goalStreams=${goalStreams.length}`);

    // 页面渲染消费 v1.6 真实字段形：events/handoffs（stats mock 回退不影响）。
    const html = renderBoardPage();
    check('页面流视图按 v1.6 实形渲染（events/handoffs 现场统计）',
      /s\.events \|\| \[\]/.test(html) && /s\.handoffs \|\| \[\]/.test(html));
    check('页面时间线消费 GET /api/streams/:id 详情',
      /getJson\('\/api\/streams\/' \+ encodeURIComponent\(streamId\)\)/.test(html));
    check('页面工作流下拉与流列表同源（真实流数据出现即上拉）',
      /dispatch-stream/.test(html) && /自动归流：同犬×Goal 归活动流/.test(html));
  } finally {
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g018b v1.6 integration smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
