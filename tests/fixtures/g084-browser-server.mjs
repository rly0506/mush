import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBoardServer } from '../../src/web/server.ts';
import { DispatchPipeline } from '../../src/web/dispatch.ts';
import { CollaborationBlackboard, ISOLATION_DIMENSIONS } from '../../src/orchestration/collaboration-blackboard.ts';
import { contractPermissionFingerprint, validateAdapterContract } from '../../src/adapters/contract.ts';

const root = mkdtempSync(path.join(process.cwd(), '.test-fixtures', 'g084-browser-'));
const brands = path.resolve('assets', 'brands');
if (existsSync(brands)) {
  mkdirSync(path.join(root, 'assets', 'brands'), { recursive: true });
  for (const file of readdirSync(brands, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith('.svg')) copyFileSync(path.join(brands, file.name), path.join(root, 'assets', 'brands', file.name));
  }
}
const scenarioFile = path.join(root, 'scenario.txt');
const delayFile = path.join(root, 'delay.txt');
const script = path.join(root, 'emit.mjs');
writeFileSync(scenarioFile, 'happy');
writeFileSync(delayFile, '150');
writeFileSync(script, [
  "import { readFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const scenario = readFileSync(args[0], 'utf8').trim();",
  "const delay = Number(readFileSync(args[1], 'utf8').trim()) || 150;",
  "const prompt = args.at(-1);",
  "const phase = prompt.match(/【阶段】(\\w+)/)?.[1];",
  "const seat = prompt.match(/【席位】(\\w+)/)?.[1];",
  "const target = prompt.match(/【回应对象】(vp_[0-9a-f-]+)/)?.[1];",
  "if (scenario==='hang' && phase==='coordination') await new Promise(r=>setTimeout(r,10000));",
  "else await new Promise(r=>setTimeout(r,delay));",
  "const base = {",
  "coordination:{a_focus:'A 关注方案',b_focus:'B 关注边界',material_plan:{A:['m1'],B:['m2']},notes:'基于批准材料分工'},",
  "proposal:{body:'提案-'+seat,stance:'支持',evidence:[seat==='A'?'m1':'m2'],reserved_disagreements:'还需验证假设'},",
  "review:{body:'评审-'+seat,stance:'附条件支持',responds_to:target,evidence:[],flaws:['边界需要补证据'],suggestions:['说明验证方法'],reserved_disagreements:''},",
  "revision:{body:'修订-'+seat,stance:'修订后支持',changes:['采纳验证建议'],reserved_disagreements:'保留待验证事项'}",
  "};",
  "let output = base[phase];",
  "if(scenario==='invalid' && phase==='proposal') output={wrong:true};",
  "if(scenario==='xss' && phase==='proposal') output.body='<img src=x onerror=\"window.__collabXss=1\">';",
  "console.log(JSON.stringify(output));",
].join('\n'));
const records = new Map();
const evidenceStore = { resolve: source => records.get(source) };
const contract = id => validateAdapterContract({
  adapter_id:id, executable:process.execPath, arguments:[script,scenarioFile,delayFile],
  protocol:'t1',prompt_transport:'argument',expected_provider:'fake',expected_model_id:id+'-model',
  tool_restriction_args:['--restricted'],
});
const board = CollaborationBlackboard.open(path.join(root,'data'),{evidenceStore});
const pipeline = new DispatchPipeline({
  workspaceRoot:root,approvalRoot:path.join(root,'approvals'),approvalRequestRoot:path.join(root,'approvals'),
  ledgerPath:path.join(root,'ledger.jsonl'),collabBlackboard:board,
  contracts:{'fixture-a':contract('fixture-a'),'fixture-b':contract('fixture-b')},
});
const server = await startBoardServer({
  workspaceRoot:root,approvalRoot:path.join(root,'approvals'),runtimeRoot:path.join(root,'runtime'),
  ledgerPath:path.join(root,'ledger.jsonl'),runId:'g084-browser',assignmentEpoch:1,dispatch:pipeline,
  enforceCallerToken:true,port:0,collaborationEvidenceStore:evidenceStore,
  collaborationEvidence:(participant,executionContract)=>{
    if(readScenario()==='unverified') return [];
    const fingerprint=contractPermissionFingerprint(executionContract);
    return ISOLATION_DIMENSIONS.map(dimension=>{
      const source='fixture://browser/'+participant.adapter_id+'/'+fingerprint+'/'+dimension;
      const evidence={adapter_id:participant.adapter_id,dimension,subject:'synthetic only',method:'behavior_test',
        coverage:'behavior',tool_version:'fixture',config_fingerprint:fingerprint,source,status:'live_verified'};
      records.set(source,{...evidence,artifact_sha256:'a'.repeat(64),result:'pass',recorded_at_utc:new Date().toISOString()});
      return evidence;
    });
  },
});
function readScenario(){ return process.getBuiltinModule('node:fs').readFileSync(scenarioFile,'utf8').trim(); }
const info = {url:'http://127.0.0.1:'+server.port,root,scenarioFile,delayFile};
writeFileSync(path.join(root,'server.json'),JSON.stringify(info,null,2));
console.log(JSON.stringify(info));
let closing=false;
const keepAlive=setInterval(()=>{},10000);
async function close(){
  if(closing)return;closing=true;clearInterval(keepAlive);
  for(const session of board.listSessions()){
    if(board.isRunActive(session.id)){
      await fetch(info.url+'/api/collaboration/sessions/cancel',{
        method:'POST',headers:{'content-type':'application/json','x-mush-caller-auth':server.callerToken},
        body:JSON.stringify({session_id:session.id}),
      }).catch(()=>{});
    }
  }
  for(let i=0;i<100&&board.listSessions().some(s=>board.isRunActive(s.id));i++)await new Promise(r=>setTimeout(r,50));
  await server.close();board.close();
}
process.once('SIGINT',()=>void close().then(()=>process.exit(0)));
process.once('SIGTERM',()=>void close().then(()=>process.exit(0)));

