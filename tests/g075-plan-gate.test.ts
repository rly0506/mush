import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatService, extractPlanBlock, type ChatFrameEvent } from '../src/web/chat.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { awaitChatReply } from './fixtures/chat-approval.ts';

// GOAL-075 切片3：派发计划门（Plan Gate）——头犬先出计划、owner 决断后才执行。

const PLAN_REPLY =
  'PLAN READY\n<PLAN>{"goal_summary":"演练目标","steps":[{"dog":"deepseek-dsh","task":"step one"},{"dog":"opencode","task":"step two"}],"est_cost_usd":0}</PLAN>';

function makeChat(root: string, frames: ChatFrameEvent[], prompts: string[]) {
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, 'workspace'),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async (_contract, prompt) => {
      prompts.push(String(prompt));
      if (String(prompt).includes('[Owner 决断：计划已批准]')) {
        return { exitCode: 0, stdout: 'EXECUTION DONE', stderr: '', timedOut: false, childKilled: false };
      }
      return { exitCode: 0, stdout: PLAN_REPLY, stderr: '', timedOut: false, childKilled: false };
    },
  });
  return { pipeline, chat: new ChatService({ runtimeRoot: root, pipeline, onEvent: (e) => frames.push(e) }) };
}

test('GOAL-075 切片3 Unit：extractPlanBlock 提取/畸形 fail-safe', () => {
  assert.equal(extractPlanBlock('前言 <PLAN>{"steps":[{"dog":"a","task":"b"}]}</PLAN> 后记')?.plan.steps.length, 1);
  assert.equal(extractPlanBlock('无块'), null);
  assert.equal(extractPlanBlock('<PLAN>不是JSON</PLAN>'), null, '畸形 JSON 按未触发处理');
  assert.equal(extractPlanBlock('<PLAN>{"steps":[]}</PLAN>'), null, '空 steps 按未触发处理');
  assert.equal(extractPlanBlock('<PLAN>{"steps":[{"task":"缺dog"}]}</PLAN>'), null);
});

test('GOAL-075 切片3 Gate：头犬出计划→WAITING→批准续跑执行', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g075-gate-'));
  const frames: ChatFrameEvent[] = [];
  const prompts: string[] = [];
  const { chat, pipeline } = makeChat(root, frames, prompts);
  try {
    const ack = await chat.post({ message: '多步任务 RM011-GATE', adapter_id: 'deepseek-dsh' });
    await chat.whenSettled();
    await awaitChatReply(pipeline, chat, ack.dispatch_id);
    const wait = frames.find((f) => f.phase === 'PLAN_WAIT');
    assert.ok(wait, 'must emit PLAN_WAIT');
    const planId = String(wait!.payload.plan_id);
    assert.ok(prompts.every((p) => !p.includes('计划已批准')), 'no execution before approval');

    chat.decidePlan(planId, 'approve');
    await chat.whenSettled();
    const continuation = frames.find((f) => f.phase === 'PLAN_DECIDED');
    await awaitChatReply(pipeline, chat, String(continuation?.payload.new_dispatch_id));
    assert.ok(prompts[1]?.includes('[Owner 决断：计划已批准]'), 'approval must trigger continuation run');
    assert.ok(prompts[1]?.includes('step one'), 'approved plan travels with continuation');
    assert.ok(frames.some((f) => f.phase === 'PLAN_DECIDED' && f.payload.decision === 'approve'));
    // 续跑回复正常落气泡（不再含计划块）
    assert.ok(frames.filter((f) => f.phase === 'REPORT').some((f) => f.payload.reply === 'EXECUTION DONE'));

    await chat.whenSettled();
    assert.throws(() => chat.decidePlan(planId, 'approve'), /already decided/, 'double-decide rejected');

    // 原始计划不出现在普通气泡里（折叠为等待语）
    const report = frames.find((f) => f.phase === 'REPORT' && typeof f.payload.reply === 'string' && String(f.payload.reply).includes('派发计划'));
    assert.ok(report, 'bubble collapses to waiting note');
    assert.ok(!String(report!.payload.reply).includes('<PLAN>'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GOAL-075 切片3 Gate：否决不产生任何派发；solo 直聊不受门控', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'g075-reject-'));
  const frames: ChatFrameEvent[] = [];
  const prompts: string[] = [];
  const { chat, pipeline } = makeChat(root, frames, prompts);
  try {
    const ack = await chat.post({ message: '多步任务 REJECT-PATH', adapter_id: 'deepseek-dsh' });
    await chat.whenSettled();
    await awaitChatReply(pipeline, chat, ack.dispatch_id);
    const wait = frames.find((f) => f.phase === 'PLAN_WAIT');
    const countAfterFirst = prompts.length;
    chat.decidePlan(String(wait!.payload.plan_id), 'reject');
    await chat.whenSettled();
    assert.equal(prompts.length, countAfterFirst, 'rejected plan must not dispatch anything');
    assert.ok(frames.some((f) => f.phase === 'PLAN_DECIDED' && f.payload.decision === 'reject'));

    // solo：即使回复带 PLAN 块也直接透传（独奏模式不派发也不设门）
    const beforeSolo = prompts.length;
    const soloAck = await chat.post({ message: 'solo 任务 SOLO-PASS', adapter_id: 'deepseek-dsh', solo: true });
    await chat.whenSettled();
    await awaitChatReply(pipeline, chat, soloAck.dispatch_id);
    assert.equal(frames.filter((f) => f.phase === 'PLAN_WAIT').length, 1, 'solo must bypass plan gate');
    assert.ok(prompts.length >= beforeSolo + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
