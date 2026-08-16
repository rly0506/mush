/**
 * mush 适配器层（M3）— T1 单发 headless + 文件落盘回报通用底座。
 *
 * 合同：docs/capability-probes/harness-landscape-2026-08-16.md T1 档。
 * 沙箱说明（AD-02）：harness 沙箱对 piped-stdio 子进程 spawn 返回 EPERM，
 * 因此 runner 接受可注入 SpawnFn；测试用 fake 子进程验证运行器语义，
 * 生产路径使用同一代码 + 默认 node:child_process spawn。
 */

import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AdapterContract } from './contract.ts';

export interface ChildProcessLike {
  stdinWrite?(chunk: string): void;
  stdinEnd?(): void;
  onStdout(listener: (chunk: Buffer | string) => void): void;
  onStderr(listener: (chunk: Buffer | string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export type SpawnFn = (
  executable: string,
  args: string[],
  opts: { cwd: string },
) => ChildProcessLike;

export interface T1IdentityEvidence {
  stdout: string;
  stderr: string;
  exitCode: number;
  contract: AdapterContract;
}

export interface T1Receipt {
  schema_version: 1;
  adapter_id: string;
  started_at_utc: string;
  finished_at_utc: string;
  exit_code: number;
  timed_out: boolean;
  child_killed: boolean;
  identity_fail_closed: boolean;
  stdout_sha256: string;
  stderr_sha256: string;
}

export interface T1RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
  receiptPath: string;
  receipt: T1Receipt;
}

export interface T1RunOptions {
  contract: AdapterContract;
  prompt: string;
  workspaceRoot: string;
  receiptPath: string;
  timeoutMs: number;
  spawn?: SpawnFn;
  identityVerifier?: (evidence: T1IdentityEvidence) => void;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function defaultSpawn(executable: string, args: string[], opts: { cwd: string }): ChildProcessLike {
  const child = nodeSpawn(executable, args, { cwd: opts.cwd, windowsHide: true });
  return {
    stdinWrite: (chunk) => {
      if (child.stdin !== null) child.stdin.write(chunk);
    },
    stdinEnd: () => {
      if (child.stdin !== null) child.stdin.end();
    },
    onStdout: (listener) => child.stdout.on('data', listener),
    onStderr: (listener) => child.stderr.on('data', listener),
    onExit: (listener) => child.on('exit', listener),
    kill: () => child.kill(),
  };
}

/**
 * 跑一个 T1 单发：prompt 按合同（stdin 或最终参数）交给子进程，超时 fail-closed
 * kill，收 stdout/stderr/exit code，写带哈希锚点的文件回报；identityVerifier
 * 抛错即身份 fail-closed（回报仍落盘并标记）。
 */
export async function runT1(options: T1RunOptions): Promise<T1RunResult> {
  const contract = options.contract;
  if (contract.protocol !== 't1') {
    throw new Error(`T1 runner only accepts protocol 't1', got '${contract.protocol}'`);
  }
  const spawn = options.spawn ?? defaultSpawn;
  const args =
    contract.prompt_transport === 'argument'
      ? [...contract.arguments, options.prompt]
      : [...contract.arguments];
  const startedAt = new Date().toISOString();
  const child = spawn(contract.executable, args, { cwd: options.workspaceRoot });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let childKilled = false;
  let exitCode = 124;
  let identityError: Error | null = null;

  child.onStdout((chunk) => {
    stdout += chunk.toString();
  });
  child.onStderr((chunk) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      childKilled = true;
      try {
        child.kill();
      } catch {
        // kill 失败仍按超时 fail-closed 收尾。
      }
    }, options.timeoutMs);
    child.onExit((code) => {
      clearTimeout(timer);
      exitCode = timedOut ? 124 : (code ?? 124);
      resolve();
    });
    if (contract.prompt_transport === 'stdin') {
      child.stdinWrite?.(options.prompt);
      child.stdinEnd?.();
    }
  });

  if (options.identityVerifier !== undefined) {
    try {
      options.identityVerifier({ stdout, stderr, exitCode, contract });
    } catch (error) {
      identityError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const receipt: T1Receipt = {
    schema_version: 1,
    adapter_id: contract.adapter_id,
    started_at_utc: startedAt,
    finished_at_utc: new Date().toISOString(),
    exit_code: exitCode,
    timed_out: timedOut,
    child_killed: childKilled,
    identity_fail_closed: identityError !== null,
    stdout_sha256: sha256Hex(stdout),
    stderr_sha256: sha256Hex(stderr),
  };
  mkdirSync(path.dirname(path.resolve(options.receiptPath)), { recursive: true });
  writeFileSync(options.receiptPath, JSON.stringify(receipt) + '\n', 'utf8');

  if (identityError !== null) throw identityError;
  return {
    exitCode,
    stdout,
    stderr,
    timedOut,
    childKilled,
    receiptPath: options.receiptPath,
    receipt,
  };
}
