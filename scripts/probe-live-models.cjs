const path = require('node:path');
const { DispatchPipeline } = require('../src/web/dispatch.ts');

const workspaceRoot = path.resolve(__dirname, '..');
const pipeline = new DispatchPipeline({
  workspaceRoot,
  approvalRoot: path.join(workspaceRoot, 'runtime', 'approvals'),
  ledgerPath: path.join(workspaceRoot, 'runtime', 'budget-ledger.jsonl'),
});

void (async () => {
  console.log('--- Probing all live models across registered harnesses ---');
  const probes = await pipeline.probeLiveModels();
  for (const [id, record] of Object.entries(probes)) {
    console.log(`[${record.status}] ${id}: live_models=[${record.live_models.join(', ')}]`);
  }
  console.log('--- Roster Live Output with Dispatchability Tiers ---');
  for (const r of pipeline.roster()) {
    console.log(`- ${r.adapter_id} (${r.expected_provider}/${r.expected_model_id}): status=${r.probe_status || 'NONE'} supports_flag=${r.supports_model_flag}`);
    if (r.model_tiers) {
      for (const [m, tier] of Object.entries(r.model_tiers)) {
        console.log(`    • [${tier}] ${m}`);
      }
    }
  }
})();
