import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  REQUIRED_COMPLETION_FIELDS,
  buildScenarioCompletion,
  validateTaskPacket,
  type CompletionScenario,
} from '../src/core/pi-rpc-completion.ts';
import {
  agentSettled,
  messageEnd,
  messageUpdate,
  promptResponseFailure,
  promptResponseSuccess,
  runRpcSession,
  stateResponse,
  toolCallMessageEnd,
  type RpcChildScript,
  type RpcSessionOptions,
  type RpcSessionResult,
} from '../src/core/pi-rpc-session.ts';

// PS 源追溯（黄金参照，只读）：
//   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-rpc.tests.ps1 L283-L504
//   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1 L160-L520
//   D:\意向项目\.agent-bridge\tools\tests\fake-pi-rpc-agent.ps1 L111-L239

const FIXTURE_ROOT = path.resolve(process.cwd(), '.test-fixtures', 'pi-rpc');
const ALLOWED_PATH = path.join(FIXTURE_ROOT, 'allowed-read-only.txt');
const EVIDENCE_PATH = path.join(FIXTURE_ROOT, 'expected-evidence.json');
const DISPATCH_PATH = path.join(FIXTURE_ROOT, 'dispatch-packet.json');
const GOAL_PATH = path.join(FIXTURE_ROOT, 'goal-packet.json');

let taskPacket: Record<string, unknown>;
let promptContent: string;

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

before(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(ALLOWED_PATH, 'read-only fixture', 'utf8');
  writeFileSync(EVIDENCE_PATH, '{"verdict":"PASS"}', 'utf8');
  const allowedHash = sha256File(ALLOWED_PATH);
  const evidenceHash = sha256File(EVIDENCE_PATH);
  taskPacket = {
    schema_version: 1,
    packet_type: 'managed_pi_task',
    objective: 'Review the frozen G-1 projection and return one completion object.',
    allowed_paths_and_hashes: [
      { path: ALLOWED_PATH, sha256: allowedHash },
      { path: EVIDENCE_PATH, sha256: evidenceHash },
    ],
    allowed_operations: ['read'],
    required_evidence: [{ path: EVIDENCE_PATH, sha256: evidenceHash }],
    required_completion_fields: [...REQUIRED_COMPLETION_FIELDS],
    stop_conditions: ['scope growth', 'hash mismatch', 'missing evidence'],
  };
  promptContent = JSON.stringify(taskPacket);
  writeFileSync(DISPATCH_PATH, promptContent, 'utf8');
  writeFileSync(
    GOAL_PATH,
    JSON.stringify({ goal_id: 'RM065-GOAL-010', run_id: 'pi-fixture-run', binding: 'goal' }),
    'utf8',
  );
});

const FAST_TIMEOUTS = {
  handshakeTimeoutMs: 60,
  settleTimeoutMs: 60,
  exitTimeoutMs: 200,
  processTimeoutMs: 200,
};

function sessionOptions(script: RpcChildScript, overrides: Partial<RpcSessionOptions> = {}): RpcSessionOptions {
  return {
    expectedProvider: 'deepseek',
    expectedModelId: 'deepseek-v4-pro',
    promptContent,
    dispatchPacketPath: DISPATCH_PATH,
    goalPacketPath: GOAL_PATH,
    runRoot: FIXTURE_ROOT,
    maxNonTerminalTurns: 8,
    ...FAST_TIMEOUTS,
    childScript: script,
    ...overrides,
  };
}

/** 按 fake-pi-rpc-agent.ps1 L139-L239 重放各 CompletionScenario 的 stdout 行。 */
function scenarioScript(scenario: CompletionScenario): RpcChildScript {
  return async function* (api) {
    const completion = buildScenarioCompletion(taskPacket, scenario);
    if (scenario === 'stale-before-prompt') {
      yield stateResponse(api.stateCommandId);
      yield messageEnd({ role: 'assistant', completion });
      yield promptResponseSuccess(api.promptCommandId);
      yield agentSettled();
      return;
    }
    yield stateResponse(api.stateCommandId);
    yield promptResponseSuccess(api.promptCommandId);
    switch (scenario) {
      case 'settle-only':
        yield agentSettled();
        return;
      case 'terminal-text-only':
        yield 'DONE: terminal text is not a completion object';
        yield agentSettled();
        return;
      case 'tool-call-then-completion':
        yield toolCallMessageEnd();
        yield messageEnd({ completion });
        yield agentSettled();
        return;
      case 'tool-call-then-settle':
        yield toolCallMessageEnd();
        yield agentSettled();
        return;
      case 'tool-budget-exceeded':
        for (let turn = 0; turn < 12; turn += 1) yield toolCallMessageEnd();
        yield messageEnd({ completion });
        yield agentSettled();
        return;
      case 'fenced-json':
        yield messageEnd({ completion, fenced: true });
        yield agentSettled();
        return;
      case 'fenced-json-incomplete':
        yield messageEnd({ completion, fencedIncomplete: true });
        yield agentSettled();
        return;
      case 'non-assistant':
        yield messageEnd({ role: 'user', completion });
        yield agentSettled();
        return;
      case 'user-then-assistant':
        yield messageEnd({ role: 'user', completion });
        yield messageEnd({ completion });
        yield agentSettled();
        return;
      case 'two-message':
        yield messageEnd({ completion });
        yield messageEnd({ completion });
        yield agentSettled();
        return;
      case 'post-completion-extra-message':
        yield messageEnd({ completion });
        yield messageUpdate();
        yield agentSettled();
        return;
      default:
        yield messageEnd({ completion });
        yield agentSettled();
        return;
    }
  };
}

// PS L438-L445 的 19 个 fail-closed 场景（逐一对应 wrapper 的精确 reason）。
const INVALID_SCENARIOS: Array<{ scenario: CompletionScenario; reason: string }> = [
  { scenario: 'settle-only', reason: 'completion-missing-before-settle' },
  { scenario: 'missing-fields', reason: 'completion-missing-field-next_step' },
  { scenario: 'empty-evidence', reason: 'completion-evidence-coverage-mismatch' },
  { scenario: 'missing-evidence-path', reason: 'completion-evidence-shape-invalid' },
  { scenario: 'missing-evidence-sha256', reason: 'completion-evidence-shape-invalid' },
  { scenario: 'malformed-evidence-hash', reason: 'completion-evidence-shape-invalid' },
  // PS wrapper L441-L450 判定顺序：先比 evidence 数量，再逐项查重/比对期望集。
  { scenario: 'duplicate-evidence', reason: 'completion-evidence-coverage-mismatch' },
  { scenario: 'unexpected-evidence', reason: 'completion-evidence-coverage-mismatch' },
  { scenario: 'fabricated-evidence', reason: 'completion-evidence-unexpected' },
  { scenario: 'wrong-hash', reason: 'completion-evidence-unexpected' },
  { scenario: 'out-of-scope', reason: 'completion-out-of-scope-path' },
  { scenario: 'in-scope-nonempty', reason: 'completion-read-only-changed-paths' },
  { scenario: 'terminal-text-only', reason: 'completion-missing-before-settle' },
  { scenario: 'stale-before-prompt', reason: 'completion-before-prompt' },
  { scenario: 'two-message', reason: 'completion-extra-message' },
  { scenario: 'non-assistant', reason: 'completion-missing-before-settle' },
  { scenario: 'tool-call-then-settle', reason: 'completion-missing-before-settle' },
  { scenario: 'post-completion-extra-message', reason: 'completion-extra-message-update' },
];

test('managed task packet contract: versioned, typed, bounded, read-allowed (PS L193-L201, L354-L360)', () => {
  assert.equal(validateTaskPacket(taskPacket), null);
  assert.throws(
    () => {
      const reason = validateTaskPacket({ ...taskPacket, packet_type: 'other' });
      if (reason !== null) throw new Error(reason);
    },
    /completion-task-packet-invalid/,
  );
  assert.throws(
    () => {
      const reason = validateTaskPacket({ ...taskPacket, allowed_operations: ['write'] });
      if (reason !== null) throw new Error(reason);
    },
    /completion-task-packet-invalid/,
  );
});

test('happy path: stdin open through settle, event-after-settle, exact dispatch-packet prompt (PS L321-L364)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId);
      yield promptResponseSuccess(api.promptCommandId);
      yield messageEnd({ completion: buildScenarioCompletion(taskPacket, 'valid') });
      yield agentSettled();
    }),
  );

  assert.equal(result.exitCode, 0, `happy path must exit 0: ${result.stderrLines.join(' ')}`);
  assert.ok(result.event !== null, 'happy path must emit a signed review_ready event');
  const event = result.event as NonNullable<RpcSessionResult['event']>;
  assert.equal(event.event_type, 'review_ready');
  assert.equal(event.actor_role, 'backend_executor');
  assert.equal(event.provider, 'deepseek');
  assert.equal(event.model_id, 'deepseek-v4-pro');
  assert.notEqual(event.signature, '0'.repeat(64), 'event signature must not be empty/unsigned');
  assert.equal(result.settleStarted, true, 'review_ready must be emitted only after agent_settled');
  assert.equal(result.stdinWasOpenAtSettle, true, 'stdin must remain open until agent_settled');
  assert.equal(result.deliveredPrompt, promptContent, 'Pi prompt must be the exact task packet UTF-8 content');

  for (const field of REQUIRED_COMPLETION_FIELDS) {
    assert.ok(field in event, `validated event is missing completion field '${field}'`);
  }

  const deliveredTask = JSON.parse(result.deliveredPrompt as string) as Record<string, unknown>;
  assert.equal(deliveredTask.schema_version, 1);
  assert.equal(deliveredTask.packet_type, 'managed_pi_task');
  assert.equal(typeof deliveredTask.objective, 'string');
  assert.ok((deliveredTask.objective as string).trim().length > 0);
  assert.ok(Array.isArray(deliveredTask.allowed_paths_and_hashes));
  assert.ok((deliveredTask.allowed_paths_and_hashes as unknown[]).length >= 1);
  assert.ok(Array.isArray(deliveredTask.allowed_operations));
  assert.ok((deliveredTask.allowed_operations as string[]).includes('read'));
  assert.ok(Array.isArray(deliveredTask.required_evidence));
  assert.ok((deliveredTask.required_evidence as unknown[]).length >= 1);
  assert.ok(Array.isArray(deliveredTask.stop_conditions));
  assert.ok((deliveredTask.stop_conditions as unknown[]).length >= 1);
});

test('message_end(user) is ignored before exactly one valid assistant completion (PS L366-L380)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId);
      yield promptResponseSuccess(api.promptCommandId);
      yield messageEnd({ role: 'user', completion: buildScenarioCompletion(taskPacket, 'valid') });
      yield messageEnd({ completion: buildScenarioCompletion(taskPacket, 'valid') });
      yield agentSettled();
    }),
  );
  assert.equal(result.exitCode, 0, `stderr=${result.stderrLines.join(' ')}`);
  assert.ok(result.event !== null, 'user-then-assistant must still emit review_ready');
});

test('intermediate assistant tool-call turn is ignored before the final completion (PS L382-L397)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId);
      yield promptResponseSuccess(api.promptCommandId);
      yield toolCallMessageEnd();
      yield messageEnd({ completion: buildScenarioCompletion(taskPacket, 'valid') });
      yield agentSettled();
    }),
  );
  assert.equal(result.exitCode, 0, `stderr=${result.stderrLines.join(' ')}`);
  assert.ok(result.event !== null, 'tool-call-then-completion must still emit review_ready');
});

test('hard non-terminal turn budget fails closed before the completion arrives (PS L399-L411)', async () => {
  const result = await runRpcSession(sessionOptions(scenarioScript('tool-budget-exceeded')));
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'completion-tool-budget-exceeded');
  assert.equal(result.event, null, 'runaway tool-call exploration must emit no signed event');
});

test('complete outer json fence is stripped and the inner completion validated (PS L413-L427)', async () => {
  const result = await runRpcSession(sessionOptions(scenarioScript('fenced-json')));
  assert.equal(result.exitCode, 0, `stderr=${result.stderrLines.join(' ')}`);
  assert.ok(result.event !== null, 'fenced-json must emit review_ready');
});

test('incomplete fence fails closed through the unchanged strict parser (PS L429-L436)', async () => {
  const result = await runRpcSession(sessionOptions(scenarioScript('fenced-json-incomplete')));
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'completion-missing-before-settle');
  assert.equal(result.event, null);
});

test('skip-settle: no event before agent_settled, bounded settle timeout, whole-tree cleanup (PS L447-L455)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId);
      yield promptResponseSuccess(api.promptCommandId);
      await new Promise<never>(() => {
        // 子进程保持存活、不再产出任何行（SkipSettle 行为）。
      });
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'agent-settle-timeout');
  assert.equal(result.event, null);
  assert.equal(result.childKilled, true, 'settle timeout must leave no surviving child process');
});

test('hung agent fails closed with state-handshake-timeout and no event (PS L457-L465)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* () {
      await new Promise<never>(() => {
        // HangBeforeState：不响应 get_state。
      });
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'state-handshake-timeout');
  assert.equal(result.event, null);
  assert.equal(result.childKilled, true, 'hung-agent timeout must leave no surviving child process');
});

test('wrong runtime model fails closed before any event (PS L467-L473)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId, { modelId: 'gpt-4o' });
      yield promptResponseSuccess(api.promptCommandId);
      yield agentSettled();
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'wrong-runtime-model');
  assert.equal(result.event, null);
});

test('conflated goal/dispatch packet binding is rejected (PS L491-L497)', async () => {
  const result = await runRpcSession(
    sessionOptions(
      async function* () {
        yield agentSettled();
      },
      { dispatchPacketPath: GOAL_PATH },
    ),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'distinct');
  assert.equal(result.event, null);
});

test('prompt error fails closed with no event (PS L483-L489)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId);
      yield promptResponseFailure(api.promptCommandId);
      yield agentSettled();
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'prompt-error');
  assert.equal(result.event, null);
});

test('missing prompt response fails closed with no event (PS L475-L481)', async () => {
  const result = await runRpcSession(
    sessionOptions(async function* (api) {
      yield stateResponse(api.stateCommandId);
      // SkipPromptResponse：状态确认后子进程 EOF，不再应答 prompt。
    }),
  );
  assert.equal(result.exitCode, 63);
  assert.equal(result.failClosedReason, 'missing-prompt-response');
  assert.equal(result.event, null);
});

test('stdout audit file is write-only and never read as input (PS L499-L504)', async () => {
  let tampered = false;
  const result = await runRpcSession(
    sessionOptions(
      async function* (api) {
        yield stateResponse(api.stateCommandId);
        yield promptResponseSuccess(api.promptCommandId);
        yield messageEnd({ completion: buildScenarioCompletion(taskPacket, 'valid') });
        yield agentSettled();
      },
      {
        auditHook: (auditLines) => {
          if (!tampered && auditLines.length >= 1) {
            tampered = true;
            auditLines.push('{"tampered":true}');
          }
        },
      },
    ),
  );
  assert.equal(result.exitCode, 0, `stderr=${result.stderrLines.join(' ')}`);
  assert.ok(result.event !== null, 'audit tampering must not affect the state machine');
  assert.ok(result.auditLines.includes('{"tampered":true}'), 'tampered audit line must be recorded as write-only mirror');
});

for (const { scenario, reason } of INVALID_SCENARIOS) {
  test(`completion scenario '${scenario}' fails closed with no event (PS L438-L445)`, async () => {
    const result = await runRpcSession(sessionOptions(scenarioScript(scenario)));
    assert.equal(result.exitCode, 63, `scenario ${scenario} must fail closed`);
    assert.equal(result.failClosedReason, reason, `scenario ${scenario} exact reason`);
    assert.equal(result.event, null, `scenario ${scenario} must emit no signed event`);
  });
}
