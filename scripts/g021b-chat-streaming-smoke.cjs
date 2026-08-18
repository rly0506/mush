// GOAL-021B 脚本化冒烟（派发包 rm004-p20b DoD：真实执行入回执）。
// 全链路：起板（fake runner，分 chunk 吐 stdout）→ POST /api/chat 202 受理 →
// SSE /api/stream 收 kind=chat 帧（ADMITTED → EXECUTE 增量 → HEARTBEAT 耗时 →
// REPORT 回复全文）→ 失败路径 REPORT status=FAIL → 会话 JSONL 完整 →
// 页面结构（pending 气泡/阶段态/打字机容器/重试按钮）。
// 用法：node scripts/g021b-chat-streaming-smoke.cjs（Windows 转义铁律：脚本文件，非内联）。
'use strict';
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
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
    checks.push({ name, ok, detail: detail || '' });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };

  const fixture = path.join(ROOT, '.test-fixtures', 'g021b-smoke', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });

  // fake runner：成功路径分 3 chunk 流式吐出；prompt 含「失败冒烟」时非零退出。
  const runAdapter = async (_contract, prompt, opts) => {
    if (prompt.indexOf('失败冒烟') >= 0) {
      if (opts.onStdout) opts.onStdout('partial-before-fail ');
      return { exitCode: 1, stdout: 'partial-before-fail ', stderr: 'boom', timedOut: false, childKilled: false };
    }
    const chunks = ['冒烟回复片段一，', '片段二接续，', '片段三收尾。'];
    for (const c of chunks) {
      if (opts.onStdout) opts.onStdout(c);
      await new Promise((r) => setTimeout(r, 30));
    }
    return { exitCode: 0, stdout: chunks.join(''), stderr: '', timedOut: false, childKilled: false };
  };

  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter,
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g021b-smoke',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });
  const base = `http://127.0.0.1:${server.port}`;

  // SSE 收集器：解析 data: <json>\n\n 帧。
  const chatFrames = [];
  const sseRes = await fetch(`${base}/api/stream`);
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = '';
  let sseClosed = false;
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = sseBuf.indexOf('\n\n')) >= 0) {
        const raw = sseBuf.slice(0, idx);
        sseBuf = sseBuf.slice(idx + 2);
        const line = raw.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const frame = JSON.parse(line.slice(6));
          if (frame && frame.kind === 'chat') chatFrames.push(frame);
        } catch (e) { /* 半帧忽略 */ }
      }
    }
    sseClosed = true;
  })();

  const waitFrames = (pred, timeoutMs, label) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const hit = chatFrames.filter(pred);
      if (hit.length > 0) return resolve(hit);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout waiting ' + label));
      setTimeout(poll, 20);
    };
    poll();
  });

  try {
    // 1) 成功路径：202 受理 + 帧序 + 增量 + 心跳 + REPORT 全文
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '冒烟：流式回报状态', adapter_id: 'head-dog', effort: 'HIGH' }),
    });
    const ack = await res.json();
    check('202 异步受理（status PENDING + dispatch_id）',
      res.status === 202 && ack.ok === true && ack.status === 'PENDING' && typeof ack.dispatch_id === 'string',
      `status=${res.status} note=${ack.note || ''}`);

    const mine = (f) => f.dispatch_id === ack.dispatch_id;
    const frames = await waitFrames((f) => mine(f) && f.phase === 'REPORT', 15000, 'REPORT');
    const phases = chatFrames.filter(mine).map((f) => f.phase);
    check('帧序 ADMITTED 先达', phases[0] === 'ADMITTED', phases.join(','));
    check('EXECUTE 增量帧 ≥1 且含 stream_text',
      chatFrames.filter(mine).filter((f) => f.phase === 'EXECUTE').length >= 1 &&
      chatFrames.filter(mine).filter((f) => f.phase === 'EXECUTE').every((f) => typeof f.payload.stream_text === 'string' && f.payload.stream_text.length > 0));
    const streamed = chatFrames.filter(mine).filter((f) => f.phase === 'EXECUTE').map((f) => f.payload.stream_text).join('');
    check('增量帧拼合 = 回复全文', streamed === '冒烟回复片段一，片段二接续，片段三收尾。', streamed.slice(0, 24));
    check('HEARTBEAT 帧含 elapsed_ms（耗时实时）',
      chatFrames.filter(mine).filter((f) => f.phase === 'HEARTBEAT').length >= 1 &&
      chatFrames.filter(mine).filter((f) => f.phase === 'HEARTBEAT').every((f) => typeof f.payload.elapsed_ms === 'number'));
    const report = frames[0];
    check('REPORT 含回复全文 + elapsed_ms',
      report.payload.reply === '冒烟回复片段一，片段二接续，片段三收尾。' && typeof report.payload.elapsed_ms === 'number',
      `status=${report.payload.status}`);

    // 2) 会话 JSONL 完整（user + head 全文）
    const jsonl = readFileSync(path.join(fixture, 'runtime', 'chat', `${ack.session_id}.jsonl`), 'utf8').trim().split('\n');
    check('会话 JSONL 双轮（user + head 全文）',
      jsonl.length === 2 && JSON.parse(jsonl[0]).role === 'user' &&
      JSON.parse(jsonl[1]).text === '冒烟回复片段一，片段二接续，片段三收尾。');

    // 3) 失败路径：REPORT status=FAIL（前端据此渲染失败气泡 + 重试）
    const badRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '失败冒烟：触发非零退出', adapter_id: 'head-dog', resume: ack.session_id }),
    });
    const badAck = await badRes.json();
    check('失败冒烟 202 受理', badRes.status === 202 && badAck.ok === true, `status=${badRes.status}`);
    const badReport = (await waitFrames((f) => f.dispatch_id === badAck.dispatch_id && f.phase === 'REPORT', 15000, 'FAIL REPORT'))[0];
    check('失败路径 REPORT status=FAIL（前端失败气泡 + 重试语义）',
      badReport.payload.status === 'FAIL' && typeof badReport.payload.elapsed_ms === 'number',
      `status=${badReport.payload.status}`);

    // 4) 页面结构（pending 气泡/阶段态/打字机/重试/心跳）
    const html = renderBoardPage();
    check('结构：pending 气泡 + 阶段态', /<span class="chat-stage">思考中<\/span>/.test(html) && /chatSetStage\(row, '生成中'\)/.test(html));
    check('结构：打字机容器 + rAF + reduced-motion', /typewriter-text/.test(html) && /requestAnimationFrame\(chatTypewriterTick\)/.test(html) && /prefers-reduced-motion/.test(html));
    check('结构：失败气泡 + 重试按钮', /chat-failed/.test(html) && /chat-retry/.test(html) && /retryChat/.test(html));
    check('结构：心跳耗时实时显示', /chatSetElapsed\(chatStreamRow \|\| thinkingRow, p\.elapsed_ms\)/.test(html));
  } finally {
    try { await reader.cancel(); } catch (e) { /* ignore */ }
    await pump.catch(() => {});
    void sseClosed;
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== g021b smoke: ${checks.length - failed.length}/${checks.length} PASS ===`);
  // 不用 process.exit（Windows SSE handle 关闭竞态，g012b 同款教训）；置 exitCode 自然排空。
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exitCode = 1;
});
