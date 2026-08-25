import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';

// GOAL-071：冻结区观察模式——零写入参演（提示级章程注入 + 事后审计，回执重定向）。

function fixtureRoot(): { root: string; host: string; frozen: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g071-'));
  const host = path.join(root, 'host');
  const frozen = path.join(root, '意向项目');
  mkdirSync(host, { recursive: true });
  mkdirSync(frozen, { recursive: true });
  writeFileSync(path.join(frozen, 'golden.txt'), 'GOLDEN REFERENCE', 'utf8');
  return { root, host, frozen };
}

function listing(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d)) {
      const p = path.join(rel, name);
      out.push(p);
      try {
        if (readdirSync(path.join(d, name)) !== undefined) walk(path.join(d, name), p);
      } catch {}
    }
  };
  walk(dir, '');
  return out.sort();
}

test('GOAL-071 Unit：观察模式仅限冻结区路径；退出后恢复正常门禁', async () => {
  const { root, host, frozen } = fixtureRoot();
  const pipeline = new DispatchPipeline({
    workspaceRoot: host,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
  });
  assert.throws(() => pipeline.enterObservation(host), /frozen-zone/, '非冻结区拒绝进入观察态');
  assert.throws(() => pipeline.enterObservation(path.join(root, '不存在')), /frozen-zone/, '不存在的路径拒绝');
  pipeline.enterObservation(frozen);
  assert.equal(pipeline.observingWorkspace, path.resolve(frozen));
  pipeline.exitObservation();
  assert.equal(pipeline.observingWorkspace, null);

  // 退出后：未登记工作区派发被正常门禁拒绝
  await assert.rejects(
    () => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', workspace: frozen, dry_run: true }),
    /workspace not registered/,
  );
  rmSync(root, { recursive: true, force: true });
});

test('GOAL-071 Integration：观察态违规写入被事后审计捕获并留痕', async () => {
  const { root, host, frozen } = fixtureRoot();
  const prompts: string[] = [];
  const pipeline = new DispatchPipeline({
    workspaceRoot: host,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async (_contract, _prompt, opts) => {
      // 模拟犬违规：在冻结区里写文件（审计必须抓住它）
      writeFileSync(path.join(opts!.workspaceRoot, 'violation.txt'), 'should not exist', 'utf8');
      return { exitCode: 0, stdout: 'analysis done', stderr: '', timedOut: false, childKilled: false };
    },
  });
  void prompts;
  pipeline.enterObservation(frozen);
  const before = listing(frozen);
  const rec = await pipeline.dispatch({
    adapter_id: 'fake-t1',
    prompt: '分析该目录结构',
    workspace: frozen,
    dry_run: true,
    timeout_s: 30,
  });
  assert.equal(rec.status, 'DRY_RUN');
  assert.match(rec.error ?? '', /观察模式违规写入/, 'violation must be recorded on the dispatch');
  const violationEvent = rec.events.find((e) => e.payload && (e.payload as Record<string, unknown>).observation_violation === true);
  assert.ok(violationEvent, 'violation event must exist in lifecycle chain');

  // 零写入断言（除违规文件被审计发现外，mush 自身绝不在冻结区落笔）
  const after = listing(frozen);
  assert.deepEqual(after.filter((x) => !before.includes(x)), ['violation.txt'], 'only the dog violation may appear; mush writes nothing');
  assert.equal(existsSync(path.join(frozen, '.mush-receipts')), false, 'receipts must NOT land in frozen zone');
  assert.ok(existsSync(path.join(host, '.mush-receipts', 'observation')), 'redirected observation receipts exist');
  rmSync(root, { recursive: true, force: true });
});

test('GOAL-071 Integration：合规观察——零写入 + 回执重定向 + 章程注入 + 退出恢复门禁', async () => {
  const { root, host, frozen } = fixtureRoot();
  let seenPrompt = '';
  const pipeline = new DispatchPipeline({
    workspaceRoot: host,
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
    runAdapter: async (_contract, prompt) => {
      seenPrompt = String(prompt);
      return { exitCode: 0, stdout: '纯文本分析结论', stderr: '', timedOut: false, childKilled: false };
    },
  });
  const before = listing(frozen);
  pipeline.enterObservation(frozen);
  const rec = await pipeline.dispatch({
    adapter_id: 'fake-t1',
    prompt: '只读分析：列出目录要点',
    workspace: frozen,
    dry_run: true,
    timeout_s: 30,
  });
  assert.equal(rec.status, 'DRY_RUN');
  assert.equal(rec.error, null, 'compliant run has no violation');
  assert.ok(rec.events.some((e) => e.payload && (e.payload as Record<string, unknown>).observation_zero_write === true));
  assert.match(seenPrompt, /\[观察模式｜只读参演\]/, 'observation charter must be injected');
  assert.deepEqual(listing(frozen), before, 'frozen zone byte-listing unchanged');
  assert.equal(existsSync(path.join(frozen, '.mush-receipts')), false);

  // 退出观察后：同一未登记路径恢复正式门禁
  pipeline.exitObservation();
  await assert.rejects(
    () => pipeline.dispatch({ adapter_id: 'fake-t1', prompt: 'x', workspace: frozen, dry_run: true }),
    /workspace not registered/,
  );
  rmSync(root, { recursive: true, force: true });
});
