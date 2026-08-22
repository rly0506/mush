/**
 * M1 fixture-reference（非生产实现）：
 * 把 Windows 内核 Job Object / 进程树清理的 fixture 断言语义翻译到可注入 fake
 * 进程模型。Node 零依赖没有 Job Object 等价物，因此移植“语义”（close 杀整棵树、
 * 失败保留句柄、身份不匹配不杀进程），断言强度保持。M2 若需真实内核 Job Object
 * 再单独立项（见 finding）。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1 L300-L506
 */

import { quoteWindowsArgument } from './windows-argument.ts';

export interface FakeProcess {
  readonly pid: number;
  alive: boolean;
  children: FakeProcess[];
}

export function makeFakeProcess(pid: number, children: FakeProcess[] = []): FakeProcess {
  return { pid, alive: true, children };
}

export interface ProcessJobHandle {
  valid: boolean;
}

export function makeInvalidHandle(): ProcessJobHandle {
  return { valid: false };
}

function makeValidHandle(): ProcessJobHandle {
  return { valid: true };
}

function killTree(process: FakeProcess): void {
  process.alive = false;
  for (const child of process.children) killTree(child);
}

export interface ProcessJob {
  readonly name: string;
  closed: boolean;
  handleConsumed(): boolean;
  assign(process: FakeProcess): void;
  close(): void;
}

/**
 * Job Object 语义模型（PS New-BridgeProcessJob / Add-BridgeProcessToJob /
 * Close-BridgeProcessJob）：
 * - 名字 AgentBridge- 前缀
 * - 无效句柄：assign 与 close 都抛错；close 失败后 closed 保持 false、句柄保留
 * - 有效 close：kill-on-close 终止整棵已分配进程树，句柄置为已消费
 */
export function createProcessJob(
  runId: string,
  dispatchId: string,
  handle: ProcessJobHandle = makeValidHandle(),
): ProcessJob {
  const assigned = new Set<FakeProcess>();
  let consumed = false;
  const job: ProcessJob = {
    name: `AgentBridge-${runId}-${dispatchId}`,
    closed: false,
    handleConsumed: () => consumed,
    assign(process: FakeProcess): void {
      if (!handle.valid) {
        throw new Error(`Invalid Job Object assignment failed for process ${process.pid}.`);
      }
      assigned.add(process);
    },
    close(): void {
      if (!handle.valid) {
        throw new Error(`Closing an invalid Job Object handle failed: ${job.name}`);
      }
      job.closed = true;
      for (const process of assigned) killTree(process);
      assigned.clear();
      consumed = true;
      handle.valid = false;
    },
  };
  return job;
}

/** PID + start time 身份校验（PS Assert-BridgeProcessIdentity L347-L357 语义）。 */
export function assertProcessIdentity(
  pid: number,
  startedAtUtc: string,
  lookup: (pid: number) => string | null,
): void {
  const actual = lookup(pid);
  if (actual === null) {
    throw new Error(`Process identity validation failed: process ${pid} not found.`);
  }
  if (actual !== startedAtUtc) {
    throw new Error(`Process identity validation must reject a mismatched start time for ${pid}.`);
  }
}

export interface ProcessSnapshotEntry {
  process_id: number;
  depth: number;
  start_time_ticks: number;
}

/**
 * fallback 清理：身份不匹配必须拒绝且绝不进入 kill 路径
 * （PS Stop-BridgeProcessSnapshot L421-L440 语义）。
 */
export function stopProcessSnapshot(
  snapshot: ProcessSnapshotEntry[],
  lookup: (pid: number) => { alive: boolean; startTicks: number } | null,
  kill: (pid: number) => void,
): void {
  for (const entry of snapshot) {
    const actual = lookup(entry.process_id);
    if (actual === null) {
      throw new Error(`Process snapshot identity missing: ${entry.process_id}`);
    }
    if (actual.startTicks !== entry.start_time_ticks) {
      throw new Error(`Process snapshot identity mismatch for ${entry.process_id}.`);
    }
    kill(entry.process_id);
  }
}

/**
 * 未归属树的 assignment-failure 清理：即使 taskkill 代理失败，也必须整树终止
 * （PS Stop-OwnedProcessTree L391-L420 语义）。
 * GOAL-067：删除无人读取的 _opts 遗迹形参（killTree 无条件整树终止）。
 */
export function stopOwnedProcessTree(
  rootPid: number,
  processes: FakeProcess[],
): void {
  const root = processes.find((process) => process.pid === rootPid);
  if (root === undefined) {
    throw new Error(`Owned process tree root missing: ${rootPid}`);
  }
  killTree(root);
}

export interface GateView {
  exists: boolean;
  dispatchId: string;
}

export interface GatedLauncherState {
  actor: FakeProcess;
  job: ProcessJob;
  started?: boolean;
}

/**
 * 可信 launcher 门控状态机的一步（PS L1069-L1075 + 测试 L475-L555 语义）：
 * - 门不存在：继续等待，actor 不得启动
 * - 门 dispatch_id 不匹配：抛错，actor 不得启动
 * - 门匹配：先完成 Job assignment（失败即 assignment failure 先于 actor 启动），
 *   再标记 actor 已启动
 */
export function runGatedLauncherStep(
  state: GatedLauncherState,
  gate: GateView | null,
  expectedDispatchId: string,
): void {
  if (gate === null || !gate.exists) return;
  if (gate.dispatchId !== expectedDispatchId) {
    throw new Error('Dispatch gate does not match BRIDGE_DISPATCH_ID.');
  }
  state.job.assign(state.actor);
  state.started = true;
}

export interface LaunchSpec {
  executable: string;
  arguments: string[];
  argument_line: string;
  stdin_required: boolean;
}

/** launch spec 构建（PS L117-L124 语义：argument_line 用 ConvertTo-WindowsArgument 逐项引用）。 */
export function buildLaunchSpec(
  executable: string,
  args: string[],
  stdinRequired = true,
): LaunchSpec {
  return {
    executable,
    arguments: [...args],
    argument_line: args.map((arg) => quoteWindowsArgument(arg)).join(' '),
    stdin_required: stdinRequired,
  };
}
