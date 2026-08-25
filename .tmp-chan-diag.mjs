// 通道诊断：deepseek-dsh / kimi-code 各跑一单，输出完整 stderr
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchPipeline } from './src/web/dispatch.ts';

const root = mkdtempSync(path.join(tmpdir(), 'chandiag-'));
for (const adapter of ['zcode', 'claude-code']) {
  const pipeline = new DispatchPipeline({
    workspaceRoot: path.join(root, adapter),
    approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'),
  });
  try {
    const rec = await pipeline.dispatch({
      adapter_id: adapter,
      prompt: 'Reply with one word: ok',
      dry_run: true,
      timeout_s: 60,
    });
    console.log('==', adapter, '→', rec.status, '| err:', JSON.stringify(rec.error));
    if (rec.stderr_tail) console.log('   stderr:', JSON.stringify(rec.stderr_tail.text.slice(0, 300)));
    if (rec.stdout_tail) console.log('   stdout:', JSON.stringify(rec.stdout_tail.text.slice(0, 200)));
  } catch (e) {
    console.log('==', adapter, '→ THROW:', String(e).slice(0, 250));
  }
}
