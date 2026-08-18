/**
 * GP-29 生产 runner：pi --mode rpc（JSONL 双向 stdio）。
 *
 * 线协议语义照黄金参照 invoke-managed-pi-agent.ps1 L262-L420（只读）：
 * - 一次性写入 {get_state}{prompt} 两命令（BOM-free UTF-8 + LF），stdin
 *   保持开启直到终态（T8-PI-RPC-001）；
 * - id/type/command/success 四元精确关联（T8-PI-RPC-003）；
 * - get_state.data.model = 运行时身份（期望非 UNKNOWN 时错配 fail-closed，
 *   D13 实测原则：UNKNOWN 则如实记录不拦）；
 * - message_end(assistant) = 终态完成；message_end(user) 等生命周期事件
 *   非完成候选（T8-PI-ASSISTANT-EVENT-ORDER-001）；
 * - 三段超时：handshake / settle / commit，全部 fail-closed 理由分类；
 * - DEF-02 spawn 失败受控；DEF-03 Windows 垫片解析复用（含 .mjs，DEF-12）。
 * 与 core/pi-rpc-session.ts（M1 fixture 件，绑 epoch 事件 schema）不同，
 * 本件面向 DispatchPipeline 的 RunAdapterResult 形态。
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWindowsShim } from './t1-runner.ts';
import { extractPiIdentity } from './pi.ts';
import type { AdapterContract } from './contract.ts';

export interface PiRpcSpawnFn {
  (executable: string, args: string[], opts: { cwd: string }): {
    stdin: { write: (chunk: string) => void; end: () => void };
    stdout: { on: (event: 'data', listener: (chunk: Buffer) => void) => void };
    stderr: { on: (event: 'data', listener: (chunk: Buffer) => void) => void };
    on: (event: 'exit', listener: (code: number | null) => void) => void;
    on: (event: 'error', listener: (error: Error) => void) => void;
    kill: () => void;
  };
}

export interface PiRpcRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
  confirmedProvider: string;
  confirmedModelId: string;
  failClosedReason: string | null;
}

export interface PiRpcRunOptions {
  workspaceRoot: string;
  receiptPath: string;
  timeoutMs: number;
  spawn?: PiRpcSpawnFn;
  resumeSession?: string;
  /** GOAL-014（M0）：carve-out 指定的犬工作根（spawn cwd）；缺省回退 workspaceRoot。 */
  cwd?: string;
}

const HANDSHAKE_TIMEOUT_MS = 30_000;
const COMMIT_TIMEOUT_MS = 30_000;
const MAX_NON_TERMINAL_TURNS = 200;

function defaultSpawn(executable: string, args: string[], opts: { cwd: string }) {
  const shim = resolveWindowsShim(executable);
  const child: ChildProcess = shim
    ? nodeSpawn(shim.node, [shim.entry, ...args], { cwd: opts.cwd, windowsHide: true })
    : nodeSpawn(executable, args, { cwd: opts.cwd, windowsHide: true });
  return child as unknown as ReturnType<PiRpcSpawnFn>;
}

function lineOf(id: string, type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id, type, ...extra });
}

export async function runPiRpc(contract: AdapterContract, prompt: string, options: PiRpcRunOptions): Promise<PiRpcRunResult> {
  const spawnFn = options.spawn ?? defaultSpawn;
  const sessionDir = path.join(options.workspaceRoot, 'runtime', 'pi-sessions');
  mkdirSync(sessionDir, { recursive: true });
  const args = [...contract.arguments, '--session-dir', sessionDir];
  if (options.resumeSession !== undefined && options.resumeSession !== '') {
    args.push('--session-id', options.resumeSession);
  }

  const stateCommandId = `mush-state-${randomUUID().replace(/-/g, '')}`;
  const promptCommandId = `mush-prompt-${randomUUID().replace(/-/g, '')}`;

  const result: PiRpcRunResult = {
    exitCode: -1,
    stdout: '',
    stderr: '',
    timedOut: false,
    childKilled: false,
    confirmedProvider: '',
    confirmedModelId: '',
    failClosedReason: null,
  };

  let child: ReturnType<PiRpcSpawnFn>;
  try {
    child = spawnFn(contract.executable, args, { cwd: options.cwd ?? options.workspaceRoot });
  } catch (error) {
    // DEF-02 受控：spawn 同步异常不崩宿主。
    result.exitCode = 127;
    result.stderr = `pi spawn failed: ${error instanceof Error ? error.message : String(error)}`;
    result.failClosedReason = 'spawn-error';
    writeReceipt(options.receiptPath, contract.adapter_id, result, prompt);
    return result;
  }

  return await new Promise<PiRpcRunResult>((resolve) => {
    const startedAt = new Date().toISOString();
    const overallDeadline = Date.now() + options.timeoutMs + COMMIT_TIMEOUT_MS;
    const handshakeDeadline = Date.now() + Math.min(HANDSHAKE_TIMEOUT_MS, options.timeoutMs);
    let settleDeadline = Number.POSITIVE_INFINITY;
    let commitDeadline = Number.POSITIVE_INFINITY;

    let stateConfirmed = false;
    let promptConfirmed = false;
    let settled = false;
    let nonTerminalTurns = 0;
    let buffer = '';
    let stderrText = '';
    const completionParts: string[] = [];
    let finished = false;

    const childError: { message: string | null } = { message: null };
    let exited = false;
    child.on('error', (error: Error) => {
      childError.message = error.message;
    });

    const finish = (reason: string | null, exitCode: number, timedOut: boolean, killed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(ticker);
      result.failClosedReason = reason;
      result.exitCode = exitCode;
      result.timedOut = timedOut;
      result.childKilled = killed;
      result.stdout = completionParts.join('\n').trim();
      result.stderr = stderrText.trim();
      // 会话续跑锚点：dispatch 侧 extractSessionId 已识别 "session_id: xxx" 形态。
      if (stateConfirmed && identity.sessionId !== null) {
        result.stdout += `\nsession_id: ${identity.sessionId}`;
      }
      if (reason !== null && result.stderr === '') {
        result.stderr = `pi-rpc fail-closed: ${reason}`;
      }
      writeReceipt(options.receiptPath, contract.adapter_id, { ...result, startedAtUtc: startedAt, finishedAtUtc: new Date().toISOString() }, prompt);
      resolve(result);
    };

    // 黄金参照语义：阶段 deadline 轮询检查，不依赖 stdout 活跃（静默子进程
    // 也要按时 settle-timeout fail-closed）。
    const checkPhases = () => {
      const now = Date.now();
      if (!stateConfirmed && now > handshakeDeadline) finish('state-handshake-timeout', 1, true, true);
      else if (stateConfirmed && !promptConfirmed && now > handshakeDeadline) finish('prompt-handshake-timeout', 1, true, true);
      else if (promptConfirmed && !settled && now > settleDeadline) {
        finish('agent-settle-timeout', 1, true, true);
        child.kill();
      } else if (settled && now > commitDeadline) {
        finish('commit-timeout', 1, true, true);
        child.kill();
      }
    };

    const identity = { provider: '', modelId: '', sessionId: null as string | null };

    const timer = setTimeout(() => {
      child.kill();
      finish(result.failClosedReason ?? 'process-timeout', result.exitCode === -1 ? 1 : result.exitCode, true, true);
    }, overallDeadline - Date.now());
    // 阶段 deadline 轮询（黄金参照语义）：不依赖 stdout 活跃。
    const ticker = setInterval(checkPhases, 100);

    child.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString('utf8');
    });

    child.on('exit', (code: number | null) => {
      exited = true;
      if (settled || code === 0) {
        finish(result.failClosedReason, code ?? 0, false, false);
      } else if (!finished) {
        finish(childError.message !== null ? 'spawn-error' : 'agent-exited-before-settled', code ?? 1, false, false);
      }
    });

    const handleLine = (line: string) => {
      if (line.trim() === '') return;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // 非 JSON 行忽略（审计镜像由回执承担）
      }
      const lineId = typeof obj.id === 'string' ? obj.id : '';
      const lineType = typeof obj.type === 'string' ? obj.type : '';
      const lineCommand = typeof obj.command === 'string' ? obj.command : '';

      if (lineId === stateCommandId && lineType === 'response' && lineCommand === 'get_state') {
        if (obj.success !== true) {
          finish('state-error', 1, false, false);
          return;
        }
        const ident = extractPiIdentity(obj.data);
        identity.provider = ident.provider;
        identity.modelId = ident.modelId;
        identity.sessionId = ident.sessionId;
        result.confirmedProvider = ident.provider;
        result.confirmedModelId = ident.modelId;
        if (ident.provider === '' || ident.modelId === '') {
          finish('missing-runtime-identity', 1, false, false);
          return;
        }
        if (
          contract.expected_provider !== 'UNKNOWN' &&
          (ident.provider !== contract.expected_provider || ident.modelId !== contract.expected_model_id)
        ) {
          finish(
            `wrong-runtime-model: got ${ident.provider}/${ident.modelId} want ${contract.expected_provider}/${contract.expected_model_id}`,
            1,
            false,
            false,
          );
          return;
        }
        stateConfirmed = true;
        return;
      }
      if (lineId === promptCommandId && lineType === 'response' && lineCommand === 'prompt') {
        if (obj.success !== true) {
          finish('prompt-error', 1, false, false);
          return;
        }
        promptConfirmed = true;
        if (stateConfirmed) settleDeadline = Date.now() + options.timeoutMs;
        return;
      }
      if (lineType === 'message_end') {
        const message = (obj.message ?? {}) as Record<string, unknown>;
        const role = typeof message.role === 'string' ? message.role : '';
        if (role !== 'assistant') return; // 生命周期事件非完成候选（黄金 T8-…-001）
        nonTerminalTurns += 1;
        const content = Array.isArray(message.content) ? message.content : [];
        for (const item of content) {
          const block = item as Record<string, unknown>;
          if (block.type === 'text' && typeof block.text === 'string') completionParts.push(block.text);
        }
        if (nonTerminalTurns >= MAX_NON_TERMINAL_TURNS) {
          finish('non-terminal-turn-overflow', 1, false, false);
          return;
        }
        // 首个 assistant 终态即完成（黄金语义：恰一次）。
        if (completionParts.length > 0) {
          settled = true;
          commitDeadline = Date.now() + COMMIT_TIMEOUT_MS;
          child.stdin.end();
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    });

    // T8-PI-RPC-001：双命令一次写入，stdin 保持开启直到终态。
    const payload =
      lineOf(stateCommandId, 'get_state') + '\n' + lineOf(promptCommandId, 'prompt', { message: prompt }) + '\n';
    child.stdin.write(payload);
  });
}

function writeReceipt(receiptPath: string, adapterId: string, result: PiRpcRunResult & Record<string, unknown>, prompt: string): void {
  try {
    mkdirSync(path.dirname(path.resolve(receiptPath)), { recursive: true });
    const receipt = {
      schema_version: 1,
      adapter_id: adapterId,
      protocol: 'pi-rpc',
      prompt_sha256: createHash('sha256').update(prompt, 'utf8').digest('hex').toUpperCase(),
      exit_code: result.exitCode,
      timed_out: result.timedOut,
      child_killed: result.childKilled,
      confirmed_provider: result.confirmedProvider,
      confirmed_model_id: result.confirmedModelId,
      fail_closed_reason: result.failClosedReason,
      stdout_sha256: createHash('sha256').update(result.stdout, 'utf8').digest('hex').toUpperCase(),
      stderr_sha256: createHash('sha256').update(result.stderr, 'utf8').digest('hex').toUpperCase(),
      started_at_utc: result.startedAtUtc,
      finished_at_utc: result.finishedAtUtc,
    };
    writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', 'utf8');
  } catch {
    // 回执失败不阻断结果返回。
  }
}
