/** GP-29 真实冒烟：pi --mode rpc 线协议握手验证（默认 provider，零配置依赖）。 */
import { runPiRpc } from '../src/adapters/pi-rpc-runner.ts';
import { buildPiContract } from '../src/adapters/pi.ts';

const result = await runPiRpc(buildPiContract(), 'reply with exactly: ok', {
  workspaceRoot: 'D:\\mush',
  receiptPath: 'D:\\mush\\.mush-receipts\\pi-rpc-smoke.json',
  timeoutMs: 60_000,
});
console.log('exit:', result.exitCode);
console.log('confirmed:', result.confirmedProvider, '/', result.confirmedModelId);
console.log('reason:', result.failClosedReason ?? '(none — completed)');
console.log('stdout(120):', JSON.stringify(result.stdout.slice(0, 120)));
console.log('stderr(200):', JSON.stringify(result.stderr.slice(0, 200)));
console.log(
  result.confirmedProvider !== ''
    ? 'SMOKE-PASS: RPC 线协议握手成立（身份已实测）'
    : 'SMOKE-FAIL: 未收到 get_state 响应',
);
process.exit(result.confirmedProvider !== '' ? 0 : 1);
