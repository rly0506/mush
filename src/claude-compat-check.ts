/**
 * GOAL-085 第三阶段维护片：Claude 新版免费行为兼容检查（可重复运行入口）。
 *
 * 用途：harness 升级（如 2.1.290 → 2.1.292）后，用真实 Claude CLI＋本地假后端＋合成凭据＋
 * 隔离 HOME/配置/工作目录，核验讨论实际依赖的行为是否仍与既有基线一致。零模型调用
 * （假后端是 loopback 假 provider，不访问真实模型端点）、不继承真实认证、不触碰生产会话。
 *
 * 使用（版本、基线、输出目录显式指定）：
 *   node scripts/claude-compat-check.mjs --expected-version 2.1.292 \
 *     --output-dir .test-fixtures/g085-claude-compat-2026-10-07
 * 退出码：0 = 全部检查 PASS；1 = 存在 FAIL 或 UNKNOWN（含超时/身份不符/失败终局）。
 *
 * 每项检查输出 PASS/FAIL/UNKNOWN、验证对象、实际版本、配置关联、与 2.1.290 基线的
 * 差异及覆盖限制。整体 PASS **不**自动升级隔离证据，也不证明真实模型讨论质量。
 *
 * 回归：tests/g085-claude-compat-check.test.ts 通过注入 spawn/spawnSync 覆盖
 * 检查失败、超时、身份不符、失败终局、资源限制变化，无需真实 CLI。
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildContracts, DispatchPipeline } from './web/dispatch.ts';
import { buildClaudeDiscussionProfile, readClaudeDiscussionInputs } from './adapters/claude-discussion-profile.ts';
import { capabilityArgs } from './adapters/contract.ts';
import { resolveWindowsShim } from './adapters/t1-runner.ts';
import { parseClaudeStreamJson } from './adapters/claude.ts';
import { extractJsonObject } from './orchestration/collaboration-coordinator.ts';

export const FORCED_TOOL_CALLS = Object.freeze([
  { id: 'tool_read', name: 'Read' },
  { id: 'tool_write', name: 'Write' },
  { id: 'tool_bash', name: 'Bash' },
  { id: 'tool_task', name: 'Task' },
  { id: 'tool_workflow', name: 'Workflow' },
  { id: 'tool_cron', name: 'CronCreate' },
]);

/** 2.1.290 基线（来源 .test-fixtures/g085-claude-compat-2026-10-06/compatibility-report.json，sha256 14a94156…）。 */
const BASELINE_2_1_290 = Object.freeze({
  native_version: '2.1.290',
  forced_tools_refused: ['Read', 'Write', 'Bash', 'Task', 'Workflow', 'CronCreate'],
  output_schema: true,
  context_workspace_injected_strict: false,
  context_user_injected_strict: false,
  baseline_context_workspace_injected: true,
  strict_mcp_servers_loaded: false,
  side_effects: 'no synthetic write or task events',
  source: '.test-fixtures/g085-claude-compat-2026-10-06/compatibility-report.json',
});

const SCENES = ['strict-tools', 'strict-context', 'baseline-context', 'dummy-mcp', 'error-terminal'] as const;

export type CompatSpawn = typeof nodeSpawn;
export type CompatSpawnSync = typeof nodeSpawnSync;

export interface CompatCheckOptions {
  expectedVersion?: string;
  outputDir: string;
  timeoutMs?: number;
  maxTurns?: number;
  repo?: string;
  spawnImpl?: CompatSpawn;
  spawnSyncImpl?: CompatSpawnSync;
  log?: (line: string) => void;
}

export interface CompatCheckResult {
  overall: 'PASS' | 'FAIL';
  exit_code: number;
  version_used: string;
  expected_version: string | null;
  output_dir: string;
  checks: Array<Record<string, unknown>>;
  evidence_path: string;
}

function envFor(root: string, port: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT', 'SystemDrive'])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  for (const dir of ['home', 'config', 'temp', 'localappdata', 'appdata']) mkdirSync(`${root}/${dir}`, { recursive: true });
  return {
    ...env, HOME: `${root}/home`, USERPROFILE: `${root}/home`, CLAUDE_CONFIG_DIR: `${root}/config`,
    TEMP: `${root}/temp`, TMP: `${root}/temp`, LOCALAPPDATA: `${root}/localappdata`, APPDATA: `${root}/appdata`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_API_KEY: 'sk-ant-synthetic-compat-only', ANTHROPIC_AUTH_TOKEN: 'sk-ant-synthetic-compat-only',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

function sse(calls: Array<{ id: string; name: string; input: unknown }>, answer: unknown): string {
  const events: Array<Record<string, unknown>> = [{ type: 'message_start', message: { id: `msg_local_${randomUUID()}`, type: 'message', role: 'assistant', model: 'claude-fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }];
  if (calls.length) calls.forEach((call, index) => events.push(
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } },
    { type: 'content_block_stop', index }));
  else events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(answer) } }, { type: 'content_block_stop', index: 0 });
  events.push({ type: 'message_delta', delta: { stop_reason: calls.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** 明确拒绝识别：必须含禁用/不支持等回执，且不得包含执行后失败或已执行指标。 */
export function isExplicitToolRefusal(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasRefusalKeywords = /no such tool|disabled for this session|tool is disabled|tool.*is not allowed|permission denied/i.test(lower);
  const hasExecutionIndicator = /tool executed|after execution|runtime failure|command failed with exit code/i.test(lower);
  return hasRefusalKeywords && !hasExecutionIndicator;
}

/** 完整 schema 校验：校验必填字段、枚举以及 additionalProperties: false。 */
export function validateOutputSchema(answer: unknown): { ok: boolean; errors: string[] } {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    return { ok: false, errors: ['答案不是 JSON 对象'] };
  }
  const obj = answer as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof obj.body !== 'string' || obj.body !== 'COMPAT_SCHEMA_OK') {
    errors.push(`body 期望 "COMPAT_SCHEMA_OK", 实测 ${JSON.stringify(obj.body)}`);
  }
  if (obj.stance !== 'support') {
    errors.push(`stance 期望 "support" (enum), 实测 ${JSON.stringify(obj.stance)}`);
  }
  const allowedKeys = new Set(['body', 'stance']);
  const extraKeys = Object.keys(obj).filter(k => !allowedKeys.has(k));
  if (extraKeys.length > 0) {
    errors.push(`存在未定义多余字段 (additionalProperties: false): [${extraKeys.join(', ')}]`);
  }
  return { ok: errors.length === 0, errors };
}

/** 各场景的假后端行为：返回 (turn, body) 对应的 HTTP 响应。根据 maxTurns 限制轮次。
 * 轮次与重试口径：以当前场景接收到的 HTTP POST /messages 计数作为轮次（turn，从 0 开始计数）。
 * 每个请求按顺序独立记账；当 turn >= maxTurns 时立即返回 400 invalid_request_error 阻断，落实轮次上限。
 */
function backendRespond(scene: string, turn: number, maxTurns: number, body: { stream?: boolean }, answer: unknown, forced: Array<{ id: string; name: string; input: unknown }>): { status: number; contentType: string; payload: string } | null {
  if (turn >= maxTurns) {
    return { status: 400, contentType: 'application/json', payload: JSON.stringify({ error: { type: 'invalid_request_error', message: `scenario call bound exceeded: turn ${turn} >= maxTurns ${maxTurns}` } }) };
  }
  const calls = scene === 'strict-tools' && turn === 0 ? forced : scene === 'strict-tools' && turn === 1 ? [{ id: 'tool_schema', name: 'StructuredOutput', input: answer }] : [];
  if (scene === 'error-terminal') return { status: 500, contentType: 'application/json', payload: '{"error":{"type":"api_error","message":"synthetic backend failure for terminal check"}}' };
  if (body.stream === false) return { status: 200, contentType: 'application/json', payload: JSON.stringify({ id: 'msg_local', type: 'message', role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }) };
  return { status: 200, contentType: 'text/event-stream', payload: sse(calls, answer) };
}

async function runScene(scene: string, opts: Required<Pick<CompatCheckOptions, 'timeoutMs' | 'maxTurns' | 'repo'>> & CompatCheckOptions, out: string, executable: string, prefix: string[]): Promise<Record<string, unknown>> {
  const { spawnImpl = nodeSpawn } = opts;
  const dir = `${out}/${scene}`;
  const workspace = `${dir}/workspace`;
  mkdirSync(workspace, { recursive: true });
  const localEnv = envFor(dir, 1);
  const workspaceCanary = `MUSH_WORKSPACE_${randomUUID()}`;
  const userCanary = `MUSH_USER_${randomUUID()}`;
  writeFileSync(`${workspace}/CLAUDE.md`, `${workspaceCanary}\n`);
  writeFileSync(`${dir}/config/CLAUDE.md`, `${userCanary}\n`);
  writeFileSync(`${workspace}/probe-read.txt`, 'SYNTHETIC_READ_TARGET\n');
  const forced = [
    { id: 'tool_read', name: 'Read', input: { file_path: `${workspace}/probe-read.txt` } },
    { id: 'tool_write', name: 'Write', input: { file_path: `${workspace}/probe-write.txt`, content: 'SYNTHETIC' } },
    { id: 'tool_bash', name: 'Bash', input: { command: 'echo MUSH_COMPAT_COMMAND' } },
    { id: 'tool_task', name: 'Task', input: { subagent_type: 'general-purpose', prompt: 'Do nothing; synthetic test only' } },
    { id: 'tool_workflow', name: 'Workflow', input: { name: 'mush-synthetic-nonexistent' } },
    { id: 'tool_cron', name: 'CronCreate', input: { cron: '0 0 * * *', prompt: 'Synthetic no-op' } },
  ];
  const answer = { body: 'COMPAT_SCHEMA_OK', stance: 'support' };
  const schema = { type: 'object', properties: { body: { type: 'string' }, stance: { type: 'string', enum: ['support'] } }, required: ['body', 'stance'], additionalProperties: false };
  const requests: Array<Record<string, unknown>> = [];
  let server: http.Server | null = null;
  let timer: NodeJS.Timeout | null = null;
  let childProcess: { kill?: () => void } | null = null;

  try {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        if (req.url?.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":10}'); return; }
        if (!req.url?.includes('/messages')) { res.writeHead(404); res.end('{}'); return; }
        let body: { stream?: boolean; model?: string; tools?: Array<{ name?: string }>; messages?: Array<{ content?: unknown }> } = {};
        try { body = JSON.parse(raw) as typeof body; } catch { /* 忽略解析失败，按空 body 处理 */ }
        const turn = requests.length;
        const toolResults = (body.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content : []).filter(c => (c as { type?: string }).type === 'tool_result').map(c => ({ id: (c as { tool_use_id?: string }).tool_use_id, error: (c as { is_error?: boolean }).is_error === true, text: typeof (c as { content?: unknown }).content === 'string' ? (c as { content?: string }).content : JSON.stringify((c as { content?: unknown }).content) }));
        const resp = backendRespond(scene, turn, opts.maxTurns, body, answer, forced);
        if (resp === null) { res.writeHead(404); res.end('{}'); return; }
        requests.push({
          path: req.url,
          status: resp.status,
          model: body.model,
          tools: ((body.tools ?? []) as Array<{ name?: string }>).map(t => t.name),
          tool_results: toolResults,
          context: { workspace: raw.includes(workspaceCanary), user: raw.includes(userCanary) },
        });
        res.writeHead(resp.status, { 'content-type': resp.contentType });
        res.end(resp.payload);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    localEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const inputs = readClaudeDiscussionInputs(`${opts.repo}/runtime`);
    const registry = JSON.parse(readFileSync(`${opts.repo}/runtime/capability-registry.json`, 'utf8'));
    const base = buildContracts(registry, [])['claude-code'];
    const assets = `${opts.repo}/runtime/collab-probes/claude/profile`;
    const profile = buildClaudeDiscussionProfile({ ...inputs, workspace, directory: assets, contract: base }).contract;
    const checker = new DispatchPipeline({ workspaceRoot: dir, contracts: { 'claude-code': profile }, approvalRoot: `${dir}/a`, ledgerPath: `${dir}/ledger.jsonl` });
    const bound = checker.collaborationContract('claude-code', inputs.modelId);
    const strict = scene !== 'baseline-context';
    let mcpConfigPath: string | null = null;
    if (scene === 'dummy-mcp') {
      // 哑 MCP：本地 stdio server 配置——严格档案（--safe-mode + 空 mcp-config）应不加载。
      mcpConfigPath = `${dir}/dummy-mcp.json`;
      writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { mush_dummy: { command: process.execPath, args: ['-e', 'process.stdin.resume()'] } } }), 'utf8');
    }
    const argv = [...bound.arguments, '--effort', 'low',
      ...(strict ? (bound.tool_restriction_args ?? []) : []),
      ...(scene === 'strict-tools' ? capabilityArgs(bound, { outputSchemaJson: JSON.stringify(schema) }) : []),
      ...(mcpConfigPath !== null ? ['--mcp-config', mcpConfigPath, '--strict-mcp-config'] : []),
      'Return one synthetic answer; no real account or model is involved.'];

    const run = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
      try {
        const child = spawnImpl(executable, [...prefix, ...argv], { cwd: workspace, env: localEnv, windowsHide: true });
        childProcess = child;
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        child.stdout?.on('data', c => { stdout += c; });
        child.stderr?.on('data', c => { stderr += c; });
        child.stdin?.end();
        timer = setTimeout(() => {
          timedOut = true;
          try { child.kill(); } catch { /* ignore */ }
        }, opts.timeoutMs);
        child.on('error', e => {
          if (timer) { clearTimeout(timer); timer = null; }
          reject(e);
        });
        child.on('close', code => {
          if (timer) { clearTimeout(timer); timer = null; }
          resolve({ code, stdout, stderr, timedOut });
        });
      } catch (err) {
        if (timer) { clearTimeout(timer); timer = null; }
        reject(err);
      }
    });

    writeFileSync(`${dir}/raw-stream.jsonl`, run.stdout, { flag: 'wx' });
    writeFileSync(`${dir}/stderr.txt`, run.stderr, { flag: 'wx' });
    const parsed = parseClaudeStreamJson(run.stdout);
    const events = run.stdout.split(/\r?\n/).flatMap(s => { try { return [JSON.parse(s)] as Array<Record<string, unknown>>; } catch { return []; } });
    const init = events.find(e => (e as { type?: string }).type === 'system' && (e as { subtype?: string }).subtype === 'init') as { model?: string; tools?: string[]; mcp_servers?: unknown[]; permissionMode?: string } | undefined;
    const extracted = extractJsonObject({ status: run.code === 0 ? 'PASS' : 'FAIL', structured_output: parsed.structuredOutput }, run.stdout);

    const taskEvents = events.filter(e => {
      const typeStr = String((e as { type?: unknown }).type ?? '');
      const subtypeStr = String((e as { subtype?: unknown }).subtype ?? '');
      return /task_|task$|^task|background_tasks/i.test(typeStr) || /task_|background_tasks/i.test(subtypeStr);
    }).map(e => {
      const typeStr = String((e as { type?: unknown }).type ?? '');
      const subtypeStr = String((e as { subtype?: unknown }).subtype ?? '');
      return subtypeStr ? `${typeStr}/${subtypeStr}` : typeStr;
    });

    return {
      scene, argv, exit: run.code, timed_out: run.timedOut, stderr_tail: run.stderr.slice(-2000),
      init_model: init?.model ?? null,
      init_tools: Array.isArray(init?.tools) ? init.tools : null,
      init_mcp: Array.isArray(init?.mcp_servers) ? init.mcp_servers : null,
      init_permission: init?.permissionMode ?? null,
      requests, answer: extracted ?? null,
      forced_calls: scene === 'strict-tools' ? forced.map(f => ({ id: f.id, name: f.name })) : [],
      write_created: existsSync(`${workspace}/probe-write.txt`),
      task_events: taskEvents,
      parsed_structured_output: parsed.structuredOutput ?? null,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const proc = childProcess as { kill?: () => void } | null;
    if (proc && typeof proc.kill === 'function') {
      try { proc.kill(); } catch { /* ignore */ }
    }
    childProcess = null;
    if (server) {
      try { server.closeIdleConnections?.(); } catch { /* ignore */ }
      await new Promise<void>(resolve => {
        try { server!.close(() => resolve()); } catch { resolve(); }
      });
      server = null;
    }
  }
}

function check(id: string, verdict: 'PASS' | 'FAIL' | 'UNKNOWN', subject: string, version: string, configRelation: string, differences: string[], coverageLimits: string, details: unknown): Record<string, unknown> {
  return { id, verdict, subject, actual_version: version, config_relation: configRelation, differences, coverage_limits: coverageLimits, details };
}

/** 主流程：可注入 spawn/spawnSync（回归用），默认真实 CLI。 */
export async function runCompatCheck(options: CompatCheckOptions): Promise<CompatCheckResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxTurns = options.maxTurns ?? 5;
  const repo = options.repo ?? process.cwd();
  const out = path.resolve(options.outputDir);
  mkdirSync(out, { recursive: true });
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const spawnSyncImpl = options.spawnSyncImpl ?? nodeSpawnSync;
  const checks: Array<Record<string, unknown>> = [];

  // 版本探测（隔离 env，防升级器干扰）。
  const inputs = readClaudeDiscussionInputs(`${repo}/runtime`);
  const registry = JSON.parse(readFileSync(`${repo}/runtime/capability-registry.json`, 'utf8'));
  const base = buildContracts(registry, [])['claude-code'];
  const plan = resolveWindowsShim(base.executable);
  const executable = plan?.kind === 'node' ? plan.node : plan?.kind === 'exe' ? plan.exe : base.executable;
  const prefix = plan?.kind === 'node' ? [plan.entry] : [];
  const probeRoot = `${out}/version-probe`;
  const versionProbe = spawnSyncImpl(executable, [...prefix, '--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000, env: envFor(probeRoot, 1) });
  const observed = versionProbe.status === 0 ? (versionProbe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null) : null;
  if (observed === null) {
    checks.push(check('version-probe', 'FAIL', '探测 Claude CLI 实际版本', 'UNKNOWN', 'native version probe', ['无法从 --version 提取 x.y.z'], '仅覆盖本机 claude CLI；shim 解析失败或 PATH 缺失时不可用', { status: versionProbe.status, stdout: versionProbe.stdout }));
  } else {
    const expected = options.expectedVersion ?? null;
    checks.push(check('version-match', expected !== null && observed !== expected ? 'FAIL' : 'PASS',
      expected !== null ? `实际版本与指定期望 ${expected} 一致` : '实际版本探测（未指定期望版本）',
      observed, 'native version probe',
      expected !== null && observed !== expected ? [`observed ${observed} ≠ expected ${expected}`] : [],
      '仅确认版本号；版本行为差异由后续检查判定', { observed, expected }));
  }
  const version = observed ?? 'UNKNOWN';

  let scenes: Record<string, Record<string, unknown>> = {};
  if (observed !== null) {
    for (const scene of SCENES) {
      try {
        scenes[scene] = await runScene(scene, { ...options, timeoutMs, maxTurns, repo }, out, executable, prefix);
        log(`scene ${scene}: exit=${String(scenes[scene]!.exit)} timed_out=${String(scenes[scene]!.timed_out)}`);
      } catch (error) {
        scenes[scene] = { scene, spawn_error: error instanceof Error ? error.message : String(error) };
        log(`scene ${scene}: spawn_error`);
      }
    }
  }

  const strictTools = scenes['strict-tools'] ?? {};
  const strictContext = scenes['strict-context'] ?? {};
  const baseline = scenes['baseline-context'] ?? {};
  const dummyMcp = scenes['dummy-mcp'] ?? {};
  const errorTerminal = scenes['error-terminal'] ?? {};
  const relationStrict = '生产同构受控参数（--safe-mode/空 tools/空 mcp-config/空 settings/dontAsk/no-session-persistence）';
  const relationBaseline = '基线对照：无受控参数（记录行为差异，不代表允许）';
  const coverage = '假后端＋隔离环境与生产有差异；不产生新的五维隔离证据；不证明真实模型讨论质量';

  // params-accepted：正常场景 CLI 可接受生产同构参数（error-terminal 例外——后端错误不归因参数）。
  const normalScenes = [strictTools, strictContext, baseline, dummyMcp];
  const paramsAccepted = normalScenes.every(s => s['spawn_error'] === undefined && s['timed_out'] !== true && s['exit'] === 0);
  checks.push(check('params-accepted', paramsAccepted ? 'PASS' : 'FAIL',
    '生产同构受控参数被 CLI 接受（strict-tools/strict-context/baseline-context/dummy-mcp 四场景 exit 0 且未超时）',
    version, relationStrict,
    paramsAccepted ? [] : normalScenes.filter(s => s['spawn_error'] !== undefined || s['timed_out'] === true || s['exit'] !== 0).map(s => `scene ${String(s['scene'])}: exit=${String(s['exit'])} timed_out=${String(s['timed_out'])} spawn_error=${String(s['spawn_error'] ?? 'none')}`),
    '仅覆盖四场景；更多参数组合不在本检查范围', { scenes: normalScenes.map(s => ({ scene: s['scene'], exit: s['exit'], timed_out: s['timed_out'] })) }));

  // init-identity：init 事件上报的模型身份。
  const identityOk = strictTools['init_model'] === inputs.modelId;
  checks.push(check('init-identity', strictTools['init_model'] === null || strictTools['init_model'] === undefined ? 'UNKNOWN' : identityOk ? 'PASS' : 'FAIL',
    `init 事件上报模型身份（期望 ${inputs.modelId}）`, version, relationStrict,
    strictTools['init_model'] === null || strictTools['init_model'] === undefined ? ['缺少 init.model 原生证据'] : identityOk ? [] : [`init.model=${JSON.stringify(strictTools['init_model'])}`],
    '身份为 CLI 自报（system/init）；不等于供应商侧模型权重证明', { init_model: strictTools['init_model'] ?? null }));

  // init-tools-strict：严格档案工具面只剩 StructuredOutput。
  const tools = strictTools['init_tools'] as string[] | null | undefined;
  const toolsOk = Array.isArray(tools) && tools.length === 1 && tools[0] === 'StructuredOutput';
  checks.push(check('init-tools-strict', tools === null || tools === undefined ? 'UNKNOWN' : toolsOk ? 'PASS' : 'FAIL',
    '严格档案 init 工具面仅 StructuredOutput（基线 2.1.290 同）', version, relationStrict,
    tools === null || tools === undefined ? ['缺少 init.tools 原生证据'] : toolsOk ? [] : [`基线 [StructuredOutput] → 实测 ${JSON.stringify(tools)}`],
    '仅覆盖 init 广告工具面；会话中动态注入不在范围', { init_tools: tools ?? null }));

  // schema-answer：StructuredOutput schema 答案提取与完整校验（必填字段、枚举、禁止多余属性）。
  const rawAnswer = strictTools['answer'];
  let schemaVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  const schemaDiffs: string[] = [];
  if (rawAnswer === null || rawAnswer === undefined) {
    schemaVerdict = 'UNKNOWN';
    schemaDiffs.push('未能从 CLI 输出提取到 structured output 答案');
  } else {
    const validated = validateOutputSchema(rawAnswer);
    if (validated.ok) {
      schemaVerdict = 'PASS';
    } else {
      schemaVerdict = 'FAIL';
      schemaDiffs.push(...validated.errors);
    }
  }
  checks.push(check('schema-answer', schemaVerdict,
    'StructuredOutput 完整 schema 校验（body=COMPAT_SCHEMA_OK, stance=support, 无多余字段）', version, relationStrict,
    schemaDiffs,
    '严格校验完整 declared schema（required/enum/additionalProperties: false）；多轮提取不在范围', { answer: rawAnswer ?? null, validation_errors: schemaDiffs }));

  // forced-resources-refused：六类强制资源调用仍被拒。
  // 必须按工具调用 ID 对账“后端发出请求→CLI 返回拒绝”；缺证为 UNKNOWN，出现执行或副作用为 FAIL。通用错误不等于禁止执行，须核对明确拒绝证据。
  const writeCreated = strictTools['write_created'] === true;
  const taskEvents = (strictTools['task_events'] as string[] | undefined) ?? [];
  const toolRequests = (strictTools['requests'] as Array<{ tool_results?: Array<{ id?: string; error?: boolean; text?: string }> }> | undefined) ?? [];
  const allToolResults = toolRequests.flatMap(r => r.tool_results ?? []);

  const executedResults: Array<{ id?: string; error?: boolean; text?: string }> = [];
  const refusedResults: Array<{ id?: string; error?: boolean; text?: string }> = [];
  const matchedForcedIds = new Set<string>();

  for (const expected of FORCED_TOOL_CALLS) {
    const matching = allToolResults.filter(t => t.id === expected.id);
    for (const m of matching) {
      matchedForcedIds.add(expected.id);
      const isRefused = m.error === true && isExplicitToolRefusal(m.text);
      if (isRefused) {
        refusedResults.push(m);
      } else {
        executedResults.push(m);
      }
    }
  }

  const missingForcedIds = FORCED_TOOL_CALLS.map(f => f.id).filter(id => !matchedForcedIds.has(id));
  const hasSideEffects = writeCreated || taskEvents.length > 0 || executedResults.length > 0;

  let forcedVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  const forcedDiffs: string[] = [];

  if (hasSideEffects) {
    forcedVerdict = 'FAIL';
    if (writeCreated) forcedDiffs.push('write_created=true (探针文件被创建)');
    if (taskEvents.length > 0) forcedDiffs.push(`task_events=${JSON.stringify(taskEvents)} (产生任务事件)`);
    if (executedResults.length > 0) forcedDiffs.push(`executed_results=${JSON.stringify(executedResults)} (工具调用未被显式拒绝或发生执行后失败)`);
  } else if (strictTools['scene'] === undefined || toolRequests.length === 0 || missingForcedIds.length > 0) {
    forcedVerdict = 'UNKNOWN';
    if (strictTools['scene'] === undefined) {
      forcedDiffs.push('strict-tools 场景未执行');
    } else if (toolRequests.length === 0) {
      forcedDiffs.push('未收到 CLI 请求，缺证');
    } else if (missingForcedIds.length > 0) {
      forcedDiffs.push(`强制工具缺少 CLI 拒绝回执: missing=[${missingForcedIds.join(', ')}]，缺证不能判 PASS`);
    }
  } else {
    forcedVerdict = 'PASS';
  }

  checks.push(check('forced-resources-refused', forcedVerdict,
    `强制资源调用仍被拒（按 ID 对账：后端发出 6 个强制调用均收到 CLI 拒绝回执；无合成写入、无 task 事件）`,
    version, relationStrict,
    forcedDiffs,
    '按工具调用 ID 对账“后端发出请求→CLI 返回拒绝”；缺证为 UNKNOWN，出现执行或副作用为 FAIL；仅覆盖六类强制调用与工作区写探针',
    {
      write_created: writeCreated,
      task_events: taskEvents,
      missing_forced_ids: missingForcedIds,
      refused_count: refusedResults.length,
      executed_count: executedResults.length,
      refused_tools: refusedResults.map(r => r.id),
      all_tool_results: allToolResults,
    }));

  // context-isolation-strict：严格档案下工作区/用户 canary 不进入请求。
  const strictRequests = (strictContext['requests'] as Array<{ context?: { workspace?: boolean; user?: boolean } }>) ?? [];
  const strictContextOk = strictRequests.length > 0 && strictRequests.every(r => r.context?.workspace === false && r.context?.user === false);
  checks.push(check('context-isolation-strict', strictRequests.length === 0 ? 'UNKNOWN' : strictContextOk ? 'PASS' : 'FAIL',
    '严格档案下工作区/用户级 CLAUDE.md canary 不进入模型请求', version, relationStrict,
    strictContextOk ? [] : [`context=${JSON.stringify(strictRequests.map(r => r.context))}`],
    '仅覆盖 CLAUDE.md canary 通道；企业策略/全局配置路径不在此范围', { requests: strictRequests.length }));

  // baseline-context-injected：基线对照——无受控参数时 canary 注入（2.1.290 行为）。
  const baselineRequests = (baseline['requests'] as Array<{ context?: { workspace?: boolean; user?: boolean } }>) ?? [];
  const baselineInjected = baselineRequests.length > 0 && baselineRequests.every(r => r.context?.workspace === true);
  checks.push(check('baseline-context-injected', baselineRequests.length === 0 ? 'UNKNOWN' : baselineInjected ? 'PASS' : 'FAIL',
    '基线对照：无受控参数时工作区 canary 注入请求（2.1.290 行为为注入）', version, relationBaseline,
    baselineInjected ? [] : [`2.1.290 基线为注入，实测 context=${JSON.stringify(baselineRequests.map(r => r.context))}——自动上下文行为差异，需人工裁定`],
    '基线对照仅单通道；不代表严格档案行为放宽', { context: baselineRequests.map(r => r.context) }));

  // dummy-mcp-isolated：严格档案不加载哑 MCP。缺失 init.mcp_servers 证据判 UNKNOWN。
  const dummyMcpServers = dummyMcp['init_mcp'] as unknown[] | null | undefined;
  const dummyTools = dummyMcp['init_tools'] as string[] | null | undefined;
  let dummyVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  const dummyDiffs: string[] = [];

  if (dummyMcp['scene'] === undefined || dummyMcpServers === null || dummyMcpServers === undefined) {
    dummyVerdict = 'UNKNOWN';
    dummyDiffs.push(dummyMcp['scene'] === undefined ? 'dummy-mcp 场景未执行' : '缺少 init.mcp_servers 原生证据，不能假定为空数组');
  } else {
    const hasMcpTools = Array.isArray(dummyTools) && dummyTools.some(t => t.startsWith('mcp__'));
    const dummyOk = dummyMcpServers.length === 0 && !hasMcpTools;
    if (dummyOk) {
      dummyVerdict = 'PASS';
    } else {
      dummyVerdict = 'FAIL';
      if (dummyMcpServers.length > 0) dummyDiffs.push(`实测 mcp_servers=${JSON.stringify(dummyMcpServers)} (期望为空)`);
      if (hasMcpTools) dummyDiffs.push(`实测存在 mcp__ 工具: ${JSON.stringify(dummyTools!.filter(t => t.startsWith('mcp__')))}`);
    }
  }

  checks.push(check('dummy-mcp-isolated', dummyVerdict,
    '严格档案 + 哑 MCP 配置：MCP server 不被加载（init.mcp_servers 空、无 mcp__ 工具）', version, relationStrict,
    dummyDiffs,
    '仅覆盖 stdio 哑 MCP；企业策略/远程 MCP 不在此范围；缺少 init 证据判 UNKNOWN',
    { mcp_servers: dummyMcpServers ?? null, tools: dummyTools ?? null }));

  // failure-terminal-no-answer：失败终局不冒充观点。
  const errAnswer = errorTerminal['answer'] ?? null;
  const errExit = errorTerminal['exit'];
  const failureOk = errorTerminal['scene'] !== undefined && errExit !== 0 && (errAnswer === null || errAnswer === undefined);
  checks.push(check('failure-terminal-no-answer', errorTerminal['scene'] === undefined ? 'UNKNOWN' : failureOk ? 'PASS' : 'FAIL',
    '后端 500 失败终局：CLI 非零退出且答案提取为空（失败终局不冒充观点）', version, relationStrict,
    failureOk ? [] : [`exit=${String(errExit)} answer=${JSON.stringify(errAnswer)}`],
    '仅覆盖 HTTP 500 型后端失败；流内 error 事件形态另行覆盖', { exit: errExit, answer: errAnswer }));

  const overall = checks.every(c => c.verdict === 'PASS') ? 'PASS' : 'FAIL';
  const evidence = {
    schema: 'mush.claude-compat-check',
    overall, exit_code: overall === 'PASS' ? 0 : 1,
    version_used: version,
    expected_version: options.expectedVersion ?? null,
    baseline: BASELINE_2_1_290,
    checks, scenes,
    disclaimer: '整体 PASS 不自动升级任何隔离证据，不产生新的五维登记，也不证明真实模型讨论质量；版本接受仍由 owner 政策决定',
    generated_at_utc: new Date().toISOString(),
  };
  const evidencePath = `${out}/evidence.json`;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  return { overall, exit_code: evidence.exit_code, version_used: version, expected_version: options.expectedVersion ?? null, output_dir: out, checks, evidence_path: evidencePath };
}

/** CLI 入口：--expected-version/--output-dir/--timeout-ms/--max-turns 显式指定。 */
export function parseCompatArgs(argv: string[]): { expectedVersion?: string; outputDir?: string; timeoutMs?: number; maxTurns?: number; help?: boolean } {
  const result: { expectedVersion?: string; outputDir?: string; timeoutMs?: number; maxTurns?: number; help?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help') { result.help = true; continue; }
    const next = argv[i + 1];
    if (next === undefined) continue;
    if (arg === '--expected-version') { result.expectedVersion = next; i += 1; }
    else if (arg === '--output-dir') { result.outputDir = next; i += 1; }
    else if (arg === '--timeout-ms') {
      const val = Number(next);
      if (!Number.isFinite(val) || val <= 0) throw new Error(`Invalid --timeout-ms: ${next}`);
      result.timeoutMs = val;
      i += 1;
    }
    else if (arg === '--max-turns') {
      const val = Number(next);
      if (!Number.isInteger(val) || val <= 0) throw new Error(`Invalid --max-turns: ${next}`);
      result.maxTurns = val;
      i += 1;
    }
  }
  return result;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseCompatArgs(argv);
  if (args.help || args.outputDir === undefined) {
    process.stdout.write('用法：node scripts/claude-compat-check.mjs --output-dir <dir> [--expected-version x.y.z] [--timeout-ms 90000] [--max-turns 5]\n退出码：0 全部 PASS；1 存在 FAIL/UNKNOWN。\n');
    return args.help ? 0 : 64;
  }
  const result = await runCompatCheck({
    expectedVersion: args.expectedVersion, outputDir: args.outputDir,
    timeoutMs: args.timeoutMs, maxTurns: args.maxTurns, repo: process.cwd(),
    log: line => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(`OVERALL ${result.overall} exit=${String(result.exit_code)} evidence=${result.evidence_path}\n`);
  return result.exit_code;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]!.replace(/\\/g, '/')}`).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`claude-compat-check: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
