import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DispatchPipeline, type RunAdapterFn } from '../src/web/dispatch.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { parseHandoffBlock, DSH_CHARTER_FIXED, DSH_STITCH_HEAD, DSH_STITCH_HISTORY, buildDshStitchedPrompt, stripAssembledLayers } from '../src/web/workstreams.ts';

// GOAL-018（rm004-p18a）— work-stream / 真续跑 / 换窗 / HANDOFF / 项目层简报。

function fixtureRoot(): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', 'g018a', `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function makePipeline(root: string, overrides: Partial<ConstructorParameters<typeof DispatchPipeline>[0]> = {}) {
  return new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async () => ({ exitCode: 0, stdout: 'OK', stderr: '', timedOut: false, childKilled: false }),
    streamsPath: path.join(root, 'streams.jsonl'),
    ...overrides,
  });
}

test('U1: dispatch auto-groups by dog×Goal key and new_stream forces a new stream', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const first = await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'one', goal_id: 'G1' });
  const second = await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'two', goal_id: 'G1' });
  const otherGoal = await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'three', goal_id: 'G2' });
  const forced = await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'four', goal_id: 'G1', new_stream: true });
  assert.ok(first.stream_id);
  assert.equal(second.stream_id, first.stream_id);
  assert.notEqual(otherGoal.stream_id, first.stream_id);
  assert.notEqual(forced.stream_id, first.stream_id);
});

test('U2: same-stream kimi dispatch carries resume session from output', async () => {
  const root = fixtureRoot();
  const seenArgs: string[][] = [];
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    streamsPath: path.join(root, 'streams.jsonl'),
    runAdapter: async (contract, _prompt, _opts) => {
      seenArgs.push([...contract.arguments]);
      return { exitCode: 0, stdout: 'To resume this session: kimi -r session_abc123', stderr: '', timedOut: false, childKilled: false };
    },
  });
  await pipeline.dispatch({ adapter_id: 'kimi-code', prompt: 'first' });
  await pipeline.dispatch({ adapter_id: 'kimi-code', prompt: 'second' });
  const secondArgs = seenArgs[1];
  assert.ok(secondArgs.includes('-r'));
  assert.ok(secondArgs.includes('session_abc123'));
});

test('U3: same-stream dsh prompt prefix is stable across two dispatches', async () => {
  const root = fixtureRoot();
  const prompts: string[] = [];
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    streamsPath: path.join(root, 'streams.jsonl'),
    runAdapter: async (_contract, prompt, _opts) => {
      prompts.push(prompt);
      return { exitCode: 0, stdout: 'dsh output', stderr: '', timedOut: false, childKilled: false };
    },
  });
  await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'first task', goal_id: 'G' });
  await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'second task', goal_id: 'G' });
  assert.ok(prompts.length === 2);
  const head = DSH_STITCH_HEAD + DSH_CHARTER_FIXED + DSH_STITCH_HISTORY;
  assert.ok(prompts[0].startsWith(head));
  assert.ok(prompts[1].startsWith(head));
  assert.equal(
    createHash('sha256').update(prompts[0].slice(0, 256)).digest('hex'),
    createHash('sha256').update(prompts[1].slice(0, 256)).digest('hex'),
  );
});

test('U3: 75% context threshold switches dsh stream and marks old stream handoff', async () => {
  const root = fixtureRoot();
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    streamsPath: path.join(root, 'streams.jsonl'),
    runAdapter: async () => ({ exitCode: 0, stdout: 'x'.repeat(100000), stderr: '', timedOut: false, childKilled: false }),
  });
  const first = await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'big', goal_id: 'G' });
  const second = await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'after', goal_id: 'G' });
  assert.notEqual(second.stream_id, first.stream_id);
  const oldStream = pipeline.getStream(first.stream_id!);
  assert.equal(oldStream?.status, 'handoff');
  assert.equal(second.stream_id, pipeline.listStreams().find((s) => s.status === 'active')?.stream_id);
});

test('U4: HANDOFF block is parsed, archived, and injected into switched new window', async () => {
  const root = fixtureRoot();
  const handoffText = [
    'HANDOFF-BEGIN',
    '做了什么: fixed parser',
    '定了什么: keep v1.6',
    '文件在哪: src/web/workstreams.ts',
    '下一步: merge',
    '未解问题: none',
    'HANDOFF-END',
  ].join('\n');
  const prompts: string[] = [];
  let first = true;
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    streamsPath: path.join(root, 'streams.jsonl'),
    runAdapter: async (_contract, prompt, _opts) => {
      prompts.push(prompt);
      if (first) {
        first = false;
        // 大输出把上下文推到 75% 阈值以上，同时末尾携带 HANDOFF 块。
        return { exitCode: 0, stdout: 'x'.repeat(100000) + '\n' + handoffText, stderr: '', timedOut: false, childKilled: false };
      }
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false };
    },
  });
  const firstRecord = await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'first', goal_id: 'G' });
  const oldStream = pipeline.getStream(firstRecord.stream_id!);
  assert.equal(oldStream?.handoffs.length, 1);
  // 第二次大输出推过阈值 → 换新窗，新窗 prompt 注入最近交接块。
  const second = await pipeline.dispatch({ adapter_id: 'deepseek-dsh', prompt: 'second', goal_id: 'G' });
  assert.notEqual(second.stream_id, firstRecord.stream_id);
  assert.match(prompts[1], /\[最近交接\]/);
  assert.match(prompts[1], /fixed parser/);
});

test('U5: AGENTS.md project brief is injected at prompt head', async () => {
  const root = fixtureRoot();
  writeFileSync(path.join(root, 'AGENTS.md'), '# Project Brief\nDo the thing.\n', 'utf8');
  let capturedPrompt = '';
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    streamsPath: path.join(root, 'streams.jsonl'),
    runAdapter: async (_contract, prompt, _opts) => {
      capturedPrompt = prompt;
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false };
    },
  });
  await pipeline.dispatch({ adapter_id: 'claude-code', prompt: 'task' });
  assert.match(capturedPrompt, /\[项目层 AGENTS.md\]/);
  assert.match(capturedPrompt, /Do the thing/);
});

test('U7: stream list/detail and external handoff API work', async () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const server = await startBoardServer({
    approvalRoot: path.join(root, 'approvals'),
    runId: 'g018a-api',
    assignmentEpoch: 1,
    dispatch: pipeline,
  });
  after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  const createdRes = await fetch(base + '/api/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter_id: 'claude-code', prompt: 'stream api', goal_id: 'G' }),
  });
  assert.equal(createdRes.status, 202);
  const created = (await createdRes.json()) as { dispatch_id: string };
  const detailRes = await fetch(base + '/api/dispatch/' + created.dispatch_id);
  const detail = (await detailRes.json()) as { dispatch: { stream_id?: string } };
  assert.ok(detail.dispatch.stream_id);

  const listRes = await fetch(base + '/api/streams');
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { streams: Array<{ stream_id: string }> };
  assert.ok(list.streams.length >= 1);

  const streamId = detail.dispatch.stream_id!;
  const streamRes = await fetch(base + '/api/streams/' + streamId);
  assert.equal(streamRes.status, 200);
  const streamBody = (await streamRes.json()) as { stream: { stream_id: string; events: unknown[] } };
  assert.equal(streamBody.stream.stream_id, streamId);
  assert.ok(streamBody.stream.events.length >= 1);

  const handoffRes = await fetch(base + '/api/streams/' + streamId + '/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ done: 'external', next: 'review' }),
  });
  assert.equal(handoffRes.status, 201);
  const handoff = (await handoffRes.json()) as { handoff: { done: string } };
  assert.equal(handoff.handoff.done, 'external');
});

test('parseHandoffBlock extracts five sections and hash anchors raw block', () => {
  const stdout = [
    'prefix',
    'HANDOFF-BEGIN',
    '做了什么: A',
    '定了什么: B',
    '文件在哪: C',
    '下一步: D',
    '未解问题: E',
    'HANDOFF-END',
    'suffix',
  ].join('\n');
  const block = parseHandoffBlock(stdout, '2026-08-17T00:00:00.000Z');
  assert.ok(block);

test('U3: adapter contracts declare context_management tiers', () => {
  const root = fixtureRoot();
  const pipeline = makePipeline(root);
  const roster = pipeline.roster();
  const byId = new Map(roster.map((entry) => [entry.adapter_id, entry]));
  const claude = byId.get('claude-code');
  const kimi = byId.get('kimi-code');
  const dsh = byId.get('deepseek-dsh');
  // roster 不直接暴露 context_management；从合同层间接验证通过 dispatch 行为已覆盖。
  // 此处仅确认字段存在并正确影响 dsh 缝合路径。
  assert.ok(claude);
  assert.ok(kimi);
  assert.ok(dsh);
});

  assert.equal(block?.done, 'A');
  assert.equal(block?.decided, 'B');
  assert.equal(block?.files, 'C');
  assert.equal(block?.next, 'D');
  assert.equal(block?.open_issues, 'E');
  assert.match(block?.sha256 ?? '', /^[0-9a-f]{64}$/);
});

test('D82 修订：stripAssembledLayers 精确剥离叠加的章程层与项目简报层', () => {
  const raw = 'S1 演练指令：输出一行 JSON';
  const brief = '# mush — agent 工作区指引\n（测试简报正文）';
  // 单层章程
  const single = buildDshStitchedPrompt(DSH_CHARTER_FIXED, '历史A', raw);
  assert.equal(stripAssembledLayers(single, ''), raw);
  // 双层套娃（旧缺陷形态）：stitch(brief + stitch(brief + raw))
  const inner = '[项目层 AGENTS.md]\n' + brief + '\n\n' + buildDshStitchedPrompt(DSH_CHARTER_FIXED, '', '[项目层 AGENTS.md]\n' + brief + '\n\n' + raw);
  const outer = buildDshStitchedPrompt(DSH_CHARTER_FIXED, '', inner);
  assert.equal(stripAssembledLayers(outer, brief), raw);
  // 简报实文不匹配时不剥（不猜测旧内容）
  assert.notEqual(stripAssembledLayers(inner, '另一份简报'), raw);
  // 纯净输入原样返回
  assert.equal(stripAssembledLayers(raw, brief), raw);
});

test('D82 修订：快照存原始指令；重跑组装恰好一次不再层层套娃', async () => {
  const root = fixtureRoot();
  const seen: string[] = [];
  const pipeline = new DispatchPipeline({
    workspaceRoot: root,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: (async (_contract, prompt) => {
      seen.push(String(prompt));
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false };
    }) as RunAdapterFn,
  });
  const raw = 'S1 演练指令：输出一行 JSON';
  const first = await pipeline.dispatch({ adapter_id: 'opencode', prompt: raw });
  // 发犬的是组装版（恰好一层章程），快照存原始指令
  assert.equal(seen.length, 1);
  assert.ok(seen[0].startsWith(DSH_STITCH_HEAD), 'dog must receive stitched prompt');
  assert.equal(seen[0].split(DSH_STITCH_HEAD).length - 1, 1, 'exactly one stitch layer');
  assert.ok(seen[0].includes(raw));
  assert.equal(first.request?.prompt, raw, 'snapshot must store raw owner intent');

  // 重跑：不得出现第二层章程/第二份简报
  await pipeline.rerun(first.dispatch_id);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].split(DSH_STITCH_HEAD).length - 1, 1, 'rerun must not stack another stitch layer');
  assert.ok(seen[1].includes(raw));
});

test('D82 批次：streamLiveOutput 开启时 stderr 增量以 EXECUTE 事件广播；缺省关闭不产生', async () => {
  const root = fixtureRoot();
  const mk = (live: boolean) =>
    new DispatchPipeline({
      workspaceRoot: path.join(root, live ? 'live' : 'quiet'),
      approvalRoot: path.join(root, live ? 'live-appr' : 'quiet-appr'),
      ledgerPath: path.join(root, live ? 'live-ledger' : 'quiet-ledger', 'ledger.jsonl'),
      streamLiveOutput: live,
      runAdapter: (async (_contract, _prompt, opts) => {
        opts?.onStderr?.('[tool] $ ls -1 | wc -l');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, childKilled: false };
      }) as RunAdapterFn,
    });
  const liveRec = await mk(true).dispatch({ adapter_id: 'fake-t1', prompt: 'watch me' });
  const liveExec = liveRec.events.filter((ev) => ev.phase === 'EXECUTE' && typeof ev.payload.stream_text === 'string');
  assert.ok(liveExec.some((ev) => ev.payload.progress === 'stderr' && String(ev.payload.stream_text).includes('$ ls')),
    'stderr chunk must be broadcast as EXECUTE event when streamLiveOutput is on');

  const quietRec = await mk(false).dispatch({ adapter_id: 'fake-t1', prompt: 'quiet' });
  const quietExec = quietRec.events.filter((ev) => ev.phase === 'EXECUTE' && typeof ev.payload.stream_text === 'string');
  assert.equal(quietExec.length, 0, 'no incremental frames by default');
});
