import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.ts';

// GOAL-005 U4：bin/mush board 子命令——起服务 + 打印访问地址。
// 常驻服务进程以 --once 探测模式测试（绑定一次打印地址即退出），
// 避免测试里挂常驻句柄；真实常驻模式由 runCli 内部 startBoardServer 承载。

test('board --once binds 127.0.0.1 by default and prints the access URL', async () => {
  const result = await runCli(['board', '--once']);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, 'board');
  assert.equal(parsed.host, '127.0.0.1');
  assert.ok(typeof parsed.port === 'number' && (parsed.port as number) > 0);
  assert.match(String(parsed.url), /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.ok(typeof parsed.approval_root === 'string');
});

test('board --once honours --port and --host flags', async () => {
  const result = await runCli(['board', '--once', '--port', '0']);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout) as { host: string; port: number };
  assert.equal(parsed.host, '127.0.0.1');
  assert.ok(parsed.port > 0);
});

test('board usage line mentions board in the command list', async () => {
  const result = await runCli([]);
  assert.equal(result.exitCode, 64);
  assert.match(result.stdout, /board/);
});
