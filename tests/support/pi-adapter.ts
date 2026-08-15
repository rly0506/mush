/**
 * M1 fixture-reference（非生产实现）：
 * 把黄金参照 bridge-pi-adapter.tests.ps1 覆盖的 capability / fail-closed / IPC
 * 事件 / 重启语义翻译为 Node/TS 可执行参考件；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-adapter.tests.ps1 L25-L224
 *   D:\意向项目\.agent-bridge\tools\tests\fake-pi-agent.ps1 L23-L98
 */

export const PI_CAPABILITY_FIELDS = [
  'adapter_id',
  'adapter_version',
  'cli_path',
  'cli_version',
  'provider',
  'model_id',
  'credential_status',
  'identity_source',
  'confidence',
  'protocol',
  'supported_roles',
] as const;

export type PiCapabilityField = (typeof PI_CAPABILITY_FIELDS)[number];

export type PiCapability = Record<PiCapabilityField, unknown> & {
  adapter_id: string;
  adapter_version: string;
  cli_path: string;
  cli_version: string;
  provider: string;
  model_id: string;
  credential_status: string;
  identity_source: string;
  confidence: string;
  protocol: string;
  supported_roles: string[];
};

export function makePiCapability(input: Record<string, unknown>): PiCapability {
  return {
    adapter_id: String(input.adapter_id ?? ''),
    adapter_version: String(input.adapter_version ?? ''),
    cli_path: String(input.cli_path ?? ''),
    cli_version: String(input.cli_version ?? ''),
    provider: String(input.provider ?? ''),
    model_id: String(input.model_id ?? ''),
    credential_status: String(input.credential_status ?? ''),
    identity_source: String(input.identity_source ?? ''),
    confidence: String(input.confidence ?? ''),
    protocol: String(input.protocol ?? ''),
    supported_roles: Array.isArray(input.supported_roles) ? input.supported_roles.map(String) : [],
  };
}

/**
 * 精确 provider/model fail-closed（移植 PS L67-L68 的两个 Assert-PiFailure）。
 * 与预期不符抛 /provider|model/；UNKNOWN 模型抛 /UNKNOWN|model/。
 */
export function assertPiProviderModel(
  capability: PiCapability,
  expectedProvider: string,
  expectedModelId: string,
): void {
  if (capability.provider !== expectedProvider || capability.model_id !== expectedModelId) {
    throw new Error(
      `Pi provider/model mismatch: expected provider=${expectedProvider} model=${expectedModelId}, ` +
        `got provider=${capability.provider} model=${capability.model_id}.`,
    );
  }
  if (capability.model_id === 'UNKNOWN') {
    throw new Error('Pi capability declares UNKNOWN runtime model; must fail closed.');
  }
}

/** working directory 必须被 run root 包含（移植 PS L69）。 */
export function assertWorkingDirectoryInside(workingDirectory: string, runRoot: string): void {
  const fullWorking = path.resolve(workingDirectory);
  const fullRoot = path.resolve(runRoot);
  const relative = path.relative(fullRoot, fullWorking);
  if (relative === '' ) return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Pi working directory must be contained by the run root: working=${fullWorking} root=${fullRoot}`,
    );
  }
}

import path from 'node:path';

/**
 * GOAL010-T8-PI-TIMEOUT-PLUMBING-001（移植 PS L37-L64）：
 * 生产 dispatcher 必须把配置的 TimeoutSeconds 转发进 handshake / settle / exit /
 * process 四个边界，并把 task-packet 截止时间与 actor 非终态回合预算绑定到同一
 * 硬预算。
 */
export interface ManagedPiLaunchSpec {
  handshakeTimeoutSeconds: number;
  settleTimeoutSeconds: number;
  exitTimeoutSeconds: number;
  processTimeoutSeconds: number;
  maxNonTerminalTurns: number;
  packetDeadlineSeconds: number;
}

export function buildManagedPiLaunchSpec(
  timeoutSeconds: number,
  maxNonTerminalTurns: number,
): ManagedPiLaunchSpec {
  return {
    handshakeTimeoutSeconds: timeoutSeconds,
    settleTimeoutSeconds: timeoutSeconds,
    exitTimeoutSeconds: timeoutSeconds,
    processTimeoutSeconds: timeoutSeconds,
    maxNonTerminalTurns,
    packetDeadlineSeconds: timeoutSeconds,
  };
}

/**
 * GOAL010-T8-PI-RPC-004 级 IPC 事件校验（移植 PS L115-L134 的验收语义）：
 * stdout-only / 错误签名 / 错误 capability 都必须 fail closed。
 */
export interface IpcEventContext {
  expectedPacketPath: string;
  expectedPacketSha256: string;
  expectedRunId: string;
  expectedDispatchId: string;
  expectedProvider: string;
  expectedModelId: string;
}

export type IpcValidationResult =
  | { ok: true }
  | { ok: false; reason: 'ipc-event' | 'ipc-event-missing-or-invalid' | 'wrong-runtime-model' };

export function validateManagedPiIpcEvent(
  event: unknown,
  ctx: IpcEventContext,
): IpcValidationResult {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, reason: 'ipc-event' };
  }
  const e = event as Record<string, unknown>;
  const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
  if (str(e.event_type) !== 'review_ready') return { ok: false, reason: 'ipc-event-missing-or-invalid' };
  if (str(e.provider) !== ctx.expectedProvider || str(e.model_id) !== ctx.expectedModelId) {
    return { ok: false, reason: 'wrong-runtime-model' };
  }
  if (str(e.signature) === '' || str(e.signature) === '0'.repeat(64)) {
    return { ok: false, reason: 'ipc-event-missing-or-invalid' };
  }
  if (str(e.capability_id) === '' || str(e.capability_id) === '0'.repeat(32)) {
    return { ok: false, reason: 'ipc-event-missing-or-invalid' };
  }
  if (str(e.packet_sha256) !== ctx.expectedPacketSha256) {
    return { ok: false, reason: 'ipc-event-missing-or-invalid' };
  }
  if (str(e.run_id) !== ctx.expectedRunId || str(e.dispatch_id) !== ctx.expectedDispatchId) {
    return { ok: false, reason: 'ipc-event-missing-or-invalid' };
  }
  return { ok: true };
}

/**
 * 同 profile 重启语义（移植 PS L215-L224）：
 * - fail_once：首次失败后重启一次，第二次成功 → DONE（restart_count=1）
 * - 重启预算用尽后再次失败 → WAIT_EXECUTOR
 */
export interface ActorAttemptResult {
  status: 'DONE' | 'WAIT_EXECUTOR';
  exitCode: number;
  restartCount: number;
}

export function simulateManagedPiActorWithRestarts(
  attemptExitCodes: number[],
  maxRestarts: number,
): ActorAttemptResult {
  let restartCount = 0;
  let exitCode = attemptExitCodes[attemptExitCodes.length - 1] ?? 0;
  for (let index = 0; index < attemptExitCodes.length; index += 1) {
    exitCode = attemptExitCodes[index];
    if (exitCode === 0) return { status: 'DONE', exitCode, restartCount };
    const hasNextAttempt = index < attemptExitCodes.length - 1;
    if (hasNextAttempt && restartCount < maxRestarts) {
      restartCount += 1;
      continue;
    }
    return { status: 'WAIT_EXECUTOR', exitCode, restartCount };
  }
  return { status: 'WAIT_EXECUTOR', exitCode, restartCount };
}

/**
 * 收据不得含密钥材料（移植 PS L201-L206）。
 */
export function assertSecretFree(secretProbe: string): void {
  if (/SECRET|TOKEN|PASSWORD/.test(secretProbe)) {
    throw new Error('Pi receipt contains secret material.');
  }
}
