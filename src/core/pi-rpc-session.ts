/**
 * M1 fixture-reference（非生产实现）：
 * 把黄金参照 invoke-managed-pi-agent.ps1 的 RPC 会话状态机翻译为 Node/TS 可执行
 * 参考件，仅服务于 M1 fixture 翻译测试；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1 L160-L520
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-rpc.tests.ps1 L283-L504
 *
 * 时间单位说明：PS 版参数为秒（1..3600）；本参考件接受毫秒，测试用小值跑同一
 * 超时状态机，断言语义（reason / 无事件 / fail-closed / 杀子进程）不弱化。
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  makeRealPathResolver,
  validateCompletion,
  validateTaskPacket,
} from './pi-rpc-completion.ts';
import { stripOuterJsonFence } from './pi-rpc-wire.ts';

export interface RpcChildApi {
  stateCommandId: string;
  promptCommandId: string;
}

export type RpcChildScript = (
  api: RpcChildApi,
) => AsyncGenerator<string | null, void, void>;

export interface RpcSessionOptions {
  expectedProvider: string;
  expectedModelId: string;
  /** dispatch packet 的严格 UTF-8 文本，也就是 Pi prompt（GOAL010-T8-PI-RPC-005）。 */
  promptContent: string;
  dispatchPacketPath: string;
  goalPacketPath: string;
  runRoot: string;
  handshakeTimeoutMs?: number;
  settleTimeoutMs?: number;
  exitTimeoutMs?: number;
  processTimeoutMs?: number;
  maxNonTerminalTurns?: number;
  childExitCode?: number;
  childScript: RpcChildScript;
  /** stdout audit 镜像钩子：只写不读，供 GOAL010-T8-PI-RPC-006 篡改测试。 */
  auditHook?: (auditLines: string[]) => void;
}

export interface RpcEvent extends Record<string, unknown> {
  schema_version: number;
  event_id: string;
  goal_id: string;
  run_id: string;
  assignment_epoch: number;
  sequence: number;
  parent_instance_id: string;
  actor_role: string;
  actor_instance_id: string;
  dispatch_id: string;
  event_type: string;
  phase: number;
  finding_ids: unknown[];
  finding_material_digests: Record<string, unknown>;
  packet_path: string;
  packet_sha256: string;
  config_digest: string;
  capability_id: string;
  signature: string;
  provider: string;
  model_id: string;
  created_at_utc: string;
}

export interface RpcSessionResult {
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
  event: RpcEvent | null;
  failClosedReason: string | null;
  deliveredPrompt: string | null;
  settleStarted: boolean;
  stdinWasOpenAtSettle: boolean;
  stdinClosed: boolean;
  nonTerminalTurns: number;
  childKilled: boolean;
  auditLines: string[];
}

const ZERO64 = '0'.repeat(64);

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nowMs(): number {
  return Date.now();
}

/** 构造 get_state 响应行（默认正确身份；可注入错误身份）。 */
export function stateResponse(
  id: string,
  opts: { provider?: string; modelId?: string; success?: boolean } = {},
): string {
  return JSON.stringify({
    type: 'response',
    id,
    command: 'get_state',
    success: opts.success ?? true,
    data: { model: { provider: opts.provider ?? 'deepseek', id: opts.modelId ?? 'deepseek-v4-pro' } },
  });
}

export function promptResponseSuccess(id: string): string {
  return JSON.stringify({ type: 'response', id, command: 'prompt', success: true });
}

export function promptResponseFailure(id: string, error = 'fake-prompt-failure'): string {
  return JSON.stringify({ type: 'response', id, command: 'prompt', success: false, error });
}

export interface MessageEndOptions {
  role?: 'assistant' | 'user';
  completion?: Record<string, unknown>;
  content?: unknown[];
  fenced?: boolean;
  fencedIncomplete?: boolean;
}

/** message_end 生命周期行（fake-pi-rpc-agent.ps1 L63-L98 的输出语义）。 */
export function messageEnd(options: MessageEndOptions = {}): string {
  const role = options.role ?? 'assistant';
  let content: unknown[];
  if (options.content !== undefined) {
    content = options.content;
  } else {
    const completionText = options.completion === undefined ? '' : JSON.stringify(options.completion);
    const text = options.fenced
      ? '```json\n' + completionText + '\n```'
      : options.fencedIncomplete
        ? '```json\n' + completionText
        : completionText;
    content = [{ type: 'text', text }];
  }
  return JSON.stringify({ type: 'message_end', message: { role, content } });
}

/** 无 completion 文本候选的 assistant 工具调用回合（fake L81-L98）。 */
export function toolCallMessageEnd(): string {
  return messageEnd({
    role: 'assistant',
    content: [
      { type: 'thinking', text: 'Let me verify the fixture evidence before completing.' },
      {
        type: 'toolCall',
        toolCall: { id: 'tool-call-1', name: 'read_file', arguments: '{"path":"fixture"}' },
      },
    ],
  });
}

export function agentSettled(): string {
  return JSON.stringify({ type: 'agent_settled' });
}

export function messageUpdate(): string {
  return JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'unexpected semantic assistant output after completion' },
  });
}

function failClosed(result: RpcSessionResult, reason: string): RpcSessionResult {
  result.failClosedReason = reason;
  result.stdoutLines.push(JSON.stringify({ type: 'bridge_fail_closed', reason }));
  result.stderrLines.push('Managed Pi RPC fail-closed: ' + reason);
  result.exitCode = 63;
  return result;
}

interface PendingLine {
  done: boolean;
  value: string | null;
}

function raceNext(
  generator: AsyncGenerator<string | null, void, void>,
  waitMs: number,
): Promise<PendingLine | 'timeout'> {
  // GOAL-068（A8）：race 输掉的 setTimeout 句柄此前永不清理——fail-closed 提前
  // 返回后，最长 processTimeoutMs 的挂起 timer 会钉住事件循环延迟进程退出。
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    generator.next().then((next) => {
      if (timer !== undefined) clearTimeout(timer);
      return {
        done: next.done === true,
        value: next.done ? null : (next.value ?? null),
      } satisfies PendingLine;
    }),
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), waitMs);
    }),
  ]);
}

/**
 * RPC 会话状态机（移植 wrapper L245-L519 的逐行判定与超时结构）。
 * childScript 模拟子进程 stdout 行流；生成器结束 = 子进程退出（EOF）。
 */
export async function runRpcSession(options: RpcSessionOptions): Promise<RpcSessionResult> {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 30_000;
  const settleTimeoutMs = options.settleTimeoutMs ?? 30_000;
  const exitTimeoutMs = options.exitTimeoutMs ?? 60_000;
  const processTimeoutMs = options.processTimeoutMs ?? 300_000;
  const maxNonTerminalTurns = options.maxNonTerminalTurns ?? 8;
  const childExitCode = options.childExitCode ?? 0;

  const result: RpcSessionResult = {
    exitCode: childExitCode,
    stdoutLines: [],
    stderrLines: [],
    event: null,
    failClosedReason: null,
    deliveredPrompt: null,
    settleStarted: false,
    stdinWasOpenAtSettle: false,
    stdinClosed: false,
    nonTerminalTurns: 0,
    childKilled: false,
    auditLines: [],
  };

  // GOAL010-T8-PI-RPC-005：dispatch packet 必须是独立于 Goal packet 的文件。
  const dispatchResolved = path.resolve(options.dispatchPacketPath);
  const goalResolved = path.resolve(options.goalPacketPath);
  if (dispatchResolved.toLowerCase() === goalResolved.toLowerCase()) {
    return failClosed(result, 'distinct');
  }

  let taskPacket: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(options.promptContent);
    const packet = asObject(parsed);
    if (packet === null) throw new Error('not an object');
    taskPacket = packet;
  } catch {
    return failClosed(result, 'completion-task-packet-malformed');
  }
  const packetReason = validateTaskPacket(taskPacket);
  if (packetReason !== null) return failClosed(result, packetReason);

  result.deliveredPrompt = options.promptContent;
  const stateCommandId = 'bridge-get-state-' + crypto.randomUUID().replace(/-/g, '');
  const promptCommandId = 'bridge-prompt-' + crypto.randomUUID().replace(/-/g, '');

  const resolver = makeRealPathResolver();
  const generator = options.childScript({ stateCommandId, promptCommandId });

  let phase: 'handshake' | 'settle' | 'commit' = 'handshake';
  let stateConfirmed = false;
  let promptConfirmed = false;
  let validatedCompletion: Record<string, unknown> | null = null;
  let confirmedProvider = '';
  let confirmedModelId = '';
  let failClosedReason: string | null = null;
  let eventEmitted = false;
  let nonTerminalTurns = 0;
  let stdinClosed = false;
  let stdinWasOpenAtSettle = false;
  let childExited = false;

  const start = nowMs();
  const overallDeadline = start + processTimeoutMs;
  const handshakeDeadline = start + handshakeTimeoutMs;
  let settleDeadline: number | null = null;
  let exitDeadline: number | null = null;

  const emitEvent = (): void => {
    const completion = validatedCompletion as Record<string, unknown>;
    const event: RpcEvent = {
      schema_version: 2,
      event_id: crypto.randomUUID().replace(/-/g, ''),
      goal_id: 'RM065-GOAL-010',
      run_id: 'pi-rpc-wrapper-run',
      assignment_epoch: 1,
      sequence: 1,
      parent_instance_id: 'parent-pi-rpc-wrapper',
      actor_role: 'backend_executor',
      actor_instance_id: 'executor-pi-rpc-wrapper',
      dispatch_id: 'D'.repeat(32),
      event_type: 'review_ready',
      phase: 1,
      finding_ids: [],
      finding_material_digests: {},
      packet_path: dispatchResolved,
      packet_sha256: sha256Hex(options.promptContent),
      config_digest: 'B'.repeat(64),
      capability_id: 'C'.repeat(32),
      signature: 'A'.repeat(64),
      provider: confirmedProvider,
      model_id: confirmedModelId,
      summary: asString(completion.summary),
      changed_paths: Array.isArray(completion.changed_paths) ? completion.changed_paths.slice() : [],
      tests_run: Array.isArray(completion.tests_run) ? completion.tests_run.slice() : [],
      test_results: Array.isArray(completion.test_results) ? completion.test_results.slice() : [],
      evidence_paths_and_hashes: Array.isArray(completion.evidence_paths_and_hashes)
        ? completion.evidence_paths_and_hashes.slice()
        : [],
      open_findings: Array.isArray(completion.open_findings) ? completion.open_findings.slice() : [],
      requested_decision: asString(completion.requested_decision),
      next_step: asString(completion.next_step),
      created_at_utc: new Date().toISOString(),
    };
    result.event = event;
  };

  try {
    while (true) {
      const now = nowMs();

      if (phase === 'handshake') {
        if (!stateConfirmed) {
          if (now >= handshakeDeadline || now >= overallDeadline) {
            failClosedReason = 'state-handshake-timeout';
            break;
          }
        } else if (!promptConfirmed) {
          if (now >= handshakeDeadline || now >= overallDeadline) {
            failClosedReason = 'prompt-handshake-timeout';
            break;
          }
        } else {
          phase = 'settle';
          settleDeadline = nowMs() + settleTimeoutMs;
          continue;
        }
      } else if (phase === 'settle') {
        if (settleDeadline !== null && (now >= settleDeadline || now >= overallDeadline)) {
          failClosedReason = 'agent-settle-timeout';
          break;
        }
      } else {
        if (childExited) break;
        if (exitDeadline !== null && (now >= exitDeadline || now >= overallDeadline)) {
          failClosedReason = 'process-timeout';
          break;
        }
      }

      let waitTarget = overallDeadline;
      if (phase === 'handshake' && handshakeDeadline < waitTarget) waitTarget = handshakeDeadline;
      if (phase === 'settle' && settleDeadline !== null && settleDeadline < waitTarget) {
        waitTarget = settleDeadline;
      }
      if (phase === 'commit' && exitDeadline !== null && exitDeadline < waitTarget) {
        waitTarget = exitDeadline;
      }
      let waitMs = Math.floor(waitTarget - nowMs());
      if (waitMs < 0) waitMs = 0;
      if (waitMs === 0) continue;

      const next = await raceNext(generator, waitMs);
      if (next === 'timeout') continue;

      if (next.done || next.value === null) {
        childExited = true;
        // 子进程 EOF：settle 阶段 = 未 settle 即退出；commit 阶段 = 正常收尾；
        // 握手未完 = 哪个确认还缺就报哪个（wrapper L325-L333）。
        if (phase === 'settle') {
          failClosedReason = 'agent-exited-before-settled';
          break;
        }
        if (phase === 'commit') break;
        if (!stateConfirmed) {
          failClosedReason = 'state-handshake-timeout';
          break;
        }
        failClosedReason = 'missing-prompt-response';
        break;
      }

      const line = next.value;
      result.auditLines.push(line);
      if (options.auditHook !== undefined) options.auditHook(result.auditLines);

      // GOAL-067：failClosedReason 各赋值点均紧跟 break，到达此行恒为 null——
      // 死半边条件已删；eventEmitted 后仅审计不再解析。
      if (eventEmitted) continue;

      let obj: Record<string, unknown> | null = null;
      try {
        obj = asObject(JSON.parse(line));
      } catch {
        // 非 JSON 行忽略（与 wrapper L336-L337 相同）。
      }
      if (obj === null) continue;

      const lineId = asString(obj.id);
      const lineType = asString(obj.type);
      const lineCommand = asString(obj.command);
      const lineSuccess = obj.success;

      // GOAL010-T8-PI-RPC-003：get_state / prompt 响应必须精确关联 id/type/command/success。
      if (lineId === stateCommandId && lineType === 'response' && lineCommand === 'get_state') {
        if (lineSuccess !== true) {
          failClosedReason = 'state-error';
          break;
        }
        stateConfirmed = true;
        const stateData = asObject(obj.data);
        const stateModel = stateData === null ? null : asObject(stateData.model);
        const provider = stateModel === null ? '' : asString(stateModel.provider);
        const modelId = stateModel === null ? '' : asString(stateModel.id);
        if (provider === '' || modelId === '') {
          failClosedReason = 'missing-runtime-identity';
          break;
        }
        if (provider !== options.expectedProvider || modelId !== options.expectedModelId) {
          failClosedReason = 'wrong-runtime-model';
          break;
        }
        confirmedProvider = provider;
        confirmedModelId = modelId;
        continue;
      }

      if (lineId === promptCommandId && lineType === 'response' && lineCommand === 'prompt') {
        if (lineSuccess !== true) {
          failClosedReason = 'prompt-error';
          break;
        }
        promptConfirmed = true;
        continue;
      }

      if (lineType === 'message_end') {
        if (!promptConfirmed) {
          failClosedReason = 'completion-before-prompt';
          break;
        }
        if (validatedCompletion !== null) {
          failClosedReason = 'completion-extra-message';
          break;
        }
        const message = asObject(obj.message);
        const messageRole = message === null ? '' : asString(message.role);
        // GOAL010-T8-PI-ASSISTANT-EVENT-ORDER-001：非 assistant 的 message_end
        // 不是 completion 候选，忽略（wrapper L363-L369）。
        if (messageRole === 'assistant') {
          const content = message === null ? [] : (Array.isArray(message.content) ? message.content : []);
          const candidates: unknown[] = [];
          for (const contentItem of content) {
            const item = asObject(contentItem);
            if (item === null || asString(item.type) !== 'text') continue;
            const completionText = asString(item.text);
            let candidate: unknown = null;
            try {
              candidate = JSON.parse(stripOuterJsonFence(completionText));
            } catch {
              // 严格解析失败 → 非候选（wrapper L381）。
            }
            if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
              candidates.push(candidate);
            }
          }
          if (candidates.length === 0) {
            // 无文本候选的 assistant 回合不是最终 completion；
            // 硬性非终态回合预算在此计数（wrapper L384-L400）。
            nonTerminalTurns += 1;
            if (nonTerminalTurns > maxNonTerminalTurns) {
              failClosedReason = 'completion-tool-budget-exceeded';
              break;
            }
          } else if (candidates.length !== 1) {
            failClosedReason = 'completion-object-missing-or-ambiguous';
            break;
          } else {
            const validation = validateCompletion(candidates[0], {
              packet: taskPacket,
              runRoot: options.runRoot,
              resolver,
            });
            if (!validation.ok) {
              failClosedReason = validation.reason;
              break;
            }
            validatedCompletion = validation.completion;
          }
        }
        continue;
      }

      if (validatedCompletion !== null && lineType === 'message_update') {
        failClosedReason = 'completion-extra-message-update';
        break;
      }

      if (lineType === 'agent_settled') {
        // settle 前必须完成两个握手确认；settle 到达时必须有 validated completion。
        if (phase === 'settle' && stateConfirmed && promptConfirmed) {
          result.settleStarted = true;
          if (validatedCompletion === null) {
            failClosedReason = 'completion-missing-before-settle';
            break;
          }
          // GOAL010-T8-PI-RPC-001：stdin 必须一直开着直到 agent_settled。
          stdinWasOpenAtSettle = !stdinClosed;
          stdinClosed = true;
          emitEvent();
          eventEmitted = true;
          phase = 'commit';
          exitDeadline = nowMs() + exitTimeoutMs;
        }
      }
    }
  } finally {
    if (!childExited && failClosedReason !== null) {
      // GOAL010-T8-PI-RPC-004：fail-closed 不得留下孤儿子进程。
      // fire-and-forget：子进程模拟挂在不可取消的 await 上时，语义等价于
      // wrapper 的 Kill()；不能等待 return() 完成（那会永远挂起）。
      result.childKilled = true;
      generator.return(undefined).catch(() => {
        // 忽略关闭异常。
      });
    }
  }

  result.deliveredPrompt = options.promptContent;
  result.stdinWasOpenAtSettle = stdinWasOpenAtSettle;
  result.stdinClosed = stdinClosed;
  result.nonTerminalTurns = nonTerminalTurns;

  if (failClosedReason !== null) {
    return failClosed(result, failClosedReason);
  }
  if (!(stateConfirmed && promptConfirmed)) {
    result.stdoutLines.push(JSON.stringify({ type: 'bridge_fail_closed', reason: 'missing-prompt-response' }));
    result.stderrLines.push('Managed Pi RPC fail-closed: missing-prompt-response');
    result.exitCode = 62;
    return result;
  }
  if (!eventEmitted) {
    result.stderrLines.push('Managed Pi RPC confirmed identity but no signed IPC event was emitted.');
    result.exitCode = 61;
    return result;
  }
  result.exitCode = childExitCode;
  return result;
}
