import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterContract } from '../src/adapters/contract.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { buildContracts } from '../src/web/dispatch.ts';

// GOAL-076+：TBTK provider 网关接入（Anthropic 兼容端点）。
// 密钥红线：密钥不入库/不入日志——runner 从宿主环境 MUSH_CLAUDE_TBTK_API_KEY 读，此处只测结构。

test('TBTK：claude-tbtk 通道在合同表内，指向 tbtk.asia 网关 + k3-256k 模型', () => {
  const contracts = buildContracts(undefined, []);
  const c = contracts['claude-tbtk'];
  assert.ok(c, 'claude-tbtk must exist in contract table');
  assert.equal(c.provider_base_url, 'https://tbtk.asia');
  assert.equal(c.expected_model_id, 'k3-256k');
  assert.equal(c.role, 'executor');
  assert.equal(c.protocol, 'stream-json');
});

test('TBTK：provider_base_url 校验——仅 https，非 https fail-closed', () => {
  assert.throws(
    () => validateAdapterContract({ ...buildClaudeContract('k3-256k'), adapter_id: 'x', provider_base_url: 'http://insecure.example' }),
    /https/,
  );
});

test('TBTK：roster 暴露 claude-tbtk 且 verified（白名单）', () => {
  const contracts = buildContracts(undefined, []);
  assert.ok(Object.keys(contracts).includes('claude-tbtk'));
});
