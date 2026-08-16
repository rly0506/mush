/**
 * M1 fixture-reference（非生产实现）：
 * bridge-pi-adapter.tests.ps1 剩余 fixture 的可执行语义参考件；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-adapter.tests.ps1 L100-L206
 */

import path from 'node:path';
import { quoteWindowsArgument } from './windows-argument.ts';

export interface ManagedPiWrapperLaunch {
  wrapperExecutable: string;
  targetExecutable: string;
  argvBase64: string;
  argumentsLine: string;
}

/**
 * 直接 node 目标经可信 PowerShell 5.1 wrapper host 启动时：
 * wrapper host 不变、目标 executable 不变、目标 argv 以 UTF-8 base64 精确传递
 * （移植 PS L100-L113 断言语义）。
 */
export function buildManagedPiWrapperLaunch(opts: {
  wrapperHostExecutable: string;
  targetExecutable: string;
  targetArguments: string[];
}): ManagedPiWrapperLaunch {
  const argvJson = JSON.stringify(opts.targetArguments);
  const argvBase64 = Buffer.from(argvJson, 'utf8').toString('base64');
  const argumentsLine = [
    '-PiExecutable',
    quoteWindowsArgument(opts.targetExecutable),
    '-PiArgumentsBase64',
    argvBase64,
  ].join(' ');
  return {
    wrapperExecutable: opts.wrapperHostExecutable,
    targetExecutable: opts.targetExecutable,
    argvBase64,
    argumentsLine,
  };
}

export interface EarlyExitResult {
  reason: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  elapsedBoundMs: number;
}

/**
 * 早期 fail-closed 退出必须比外层 IPC 等待更快，并保留精确 reason、退出码 63、
 * stdout 与 stderr（移植 PS L136-L177 的断言语义；handshake 超时按毫秒注入）。
 */
export async function runEarlyExitFixture(opts: {
  handshakeTimeoutMs: number;
  elapsedBoundMs: number;
}): Promise<EarlyExitResult> {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, opts.handshakeTimeoutMs));
  const elapsedMs = Date.now() - start;
  const reason = 'state-handshake-timeout';
  return {
    reason,
    exitCode: 63,
    stdout: JSON.stringify({ type: 'bridge_fail_closed', reason }),
    stderr: 'Managed Pi RPC fail-closed: ' + reason,
    elapsedMs,
    elapsedBoundMs: opts.elapsedBoundMs,
  };
}

/**
 * packet 路径祖先链不得含 reparse point（junction）——移植 PS L191-L199 语义；
 * 用可注入 isReparse 谓词替代 Windows 文件属性查询，断言强度保持（祖先任一命中即拒）。
 */
export function assertNoReparseAncestry(
  targetPath: string,
  rootPath: string,
  isReparse: (segmentPath: string) => boolean,
): void {
  const fullTarget = path.resolve(targetPath);
  const fullRoot = path.resolve(rootPath);
  let current = fullTarget;
  while (true) {
    if (isReparse(current)) {
      throw new Error('Signed Pi packet path contains a reparse point.');
    }
    if (current.toLowerCase() === fullRoot.toLowerCase()) return;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Signed Pi packet path escaped the run root.');
    }
    current = parent;
  }
}

export interface OrderlyReceipt {
  profile: string;
  heartbeat: string;
  status: string;
  secret_probe: string;
}

/** orderly exit 收据（移植 fake-pi-agent.ps1 L90-L98 的输出语义）。 */
export function buildOrderlyReceipt(profile: string, secretProbe: string): OrderlyReceipt {
  return {
    profile,
    heartbeat: 'ready',
    status: 'DONE',
    secret_probe: secretProbe,
  };
}

/** review_ready 必须携带 created_at_utc（PS L120 断言语义）。 */
export function assertEventCreatedAtUtc(event: unknown): void {
  if (event === null || typeof event !== 'object') {
    throw new Error('IPC event is missing created_at_utc.');
  }
  const created = (event as Record<string, unknown>).created_at_utc;
  if (typeof created !== 'string' || created.trim() === '') {
    throw new Error('Managed Pi IPC event must carry created_at_utc for dispatch ordering.');
  }
}
