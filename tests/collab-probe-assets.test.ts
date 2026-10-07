import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// GOAL-084 探针资产自检（owner 复核四轮）：哑 MCP server 必须校验工具名——
// 不存在的工具返回 JSON-RPC error（失败基线真实），不能对任意名字返回成功。
// 资产在 tests/fixtures/（随仓库分发——owner 复核五轮：.test-fixtures 被
// gitignore，新检出仓库不携带，测试必须可复现）。

const SERVER = fileURLToPath(new URL('./fixtures/collab-probe-assets/dummy-mcp-server.mjs', import.meta.url));

function rpc(requests: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = [];
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        lines.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.on('error', reject);
    child.on('exit', () => resolve(lines));
    for (const req of requests) child.stdin.write(req + '\n');
    child.stdin.end();
    setTimeout(() => { child.kill(); reject(new Error('dummy mcp server timed out')); }, 5000).unref();
  });
}

test('dummy mcp server: probe_echo succeeds, unknown tool fails (failure baseline stays real)', async () => {
  const lines = await rpc([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'probe_echo', arguments: { text: 'PROBE' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mush-probe-nonexistent', arguments: {} } }),
  ]);
  assert.equal(lines.length, 4, 'notifications produce no response');
  const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal((parsed[0].result as Record<string, unknown>).protocolVersion, '2024-11-05', 'initialize handshakes');
  const tools = ((parsed[1].result as Record<string, unknown>).tools as Array<{ name: string }>).map((t) => t.name);
  assert.deepEqual(tools, ['probe_echo'], 'tools/list exposes only the zero-side-effect echo tool');
  const echo = parsed[2].result as { content: Array<{ text: string }> };
  assert.match(echo.content[0].text, /^PROBE_ECHO_OK:/, 'probe_echo call succeeds');
  const unknown = parsed[3] as { error?: { code: number; message: string } };
  assert.ok(unknown.error !== undefined, 'unknown tool must fail');
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /mush-probe-nonexistent/);
});
