/**
 * mush CLI（D21 同机跨工作区）— 最小命令集：status / dispatch / review。
 * 零依赖；--workspace 参数贯通所有命令。
 * dispatch：dry-run 全模拟并先过 per-actor USD admission 门（事件化记账）；
 * --real 需要 owner D6 确认记录（approval 文件），无确认 = BLOCKED_WAITING_OWNER。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { UsdBudgetLedger } from './core/budget.ts';
import { validateAdapterContract, type AdapterContract } from './adapters/contract.ts';
import { buildDeepSeekContract } from './adapters/deepseek.ts';
import { buildClaudeContract } from './adapters/claude.ts';
import { startBoardServer } from './web/server.ts';
import { runChatRepl } from './web/repl.ts';
import { LockError } from './web/persistence.ts';
import { InputError } from './web/dispatch.ts';
import {
  CollabBoardUnreachableError,
  CollabProtocolError,
  collabCheck,
  collabCreate,
  collabRejectionExitCode,
  collabResult,
  collabStatus,
  collabStop,
  inputErrorHttpStatus,
  resolveWorkspaceRoot,
  writeOutFileExclusive,
  type CollabParticipantSelection,
} from './web/collab-client.ts';
import { runMcpCollabServer } from './mcp-collab.ts';

export interface CliResult {
  exitCode: number;
  stdout: string;
}

function jsonLine(value: Record<string, unknown>): string {
  return JSON.stringify(value) + '\n';
}

function fail(message: string, exitCode: number): CliResult {
  return { exitCode, stdout: jsonLine({ ok: false, error: message }) };
}

/** GOAL-068（A5）：全部命令的合法旗标并集——未知旗标一律 usage error，不再静默吞。 */
/** 合法旗标并集导出：skills 文档回归用它做防漂移比对（文档中出现的 --flag 必须在此集合内）。 */
export const KNOWN_FLAGS = new Set([
  'workspace',
  'port',
  'once',
  'approval-root',
  'adapter',
  'prompt',
  'cap-usd',
  'amount-usd',
  'real',
  'receipt',
  'dry-run',
  'board-url',
  'session',
  // GOAL-085 第三阶段第一片：collab 薄入口旗标。
  'adapter-a', 'model-a', 'effort-a',
  'adapter-b', 'model-b', 'effort-b',
  'topic', 'material', 'constraints', 'refresh',
  'format', 'out', 'request',
]);

/** 允许重复出现并聚合为数组的旗标；其余旗标重复出现 = 用法错误（Codex 复核缺口 3）。 */
const KNOWN_MULTI_FLAGS = new Set(['material']);

function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean | string[]>; unknownFlags: string[]; duplicateFlags: string[] } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const unknownFlags: string[] = [];
  const duplicateFlags: string[] = [];
  const assign = (key: string, value: string): void => {
    const existing = flags[key];
    if (existing === undefined) flags[key] = value;
    else if (KNOWN_MULTI_FLAGS.has(key)) {
      if (Array.isArray(existing)) existing.push(value);
      else flags[key] = [existing as string, value];
    } else duplicateFlags.push(`--${key}`);
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      // GOAL-068（A5）：支持 --flag=value 形态——此前 '--workspace=D:\x' 会变成
      // 名为 'workspace=D:\x' 的布尔旗标，resolveWorkspace 静默回退 cwd。
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        // 重复聚合对两种写法一致（Codex 复核缺口 3：--material=x 两次只提交一份）。
        assign(key, arg.slice(eq + 1));
        if (!KNOWN_FLAGS.has(key)) unknownFlags.push(`--${key}`);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        assign(key, next);
        index += 1;
      } else {
        if (flags[key] !== undefined && !KNOWN_MULTI_FLAGS.has(key)) duplicateFlags.push(`--${key}`);
        flags[key] = true;
      }
      if (!KNOWN_FLAGS.has(key)) unknownFlags.push(`--${key}`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags, unknownFlags, duplicateFlags };
}

function resolveWorkspace(flags: Record<string, string | boolean | string[]>): string {
  const raw = typeof flags.workspace === 'string' ? flags.workspace : process.cwd();
  const resolved = path.resolve(raw);
  if (!existsSync(resolved)) throw new Error(`workspace does not exist: ${resolved}`);
  return resolved;
}

function knownContract(adapterId: string): AdapterContract | null {
  if (adapterId === 'fake-t1') {
    return validateAdapterContract({
      adapter_id: 'fake-t1',
      executable: 'fake.exe',
      arguments: ['--headless'],
      protocol: 't1',
      prompt_transport: 'stdin',
      expected_provider: 'fake-provider',
      expected_model_id: 'fake-model',
    });
  }
  if (adapterId === 'deepseek-dsh') return buildDeepSeekContract('dsh');
  if (adapterId === 'deepseek-pi') return buildDeepSeekContract('pi');
  if (adapterId === 'claude-code') return buildClaudeContract('claude-sonnet-4-5');
  return null;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const { positionals, flags, unknownFlags, duplicateFlags } = parseArgs(argv);
  const command = positionals[0];
  // Codex 三轮复核缺口 3：MCP 模式下 stdout 只承载协议帧——未知旗标、重复旗标等
  // 前置用法错误一律写 stderr，不进入 stdout。
  const isMcpCommand = command === 'mcp';
  const failPreflight = (message: string, exitCode: number): CliResult => {
    if (!isMcpCommand) return fail(message, exitCode);
    process.stderr.write(`mush mcp: ${message}\n`);
    return { exitCode, stdout: '' };
  };
  if (command === undefined) {
    return { exitCode: 64, stdout: jsonLine({ ok: false, usage: 'mush <status|dispatch|review|board|chat|collab|mcp> [--workspace <dir>] [options]' }) };
  }
  if (unknownFlags.length > 0) {
    return failPreflight(`unknown flag(s): ${unknownFlags.join(', ')}`, 64);
  }
  // Codex 复核缺口 3：标量旗标重复出现不静默覆盖/聚合——明确报用法错误。
  if (duplicateFlags.length > 0) {
    return failPreflight(`duplicate flag(s): ${[...new Set(duplicateFlags)].join(', ')}（除 --material 外不接受重复旗标）`, 64);
  }

  if (command === 'chat') {
    // GOAL-081：终端 REPL——复用 /api/chat + SSE（零新端点，契约 v1.9/v1.13）。
    // 默认连本机看板；--board-url 覆盖；--session 续接既有会话（与看板共用持久化）。
    const baseUrl = typeof flags['board-url'] === 'string' ? flags['board-url'] : 'http://127.0.0.1:4173';
    const sessionId = typeof flags.session === 'string' ? flags.session : undefined;
    const code = await runChatRepl({ baseUrl, sessionId });
    return { exitCode: code, stdout: '' };
  }

  if (command === 'board') {
    // GOAL-005：本地看板。默认 127.0.0.1（触发门 4：对外暴露需 owner 明确开启）。
    const workspace = resolveWorkspace(flags);
    const approvalRoot =
      typeof flags['approval-root'] === 'string'
        ? path.resolve(flags['approval-root'])
        : path.join(workspace, 'goals', 'receipts', 'approval-requests');
    const port = typeof flags.port === 'string' ? Number(flags.port) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535) return fail('--port must be an integer 0-65535', 64);
    const host = '127.0.0.1'; // 硬绑定 loopback；不设 --host 开关（门 4）
    const callerToken = randomUUID().replace(/-/g, '');
    const server = await startBoardServer({
      approvalRoot,
      runId: `board-${workspace === process.cwd() ? 'mush' : path.basename(workspace)}`,
      assignmentEpoch: 1,
      host,
      port,
      runtimeRoot: path.join(workspace, 'runtime'),
      callerToken,
      enforceCallerToken: true,
    }).catch((error) => {
      if (error instanceof LockError) {
        return { exitCode: 3, stdout: jsonLine({ ok: false, error: error.message, hint: 'another board instance is running' }) } as unknown as Awaited<ReturnType<typeof startBoardServer>>;
      }
      throw error;
    });
    if ('exitCode' in server) {
      return server as unknown as CliResult;
    }
    const url = `http://${host}:${server.port}/`;
    const payload = {
      ok: true,
      command: 'board',
      url,
      host,
      port: server.port,
      approval_root: approvalRoot,
    };
    if (flags.once === true) {
      // 探测模式：绑定成功打印地址即退出（测试用）。
      await server.close();
      return { exitCode: 0, stdout: jsonLine({ ...payload, once: true }) };
    }
    process.stdout.write(`mush 看板已启动：${url}\n审批目录：${approvalRoot}\nCtrl+C 停止。\n`);
    await new Promise<void>((resolve) => {
      const onSig = () => {
        process.removeListener('SIGINT', onSig);
        process.removeListener('SIGTERM', onSig);
        resolve();
      };
      process.on('SIGINT', onSig);
      process.on('SIGTERM', onSig);
    });
    await server.close();
    return { exitCode: 0, stdout: jsonLine({ ...payload, stopped: true }) };
  }

  if (command === 'status') {
    const workspace = resolveWorkspace(flags);
    let version = 'UNKNOWN';
    try {
      const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string') version = pkg.version;
    } catch {
      version = 'UNKNOWN';
    }
    return {
      exitCode: 0,
      stdout: jsonLine({
        ok: true,
        command: 'status',
        workspace,
        has_git: existsSync(path.join(workspace, '.git')),
        mush_version: version,
        node_version: process.version,
      }),
    };
  }

  if (command === 'dispatch') {
    const adapterId = typeof flags.adapter === 'string' ? flags.adapter : '';
    const prompt = typeof flags.prompt === 'string' ? flags.prompt : '';
    if (adapterId === '' || prompt === '') return fail("dispatch requires --adapter and --prompt", 64);
    const contract = knownContract(adapterId);
    if (contract === null) return fail(`unknown adapter: ${adapterId}`, 64);
    const workspace = resolveWorkspace(flags);
    const capUsd = typeof flags['cap-usd'] === 'string' ? Number(flags['cap-usd']) : 5;
    const amountUsd = typeof flags['amount-usd'] === 'string' ? Number(flags['amount-usd']) : 0;
    if (!Number.isFinite(capUsd) || capUsd <= 0) return fail('--cap-usd must be a positive number', 64);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) return fail('--amount-usd must be >= 0', 64);

    // U6：先 admit 后执行——无论结果如何都作为事件记账（非阻断）。
    const ledger = new UsdBudgetLedger();
    const admission = ledger.admit({
      actorId: contract.adapter_id,
      capUsd,
      amountUsd,
      meta: { unit: 'dispatch', adapter: contract.adapter_id, command: 'dispatch' },
    });

    const real = flags.real === true;
    if (real) {
      const approvalRoot =
        typeof flags['approval-root'] === 'string'
          ? flags['approval-root']
          : path.join(process.cwd(), 'goals', 'receipts', 'dispatch-approvals');
      const approvalPath = path.join(approvalRoot, contract.adapter_id + '.approved.json');
      if (!existsSync(approvalPath)) {
        return {
          exitCode: 2,
          stdout: jsonLine({
            status: 'BLOCKED_WAITING_OWNER',
            adapter_id: contract.adapter_id,
            reason: 'real dispatch requires owner D6 confirmation record before spending',
            expected_approval: approvalPath,
          }),
        };
      }
      return fail(
        'real dispatch approved but sandbox piped-spawn is unavailable (AD-02); run outside sandbox',
        3,
      );
    }

    const receiptDir = path.join(workspace, '.mush-receipts');
    mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, `dispatch-${Date.now()}.json`);
    const receipt = {
      schema_version: 1,
      adapter_id: contract.adapter_id,
      protocol: contract.protocol,
      prompt,
      dry_run: true,
      generated_at_utc: new Date().toISOString(),
      exit_code: 0,
      timed_out: false,
      identity_fail_closed: false,
      admission_decision: admission.decision,
      admission_remaining_usd: admission.remainingUsd,
      admission_cap_usd: capUsd,
    };
    writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', 'utf8');
    return {
      exitCode: 0,
      stdout: jsonLine({
        ok: true,
        command: 'dispatch',
        dry_run: true,
        receipt_path: receiptPath,
        admission: {
          decision: admission.decision,
          remaining_usd: admission.remainingUsd,
          cap_usd: capUsd,
        },
      }),
    };
  }

  if (command === 'review') {
    const receiptPathRaw = typeof flags.receipt === 'string' ? flags.receipt : positionals[1];
    if (receiptPathRaw === undefined || receiptPathRaw === '') return fail('review requires --receipt <path>', 64);
    if (!existsSync(receiptPathRaw)) return fail(`receipt not found: ${receiptPathRaw}`, 64);
    const receipt = JSON.parse(readFileSync(receiptPathRaw, 'utf8')) as Record<string, unknown>;
    const verdict =
      receipt.exit_code === 0 && receipt.timed_out === false && receipt.identity_fail_closed === false
        ? 'PASS'
        : 'FAIL';
    return {
      exitCode: verdict === 'PASS' ? 0 : 1,
      stdout: jsonLine({ ok: verdict === 'PASS', command: 'review', receipt_path: receiptPathRaw, verdict }),
    };
  }

  if (command === 'mcp') {
    // GOAL-085 第三阶段第二片：本地 stdio MCP——复用共享客户端（回环限制/超时/
    // 协议校验）与同一审批门（create 仅待批卡，无 approve/reject 工具）；零网络
    // 监听，stdio JSON-RPC 常驻直到 stdin EOF。
    const baseUrl = typeof flags['board-url'] === 'string' ? (flags['board-url'] as string).replace(/\/+$/, '') : 'http://127.0.0.1:4790';
    try {
      await runMcpCollabServer({ baseUrl });
      return { exitCode: 0, stdout: '' };
    } catch (error) {
      // Codex 二轮复核缺口 4：MCP 的 stdout 只承载协议帧——启动错误写 stderr，
      // 不走 fail()（fail 的 stdout 会被 bin/mush 打到 stdout 污染协议通道）。
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`mush mcp: ${message}
`);
      return { exitCode: error instanceof InputError ? 64 : 1, stdout: '' };
    }
  }

  if (command === 'collab') {
    // GOAL-085 第三阶段第一片（owner 2026-10-06）：受控讨论 CLI 薄入口——
    // check/create/status/result/stop 五个子命令，全部是看板 HTTP API 的 loopback
    // 薄客户端，**零新端点、不绕过审批/编排/账本**。create 只创建待批准会话并
    // 返回审批卡信息（D30：批准仍由 owner 在看板完成，CLI 不自动批准）；stop
    // 只发停止请求，终态以 status 为准。
    return runCollabCli(positionals.slice(1), flags);
  }

  return fail(`unknown command: ${command}`, 64);
}

/** collab 薄入口的看板客户端基址：默认生产看板端口 4790（board-up 惯例），--board-url 覆盖。
 *  回环校验/超时/协议校验在共享客户端 src/web/collab-client.ts——CLI 与 MCP 复用同一实现。 */
function collabBaseUrl(flags: Record<string, string | boolean | string[]>): string {
  return typeof flags['board-url'] === 'string' ? (flags['board-url'] as string).replace(/\/+$/, '') : 'http://127.0.0.1:4790';
}

function collabParticipant(flags: Record<string, string | boolean | string[]>, seat: 'a' | 'b'): CollabParticipantSelection | null {
  const adapterId = typeof flags[`adapter-${seat}`] === 'string' ? flags[`adapter-${seat}`] as string : '';
  if (adapterId === '') return null;
  const modelId = typeof flags[`model-${seat}`] === 'string' ? flags[`model-${seat}`] as string : undefined;
  const effort = typeof flags[`effort-${seat}`] === 'string' ? (flags[`effort-${seat}`] as string).toUpperCase() : undefined;
  return { adapter_id: adapterId, ...(modelId !== undefined ? { model_id: modelId } : {}), ...(effort !== undefined ? { effort } : {}) };
}

function collabParticipants(flags: Record<string, string | boolean | string[]>): CollabParticipantSelection[] | null {
  const a = collabParticipant(flags, 'a');
  const b = collabParticipant(flags, 'b');
  if (a === null || b === null) return null;
  return [a, b];
}

function flagString(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  return typeof flags[key] === 'string' ? flags[key] as string : undefined;
}

async function runCollabCli(sub: string[], flags: Record<string, string | boolean | string[]>): Promise<CliResult> {
  const subcommand = sub[0];
  const baseUrl = collabBaseUrl(flags);
  const usage = 'mush collab <check|create|status|result|stop> [--board-url <url>] ...';
  if (subcommand === undefined) {
    return { exitCode: 64, stdout: jsonLine({ ok: false, usage }) };
  }
  try {
    if (subcommand === 'check') {
      const participants = collabParticipants(flags);
      if (participants === null) return fail('collab check requires --adapter-a/--adapter-b（--model-*/--effort-* 可选）', 64);
      const data = await collabCheck(baseUrl, participants, {
        ...(flags.refresh === true ? { refresh: true } : {}),
        ...(flagString(flags, 'workspace') !== undefined ? { workspace_root: flagString(flags, 'workspace') } : {}),
      });
      // check 是只读查询：ready=false（准入/版本阻断）仍是成功查询，exit 0，原因原样透出。
      return { exitCode: 0, stdout: jsonLine({ ok: true, command: 'collab check', board_url: baseUrl, ...data }) };
    }
    if (subcommand === 'create') {
      // Codex 复核缺口 2：--request <file> 为 UTF-8 JSON 请求入口（保留工作区与
      // 材料席位权限），与逐项旗标互斥——不设两处事实源。
      const requestPath = flagString(flags, 'request');
      let requestBody: Record<string, unknown>;
      const explicitConflicts = ['topic', 'material', 'constraints', 'adapter-a', 'model-a', 'effort-a', 'adapter-b', 'model-b', 'effort-b']
        .filter((key) => flags[key] !== undefined);
      if (requestPath !== undefined) {
        if (explicitConflicts.length > 0) {
          return fail(`--request 与以下旗标互斥：${explicitConflicts.map((c) => `--${c}`).join(', ')}`, 64);
        }
        if (!existsSync(requestPath)) return fail(`请求文件不存在：${requestPath}`, 64);
        let parsed: unknown;
        try {
          parsed = JSON.parse(readFileSync(requestPath, 'utf8'));
        } catch {
          return fail(`请求文件必须是 UTF-8 JSON：${requestPath}`, 64);
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return fail('请求文件必须是 JSON 对象', 64);
        }
        requestBody = parsed as Record<string, unknown>;
        if (typeof requestBody.topic !== 'string' || requestBody.topic.trim() === '') return fail('请求文件需要 topic', 64);
        if (!Array.isArray(requestBody.participants) || requestBody.participants.length === 0) return fail('请求文件需要 participants 数组', 64);
        // 材料允许 {path} 引用本地文件（读为正文）；{content} 原样；allowed_seats 席位权限原样透传（服务端校验）。
        if (Array.isArray(requestBody.materials)) {
          requestBody.materials = (requestBody.materials as unknown[]).map((m, index) => {
            if (m === null || typeof m !== 'object' || Array.isArray(m)) throw new InputError(`请求文件 materials[${index}] 必须是对象`);
            const rec = m as Record<string, unknown>;
            if (typeof rec.path === 'string') {
              if (!existsSync(rec.path)) throw new InputError(`材料文件不存在：${String(rec.path)}`);
              const { path: _path, ...rest } = rec;
              return { ...rest, content: readFileSync(rec.path, 'utf8') };
            }
            return rec;
          });
        }
      } else {
        const topic = flagString(flags, 'topic');
        if (topic === undefined || topic.trim() === '') return fail('collab create requires --topic（或 --request <file>）', 64);
        const participants = collabParticipants(flags);
        if (participants === null) return fail('collab create requires --adapter-a/--model-a 与 --adapter-b/--model-b（--effort-* 可选）', 64);
        const rawMaterials = Array.isArray(flags.material) ? flags.material as string[] : flags.material !== undefined ? [flags.material as string] : [];
        const materials = rawMaterials.map((spec, index) => {
          const eq = spec.indexOf('=');
          if (eq === -1) throw new InputError(`--material 第 ${index + 1} 项需要 "名称=路径" 形态`);
          const name = spec.slice(0, eq).trim();
          const filePath = spec.slice(eq + 1).trim();
          if (name === '' || filePath === '') throw new InputError(`--material 第 ${index + 1} 项需要 "名称=路径" 形态`);
          if (!existsSync(filePath)) throw new InputError(`材料文件不存在：${filePath}`);
          return { name, content: readFileSync(filePath, 'utf8') };
        });
        requestBody = {
          topic: topic.trim(),
          participants,
          materials,
          ...(flagString(flags, 'constraints') !== undefined ? { constraints: flagString(flags, 'constraints') } : {}),
          isolation_required: true,
        };
      }
      // Codex 复核缺口 2：--workspace 透传为 workspace_root（服务端校验与看板工作区一致）。
      const workspaceFlag = flagString(flags, 'workspace');
      if (workspaceFlag !== undefined) requestBody.workspace_root = resolveWorkspaceRoot(workspaceFlag);
      if (requestBody.isolation_required === false) throw new InputError('受控协作必须启用材料与工具隔离（isolation_required 不允许为 false）');
      if (requestBody.isolation_required === undefined) requestBody.isolation_required = true;
      const outcome = await collabCreate(baseUrl, requestBody);
      if (outcome.status !== 201) {
        // 409 = 准入/版本 fail-closed 拒绝（设计内），exit 2；400 = 用法错误，exit 64。
        return { exitCode: collabRejectionExitCode(outcome.status), stdout: jsonLine({ ok: false, command: 'collab create', status: outcome.status, error: outcome.error }) };
      }
      // D30/薄入口边界：create 只建待批准会话，批准必须由 owner 在看板完成。
      return {
        exitCode: 0,
        stdout: jsonLine({
          ok: true,
          command: 'collab create',
          session_id: outcome.session_id,
          status: 'pending_approval',
          request_file: outcome.request_file,
          authorization_readiness: outcome.authorization_readiness,
          approval: 'PENDING_OWNER_APPROVAL',
          board_url: baseUrl,
          note: '会话已创建为待批准；CLI 不自动批准——请到看板审批卡批准后才开始讨论（stop 前零模型调用）',
        }),
      };
    }
    if (subcommand === 'status') {
      const sessionId = flagString(flags, 'session');
      const data = await collabStatus(baseUrl, sessionId?.trim());
      if (sessionId === undefined || sessionId.trim() === '') {
        return { exitCode: 0, stdout: jsonLine({ ok: true, command: 'collab status', board_url: baseUrl, ...data }) };
      }
      return { exitCode: 0, stdout: jsonLine({ ok: true, command: 'collab status', ...data }) };
    }
    if (subcommand === 'result') {
      const sessionId = flagString(flags, 'session');
      if (sessionId === undefined || sessionId.trim() === '') return fail('collab result requires --session', 64);
      const format = flagString(flags, 'format') ?? 'json';
      if (format !== 'json' && format !== 'markdown') return fail("--format must be 'json' or 'markdown'", 64);
      const { payload } = await collabResult(baseUrl, sessionId.trim(), format);
      const outPath = flagString(flags, 'out');
      if (outPath !== undefined) {
        writeOutFileExclusive(outPath, payload);
        return { exitCode: 0, stdout: jsonLine({ ok: true, command: 'collab result', session_id: sessionId.trim(), format, out: path.resolve(outPath), bytes: Buffer.byteLength(payload) }) };
      }
      return { exitCode: 0, stdout: payload };
    }
    if (subcommand === 'stop') {
      const sessionId = flagString(flags, 'session');
      if (sessionId === undefined || sessionId.trim() === '') return fail('collab stop requires --session', 64);
      const data = await collabStop(baseUrl, sessionId.trim());
      return {
        exitCode: 0,
        stdout: jsonLine({ ok: true, command: 'collab stop', board_url: baseUrl, ...data, note: '停止请求已提交；终态以 collab status 为准（stop 只发请求，不提前显示为已停止）' }),
      };
    }
    return { exitCode: 64, stdout: jsonLine({ ok: false, usage, error: `unknown collab subcommand: ${subcommand}` }) };
  } catch (error) {
    if (error instanceof CollabBoardUnreachableError) return fail(error.message, 3);
    if (error instanceof InputError) {
      // detail/cancel 的 409 业务拒绝 → exit 2；其余 InputError → 用法错误 64。
      return fail(error.message, inputErrorHttpStatus(error) === 409 ? 2 : 64);
    }
    if (error instanceof CollabProtocolError) return fail(error.message, 1);
    return fail(error instanceof Error ? error.message : String(error), 1);
  }
}
