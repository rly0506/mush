// GOAL-084 权限探针用本地哑 MCP server（stdio，换行分隔 JSON-RPC 2.0）。
// 零副作用：仅实现 initialize / tools/list / tools/call（echo 工具回显入参）。
// 用途：mcp_scope 对照——把"已知存在、无副作用的哑工具"注入被测通道会话，
// 观察受控配置下它是否可见/可调用；与"不存在的工具"（失败基线）区分。
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
rl.on('line', (line) => {
  if (line.trim() === '') return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === 'initialize') {
    send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mush-probe-dummy', version: '0.1.0' } } });
  } else if (req.method === 'notifications/initialized') {
    // 通知无需应答
  } else if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'probe_echo', description: 'zero-side-effect echo for permission probe', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
  } else if (req.method === 'tools/call') {
    // 工具名必须校验（owner 复核四轮）：不存在的工具返回 JSON-RPC error，
    // 保持"失败基线"真实——哑 server 不能对任意名字返回成功。
    if (req.params?.name !== 'probe_echo') {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'unknown tool: ' + String(req.params?.name) } });
      return;
    }
    send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'PROBE_ECHO_OK:' + JSON.stringify(req.params?.arguments ?? {}) }] } });
  } else if (req.id !== undefined) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found: ' + String(req.method) } });
  }
});
