/** GOAL-085 第三阶段维护片：Claude 兼容检查回归——注入 fake spawn/spawnSync，
 *  覆盖检查失败、超时、身份不符、失败终局、资源限制变化；无需真实 CLI。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCompatCheck, parseCompatArgs, type CompatSpawn, type CompatSpawnSync } from '../src/claude-compat-check.ts';

function tempRoot(tag: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `g085-compat-${tag}-`));
}

/** 合成原生流：system/init + 助手文本（JSON 答案）+ result 终局。 */
function okStream(model: string, tools: string[], mcpServers: unknown[], answer: unknown): string {
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', model, tools, mcp_servers: mcpServers, permissionMode: 'dontAsk' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify(answer) }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(answer) }),
  ];
  return lines.join('\n') + '\n';
}

/** fake spawn 描述：每个场景的 stdout / exit / 延迟 / tool_results 回执。 */
interface FakeChild {
  stdout: string;
  stderr: string;
  code: number;
  hangMs?: number;
  sideEffect?: () => void;
  toolResults?: Array<{ id: string; error?: boolean; text?: string }>;
}

type SpawnCalls = Array<{ file: string; args: string[] }>;

const ALL_FORCED_REFUSED = [
  { id: 'tool_read', error: true, text: 'Error: No such tool available: Read' },
  { id: 'tool_write', error: true, text: 'Error: No such tool available: Write' },
  { id: 'tool_bash', error: true, text: 'Error: No such tool available: Bash' },
  { id: 'tool_task', error: true, text: 'Error: No such tool available: Task' },
  { id: 'tool_workflow', error: true, text: 'Error: No such tool available: Workflow' },
  { id: 'tool_cron', error: true, text: 'Error: No such tool available: CronCreate' },
];

function fakeSpawnFactory(children: FakeChild[], calls: SpawnCalls): { spawnImpl: CompatSpawn; spawnSyncImpl: CompatSpawnSync } {
  const spawnImpl = ((file: string, args: string[], _opts?: unknown) => {
    calls.push({ file, args: [...args] });
    // --version 探测：返回固定新版本文本。
    if (args.includes('--version')) {
      return {
        stdout: '2.1.292 (Claude Code)', stderr: '', status: 0,
      } as unknown as string;
    }
    const child = children.shift() ?? { stdout: '{}', stderr: '', code: 0 };
    if (child.sideEffect) child.sideEffect();
    // 模拟 CLI 请求行为：无 --safe-mode（基线对照）时读取工作区 CLAUDE.md 放入请求；
    // 受控参数下不注入（与真实 CLI 行为同构，供假后端记录 context canary）。
    const optsAny = _opts as { env?: Record<string, string>; cwd?: string } | undefined;
    const baseUrl = optsAny?.env?.ANTHROPIC_BASE_URL ?? 'http://127.0.0.1:1';
    const strictArgs = args.includes('--safe-mode');
    const canary = (!strictArgs && optsAny?.cwd !== undefined && existsSync(path.join(optsAny.cwd, 'CLAUDE.md')))
      ? readFileSync(path.join(optsAny.cwd, 'CLAUDE.md'), 'utf8')
      : '';

    let effectiveCode = child.code;
    let effectiveStderr = child.stderr;
    let effectiveStdout = child.stdout;
    let closeCb: ((code: number) => void) | null = null;
    let hangTimer: NodeJS.Timeout | null = null;
    let isClosed = false;

    const triggerClose = (): void => {
      if (isClosed) return;
      isClosed = true;
      if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }
      if (closeCb) {
        const cb = closeCb;
        closeCb = null;
        cb(effectiveCode);
      }
    };

    const simulateRequests = async (): Promise<void> => {
      const res1 = await fetch(baseUrl + '/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, messages: [{ role: 'user', content: canary }] }),
      }).catch(() => undefined);
      if (res1 && res1.status >= 400 && child.code === 0) {
        effectiveCode = 1;
        effectiveStdout = '';
        effectiveStderr = await res1.text().catch(() => 'backend error');
        return;
      }
      if (child.toolResults !== undefined) {
        const res2 = await fetch(baseUrl + '/v1/messages', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-5', stream: true,
            messages: [{
              role: 'user',
              content: child.toolResults.map(t => ({
                type: 'tool_result',
                tool_use_id: t.id,
                is_error: t.error !== false,
                content: t.text ?? `<tool_use_error>Error: No such tool available: ${t.id}. ${t.id} is disabled for this session.</tool_use_error>`,
              })),
            }],
          }),
        }).catch(() => undefined);
        if (res2 && res2.status >= 400 && child.code === 0) {
          effectiveCode = 1;
          effectiveStdout = '';
          effectiveStderr = await res2.text().catch(() => 'backend error');
          return;
        }
      }
    };

    const requestDone = simulateRequests();

    return {
      stdout: {
        on: (event: string, cb: (c: string) => void) => {
          if (event === 'data') {
            void requestDone.then(() => {
              if (effectiveStdout !== '') cb(effectiveStdout);
            });
          }
        },
      },
      stderr: {
        on: (event: string, cb: (c: string) => void) => {
          if (event === 'data') {
            void requestDone.then(() => {
              if (effectiveStderr !== '') cb(effectiveStderr);
            });
          }
        },
      },
      stdin: { end: () => {} },
      kill: () => { triggerClose(); },
      on: (event: string, cb: (value?: unknown) => void) => {
        if (event === 'close') {
          closeCb = cb;
          void requestDone.then(() => {
            if (child.hangMs !== undefined) {
              hangTimer = setTimeout(triggerClose, child.hangMs);
            } else {
              setTimeout(triggerClose, 0);
            }
          });
        }
      },
    } as unknown as CompatSpawn;
  }) as unknown as CompatSpawn;
  const spawnSyncImpl = ((file: string, args: string[], _opts?: unknown) => {
    calls.push({ file, args: [...args] });
    if (args.includes('--version')) return { status: 0, stdout: '2.1.292 (Claude Code)', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  }) as unknown as CompatSpawnSync;
  return { spawnImpl, spawnSyncImpl };
}
function nodeSpawnShim(): void { /* 仅类型锚点 */ }

const NORMAL_STREAM = (tools: string[], mcp: unknown[]): string => okStream('claude-sonnet-5', tools, mcp, { body: 'COMPAT_SCHEMA_OK', stance: 'support' });

test('兼容检查：基线行为全部符合 → overall PASS、exit 0、证据落盘', async () => {
  const root = tempRoot('pass');
  const calls: SpawnCalls = [];
  // 场景顺序：strict-tools / strict-context / baseline-context / dummy-mcp / error-terminal。
  // error-terminal 场景：CLI 因后端 500 非零退出、无答案。
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read', 'Skill'], []), code: 0 , stderr: '' },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, calls);
  const outDir = path.join(root, 'out');
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: outDir, timeoutMs: 5000, maxTurns: 5, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'PASS', JSON.stringify(result.checks, null, 1));
  assert.equal(result.exit_code, 0);
  assert.equal(result.version_used, '2.1.292');
  assert.ok(existsSync(result.evidence_path), '证据落盘');
  const evidence = JSON.parse(readFileSync(result.evidence_path, 'utf8')) as Record<string, unknown>;
  assert.equal(evidence.schema, 'mush.claude-compat-check');
  assert.match(String(evidence.disclaimer), /不自动升级任何隔离证据/);
  // --version 探测进 spawn 调用（隔离 env）。
  assert.ok(calls.some(c => c.args.includes('--version')));
});

test('兼容检查：身份不符（期望 2.1.290、实际 2.1.292）→ FAIL、非零退出', async () => {
  const root = tempRoot('identity');
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.290', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  assert.equal(result.exit_code === 0, false);
  const versionCheck = result.checks.find(c => c.id === 'version-match') as Record<string, unknown>;
  assert.equal(versionCheck.verdict, 'FAIL');
  assert.match(JSON.stringify(versionCheck.differences), /2\.1\.292 ≠ expected 2\.1\.290/);
});

test('兼容检查：资源限制变化（Write 落盘成功）→ forced-resources-refused FAIL', async () => {
  const root = tempRoot('resource-drift');
  const probePath = path.join(root, 'out', 'strict-tools', 'workspace', 'probe-write.txt');
  mkdirSync(path.dirname(probePath), { recursive: true });
  // fake spawn 在 strict-tools 场景执行时真实创建写探针文件——模拟资源限制被突破。
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED, sideEffect: () => { writeFileSync(probePath, 'SYNTHETIC'); } },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const resourceCheck = result.checks.find(c => c.id === 'forced-resources-refused') as Record<string, unknown>;
  assert.equal(resourceCheck.verdict, 'FAIL');
  assert.match(JSON.stringify(resourceCheck.details), /write_created.*true/);
});

test('兼容检查：schema 答案漂移 → schema-answer FAIL', async () => {
  const root = tempRoot('schema-drift');
  const children: FakeChild[] = [
    { stdout: okStream('claude-sonnet-5', ['StructuredOutput'], [], { body: 'DRIFTED_ANSWER', stance: 'oppose' }), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const schemaCheck = result.checks.find(c => c.id === 'schema-answer') as Record<string, unknown>;
  assert.equal(schemaCheck.verdict, 'FAIL');
  assert.match(JSON.stringify(schemaCheck.details), /DRIFTED_ANSWER/);
});

test('兼容检查：失败终局（后端 500、CLI 非零退出）→ 答案必须为空、该项 PASS', async () => {
  const root = tempRoot('failure-terminal');
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  const failureCheck = result.checks.find(c => c.id === 'failure-terminal-no-answer') as Record<string, unknown>;
  assert.equal(failureCheck.verdict, 'PASS', JSON.stringify(failureCheck));
});

test('兼容检查：场景超时 → 该场景检查 UNKNOWN、整体 FAIL 非零退出', async () => {
  const root = tempRoot('timeout');
  // strict-tools 场景挂起（hangMs 超过 timeoutMs）。
  const children: FakeChild[] = [
    { stdout: '', stderr: '', code: 0, hangMs: 3000 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 150, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  assert.equal(result.exit_code === 0, false);
  const unknownChecks = result.checks.filter(c => c.verdict === 'UNKNOWN') as Array<Record<string, unknown>>;
  assert.ok(unknownChecks.length > 0, '超时场景的检查应转为 UNKNOWN');
  assert.match(JSON.stringify(unknownChecks), /覆盖限制|UNKNOWN|UNKNOWN|UNKNOWN/);
});

test('兼容检查：CLI 缺失（--version 探测失败）→ version-probe FAIL、整体 FAIL', async () => {
  const root = tempRoot('no-cli');
  const spawnImpl = ((_file: string, args: string[], _opts?: unknown) => {
    if (args.includes('--version')) throw new Error('claude CLI not found');
    throw new Error('should not reach here');
  }) as unknown as CompatSpawn;
  const spawnSyncImpl = ((_file: string, args: string[], _opts?: unknown) => {
    if (args.includes('--version')) return { status: 1, stdout: '', stderr: 'command not found' };
    return { status: 1, stdout: '', stderr: '' };
  }) as unknown as CompatSpawnSync;
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const probe = result.checks.find(c => c.id === 'version-probe') as Record<string, unknown>;
  assert.equal(probe.verdict, 'FAIL');
  assert.equal(result.version_used, 'UNKNOWN');
});

test('兼容检查负向：强制工具未返回拒绝证据（缺证）→ forced-resources-refused UNKNOWN、overall FAIL', async () => {
  const root = tempRoot('refused-missing');
  // strict-tools 中，fake spawn 未提供 toolResults（即 CLI 未返回任何工具回执）
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 }, // no toolResults!
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const forcedCheck = result.checks.find(c => c.id === 'forced-resources-refused') as Record<string, unknown>;
  assert.equal(forcedCheck.verdict, 'UNKNOWN', '缺证必须判 UNKNOWN，不能判 PASS');
  assert.match(JSON.stringify(forcedCheck.differences), /缺证不能判 PASS|未收到 CLI 请求/);
});

test('兼容检查负向：强制工具仅部分拒绝（缺少某些 ID 回执）→ forced-resources-refused UNKNOWN，overall FAIL', async () => {
  const root = tempRoot('refused-partial');
  // strict-tools 中，仅提供了 5 个工具回执，缺少 tool_cron
  const partialRefused = ALL_FORCED_REFUSED.filter(t => t.id !== 'tool_cron');
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: partialRefused },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const forcedCheck = result.checks.find(c => c.id === 'forced-resources-refused') as Record<string, unknown>;
  assert.equal(forcedCheck.verdict, 'UNKNOWN', '漏对账的工具必须判 UNKNOWN');
  assert.ok((forcedCheck.details as { missing_forced_ids: string[] }).missing_forced_ids.includes('tool_cron'));
});

test('兼容检查负向：强制工具被执行（CLI 返回未拒绝 tool_result）→ forced-resources-refused FAIL，overall FAIL', async () => {
  const root = tempRoot('refused-executed');
  // strict-tools 中，tool_bash 返回成功（is_error = false）
  const executedResults = ALL_FORCED_REFUSED.map(t => t.id === 'tool_bash' ? { id: t.id, error: false, text: 'MUSH_COMPAT_COMMAND' } : t);
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: executedResults },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: '', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const forcedCheck = result.checks.find(c => c.id === 'forced-resources-refused') as Record<string, unknown>;
  assert.equal(forcedCheck.verdict, 'FAIL', '发生执行必须判 FAIL');
  assert.equal((forcedCheck.details as { executed_count: number }).executed_count, 1);
});

test('兼容检查负向（R1）：工具执行后报错（通用错误非显式拒绝）→ forced-resources-refused FAIL', async () => {
  const root = tempRoot('r1-error-after-exec');
  // 6 个工具回执带有 error: true，但文本为执行后失败，而非显式拒绝
  const errorAfterExecutionResults = ALL_FORCED_REFUSED.map(t => ({
    id: t.id,
    error: true,
    text: 'Tool executed before a subsequent runtime failure',
  }));
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: errorAfterExecutionResults },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const forcedCheck = result.checks.find(c => c.id === 'forced-resources-refused') as Record<string, unknown>;
  assert.equal(forcedCheck.verdict, 'FAIL', '工具执行后报错不能被误判为 PASS');
  assert.equal((forcedCheck.details as { executed_count: number }).executed_count, 6);
  assert.match(JSON.stringify(forcedCheck.differences), /executed_results/);
});

test('兼容检查负向（R2）：顶层 task_started 事件 → 识别为任务事件并判 FAIL', async () => {
  const root = tempRoot('r2-task-type');
  // 在 strict-tools 中注入顶层 type: "task_started"
  const streamWithTask = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5', tools: ['StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' }),
    JSON.stringify({ type: 'task_started', task_id: 'task_subagent_synthetic_001' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({ body: 'COMPAT_SCHEMA_OK', stance: 'support' }) }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ body: 'COMPAT_SCHEMA_OK', stance: 'support' }) }),
  ].join('\n') + '\n';
  const children: FakeChild[] = [
    { stdout: streamWithTask, stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const forcedCheck = result.checks.find(c => c.id === 'forced-resources-refused') as Record<string, unknown>;
  assert.equal(forcedCheck.verdict, 'FAIL', '出现顶层任务事件必须判 FAIL');
  assert.ok(((forcedCheck.details as { task_events: string[] }).task_events).includes('task_started'));
  assert.match(JSON.stringify(forcedCheck.differences), /task_started/);
});

test('兼容检查负向（R3）：schema 枚举不符且有多余字段 → schema-answer FAIL', async () => {
  const root = tempRoot('r3-invalid-schema');
  // body 正确，但 stance 为 oppose (非法枚举)，且包含 extra: true 多余字段 (违反 additionalProperties: false)
  const invalidSchemaStream = okStream('claude-sonnet-5', ['StructuredOutput'], [], {
    body: 'COMPAT_SCHEMA_OK',
    stance: 'oppose',
    extra: true,
  });
  const children: FakeChild[] = [
    { stdout: invalidSchemaStream, stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const schemaCheck = result.checks.find(c => c.id === 'schema-answer') as Record<string, unknown>;
  assert.equal(schemaCheck.verdict, 'FAIL');
  assert.match(JSON.stringify(schemaCheck.differences), /stance/);
  assert.match(JSON.stringify(schemaCheck.differences), /additionalProperties/);
});

test('兼容检查负向（R4）：dummy-mcp 场景缺失 mcp_servers 原生证据 → dummy-mcp-isolated UNKNOWN', async () => {
  const root = tempRoot('r4-missing-mcp');
  // dummy-mcp 场景中，init 事件没有 mcp_servers 属性
  const streamWithoutMcpServers = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5', tools: ['StructuredOutput'], permissionMode: 'dontAsk' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({ body: 'COMPAT_SCHEMA_OK', stance: 'support' }) }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ body: 'COMPAT_SCHEMA_OK', stance: 'support' }) }),
  ].join('\n') + '\n';
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: streamWithoutMcpServers, stderr: '', code: 0 }, // dummy-mcp 场景缺失 init.mcp_servers
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({ expectedVersion: '2.1.292', outputDir: path.join(root, 'out'), timeoutMs: 5000, repo: process.cwd(), spawnImpl, spawnSyncImpl });
  assert.equal(result.overall, 'FAIL');
  const dummyCheck = result.checks.find(c => c.id === 'dummy-mcp-isolated') as Record<string, unknown>;
  assert.equal(dummyCheck.verdict, 'UNKNOWN', '缺失原生证据必须判 UNKNOWN，不能默认补空数组');
  assert.match(JSON.stringify(dummyCheck.differences), /缺少 init\.mcp_servers 原生证据/);
});

test('兼容检查控制（R5）：maxTurns 限制与参数校验 → 超限 400 截断且非法数值报错', async () => {
  // 1. 参数校验测试
  assert.throws(() => parseCompatArgs(['--output-dir', 'tmp', '--max-turns', '0']), /Invalid --max-turns/);
  assert.throws(() => parseCompatArgs(['--output-dir', 'tmp', '--max-turns', '-1']), /Invalid --max-turns/);
  assert.throws(() => parseCompatArgs(['--output-dir', 'tmp', '--max-turns', 'abc']), /Invalid --max-turns/);
  assert.throws(() => parseCompatArgs(['--output-dir', 'tmp', '--max-turns', '1.5']), /Invalid --max-turns/);
  assert.throws(() => parseCompatArgs(['--output-dir', 'tmp', '--timeout-ms', '0']), /Invalid --timeout-ms/);
  assert.throws(() => parseCompatArgs(['--output-dir', 'tmp', '--timeout-ms', '-10']), /Invalid --timeout-ms/);

  // 2. maxTurns=1 截断测试：strict-tools 第 2 轮请求被 400 拦截
  const root = tempRoot('r5-turn-limit');
  const children: FakeChild[] = [
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0, toolResults: ALL_FORCED_REFUSED },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['Bash', 'Read'], []), stderr: '', code: 0 },
    { stdout: NORMAL_STREAM(['StructuredOutput'], []), stderr: '', code: 0 },
    { stdout: '', stderr: 'synthetic backend failure', code: 1 },
  ];
  const { spawnImpl, spawnSyncImpl } = fakeSpawnFactory(children, []);
  const result = await runCompatCheck({
    expectedVersion: '2.1.292',
    outputDir: path.join(root, 'out'),
    timeoutMs: 5000,
    maxTurns: 1, // 仅允许 1 轮
    repo: process.cwd(),
    spawnImpl,
    spawnSyncImpl,
  });
  assert.equal(result.overall, 'FAIL');
  const paramsCheck = result.checks.find(c => c.id === 'params-accepted') as Record<string, unknown>;
  assert.equal(paramsCheck.verdict, 'FAIL');
});

test('兼容检查稳健性（R6）：spawn 抛出异常 → 资源在 finally 释放且进程迅速退出不挂起', async () => {
  const root = tempRoot('r6-spawn-error');
  const spawnImpl = ((_file: string, args: string[], _opts?: unknown) => {
    if (args.includes('--version')) return { stdout: '2.1.292 (Claude Code)', stderr: '', status: 0 } as any;
    throw new Error('EACCES: synthetic spawn permission denied');
  }) as unknown as CompatSpawn;
  const spawnSyncImpl = ((_file: string, args: string[]) => {
    return { status: 0, stdout: '2.1.292', stderr: '' };
  }) as unknown as CompatSpawnSync;

  const start = Date.now();
  const result = await runCompatCheck({
    expectedVersion: '2.1.292',
    outputDir: path.join(root, 'out'),
    timeoutMs: 5000,
    repo: process.cwd(),
    spawnImpl,
    spawnSyncImpl,
  });
  const elapsed = Date.now() - start;

  assert.equal(result.overall, 'FAIL');
  assert.equal(result.exit_code, 1);
  const paramsCheck = result.checks.find(c => c.id === 'params-accepted') as Record<string, unknown>;
  assert.equal(paramsCheck.verdict, 'FAIL');
  assert.match(JSON.stringify(paramsCheck.differences), /EACCES: synthetic spawn permission denied/);
  // finally 释放了 http server，所有 scene 立即捕获失败并返回，总耗时远低于 timeoutMs
  assert.ok(elapsed < 2000, `耗时过长 (${elapsed}ms)，可能存在未释放的句柄导致挂起`);
});


