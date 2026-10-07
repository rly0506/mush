import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { BoardPersistence } from '../src/web/persistence.ts';
import { ChatService } from '../src/web/chat.ts';
import { startBoardServer } from '../src/web/server.ts';
import { renderBoardPage } from '../src/web/page.ts';

function fixture() {
  const parent = path.resolve('.test-fixtures/core-flow-tests');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, 'run-'));
}

test('chat runs immediately (D83 direct conversation); retry needs no token; no D30 card', async () => {
  const root = fixture();
  const runtimeRoot = path.join(root, 'runtime');
  let calls = 0;
  const makePipeline = () => new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(runtimeRoot, 'budget-ledger.jsonl'),
    persistence: new BoardPersistence(runtimeRoot),
    runAdapter: async (_contract, _prompt, options) => {
      calls++;
      const stdout = calls === 1 ? '' : 'RECOVERED RESULT';
      options?.onStdout?.(stdout);
      return { exitCode: calls === 1 ? 1 : 0, stdout, stderr: calls === 1 ? 'fixture failure' : '', timedOut: false, childKilled: false };
    },
  });
  const pipeline = makePipeline();
  const chat = new ChatService({ pipeline, runtimeRoot });
  const ack = await chat.post({ message: 'first browser task', adapter_id: 'claude-code' });
  await chat.whenSettled();
  assert.equal(calls, 1, 'D83：聊天受理即执行（owner 敲字即批准，无需审批卡）');
  assert.equal(pipeline.get(ack.dispatch_id)?.status, 'FAIL');
  const history = await chat.history(ack.session_id);
  assert.equal(history.turns.at(-1)?.status, 'FAIL');
  assert.match(history.turns.at(-1)?.text ?? '', /fixture failure/);

  // 重试不经审批令牌直接执行，并回写同一会话。
  const retry = await chat.rerun(ack.dispatch_id);
  assert.equal(retry.status, 'PASS');
  assert.equal(calls, 2, 'retry executed without any approval token');
  assert.equal((await chat.history(ack.session_id)).turns.at(-1)?.text, 'RECOVERED RESULT');

  // 聊天派发不得生成 D30 审批请求卡（看板派发才走逐单审批）。
  const { existsSync, readdirSync } = await import('node:fs');
  const cardDir = path.join(root, 'goals', 'receipts', 'approval-requests');
  assert.ok(!existsSync(cardDir) || readdirSync(cardDir).length === 0, 'chat dispatch must not create approval cards');
});

test('server uses the supplied simulator after switching workspace and preserves selection', async (t) => {
  const root = fixture();
  const other = path.join(root, 'project-b');
  mkdirSync(other);
  let calls = 0;
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    runId: 'browser-flow', assignmentEpoch: 1,
    runAdapter: async () => {
      calls++;
      return { exitCode: 0, stdout: 'SIMULATED', stderr: '', timedOut: false, childKilled: false };
    },
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const post = (url: string, body: unknown) => fetch(base + url, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await post('/api/workspaces/select', { path: other })).status, 201);
  const workspaces = await (await fetch(base + '/api/workspaces')).json() as { workspaces: Array<{ path: string; selected: boolean }> };
  assert.ok(workspaces.workspaces.some((w: { path: string; selected: boolean }) => w.path === other && w.selected));
  const created = await (await post('/api/dispatch', { adapter_id: 'fake-t1', prompt: 'local only' })).json() as { status: string };
  assert.equal(created.status, 'DRY_RUN');
  assert.equal(calls, 1);
});

test('browser effort options use each selected adapter contract independently', () => {
  const html = renderBoardPage();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
  const fn = script.slice(script.indexOf('  function renderDynamicThinkingOptions('), script.indexOf('  var currentChildSessionId'));
  const controls: Record<string, { value: string; innerHTML: string }> = {
    'chat-effort': { value: 'HIGH', innerHTML: '' },
    'dispatch-effort': { value: 'HIGH', innerHTML: '' },
    'chat-head-select': { value: 'deepseek-dsh', innerHTML: '' },
    'dispatch-adapter': { value: 'claude-code', innerHTML: '' },
  };
  const roster = [
    { adapter_id: 'deepseek-dsh', effort_levels: ['DEFAULT'] },
    { adapter_id: 'claude-code', effort_levels: ['LOW', 'HIGH'] },
  ];
  new Function('document', 'snapshot', 'esc', fn + '; renderDynamicThinkingOptions("deepseek-v4-flash");')(
    { getElementById: (id: string) => controls[id] }, { roster }, (s: string) => s,
  );
  assert.match(controls['chat-effort'].innerHTML, /value="DEFAULT"/);
  assert.doesNotMatch(controls['chat-effort'].innerHTML, /value="HIGH"/);
  assert.match(controls['dispatch-effort'].innerHTML, /value="HIGH"/);
});

test('restored chat turns keep failure state and a retry bound to the original dispatch', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(renderBoardPage())![1];
  const fn = script.slice(script.indexOf('  function appendChatRow('), script.indexOf('  // 头犬动作卡：'));
  const retried: string[] = [];
  const row = { className: '', innerHTML: '', classList: { add() {} } };
  new Function('document', 'chatClearEmpty', 'fmtTime', 'dogLogo', 'chatPending', 'renderChatBubbleFromTurn', 'renderChatBubbleContent', 'esc', 'chatStreamEl', 'chatTurnCount', 'chatScrollBottom', 'attachRetry', 'statusLabel',
    'var chatLastMessage="";' + fn + '; appendChatRow("head","failed",null,"dispatch-1",{status:"FAIL"});')(
    { createElement: () => row }, () => {}, (s: string) => s, () => '', false, () => 'failed', () => 'failed', (s: string) => s,
    () => ({ appendChild() {} }), 0, () => {}, (_row: unknown, id: string) => retried.push(id), (s: string) => s,
  );
  assert.deepEqual(retried, ['dispatch-1']);
  assert.match(row.innerHTML, /FAIL/);
});

test('approved replay takes over a waiting chat frame before its animation finishes', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(renderBoardPage())![1];
  const fn = script.slice(script.indexOf('  function chatHandleFrame('), script.indexOf('  /* ---------- GOAL-075 切片3：派发计划卡'));
  const state = new Function(`
    var chatWorkspace='A', chatSessionId='session', chatInflightId='waiting', chatPending=true;
    var chatStreamFinal={status:'BLOCKED_WAITING_OWNER'}, thinkingRow=null, chatStreamRow=null;
    function chatFinalizeReport() { chatInflightId=null; chatPending=false; }
    function setChatPending(value) { chatPending=value; }
    function showThinking() {}
    function chatSetStage() {}
    ${fn}
    chatHandleFrame({kind:'chat',phase:'ADMITTED',session_id:'session',dispatch_id:'approved',workspace_root:'A',payload:{rerun_of:'waiting'}});
    return {id:chatInflightId,pending:chatPending};
  `)();
  assert.deepEqual(state, { id: 'approved', pending: true });
});

test('workspace switching clears previous UI state and restores only the target session', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(renderBoardPage())![1];
  const fn = script.slice(script.indexOf('  function applyChatWorkspace('), script.indexOf('  function chatStreamEl('));
  const state = new Function(`
    var chatWorkspace='A', chatSessionId='session-a', trackedDispatches=[{dispatch_id:'old'}], detailCache={old:1}, chatLastMessage='old';
    var input={value:'draft'}, pendingAttachments=[1];
    var document={getElementById:()=>input};
    function chatStorageKey(name) { return name+':'+chatWorkspace; }
    var localStorage={getItem:key=>key==='session:B'?'session-b':null};
    function renderAttachmentPreviews() {}
    function switchChatSession(id) { chatSessionId=id; }
    ${fn}
    applyChatWorkspace('B');
    return {session:chatSessionId,dispatches:trackedDispatches,draft:input.value,attachments:pendingAttachments};
  `)();
  assert.deepEqual(state, { session: 'session-b', dispatches: [], draft: '', attachments: [] });
});

test('directory tree does not replace typed paths or accept an older navigation response', async () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(renderBoardPage())![1];
  const fn = script.slice(script.indexOf("  var currentWsTreePath = ''"), script.indexOf('  function openWorkspaceTreeDialog('));
  const state = await new Function(`return (async () => {
    const input={value:'A'}, container={innerHTML:'',querySelectorAll:()=>[]};
    const document={getElementById:id=>id==='ws-tree-path-input'?input:id==='ws-dir-list-container'?container:null};
    const resolvers=[];
    function getJson() { return new Promise(resolve=>resolvers.push(resolve)); }
    function esc(value) { return value; }
    ${fn}
    loadWorkspaceTreePath('A');
    input.value='B';
    resolvers[0]({ok:true,currentPath:'A',directories:[]});
    await Promise.resolve();
    const typed=input.value;
    loadWorkspaceTreePath('A');
    loadWorkspaceTreePath('B');
    resolvers[2]({ok:true,currentPath:'B',directories:[]});
    await Promise.resolve();
    resolvers[1]({ok:true,currentPath:'A',directories:[]});
    await Promise.resolve();
    return {typed,selected:currentWsTreeSelected};
  })();`)();
  assert.deepEqual(state, { typed: 'B', selected: 'B' });
});
