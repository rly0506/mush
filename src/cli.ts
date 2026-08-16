/**
 * mush CLI（D21 同机跨工作区）— 最小命令集：status / dispatch / review。
 * 零依赖；--workspace 参数贯通所有命令。
 * dispatch：dry-run 全模拟并先过 per-actor USD admission 门（事件化记账）；
 * --real 需要 owner D6 确认记录（approval 文件），无确认 = BLOCKED_WAITING_OWNER。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsdBudgetLedger } from './core/budget.ts';
import { validateAdapterContract, type AdapterContract } from './adapters/contract.ts';
import { buildDeepSeekContract } from './adapters/deepseek.ts';
import { buildClaudeContract } from './adapters/claude.ts';
import { startBoardServer } from './web/server.ts';
import { LockError } from './web/persistence.ts';

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

function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function resolveWorkspace(flags: Record<string, string | boolean>): string {
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
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  if (command === undefined) {
    return { exitCode: 64, stdout: jsonLine({ ok: false, usage: 'mush <status|dispatch|review|board> [--workspace <dir>] [options]' }) };
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
    const server = await startBoardServer({
      approvalRoot,
      runId: `board-${workspace === process.cwd() ? 'mush' : path.basename(workspace)}`,
      assignmentEpoch: 1,
      host,
      port,
      runtimeRoot: path.join(workspace, 'runtime'),
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
      process.on('SIGINT', () => resolve());
      process.on('SIGTERM', () => resolve());
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

  return fail(`unknown command: ${command}`, 64);
}
