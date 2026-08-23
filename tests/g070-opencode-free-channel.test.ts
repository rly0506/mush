import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildOpencodeContract, parseOpencodeModelsList, OPENCODE_DEFAULT_MODEL } from '../src/adapters/opencode.ts';
import { isFreeModel } from '../src/web/pricing.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';

// GOAL-070：opencode free 模型通道接入——发现枚举、variants 同步、-m 注入、零成本计费。

const MODELS_FIXTURE = [
  'opencode/big-pickle',
  'opencode/hy3-free',
  'opencode/mimo-v2.5-free',
  'opencode/muse-spark-1.2-contributor-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/x-preview-f-free',
  'botcf/kimi-k3',
  'pixel/grok-4.5',
  'tbtk/glm-5.3',
].join('\n');

function makePipeline(tmpDir: string, onDispatchArgs: (args: string[]) => void): DispatchPipeline {
  return new DispatchPipeline({
    workspaceRoot: path.join(tmpDir, 'workspace'),
    approvalRoot: path.join(tmpDir, 'approvals'),
    ledgerPath: path.join(tmpDir, 'budget-ledger.jsonl'),
    runAdapter: async (contract, prompt) => {
      if (prompt === 'models') {
        return { exitCode: 0, stdout: MODELS_FIXTURE, stderr: '', timedOut: false, childKilled: false };
      }
      onDispatchArgs([...contract.arguments]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ model: OPENCODE_DEFAULT_MODEL, text: 'ok' }),
        stderr: '',
        timedOut: false,
        childKilled: false,
      };
    },
  });
}

test('GOAL-070 Unit: parseOpencodeModelsList groups by provider prefix', () => {
  const parsed = parseOpencodeModelsList(MODELS_FIXTURE);
  assert.equal(parsed.models.length, 10);
  assert.deepEqual(parsed.grouped['opencode'], [
    'opencode/big-pickle',
    'opencode/hy3-free',
    'opencode/mimo-v2.5-free',
    'opencode/muse-spark-1.2-contributor-free',
    'opencode/nemotron-3-ultra-free',
    'opencode/nemotron-3.5-lightning-free',
    'opencode/x-preview-f-free',
  ]);
  assert.deepEqual(parsed.grouped['botcf'], ['botcf/kimi-k3']);
  assert.deepEqual(parsed.grouped['pixel'], ['pixel/grok-4.5']);
  assert.deepEqual(parsed.grouped['tbtk'], ['tbtk/glm-5.3']);
});

test('GOAL-070 Unit: parser tolerates blank lines and non-model noise', () => {
  const parsed = parseOpencodeModelsList('\n  opencode/hy3-free  \n\nnot-a-model-line\n/-weird\n');
  assert.deepEqual(parsed.models, ['opencode/hy3-free']);
  assert.deepEqual(parsed.grouped['opencode'], ['opencode/hy3-free']);
});

test('GOAL-070 Unit: free-tier models classify as zero-cost pricing', () => {
  for (const id of [
    'opencode/hy3-free',
    'opencode/mimo-v2.5-free',
    'opencode/muse-spark-1.2-contributor-free',
    'opencode/nemotron-3-ultra-free',
    'opencode/nemotron-3.5-lightning-free',
    'opencode/x-preview-f-free',
  ]) {
    assert.equal(isFreeModel(id), true, `${id} must be free-tier`);
  }
  assert.equal(isFreeModel('opencode/big-pickle'), false);
});

test('GOAL-070 Pipeline: probeLiveModels enumerates real models, syncs variants, marks channel verified', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g070a-'));
  try {
    const pipeline = makePipeline(tmpDir, () => {});
    // opencode 分支直接执行本机 `opencode models`（零 token 本地清单），
    // 断言用真实在册 free 档子集，不锁死全量清单。
    const probes = await pipeline.probeLiveModels('opencode');
    assert.equal(probes.opencode.status, 'ONLINE');
    for (const id of ['opencode/hy3-free', 'opencode/x-preview-f-free', 'botcf/kimi-k3']) {
      assert.ok(probes.opencode.live_models.includes(id), `live_models must contain ${id}`);
    }
    assert.ok(probes.opencode.grouped_models?.['tbtk']?.includes('tbtk/glm-5.3'));

    const entry = pipeline.roster().find((r) => r.adapter_id === 'opencode');
    assert.ok(entry, 'opencode must appear in roster');
    assert.equal(entry.verified, true, 'probe ONLINE with live models must mark channel verified');
    assert.ok(entry.live_models?.includes('opencode/x-preview-f-free'));
    assert.ok(entry.grouped_models && Object.keys(entry.grouped_models).length >= 4);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GOAL-070 Pipeline: dry-run dispatch injects -m; explicit variant rewrites the value', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g070b-'));
  try {
    let seenArgs: string[] = [];
    const pipeline = makePipeline(tmpDir, (args) => {
      seenArgs = args;
    });
    // 先实测枚举——variants 同步后 hy3-free 才过派发门禁（line ~793 校验同源）
    await pipeline.probeLiveModels('opencode');

    // 缺省派发（不选模型）→ 免费缺省档随命令注入
    await pipeline.dispatch({ adapter_id: 'opencode', prompt: 'smoke', dry_run: true });
    assert.ok(seenArgs.includes('-m'), 'default dispatch must inject -m flag pair');
    assert.equal(seenArgs[seenArgs.indexOf('-m') + 1], OPENCODE_DEFAULT_MODEL);

    // 显式选择另一 free 档 → -m 值被重写
    await pipeline.dispatch({ adapter_id: 'opencode', prompt: 'smoke2', dry_run: true, model_id: 'opencode/hy3-free' });
    assert.equal(seenArgs[seenArgs.indexOf('-m') + 1], 'opencode/hy3-free');

    // 未枚举进 variants 的模型必须被 fail-closed 拒绝
    await assert.rejects(
      pipeline.dispatch({ adapter_id: 'opencode', prompt: 'smoke3', dry_run: true, model_id: 'totally/unknown-model' }),
      /not in variants/,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
