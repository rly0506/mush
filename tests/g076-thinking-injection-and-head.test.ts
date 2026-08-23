import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getModelThinkingSpec } from '../src/adapters/live-probe.ts';
import { DispatchPipeline, type DispatchRecord } from '../src/web/dispatch.ts';

// D82 批次：思维强度全链路注入 + 派发头犬指定。

function makePipeline(tmpDir: string, onArgs: (args: string[]) => void): DispatchPipeline {
  return new DispatchPipeline({
    workspaceRoot: path.join(tmpDir, 'workspace'),
    approvalRoot: path.join(tmpDir, 'approvals'),
    ledgerPath: path.join(tmpDir, 'budget-ledger.jsonl'),
    runAdapter: async (contract) => {
      onArgs([...contract.arguments]);
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, childKilled: false };
    },
  });
}

test('D82 Unit: thinking spec tables cover opencode-hosted and deepseek v4 with MAX tier', () => {
  const ox = getModelThinkingSpec('opencode/x-preview-f-free');
  assert.equal(ox.type, 'categorical');
  assert.ok(ox.options?.some((o) => o.value === 'max'), 'OX alpha must expose max tier');
  assert.equal(ox.param_flag, '--variant');

  const hy3 = getModelThinkingSpec('opencode/hy3-free');
  assert.ok(hy3.options?.some((o) => o.value === 'minimal'));

  const ds = getModelThinkingSpec('deepseek-v4-pro');
  assert.equal(ds.type, 'categorical');
  assert.ok(ds.options?.some((o) => o.value === 'max'), 'deepseek v4 must expose max (Think Max)');
  assert.ok(ds.options?.some((o) => o.value === 'off'));
});

test('D82 Pipeline: opencode effort MAX reaches spawn command line as --variant max', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g076a-'));
  try {
    let seen: string[] = [];
    const pipeline = makePipeline(tmpDir, (args) => {
      seen = args;
    });
    await pipeline.dispatch({ adapter_id: 'opencode', prompt: 'smoke', dry_run: true, effort: 'MAX' });
    const idx = seen.indexOf('--variant');
    assert.ok(idx >= 0, '--variant flag must be injected');
    assert.equal(seen[idx + 1], 'max', 'effort value must be normalized to lowercase');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('D82 Pipeline: channels without injection stay untouched; fail-closed on unknown tier', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g076b-'));
  try {
    let seen: string[] = [];
    const pipeline = makePipeline(tmpDir, (args) => {
      seen = args;
    });
    // zcode：effort_injection none——档位不注入、命令行保持合同原样
    await pipeline.dispatch({ adapter_id: 'zcode', prompt: 'smoke', dry_run: true, effort: 'HIGH' });
    assert.equal(seen.includes('HIGH'), false, 'no raw effort token may leak into args');
    assert.deepEqual(seen.slice(0, 1), ['--prompt']);

    // 未声明档位且非数值/开关 → fail-closed 拒绝
    await assert.rejects(
      pipeline.dispatch({ adapter_id: 'zcode', prompt: 'smoke', dry_run: true, effort: 'ULTRA' }),
      /effort must be one of/,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('D82 Pipeline: dispatch accepts verified head_id and records it in request snapshot', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g076c-'));
  try {
    const pipeline = makePipeline(tmpDir, () => {});
    const record: DispatchRecord = await pipeline.dispatch({
      adapter_id: 'zcode',
      prompt: 'smoke',
      dry_run: true,
      head_id: 'claude-code',
    });
    assert.equal(record.request?.head_id, 'claude-code');

    // 非实证/不在白名单的通道拒绝任头犬
    await assert.rejects(
      pipeline.dispatch({ adapter_id: 'zcode', prompt: 'smoke', dry_run: true, head_id: 'fake-t1' }),
      /not a verified head-capable adapter/,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
