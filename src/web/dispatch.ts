/**
 * mush Board API v1 — 派发管线（GOAL-006）。
 *
 * 契约：src/web/api-contract.md POST /api/dispatch 等。
 * 流程：schema 校验 → 合同解析 → USD admission 门（事件化，JSONL append-only）
 *      → dry-run/real 执行 → 回执落盘 → 派发生命周期事件。
 * real=true 必须有逐单 owner 审批（D30/GP-32：无令牌自动生成审批请求停卡，
 * 批准→单次令牌→approved_via 重跑消费；否决→REJECTED；常设文件已废除）。
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { UsdBudgetLedger, roundMicroUsd, type UsdAdmissionEntry } from '../core/budget.ts';
import type { MasterBudgetGateLike } from '../core/budget-master.ts';
import { sha256Hex } from '../core/event-log.ts';
import { validateAdapterContract, type AdapterContract, type EffortInjection } from '../adapters/contract.ts';
import { buildDeepSeekContract } from '../adapters/deepseek.ts';
import { buildClaudeContract } from '../adapters/claude.ts';
import { buildZcodeContract } from '../adapters/zcode.ts';
import { buildPiContract } from '../adapters/pi.ts';
import { buildCodexContract } from '../adapters/codex.ts';
import { buildOpencodeContract } from '../adapters/opencode.ts';
import { buildKimiContract } from '../adapters/kimi.ts';
import { buildAgyContract } from '../adapters/agy.ts';
import { buildHeadDogContract, extractSessionId } from '../adapters/head-dog.ts';
import { runT1, type SpawnFn } from '../adapters/t1-runner.ts';
import { runPiRpc } from '../adapters/pi-rpc-runner.ts';
import {
  loadLiveProbeCache,
  saveLiveProbeCache,
  probeAdapterLive,
  recordModelReceipt,
  classifyModelTier,
  discoverHarnessGroupedModels,
  getHarnessHierarchy,
  type HarnessProviderInfo,
  type LiveProbeRecord,
  type LiveProbeStatus,
  type ModelTier,
} from '../adapters/live-probe.ts';


import { runVerifier, type VerifierReport, VerifierDecouplingError } from '../orchestration/verifier.ts';
import type { TopologyMode } from '../orchestration/topology.ts';
import type { BoardPersistence } from './persistence.ts';
import {
  loadAdapterStore,
  saveAdapterStore,
  validateAdapterUpsert,
  applyUserAdapterParams,
  inferTemplateForAdapterId,
  VERIFIED_TEMPLATES,
  type UserAdapterRecord,
  type AdapterTemplateId,
} from './adapter-store.ts';
import { loadBudgetCaps, saveBudgetCaps, DEFAULT_BUDGET_CAP_USD } from './budget-caps.ts';
import {
  loadStreams,
  createStream,
  addDispatchToStream,
  addHandoffToStream,
  setStreamStatus,
  parseHandoffBlock,
  streamKey,
  estimateTokens,
  shouldSwitchWindow,
  buildDshStitchedPrompt,
  DSH_CHARTER_FIXED,
  readProjectBrief,
  type WorkStream,
  type HandoffBlock,
} from './workstreams.ts';
import {
  loadTasks,
  appendTask,
  createTask,
  transitionTask,
  linkDispatchToTask,
  advanceTaskToStatus,
  syncGoalsDirectoryToTasks,
  type Task,
  type TaskStatus,
} from './tasks.ts';

import {
  loadCarveouts,
  appendCarveout,
  buildCarveout,
  revokeCarveout as revokeCarveoutSnapshot,
  expireCarveout,
  parseGrantCarveoutInput,
  resolveActiveCarveout,
  readCarveoutToken,
  rotateCarveoutToken,
  hasAgentBridgeSegment,
  isPathWithinRoots,
  type Carveout,
  type CarveoutWhitelistSnapshot,
} from './carveouts.ts';

export type DispatchStatus =
  | 'ADMITTED'
  | 'DRY_RUN'
  | 'BLOCKED_WAITING_OWNER'
  | 'BLOCKED_ENV'
  | 'TIMEOUT'
  | 'INTERRUPTED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'FAIL'
  | 'PASS';

export interface DispatchLifecycleEvent {
  kind: 'dispatch';
  phase: 'ADMISSION' | 'EXECUTE' | 'REPORT' | 'REVIEW';
  status: DispatchStatus;
  adapter_id: string;
  at_utc: string;
  dispatch_id: string;
  payload: Record<string, unknown>;
}

/** GP-10：rerun 所需的历史请求快照（不含 amount_usd 虚报风险字段）。 */
export interface DispatchRequestSnapshot {
  adapter_id: string;
  prompt: string;
  effort: string;
  workspace: string;
  timeout_s: number;
  model_id?: string;
  /** D82 批次：本次任务指定的领队头犬（实证在册 + 头犬白名单校验后落快照）。 */
  head_id?: string;
  profile?: string;
  stream_id?: string;
  goal_id?: string;
  resume_session?: string;
  task_id?: string;
  /** GOAL-028：多组织拓扑与独立验证犬 */
  topology_mode?: TopologyMode;
  verifier_dog?: string;
  /** GOAL-014（M0）：carve-out 声明式写面——派发目标工作根与切片引用。 */
  cwd?: string;
  carveout_id?: string;
  carveout_whitelist?: CarveoutWhitelistSnapshot;
  cap_usd: number;
  real: boolean;
}

export interface DispatchRecord {
  dispatch_id: string;
  adapter_id: string;
  status: DispatchStatus;
  receipt_path: string | null;
  admission: { decision: string; remaining_usd: number } | null;
  events: DispatchLifecycleEvent[];
  error: string | null;
  /** G7B-E1（契约 v1.1 向后兼容新增）：只读输出摘要，REPORT 后填充。 */
  stdout_tail: { text: string; truncated: boolean } | null;
  stderr_tail: { text: string; truncated: boolean } | null;
  /** G011：犬侧会话 id（会话续跑锚点）。 */
  session_id: string | null;
  /** GOAL-018 U1：work-stream 关联。 */
  stream_id?: string;
  /** GOAL-019 U3：任务池回链。 */
  task_id?: string;
  /** GOAL-028：多组织拓扑与独立验证犬 */
  topology_mode?: TopologyMode;
  verifier_report?: VerifierReport;
  /** GOAL-014（M0）：关联的 ACTIVE carve-out 切片（写面声明式留痕）。 */
  carveout_id?: string;
  /** GP-10（契约 v1.4）：rerun 用的历史请求快照；旧记录缺省无此字段。 */
  request?: DispatchRequestSnapshot;
}

/** GOAL-017A U1：合并视图条目（base + user override + origin 标记）。 */
export interface AdapterView {
  adapter_id: string;
  protocol: string;
  expected_provider: string;
  expected_model_id: string;
  role: 'head' | 'executor';
  origin: 'base' | 'user' | 'user-override';
  verified: boolean;
  template?: AdapterTemplateId;
  variants?: string[];
  model_flag?: string;
  effort_levels?: string[];
  effort_injection?: EffortInjection;
}

/** 尾部截断（UTF-8 字符安全）：超长保留末段并标记 truncated。 */
export function tailOf(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(text.length - maxChars), truncated: true };
}

/** GOAL-021 U3：增量 stdout 节流合帧器——≥ minBytes(512B) 或距上次≥ minIntervalMs(200ms)
 *  任一台到达即把累积文本合为一帧交给 emit；结束时 flush() 强制吐剩余。
 *  时间/字节阈值均可注入（测试确定性），首次有内容立即出帧（流式首字即时可见）。 */
export interface ThrottledStream {
  push(chunk: string): void;
  flush(): void;
}

export interface ThrottledStreamOptions {
  emit: (text: string) => void;
  minIntervalMs?: number;
  minBytes?: number;
  now?: () => number;
}

export function createThrottledStream(options: ThrottledStreamOptions): ThrottledStream {
  const minIntervalMs = options.minIntervalMs ?? 200;
  const minBytes = options.minBytes ?? 512;
  const now = options.now ?? (() => Date.now());
  let buffer = '';
  let nextEmitAt = 0;
  const emitFrame = (text: string): void => {
    if (text !== '') options.emit(text);
  };
  const maybeEmit = (force: boolean): void => {
    if (buffer === '') return;
    const t = now();
    if (force || t >= nextEmitAt || Buffer.byteLength(buffer, 'utf8') >= minBytes) {
      emitFrame(buffer);
      buffer = '';
      nextEmitAt = t + minIntervalMs;
    }
  };
  return {
    push(chunk: string): void {
      buffer += chunk;
      maybeEmit(false);
    },
    flush(): void {
      maybeEmit(true);
    },
  };
}

export interface RunAdapterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
  /** GOAL-069：真实 runner（runT1）返回完整回执；fake 可省略。 */
  receipt?: { telemetry?: import('../core/budget.ts').TokenUsageTelemetry };
}

export type RunAdapterFn = (
  contract: AdapterContract,
  prompt: string,
  /** GOAL-069：可选——注入式 fake 允许两参签名；默认实现依赖完整 opts，
   * 缺省时在 try 内解构 undefined 同步抛错→受控返回 exit1（历史行为）。 */
  opts?: {
    workspaceRoot: string;
    receiptPath: string;
    timeoutMs: number;
    /** GOAL-014（M0）：carve-out 指定的犬工作根（spawn cwd）；缺省 workspaceRoot。 */
    cwd?: string;
    /** GOAL-021 U3：增量 stdout 透传（可选）。宿主收到原始 chunk，负责节流合帧。 */
    onStdout?: (chunk: string) => void;
  },
) => Promise<RunAdapterResult>;

export interface DispatchPipelineOptions {
  workspaceRoot: string;
  approvalRoot: string;
  /** G009：real-dispatch 犬只批准目录；缺省 <workspaceRoot>/goals/receipts/dispatch-approvals。 */
  dispatchApprovalRoot?: string;
  /** GP-32（D30）：派发类审批请求落盘目录（看板审批视图数据源）；
   * 缺省 <workspaceRoot>/goals/receipts/approval-requests。 */
  approvalRequestRoot?: string;
  /** GP-32（D30）：单次审批令牌目录（读即焚）；缺省 <workspaceRoot>/runtime/approval-tokens。 */
  approvalTokensPath?: string;
  ledgerPath: string;
  contracts?: Record<string, AdapterContract>;
  runAdapter?: RunAdapterFn;
  spawn?: SpawnFn;
  onEvent?: (event: DispatchLifecycleEvent) => void;
  now?: () => Date;
  /** G010：能力注册表路径；缺省 <workspaceRoot>/runtime/capability-registry.json。 */
  registryPath?: string;
  /** GP-03：持久化三件套接入；缺省纯内存。 */
  persistence?: BoardPersistence;
  /** GP-21：dsh preset 根目录；缺省 ~/.dsh/profiles（测试可注入临时目录）。 */
  profilesRoot?: string;
  /** GOAL-017A U1：适配器注册表路径；缺省 <workspaceRoot>/runtime/adapters.json。 */
  adaptersPath?: string;
  /** GOAL-017A U3：预算 cap 持久化路径；缺省 <workspaceRoot>/runtime/budget-caps.json。 */
  budgetCapsPath?: string;
  /** GOAL-018 U1：work-stream 日志路径；缺省 <workspaceRoot>/runtime/streams.jsonl。 */
  streamsPath?: string;
  /** GOAL-019 U1：任务池日志路径；缺省 <workspaceRoot>/runtime/tasks.jsonl。 */
  tasksPath?: string;
  /** GOAL-014（M0）：carve-out 记录路径；缺省 <workspaceRoot>/runtime/carveouts.jsonl。 */
  carveoutsPath?: string;
  /** GOAL-014（M0）：owner 一次性 token 文件；缺省 <workspaceRoot>/.mush/carveout-token。 */
  carveoutTokenPath?: string;
  /** GOAL-025（GP-35）：模型实测缓存文件路径；缺省 <workspaceRoot>/runtime/live-probes.json。 */
  liveProbesPath?: string;
  /** GOAL-068（D2）：跨项目全局资金总控门（多项目热切换下防资金逃逸）。 */
  masterGate?: MasterBudgetGateLike;
}

export interface WorkspaceInfo {
  path: string;
  is_git: boolean;
  mush_managed: boolean;
  /** G7B-E2（契约 v1.1 向后兼容新增）：是否为当前选中 workspace。 */
  selected: boolean;
}

function baseContracts(): Record<string, AdapterContract> {
  return {
    'fake-t1': validateAdapterContract({
      adapter_id: 'fake-t1',
      executable: 'fake.exe',
      arguments: ['--headless'],
      protocol: 't1',
      prompt_transport: 'stdin',
      expected_provider: 'fake-provider',
      expected_model_id: 'fake-model',
    }),
    'deepseek-dsh': buildDeepSeekContract('dsh'),
    // 默认 sonnet-5：claude-real-011 实证该变体身份+nonce 双通过。
    'claude-code': buildClaudeContract('claude-sonnet-5'),
    zcode: buildZcodeContract(),
    codex: buildCodexContract(),
    opencode: buildOpencodeContract(),
    'kimi-code': buildKimiContract(),
    pi: buildPiContract(),
    agy: buildAgyContract(),
    'head-dog': buildHeadDogContract(),
  };
}

export interface RegistryFile {
  adapters?: Array<{ adapter_id: string; models?: string[]; verified?: boolean }>;
}

/** GOAL-017A U2：verified 合同白名单（不含 codex/opencode——F-50/未验证）。 */
const VERIFIED_WHITELIST = new Set<string>([
  'deepseek-dsh',
  'claude-code',
  'kimi-code',
  'zcode',
  'head-dog',
  'agy',
]);

/** G010：静态合同 + cc-switch 注册表合成；GOAL-017A U1 再叠加用户注册表。
 * 注册表缺省时回退静态（fail-closed 不猜测）；
 * 注册表只增补 variants 与 provider 归属，executable/协议等敏感细节不来自外部数据。 */
export function buildContracts(
  registry?: RegistryFile | null,
  userAdapters: UserAdapterRecord[] = [],
): Record<string, AdapterContract> {
  const contracts = baseContracts();
  for (const entry of registry?.adapters ?? []) {
    const base = contracts[entry.adapter_id];
    if (base === undefined || entry.models === undefined || entry.models.length === 0) continue;
    const variants = [...new Set([...(base.variants ?? []), ...entry.models.filter((model) => typeof model === 'string' && model.trim() !== '' && model !== 'UNKNOWN')])];
    if (variants.length === 0) continue;
    contracts[entry.adapter_id] = validateAdapterContract({
      ...base,
      variants,
    });
  }
  for (const record of userAdapters) {
    if (record.removed === true) {
      delete contracts[record.adapter_id];
      continue;
    }
    const contract = applyUserAdapterParams(record.template, record.adapter_id, record.params);
    contracts[record.adapter_id] = contract;
  }
  return contracts;
}

function loadRegistry(registryPath: string): RegistryFile | undefined {
  try {
    const text = readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(text) as RegistryFile;
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined; // 损坏的注册表 fail-closed 回退静态
    return undefined; // 文件缺失/不可读同回退
  }
}

/** G009：应用模型变体——更新身份期望；有 model_flag 的通道同步重写 CLI 参数
 *（旗标值替换为变体名）。无 flag 通道仅记录身份期望（切换能力见 F-G9-02）。 */
function applyModelVariant(contract: AdapterContract, modelId: string): AdapterContract {
  const arguments_ =
    contract.model_flag !== undefined && contract.arguments.includes(contract.model_flag)
      ? contract.arguments.map((arg, index) =>
          index > 0 && contract.arguments[index - 1] === contract.model_flag ? modelId : arg,
        )
      : contract.arguments;
  return validateAdapterContract({
    ...contract,
    arguments: arguments_,
    expected_model_id: modelId,
  });
}

/** GP-21：把合同参数中的 `--profile <默认>` 替换为请求指定的 preset 名。 */
function applyProfile(contract: AdapterContract, profileName: string): AdapterContract {
  if (!contract.arguments.includes('--profile')) {
    throw new InputError(`adapter ${contract.adapter_id} does not support profile`);
  }
  const args = [...contract.arguments];
  const index = args.indexOf('--profile');
  if (index + 1 >= args.length) {
    throw new InputError(`adapter ${contract.adapter_id} has malformed --profile default`);
  }
  args[index + 1] = profileName;
  return validateAdapterContract({ ...contract, arguments: args });
}

/** D82 批次：effort 值规范化——各通道 CLI 旗标值统一小写（codex/claude --effort、
 *  opencode --variant、reasoning_effort 均小写）；token 预算数值原样；开关转小写。 */
function normalizeEffortValue(effort: string): string {
  if (/^\d+$/.test(effort)) return effort;
  if (['TRUE', 'FALSE'].includes(effort)) return effort.toLowerCase();
  return effort.toLowerCase();
}

/** D82 批次（思维强度全链路补全）：把请求档位真正注入合同 CLI 参数。
 *  GP-22 此前只做校验层——档位在 spawn 前被静默丢弃，前端选 MAX 实际不生效；
 *  本函数按合同 effort_injection（kind=flag）追加/改写旗标值。 */
function applyEffortInjection(contract: AdapterContract, effort: string): AdapterContract {
  const injection = contract.effort_injection;
  if (injection === undefined || injection.kind !== 'flag' || injection.name === undefined) return contract;
  const value = normalizeEffortValue(effort);
  const args = [...contract.arguments];
  const idx = args.indexOf(injection.name);
  if (idx >= 0) {
    if (idx + 1 >= args.length) throw new InputError(`adapter ${contract.adapter_id} has malformed ${injection.name} default`);
    args[idx + 1] = value;
  } else {
    args.push(injection.name, value);
  }
  return validateAdapterContract({ ...contract, arguments: args });
}

const EFFORTS = new Set(['LOW', 'HIGH', 'XHIGH']);
const DEFAULT_EFFORT_LEVELS: readonly string[] = ['LOW', 'HIGH', 'XHIGH'];

export class DispatchPipeline {
  readonly workspaceRoot: string;
  readonly approvalRoot: string;
  private readonly dispatchApprovalRoot: string;
  private readonly approvalRequestRoot: string;
  private readonly approvalTokensPath: string;
  readonly ledgerPath: string;
  private contracts: Record<string, AdapterContract>;
  private readonly runAdapter: RunAdapterFn;
  private onEvent: (event: DispatchLifecycleEvent) => void;
  private readonly ledger = new UsdBudgetLedger();
  /** GOAL-068（D2）：跨项目全局资金总控门（可选；多项目热切换防逃逸）。 */
  private masterGate?: MasterBudgetGateLike;
  private readonly records = new Map<string, DispatchRecord>();
  private selectedWorkspace: string | null = null;
  private now: () => Date;
  private readonly persistence: BoardPersistence | null;
  private readonly profilesRoot: string;
  private profileDirsCache: Set<string> | null = null;
  private readonly adaptersPath: string;
  private userAdapters: UserAdapterRecord[];
  private readonly registryPath: string;
  private registryVerified: Set<string>;
  private readonly budgetCapsPath: string;
  private budgetCaps: Record<string, number>;
  private readonly baseAdapterIds: Set<string>;
  private readonly streamsPath: string;
  private streams: WorkStream[];
  private readonly tasksPath: string;
  /** GOAL-014（M0）：carve-out 记录路径与 owner token 文件路径。 */
  private readonly carveoutsPath: string;
  private readonly carveoutTokenPath: string;
  /** GOAL-025（GP-35）：模型实测缓存与权威返回模型表 */
  private readonly liveProbesPath: string;
  private liveProbes: Record<string, LiveProbeRecord>;
  private authoritativeModels = new Map<string, string>();

  constructor(options: DispatchPipelineOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.approvalRoot = path.resolve(options.approvalRoot);
    // G009 修复：real-dispatch 的犬只批准目录与看板审批视图（approval-requests）
    // 是两类记录，默认分开——犬只批准在 dispatch-approvals（D6 惯例）。
    this.dispatchApprovalRoot = path.resolve(
      options.dispatchApprovalRoot ?? path.join(this.workspaceRoot, 'goals', 'receipts', 'dispatch-approvals'),
    );
    // GP-32（D30）：逐单审批——被拦的真实派发自动生成审批请求文件（进看板
    // 审批视图），批准后写单次令牌（读即焚），常设文件不再参与放行。
    this.approvalRequestRoot = path.resolve(
      options.approvalRequestRoot ?? path.join(this.workspaceRoot, 'goals', 'receipts', 'approval-requests'),
    );
    this.approvalTokensPath = path.resolve(
      options.approvalTokensPath ?? path.join(this.workspaceRoot, 'runtime', 'approval-tokens'),
    );
    this.ledgerPath = path.resolve(options.ledgerPath);
    this.registryPath = path.resolve(
      options.registryPath ?? path.join(this.workspaceRoot, 'runtime', 'capability-registry.json'),
    );
    this.adaptersPath = path.resolve(
      options.adaptersPath ?? path.join(this.workspaceRoot, 'runtime', 'adapters.json'),
    );
    this.userAdapters = loadAdapterStore(this.adaptersPath);
    const registry = loadRegistry(this.registryPath);
    this.registryVerified = new Set(
      (registry?.adapters ?? []).filter((entry) => entry.verified === true).map((entry) => entry.adapter_id),
    );
    this.contracts =
      options.contracts ??
      buildContracts(
        registry,
        this.userAdapters,
      );
    this.onEvent = options.onEvent ?? (() => {});
    this.now = options.now ?? (() => new Date());
    this.persistence = options.persistence ?? null;
    this.masterGate = options.masterGate;
    this.profilesRoot = path.resolve(options.profilesRoot ?? path.join(homedir(), '.dsh', 'profiles'));
    this.budgetCapsPath = path.resolve(
      options.budgetCapsPath ?? path.join(this.workspaceRoot, 'runtime', 'budget-caps.json'),
    );
    this.budgetCaps = loadBudgetCaps(this.budgetCapsPath);
    this.streamsPath = path.resolve(
      options.streamsPath ?? path.join(this.workspaceRoot, 'runtime', 'streams.jsonl'),
    );
    this.streams = loadStreams(this.streamsPath);
    this.tasksPath = path.resolve(
      options.tasksPath ?? path.join(this.workspaceRoot, 'runtime', 'tasks.jsonl'),
    );
    this.carveoutsPath = path.resolve(
      options.carveoutsPath ?? path.join(this.workspaceRoot, 'runtime', 'carveouts.jsonl'),
    );
    this.carveoutTokenPath = path.resolve(
      options.carveoutTokenPath ?? path.join(this.workspaceRoot, '.mush', 'carveout-token'),
    );
    // GOAL-014（M0）：owner 授权通道最小握手——启动时确保 token 文件存在
    // （缺省自动生成，owner 可读文件取得），权限 0600，每次 grant 旋转。
    if (readCarveoutToken(this.carveoutTokenPath) === null) {
      rotateCarveoutToken(this.carveoutTokenPath, this.now);
    }
    this.liveProbesPath = path.resolve(
      options.liveProbesPath ?? path.join(this.workspaceRoot, 'runtime', 'live-probes.json'),
    );
    this.liveProbes = loadLiveProbeCache(this.liveProbesPath);
    this.baseAdapterIds = new Set(Object.keys(baseContracts()));
    // GP-03：重启回放——已落盘的派发记录重新入内存（recent() 跨重启可用）。
    // DEF-05 修复：header.status 只反映落盘瞬间，事件链才是权威——回放时
    // 以最后一个生命周期事件的状态为准（747c7040 曾显示 ADMITTED 而实为超时）。
    for (const record of this.persistence?.loadDispatchRecords() ?? []) {
      const lastEvent = record.events.length > 0 ? record.events[record.events.length - 1] : null;
      if (lastEvent !== null && (lastEvent.phase === 'REPORT' || lastEvent.phase === 'REVIEW')) {
        record.status = lastEvent.status;
      }
      this.records.set(record.dispatch_id, record);
    }
    // DEF-09：僵尸派发回收——上个实例若在 EXECUTE 中途被杀（重启/崩溃），
    // 记录会永远停在 ADMITTED（ee34f331 事故：头犬重启误杀 owner 在途派发）。
    // 回放时对"非终态且止步 EXECUTE"的记录追加 INTERRUPTED 报告，如实可见。
    const TERMINAL = new Set<DispatchStatus>(['PASS', 'FAIL', 'DRY_RUN', 'TIMEOUT', 'BLOCKED_WAITING_OWNER', 'BLOCKED_ENV', 'INTERRUPTED', 'REJECTED', 'SUPERSEDED']);
    for (const record of this.records.values()) {
      const lastPhase = record.events.length > 0 ? record.events[record.events.length - 1].phase : null;
      if (!TERMINAL.has(record.status) && lastPhase === 'EXECUTE') {
        record.status = 'INTERRUPTED';
        const event: DispatchLifecycleEvent = {
          kind: 'dispatch',
          phase: 'REPORT',
          status: 'INTERRUPTED',
          adapter_id: record.adapter_id,
          dispatch_id: record.dispatch_id,
          at_utc: this.now().toISOString(),
          payload: { reason: 'server restarted during EXECUTE (DEF-09 zombie reconciliation)' },
        };
        record.events.push(event);
        try {
          this.persistence?.appendDispatchEvent(record, event);
        } catch {
          // 回收事件落盘失败不阻断内存回收（重启幂等由终态判断保证）。
        }
      }
      // GP-32：被拦真实派发若无审批请求文件（GP-32 之前的旧卡，或拦截与
      // 落盘之间崩溃），回放时补建——保证审批视图可见、owner 永远有卡可批。
      if (record.status === 'BLOCKED_WAITING_OWNER' && record.request !== undefined) {
        const requestFile = path.join(this.approvalRequestRoot, `dispatch-${record.dispatch_id}.json`);
        if (!existsSync(requestFile)) this.createDispatchApprovalRequest(record, record.request.cap_usd);
      }
    }
    // GOAL-064: 启动时全量重放并恢复 budget-ledger 历史台账与已花预算
    this.rehydrateLedger();
    this.runAdapter =
      options.runAdapter ??
      (async (contract, prompt, opts) => {
        try {
          // GOAL-069：opts 按类型可选；默认实现缺省时此处解构 undefined 同步
          // 抛 TypeError→下方 catch 受控返回 exit1（与历史两参调用行为一致）。
          const { workspaceRoot, receiptPath, timeoutMs } = opts!;
          if (contract.protocol === 'pi-rpc') {
            // GP-29：pi 通用 harness 走 RPC runner（黄金参照线协议）。
            const piResult = await runPiRpc(contract, prompt, {
              workspaceRoot,
              receiptPath,
              timeoutMs,
              ...(opts!.cwd !== undefined ? { cwd: opts!.cwd } : {}),
            });
            return {
              exitCode: piResult.exitCode,
              stdout: piResult.stdout,
              stderr: piResult.stderr,
              timedOut: piResult.timedOut,
              childKilled: piResult.childKilled,
            };
          }
          const result = await runT1({
            contract,
            prompt,
            workspaceRoot: opts!.workspaceRoot,
            receiptPath: opts!.receiptPath,
            timeoutMs: opts!.timeoutMs,
            spawn: options.spawn,
            onStdout: opts!.onStdout,
            ...(opts!.cwd !== undefined ? { cwd: opts!.cwd } : {}),
          });
          return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
            childKilled: result.childKilled,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            timedOut: false,
            childKilled: false,
          };
        }
      });
  }

  /** 让宿主（board server SSE）重新挂接生命周期事件监听。 */
  setEventListener(listener: (event: DispatchLifecycleEvent) => void): void {
    this.onEvent = listener;
  }

  /**
   * GOAL-068（D2）：注入跨项目全局资金总控门。
   * startBoardServer 对**活动缺省管线**（含 options.dispatch 注入式实例）统一
   * 调用，保证热切换构建的所有上下文与缺省上下文共享同一个 Master Cap 门。
   */
  setMasterGate(gate: MasterBudgetGateLike): void {
    this.masterGate = gate;
  }

  private emit(record: DispatchRecord, phase: DispatchLifecycleEvent['phase'], status: DispatchStatus, payload: Record<string, unknown>): void {
    const event: DispatchLifecycleEvent = {
      kind: 'dispatch',
      phase,
      status,
      adapter_id: record.adapter_id,
      dispatch_id: record.dispatch_id,
      at_utc: this.now().toISOString(),
      payload,
    };
    record.events.push(event);
    this.persistence?.appendDispatchEvent(record, event);
    this.onEvent(event);
  }

  private appendLedger(entry: UsdAdmissionEntry): void {    if (this.persistence !== null) {
      this.persistence.appendLedger({
        atUtc: entry.atUtc,
        actorId: entry.actorId,
        decision: entry.decision,
        amountUsd: entry.amountUsd,
        capUsd: entry.capUsd,
        spentBeforeUsd: entry.spentBeforeUsd,
        remainingUsd: entry.remainingUsd,
        meta: entry.meta,
      });
      return;
    }
    mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
    writeFileSync(this.ledgerPath, JSON.stringify(entry) + '\n', { flag: 'a', encoding: 'utf8' });
  }

  /** GOAL-017A U3：cap 改动追加台账一行（kind=CAP_CHANGE）。 */
  private appendCapChange(actorId: string, previousCapUsd: number, newCapUsd: number): void {
    const atUtc = this.now().toISOString();
    if (this.persistence !== null) {
      this.persistence.appendLedger({
        atUtc,
        actorId,
        decision: 'ADMITTED',
        amountUsd: 0,
        capUsd: newCapUsd,
        spentBeforeUsd: this.ledger.spentUsd(actorId),
        remainingUsd: newCapUsd - this.ledger.spentUsd(actorId),
        meta: { kind: 'CAP_CHANGE', previous_cap_usd: previousCapUsd, new_cap_usd: newCapUsd },
      });
      return;
    }
    mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
    writeFileSync(
      this.ledgerPath,
      JSON.stringify({
        kind: 'CAP_CHANGE',
        at_utc: atUtc,
        actor_id: actorId,
        previous_cap_usd: previousCapUsd,
        new_cap_usd: newCapUsd,
      }) + '\n',
      { flag: 'a', encoding: 'utf8' },
    );
  }

  /** GOAL-064: 启动时全量重放并恢复 budget-ledger 历史台账与已花预算 */
  private rehydrateLedger(): void {
    let lines: Array<Record<string, unknown>> = [];
    if (this.persistence !== null) {
      lines = this.persistence.loadLedgerLines();
    } else if (existsSync(this.ledgerPath)) {
      try {
        lines = readFileSync(this.ledgerPath, 'utf8')
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => JSON.parse(l) as Record<string, unknown>);
      } catch {}
    }
    if (lines.length > 0) {
      const entries: UsdAdmissionEntry[] = lines.map((line) => {
        return Object.freeze({
          atUtc: String(line.at_utc ?? line.atUtc ?? ''),
          actorId: String(line.actor_id ?? line.actorId ?? ''),
          decision: (line.decision === 'DENIED' ? 'DENIED' : 'ADMITTED') as 'ADMITTED' | 'DENIED',
          amountUsd: Number(line.amount_usd ?? line.amountUsd ?? 0),
          capUsd: Number(line.cap_usd ?? line.capUsd ?? 0),
          spentBeforeUsd: Number(line.spent_before_usd ?? line.spentBeforeUsd ?? 0),
          remainingUsd: Number(line.remaining_usd ?? line.remainingUsd ?? 0),
          meta: (line.meta && typeof line.meta === 'object' ? line.meta : {}) as Record<string, unknown>,
          sha256: String(line.sha256 ?? ''),
          previous_sha256: (line.previous_sha256 ?? line.previousSha256 ?? null) as string | null,
        });
      });
      this.ledger.loadEntries(entries);
    }
  }

  /** GP-21：探测一次并缓存 ~/.dsh/profiles 下的目录名；缓存后不再反复读盘。 */
  private profileDirs(): Set<string> {
    if (this.profileDirsCache !== null) return this.profileDirsCache;
    const dirs = new Set<string>();
    try {
      if (existsSync(this.profilesRoot)) {
        for (const name of readdirSync(this.profilesRoot)) {
          const full = path.join(this.profilesRoot, name);
          try {
            if (statSync(full).isDirectory()) dirs.add(name);
          } catch {
            // 单个不可读目录 fail-closed：不加入白名单。
          }
        }
      }
    } catch {
      // profilesRoot 不可读 → 空白名单，所有 profile 请求 fail-closed。
    }
    this.profileDirsCache = dirs;
    return dirs;
  }

  /** GP-21：profile 必须是非空目录名且位于 profilesRoot 内（防路径穿越）。 */
  private resolveProfile(profileName: string): string {
    if (profileName.trim() === '') throw new InputError('profile must be non-blank when present');
    const dirs = this.profileDirs();
    if (!dirs.has(profileName)) {
      throw new InputError(`profile '${profileName}' not found under ${this.profilesRoot}`);
    }
    const resolved = path.resolve(this.profilesRoot, profileName);
    const relative = path.relative(this.profilesRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new InputError('profile path traversal is not allowed');
    }
    return resolved;
  }

  /** schema fail-closed：任何字段违规抛 InputError（HTTP 400）。 */
  async dispatch(
    input: unknown,
    internal?: {
      approvedVia?: string;
      originOwner?: boolean;
      /** GOAL-021 U1：外部预生成 dispatch_id（聊天 202 即返需在受理前拿到 id）。 */
      dispatchId?: string;
      /** GOAL-021 U3：增量 stdout 透传 + 触发 EXECUTE 增量派发帧。 */
      onStdout?: (chunk: string) => void;
    },
  ): Promise<DispatchRecord> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new InputError('body must be a JSON object');
    }
    const body = input as Record<string, unknown>;
    const adapterId = typeof body.adapter_id === 'string' ? body.adapter_id : '';
    const contract = this.contracts[adapterId];
    if (contract === undefined) throw new InputError(`unknown adapter: ${adapterId}`);
    // G009：模型变体选择——必须属于合同声明的 variants（fail-closed）。
    let effectiveContract = contract;
    let modelId: string | undefined;
    if (body.model_id !== undefined) {
      modelId = String(body.model_id);
      if (contract.variants === undefined || !contract.variants.includes(modelId)) {
        throw new InputError(`model_id '${modelId}' not in variants of ${adapterId}`);
      }
      effectiveContract = applyModelVariant(contract, modelId);
    }
    // GP-21：dsh preset——只允许 ~/.dsh/profiles 下真实目录；替换合同默认 --profile。
    let profile: string | undefined;
    if (body.profile !== undefined) {
      profile = String(body.profile);
      this.resolveProfile(profile);
      effectiveContract = applyProfile(effectiveContract, profile);
    }
    // GOAL-018 U1：解析/创建 work-stream，并组装最终 prompt（项目层/交接/dsh 缝合）。
    const earlyWorkspace = typeof body.workspace === 'string' && body.workspace.trim() !== '' ? path.resolve(body.workspace) : this.defaultWorkspace();
    const rawPrompt = typeof body.prompt === 'string' ? body.prompt : '';
    const goalId = typeof body.goal_id === 'string' && body.goal_id.trim() !== '' ? body.goal_id.trim() : undefined;
    const newStreamRequested = body.new_stream === true;
    const explicitStreamId = typeof body.stream_id === 'string' && body.stream_id.trim() !== '' ? body.stream_id.trim() : undefined;
    const prep = this.resolveStreamForDispatch(
      adapterId,
      goalId,
      newStreamRequested,
      explicitStreamId,
      effectiveContract,
      rawPrompt,
      earlyWorkspace,
    );
    body.prompt = prep.prompt;
    if (prep.resumeSession !== undefined && body.resume_session === undefined) {
      body.resume_session = prep.resumeSession;
    }
    const resolvedStream: WorkStream | null = prep.stream;

    // G011：会话续跑——resume_flag 通道追加 <flag> <session_id>（dsh --resume 等）。
    if (body.resume_session !== undefined) {
      const resumeSession = String(body.resume_session);
      if (resumeSession.trim() === '') throw new InputError('resume_session must be non-blank when present');
      if (effectiveContract.resume_flag === undefined) {
        throw new InputError(`adapter ${adapterId} does not support resume_session`);
      }
      effectiveContract = validateAdapterContract({
        ...effectiveContract,
        arguments: [...effectiveContract.arguments, effectiveContract.resume_flag, resumeSession],
      });
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    // GOAL-068（A7）：argument 通道的 prompt 直接进 argv，Windows CreateProcess
    // 单条命令行上限 ~32767 字符——此前放行到 64000 只会在执行期 spawn 必败。
    // 按通道前置拦截：argument ≤30000（给合同参数留余量），stdin/rpc 维持 64000。
    const promptLimit = effectiveContract.prompt_transport === 'argument' ? 30_000 : 64_000;
    if (prompt.trim() === '' || prompt.length > promptLimit) {
      throw new InputError(`prompt must be 1..${promptLimit} chars (${effectiveContract.prompt_transport} transport)`);
    }
    // GP-22 / GOAL-059：effort 校验，兼容合同声明的 effort_levels 或动态 ThinkingSpec（数值预算/开关）
    const effortLevels = (effectiveContract.effort_levels ?? DEFAULT_EFFORT_LEVELS).map((level) => level.toUpperCase());
    const defaultEffort = effortLevels.includes('LOW') ? 'LOW' : effortLevels[0];
    const rawEffort = body.effort === undefined ? defaultEffort : String(body.effort);
    const effort = rawEffort.toUpperCase();
    const isNumericEffort = /^\d+$/.test(rawEffort.trim());
    const isToggleEffort = ['ON', 'OFF', 'TRUE', 'FALSE'].includes(effort);
    if (!effortLevels.includes(effort) && !isNumericEffort && !isToggleEffort) {
      throw new InputError(`effort must be one of ${effortLevels.join('|')} for ${adapterId}`);
    }
    // D82 批次：档位真正进入 spawn 命令行（此前校验后被丢弃）。
    effectiveContract = applyEffortInjection(effectiveContract, effort);
    // D82 批次：派发可指定头犬——仅接受实证在册且头犬白名单内的通道。
    const headId = typeof body.head_id === 'string' && body.head_id.trim() !== '' ? body.head_id.trim() : undefined;
    if (headId !== undefined) {
      const headCapable = new Set<string>([...VERIFIED_WHITELIST, ...this.registryVerified]);
      if (!headCapable.has(headId)) {
        throw new InputError(`head_id '${headId}' is not a verified head-capable adapter`);
      }
    }
    const serverCap = this.budgetCaps[adapterId] ?? DEFAULT_BUDGET_CAP_USD;
    const requestedCap = body.cap_usd !== undefined ? Number(body.cap_usd) : serverCap;
    if (!Number.isFinite(requestedCap) || requestedCap <= 0) throw new InputError('cap_usd must be > 0');
    if (requestedCap > serverCap) {
      throw new InputError(`cap_usd (${requestedCap}) cannot exceed server configured budget cap (${serverCap})`);
    }
    const capUsd = Math.min(requestedCap, serverCap);
    const amountUsd = body.amount_usd === undefined ? 0 : Number(body.amount_usd);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new InputError('amount_usd must be >= 0');
    // 超时可配（秒）：真实任务远超旧 120s 硬编码（dispatch 747c7040 教训：
    // RF-C 诊断犬 120s 被掐）。默认 real=900 / dry=5，范围 5..3600。
    const timeoutSec = body.timeout_s === undefined ? (body.real === true ? 900 : 5) : Number(body.timeout_s);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 5 || timeoutSec > 3600) {
      throw new InputError('timeout_s must be 5..3600 seconds');
    }
    const real = body.real === true;
    const workspace = typeof body.workspace === 'string' && body.workspace.trim() !== '' ? path.resolve(body.workspace) : this.defaultWorkspace();
    if (!existsSync(workspace)) throw new InputError(`workspace does not exist: ${workspace}`);
    // F-41（安全审查 2026-08-17）：workspace 白名单——dispatch 只允许落在
    // 服务根目录或已登记（known-workspaces/当前选中）的工作区，防止任意
    // 本地目录被选为犬的执行范围（纵深防御，配合 DEF-04 Host 校验）。
    if (workspace !== this.workspaceRoot && !this.isKnownWorkspace(workspace)) {
      throw new InputError(`workspace not registered: ${workspace}（先经 POST /api/workspaces/select 登记）`);
    }

    // GOAL-014（M0）：carve-out 声明式写面校验。携带 carveout_id 时 cwd 必须
    // 位于白名单根下（.agent-bridge 任意仓永久 deny），快照留痕供头犬事后
    // diff 审核；不做运行时文件写拦截（运行时强拦截留 GP-14 隔离区）。
    const carveoutId =
      typeof body.carveout_id === 'string' && body.carveout_id.trim() !== '' ? body.carveout_id.trim() : undefined;
    const cwd = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? path.resolve(body.cwd) : undefined;
    let carveoutWhitelist: CarveoutWhitelistSnapshot | undefined;
    if (carveoutId !== undefined || cwd !== undefined) {
      if (carveoutId === undefined) {
        throw new InputError('cwd requires carveout_id (carve-out declarative gate)');
      }
      const active = this.activeCarveout(); // 写面留痕：回收过期
      if (active === null || active.carveout_id !== carveoutId) {
        throw new InputError(`carveout is not ACTIVE: ${carveoutId}`);
      }
      if (cwd === undefined) {
        throw new InputError('carveout_id requires cwd (must be within carve-out whitelist root)');
      }
      if (hasAgentBridgeSegment(cwd)) {
        throw new InputError(`cwd under .agent-bridge is permanently denied (golden reference): ${cwd}`);
      }
      if (!isPathWithinRoots(cwd, active.paths)) {
        throw new InputError(`cwd not within carve-out whitelist roots: ${cwd}`);
      }
      carveoutWhitelist = { paths: [...active.paths], expires_at: active.expires_at, task_ref: active.task_ref };
    }

    const topologyMode: TopologyMode = (typeof body.topology_mode === 'string' && ['HIERARCHICAL', 'PIPELINE_SOP', 'COMMITTEE_DEBATE', 'BOUNTY_MARKET'].includes(body.topology_mode))
      ? (body.topology_mode as TopologyMode)
      : 'HIERARCHICAL';
    const verifierDog: string | undefined = typeof body.verifier_dog === 'string' && body.verifier_dog.trim() !== ''
      ? body.verifier_dog.trim()
      : undefined;

    if (verifierDog !== undefined && verifierDog === adapterId) {
      throw new VerifierDecouplingError(`生成者与验证者不得为同一犬只 (${adapterId})，必须由独立异构犬只进行验证`);
    }

    const dispatchId =
      internal?.dispatchId !== undefined && /^[0-9a-f]{32}$/.test(internal.dispatchId)
        ? internal.dispatchId
        : randomUUID().replace(/-/g, '');
    const request: DispatchRequestSnapshot = {
      adapter_id: adapterId,
      prompt,
      effort,
      workspace,
      timeout_s: timeoutSec,
      cap_usd: capUsd,
      real,
      ...(modelId !== undefined ? { model_id: modelId } : {}),
      ...(headId !== undefined ? { head_id: headId } : {}),
      ...(profile !== undefined ? { profile } : {}),
      ...(resolvedStream !== null ? { stream_id: resolvedStream.stream_id } : {}),
      ...(goalId !== undefined ? { goal_id: goalId } : {}),
      ...(typeof body.resume_session === 'string' && body.resume_session.trim() !== '' ? { resume_session: body.resume_session } : {}),
      ...(typeof body.task_id === 'string' && body.task_id.trim() !== '' ? { task_id: body.task_id.trim() } : {}),
      ...(topologyMode !== 'HIERARCHICAL' ? { topology_mode: topologyMode } : {}),
      ...(verifierDog !== undefined ? { verifier_dog: verifierDog } : {}),
      ...(carveoutId !== undefined && carveoutWhitelist !== undefined
        ? { cwd, carveout_id: carveoutId, carveout_whitelist: carveoutWhitelist }
        : {}),
    };
    const record: DispatchRecord = {
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      status: 'ADMITTED',
      receipt_path: null,
      admission: null,
      events: [],
      error: null,
      stdout_tail: null,
      stderr_tail: null,
      session_id: null,
      ...(resolvedStream !== null ? { stream_id: resolvedStream.stream_id } : {}),
      ...(typeof body.task_id === 'string' && body.task_id.trim() !== '' ? { task_id: body.task_id.trim() } : {}),
      ...(topologyMode !== 'HIERARCHICAL' ? { topology_mode: topologyMode } : {}),
      ...(carveoutId !== undefined ? { carveout_id: carveoutId } : {}),
      request,
    };

    // GOAL-068（D2）：全局资金总控门先于项目 admission——跨项目切换下防资金
    // 逃逸；DENIED 同样在项目台账留证（kind=MASTER_CAP_EXCEEDED）。
    const masterCheck = this.masterGate?.admit(adapterId, workspace, amountUsd);
    if (masterCheck !== undefined && masterCheck.decision === 'DENIED') {
      const deniedAtUtc = this.now().toISOString();
      const spentBeforeDenied = roundMicroUsd(this.ledger.spentUsd(adapterId));
      const deniedEntry: UsdAdmissionEntry = Object.freeze({
        atUtc: deniedAtUtc,
        actorId: adapterId,
        decision: 'DENIED',
        amountUsd,
        capUsd,
        spentBeforeUsd: spentBeforeDenied,
        remainingUsd: roundMicroUsd(capUsd - spentBeforeDenied),
        meta: {
          dispatch_id: dispatchId,
          kind: 'MASTER_CAP_EXCEEDED',
          master_cap_usd: masterCheck.master_cap_usd,
          master_remaining_usd: masterCheck.remaining_usd,
          reason: masterCheck.reason ?? 'master budget cap exceeded (cross-project)',
          workspace,
        },
        sha256: '',
        previous_sha256: null,
      });
      record.admission = { decision: 'DENIED', remaining_usd: deniedEntry.remainingUsd };
      this.records.set(dispatchId, record);
      this.persistence?.saveDispatchHeader(record);
      this.appendLedger(deniedEntry);
      this.emit(record, 'ADMISSION', 'FAIL', {
        decision: 'DENIED',
        remaining_usd: deniedEntry.remainingUsd,
        master_remaining_usd: masterCheck.remaining_usd,
      });
      record.status = 'FAIL';
      record.error = 'master budget admission denied (cross-project cap)';
      this.emit(record, 'REVIEW', 'FAIL', { reason: record.error });
      return record;
    }

    const admission = this.ledger.admit({
      actorId: adapterId,
      capUsd,
      amountUsd,
      meta: {
        dispatch_id: dispatchId,
        effort,
        real,
        profile,
        prompt_sha256: sha256Hex(prompt),
        ...(masterCheck !== undefined ? { master_remaining_usd: masterCheck.remaining_usd } : {}),
        workspace,
      },
    });
    record.admission = { decision: admission.decision, remaining_usd: admission.remainingUsd };
    this.records.set(dispatchId, record);
    this.persistence?.saveDispatchHeader(record); // GP-03：header 先于任何事件行落盘
    this.appendLedger(admission);
    this.emit(record, 'ADMISSION', admission.decision === 'ADMITTED' ? 'ADMITTED' : 'FAIL', {
      decision: admission.decision,
      remaining_usd: admission.remainingUsd,
    });
    if (admission.decision !== 'ADMITTED') {
      record.status = 'FAIL';
      record.error = 'budget admission denied';
      this.emit(record, 'REVIEW', 'FAIL', { reason: 'budget admission denied' });
      return record;
    }

    // GOAL-019 U3：派发回链——ADMITTED 后把 dispatch_id 追加进任务记录。
    if (typeof body.task_id === 'string' && body.task_id.trim() !== '') {
      this.linkTaskDispatch(body.task_id.trim(), dispatchId);
    }

    if (real && internal?.originOwner !== true) {
      // GP-32（D30 逐单审批）：只认本单（或审批重跑所继承的原单）令牌，
      // GOAL-065：原子 rename 读即焚消费，彻底杜绝高并发竞争双花 (TOCTOU)
      const tokenFor = internal?.approvedVia ?? dispatchId;
      const tokenPath = path.join(this.approvalTokensPath, `dispatch-${tokenFor}.token.json`);
      const consumedPath = path.join(this.approvalTokensPath, `dispatch-${tokenFor}.token.consumed.${randomUUID().replace(/-/g, '')}`);
      let consumed = false;
      try {
        renameSync(tokenPath, consumedPath);
        rmSync(consumedPath, { force: true });
        consumed = true;
      } catch {
        consumed = false;
      }
      if (!consumed) {
        if (internal?.approvedVia !== undefined) {
          throw new InputError(`approval token not found or already consumed for dispatch ${tokenFor}`);
        }
        this.createDispatchApprovalRequest(record, capUsd);
        record.status = 'BLOCKED_WAITING_OWNER';
        record.error = 'real dispatch requires owner approval (D30 per-dispatch card)';
        this.emit(record, 'EXECUTE', 'BLOCKED_WAITING_OWNER', { approval_request: `dispatch-${dispatchId}.json` });
        this.emit(record, 'REVIEW', 'BLOCKED_WAITING_OWNER', { reason: record.error });
        return record;
      }
    }

    const receiptDir = path.join(workspace, '.mush-receipts');
    mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, `dispatch-${dispatchId}.json`);
    this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', { workspace });
    // GOAL-021 U3：仅当宿主请求流式（internal.onStdout）时，才把原始 stdout
    // 节流合帧（≥200ms 或 512B）为 EXECUTE 增量事件，并转发合并文本给宿主。
    // 无宿主回调 = 维持既有行为（一次性 REPORT，不外加 EXECUTE 增量帧）。
    const streamThrottle =
      internal?.onStdout !== undefined
        ? createThrottledStream({
            emit: (text) => {
              this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', {
                workspace,
                progress: 'stream',
                stream_text: text,
              });
              internal.onStdout?.(text);
            },
            now: () => this.now().getTime(),
          })
        : null;
    const run = await this.runAdapter(effectiveContract, prompt, {
      workspaceRoot: workspace,
      receiptPath,
      timeoutMs: timeoutSec * 1000,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(streamThrottle !== null ? { onStdout: (chunk: string) => streamThrottle.push(chunk) } : {}),
    });
    streamThrottle?.flush();
    record.receipt_path = receiptPath;
    record.stdout_tail = tailOf(run.stdout, 2048);
    record.stderr_tail = tailOf(run.stderr, 256);
    record.session_id = extractSessionId(run.stdout);
    const telemetry = run.receipt?.telemetry;
    const receipt = {
      schema_version: 1,
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      prompt_sha256: sha256Hex(prompt),
      effort,
      real,
      profile,
      exit_code: run.exitCode,
      timed_out: run.timedOut,
      child_killed: run.childKilled,
      stdout_sha256: sha256Hex(run.stdout),
      stderr_sha256: sha256Hex(run.stderr),
      finished_at_utc: this.now().toISOString(),
      ...(telemetry ? { telemetry } : {}),
    };
    writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', 'utf8');

    // GOAL-064: 实际消耗真实回写 (Cost Feedback Loop)
    if (telemetry && typeof telemetry.total_cost_usd === 'number' && telemetry.total_cost_usd > 0) {
      const actualEntry = this.ledger.recordActualUsage({
        actorId: adapterId,
        capUsd,
        actualCostUsd: telemetry.total_cost_usd,
        meta: {
          dispatch_id: dispatchId,
          real,
          telemetry,
          cache_savings_usd: telemetry.cache_savings_usd ?? 0,
          kind: 'ACTUAL_COST',
          workspace,
        },
      });
      this.appendLedger(actualEntry);
    }

    const pass = run.exitCode === 0 && !run.timedOut;
    record.status = pass ? (real ? 'PASS' : 'DRY_RUN') : run.timedOut ? 'TIMEOUT' : 'FAIL';
    record.error = pass ? null : run.stderr || `runner exit ${run.exitCode}`;

    // GOAL-028: LLM-as-a-Verifier 独立审判验证
    if (verifierDog !== undefined) {
      try {
        const vReport = await runVerifier({
          generatorId: adapterId,
          verifierId: verifierDog,
          facet: 'SECURITY',
          prompt,
          artifactContent: run.stdout,
          now: this.now,
        });
        record.verifier_report = vReport;
        if (vReport.decision === 'FAIL') {
          record.status = 'FAIL';
          record.error = `Verifier rejected (${vReport.issues.join('; ')})`;
        }
      } catch (err) {
        record.status = 'FAIL';
        record.error = err instanceof Error ? err.message : String(err);
      }
    }

    // GOAL-026: 顺风车记录模型真实可用性（PASS 升 T1_VERIFIED 权威实测）
    // GOAL-067（P1-10）归因修正：用户请求的模型变体存于 record.request.model_id
    // （旧代码读取不存在的 record.model_id，变体实测被错误归因到合同默认模型，
    //  污染 T1 权威表与名册显示）。
    const effectiveModel = record.request?.model_id || contract.expected_model_id;
    if (effectiveModel && effectiveModel !== 'UNKNOWN') {
      recordModelReceipt(
        this.liveProbesPath,
        adapterId,
        effectiveModel,
        pass,
        pass ? undefined : record.error || undefined,
        this.now,
      );
      if (pass) {
        this.authoritativeModels.set(adapterId, effectiveModel);
        if (this.liveProbes[adapterId]) {
          this.liveProbes[adapterId].actual_model_id = effectiveModel;
          this.liveProbes[adapterId].model_tiers = this.liveProbes[adapterId].model_tiers || {};
          this.liveProbes[adapterId].model_tiers[effectiveModel] = 'T1_VERIFIED';
        }
      }
    }

    this.emit(record, 'REPORT', record.status, { receipt_path: receiptPath, exit_code: run.exitCode });
    this.emit(record, 'REVIEW', record.status, { verdict: pass ? 'PASS' : 'FAIL' });
    if (resolvedStream !== null) {
      this.recordStreamDispatch(resolvedStream, dispatchId, adapterId, record.session_id, prompt, run);
    }
    // GOAL-024: 自动将关联任务推进到完成池 (DONE) 或受阻池 (BLOCKED)
    if (typeof record.task_id === 'string' && record.task_id !== '') {
      const target = pass ? 'DONE' : 'BLOCKED';
      this.autoAdvanceTask(record.task_id, target);
    }
    return record;
  }

  /** GP-10：派发重跑——克隆历史请求快照，生成新 dispatch；amount_usd 不克隆。 */
  async rerun(dispatchId: string, overrides: Record<string, unknown> = {}): Promise<DispatchRecord> {
    const original = this.get(dispatchId);
    if (original === null) throw new InputError(`dispatch not found: ${dispatchId}`);
    if (original.request === undefined) {
      throw new InputError(`dispatch ${dispatchId} has no replayable request snapshot (created before v1.4)`);
    }
    const request = original.request;
    const real = overrides.real === undefined ? request.real : overrides.real === true;
    const capUsd = overrides.cap_usd === undefined ? request.cap_usd : Number(overrides.cap_usd);
    // GP-32（D30）：审批通过的重跑携带 approved_via——新派发消费原单令牌，
    // 原被拦记录折算 SUPERSEDED（终态），审计链：审批应答→令牌→新派发回执。
    const approvedVia =
      typeof overrides.approved_via === 'string' && overrides.approved_via.trim() !== ''
        ? overrides.approved_via.trim()
        : undefined;
    if (approvedVia === dispatchId && original.status === 'BLOCKED_WAITING_OWNER') {
      original.status = 'SUPERSEDED';
      original.error = 'superseded by owner-approved rerun (D30)';
      this.emit(original, 'REVIEW', 'SUPERSEDED', { reason: 'approved rerun executed' });
    }
    return this.dispatch(
      {
        adapter_id: request.adapter_id,
        prompt: request.prompt,
        effort: request.effort,
        workspace: request.workspace,
        timeout_s: request.timeout_s,
        model_id: request.model_id,
        profile: request.profile,
        stream_id: request.stream_id,
        goal_id: request.goal_id,
        resume_session: request.resume_session,
        task_id: request.task_id,
        // GOAL-014（M0）：carve-out 切片引用随重跑透传，dispatch() 重新校验
        // 当前 ACTIVE（原切片已过期/撤销 → rerun 拒绝，不绕过写面门）。
        ...(request.carveout_id !== undefined ? { carveout_id: request.carveout_id } : {}),
        ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
        cap_usd: capUsd,
        real,
      },
      approvedVia !== undefined ? { approvedVia } : undefined,
    );
  }

  get(dispatchId: string): DispatchRecord | null {
    return this.records.get(dispatchId) ?? null;
  }

  /** GP-32（D30）：被拦的真实派发自动生成审批请求文件（看板审批视图数据源），
   * 报备信息齐全：犬只/强度/超时/工作区/预算已花与 cap/完整 prompt/流关联。 */
  private createDispatchApprovalRequest(record: DispatchRecord, capUsd: number): void {
    const request = record.request;
    if (request === undefined) return;
    mkdirSync(this.approvalRequestRoot, { recursive: true });
    const spentUsd = this.ledger.spentUsd(record.adapter_id);
    const file = {
      schema_version: 1,
      kind: 'dispatch',
      gate: 'D30-real-dispatch',
      dispatch_id: record.dispatch_id,
      // owner 2026-08-17 反馈：审批名必须带 Goal 编号利于人识别 + 任务池关联。
      title: `真实派发：${record.adapter_id}${request.goal_id !== undefined ? ' · ' + request.goal_id : ''}`,
      actor_id: record.adapter_id,
      goal_id: request.goal_id ?? null,
      reason: `${request.goal_id !== undefined ? request.goal_id + ' · ' : ''}real 派发逐单审批（effort=${request.effort} timeout=${request.timeout_s}s cap=$${capUsd}）`,
      requested_at_utc: this.now().toISOString(),
      adapter_id: record.adapter_id,
      effort: request.effort,
      timeout_s: request.timeout_s,
      workspace: request.workspace,
      cap_usd: capUsd,
      actor_spent_usd: spentUsd,
      stream_id: record.stream_id ?? null,
      prompt: request.prompt,
    };
    writeFileSync(
      path.join(this.approvalRequestRoot, `dispatch-${record.dispatch_id}.json`),
      JSON.stringify(file, null, 2) + '\n',
      'utf8',
    );
  }

  /** GP-32（D30）：owner 批准 → 为该派发写单次令牌（消费即焚）。 */
  grantApprovalToken(dispatchId: string): void {
    const record = this.get(dispatchId);
    if (record === null) throw new InputError(`dispatch not found: ${dispatchId}`);
    mkdirSync(this.approvalTokensPath, { recursive: true });
    writeFileSync(
      path.join(this.approvalTokensPath, `dispatch-${dispatchId}.token.json`),
      JSON.stringify({ dispatch_id: dispatchId, granted_at_utc: this.now().toISOString() }) + '\n',
      'utf8',
    );
  }

  /** GP-32（D30）：owner 否决 → 派发折算 REJECTED（终态，append-only 事件留痕）。 */
  rejectDispatch(dispatchId: string): DispatchRecord {
    const record = this.get(dispatchId);
    if (record === null) throw new InputError(`dispatch not found: ${dispatchId}`);
    record.status = 'REJECTED';
    record.error = 'owner rejected the approval request (D30)';
    this.emit(record, 'REVIEW', 'REJECTED', { reason: 'owner rejected' });
    return record;
  }

  // ---- GOAL-014（M0）：carve-out owner 授权通道 + 写面声明式校验 ----

  /** 当前 ACTIVE carve-out（写面调用：回收过期留痕后返回；无 = null）。 */
  activeCarveout(): Carveout | null {
    this.reapExpiredCarveout();
    return this.resolveActive();
  }

  /** GOAL-034 (GP-24): 查询所有 carve-out 切片与当前 ACTIVE 状态。 */
  listCarveouts(): { carveouts: Carveout[]; active: Carveout | null; current_token: string | null } {
    this.reapExpiredCarveout();
    const all = loadCarveouts(this.carveoutsPath);
    const active = this.resolveActive();
    return {
      carveouts: all,
      active,
      current_token: this.currentCarveoutToken(),
    };
  }

  /** owner 授权通道：校验一次性 token → 创建 ACTIVE 切片（同时刻最多 1 份）→ 旋转 token。 */
  grantCarveout(input: unknown, token: string): Carveout {
    this.requireCarveoutToken(token);
    let parsed;
    try {
      parsed = parseGrantCarveoutInput(input);
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : String(error));
    }
    this.reapExpiredCarveout(); // 过期 ACTIVE 先标注 EXPIRED，避免阻塞新授权
    const active = this.resolveActive();
    if (active !== null) {
      throw new InputError(
        `a carve-out is already ACTIVE: ${active.carveout_id} (${active.task_ref}) — revoke first (single-slice grant)`,
      );
    }
    const record = buildCarveout(parsed, this.now());
    appendCarveout(this.carveoutsPath, record);
    rotateCarveoutToken(this.carveoutTokenPath, this.now); // 每次 grant 旋转
    return record;
  }

  /** 收回：校验 token + 目标切片 ACTIVE → 追加 REVOKED 快照。 */
  revokeCarveout(carveoutId: string, token: string): Carveout {
    this.requireCarveoutToken(token);
    const id = typeof carveoutId === 'string' ? carveoutId.trim() : '';
    if (id === '') throw new InputError('carveout_id must be non-blank');
    const byId = new Map(loadCarveouts(this.carveoutsPath).map((record) => [record.carveout_id, record]));
    const record = byId.get(id);
    if (record === undefined) throw new InputError(`carveout not found: ${id}`);
    if (record.status !== 'ACTIVE') throw new InputError(`carveout ${id} is not ACTIVE (status=${record.status})`);
    const revoked = revokeCarveoutSnapshot(record, this.now());
    appendCarveout(this.carveoutsPath, revoked);
    return revoked;
  }

  private currentCarveoutToken(): string | null {
    return readCarveoutToken(this.carveoutTokenPath);
  }

  private requireCarveoutToken(provided: string): void {
    const token = typeof provided === 'string' ? provided.trim() : '';
    if (token === '') throw new CarveoutAuthError('carve-out token is required');
    if (token !== this.currentCarveoutToken()) {
      throw new CarveoutAuthError('carve-out token mismatch (file missing, rotated, or stale)');
    }
  }

  private resolveActive(): Carveout | null {
    return resolveActiveCarveout(loadCarveouts(this.carveoutsPath), this.now()).active;
  }

  /** 已过期但状态仍为 ACTIVE 的记录追加 EXPIRED 快照（append-only，幂等允许冗余）。 */
  private reapExpiredCarveout(): void {
    const resolution = resolveActiveCarveout(loadCarveouts(this.carveoutsPath), this.now());
    if (resolution.expired !== null) {
      appendCarveout(this.carveoutsPath, expireCarveout(resolution.expired, this.now()));
    }
  }

  /** GOAL-017A U1：合并视图（base + user override + origin）。 */
  listAdapters(): AdapterView[] {
    return Object.values(this.contracts)
      .filter((contract) => contract.adapter_id !== 'fake-t1' || process.env.MUSH_INCLUDE_FAKE_ROSTER === '1')
      .map((contract) => {
          const user = this.userAdapters.find((entry) => entry.adapter_id === contract.adapter_id && entry.removed !== true);
          const origin: AdapterView['origin'] = user !== undefined ? (this.baseAdapterIds.has(contract.adapter_id) ? 'user-override' : 'user') : 'base';
        return {
          adapter_id: contract.adapter_id,
          protocol: contract.protocol,
          expected_provider: contract.expected_provider,
          expected_model_id: contract.expected_model_id,
          role: contract.role ?? 'executor',
          origin,
          verified: this.isAdapterVerified(contract.adapter_id),
          ...(user !== undefined ? { template: user.template } : {}),
          ...(contract.variants !== undefined ? { variants: [...contract.variants] } : {}),
          ...(contract.model_flag !== undefined ? { model_flag: contract.model_flag } : {}),
          ...(contract.effort_levels !== undefined ? { effort_levels: [...contract.effort_levels] } : {}),
          ...(contract.effort_injection !== undefined ? { effort_injection: { ...contract.effort_injection } } : {}),
        };
      })
      .sort((a, b) => a.adapter_id.localeCompare(b.adapter_id));
  }

  /** GOAL-017A U1：新增/覆盖用户适配器并持久化。 */
  upsertAdapter(input: unknown): AdapterView {
    let parsed: { template: AdapterTemplateId; adapterId: string; params: import('./adapter-store.ts').UserAdapterParams };
    try {
      parsed = validateAdapterUpsert(input);
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : String(error));
    }
    const now = this.now().toISOString();
    const existing = this.userAdapters.find((entry) => entry.adapter_id === parsed.adapterId);
    const record: UserAdapterRecord = {
      adapter_id: parsed.adapterId,
      template: parsed.template,
      params: parsed.params,
      removed: false,
      created_at_utc: existing?.created_at_utc ?? now,
      updated_at_utc: now,
    };
    const index = this.userAdapters.findIndex((entry) => entry.adapter_id === parsed.adapterId);
    if (index >= 0) this.userAdapters[index] = record;
    else this.userAdapters.push(record);
    saveAdapterStore(this.adaptersPath, this.userAdapters);
    this.rebuildContracts();
    const view = this.listAdapters().find((entry) => entry.adapter_id === parsed.adapterId);
    if (view === undefined) throw new InputError('adapter upsert failed to produce a merged view');
    return view;
  }

  /** GOAL-017A U1：软删适配器（removed:true，roster 隐藏，历史派发不受影响）。 */
  removeAdapter(adapterId: string): void {
    if (adapterId.trim() === '') throw new InputError('adapter_id must be non-blank');
    const active = this.contracts[adapterId] !== undefined;
    const existing = this.userAdapters.find((entry) => entry.adapter_id === adapterId);
    if (!active && existing === undefined) throw new InputError(`adapter not found: ${adapterId}`);
    const template = existing?.template ?? inferTemplateForAdapterId(adapterId, this.userAdapters);
    if (template === null) throw new InputError(`adapter not found: ${adapterId}`);
    const now = this.now().toISOString();
    const record: UserAdapterRecord = {
      adapter_id: adapterId,
      template,
      params: existing?.params ?? {},
      removed: true,
      created_at_utc: existing?.created_at_utc ?? now,
      updated_at_utc: now,
    };
    const index = this.userAdapters.findIndex((entry) => entry.adapter_id === adapterId);
    if (index >= 0) this.userAdapters[index] = record;
    else this.userAdapters.push(record);
    saveAdapterStore(this.adaptersPath, this.userAdapters);
    this.rebuildContracts();
  }

  /** GOAL-017A U2：verified 头犬候选（任意在册且 verified 的 harness）。 */
  verifiedAdapters(): string[] {
    return Object.values(this.contracts)
      .filter((contract) => this.isAdapterVerified(contract.adapter_id))
      .map((contract) => contract.adapter_id)
      .sort();
  }

  private isAdapterVerified(adapterId: string): boolean {
    const user = this.userAdapters.find((entry) => entry.adapter_id === adapterId && entry.removed !== true);
    if (user !== undefined) return VERIFIED_TEMPLATES.has(user.template);
    if (this.registryVerified.has(adapterId)) return true;
    const probe = this.liveProbes[adapterId];
    if (probe && probe.status === 'ONLINE' && probe.live_models && probe.live_models.length > 0) return true;
    return VERIFIED_WHITELIST.has(adapterId);
  }


  private rebuildContracts(): void {
    const registry = loadRegistry(this.registryPath);
    this.registryVerified = new Set(
      (registry?.adapters ?? []).filter((entry) => entry.verified === true).map((entry) => entry.adapter_id),
    );
    this.contracts = buildContracts(registry, this.userAdapters);
  }

  /** GOAL-025（GP-35）：执行在线模型实测探测并持久化缓存。 */
  async probeLiveModels(targetAdapterId?: string): Promise<Record<string, LiveProbeRecord>> {
    const contractsToProbe = targetAdapterId
      ? (this.contracts[targetAdapterId] ? [this.contracts[targetAdapterId]] : [])
      : Object.values(this.contracts);

    for (const contract of contractsToProbe) {
      if (contract.adapter_id === 'fake-t1') continue;
      try {
        const record = await probeAdapterLive(
          contract,
          async (cmd, args) => {
            // GOAL-069：保持历史两参调用——注入式 fake（两参签名）照常工作；
            // 默认 runner 因缺 opts 在内部受控返回 exit1（探测记为失败）。
            const res = await this.runAdapter(contract, args.join(' '));
            return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
          },
          this.now,
          this.liveProbes[contract.adapter_id]?.verified_models,
        );
        this.liveProbes[contract.adapter_id] = record;
        // GOAL-070：实测枚举到的模型同步进合同 variants（仅限带 model_flag 的
        // 通道）——派发侧 model_id 门禁（line ~793）与名册下拉同源，杜绝
        // "看板可见却派发被拒"的裂缝。
        if (record.status === 'ONLINE' && record.live_models.length > 0) {
          const base = this.contracts[contract.adapter_id];
          if (base !== undefined && base.model_flag !== undefined) {
            const mergedVariants = [...new Set([...(base.variants ?? []), ...record.live_models])];
            this.contracts[contract.adapter_id] = validateAdapterContract({ ...base, variants: mergedVariants });
          }
        }
      } catch (error) {
        this.liveProbes[contract.adapter_id] = {
          adapter_id: contract.adapter_id,
          status: 'UNAVAILABLE',
          live_models: [],
          error_message: error instanceof Error ? error.message : String(error),
          checked_at_utc: this.now().toISOString(),
        };
      }
    }
    saveLiveProbeCache(this.liveProbesPath, this.liveProbes);
    return this.liveProbes;
  }

  getLiveProbes(): Record<string, LiveProbeRecord> {
    return { ...this.liveProbes };
  }

  /** 机器级共享文件路径：能力注册表。实证状态是机器级事实（D82 批次修复），
   *  跨工作区上下文必须一致，不得随热切换落入 per-project runtime。 */
  get capabilityRegistryPath(): string {
    return this.registryPath;
  }

  /** 机器级共享文件路径：模型实测探针缓存（GOAL-025）。 */
  get liveProbeCachePath(): string {
    return this.liveProbesPath;
  }

  /** G009 & GOAL-025：在册犬只名册（派发下拉/看板视图的取数源）——合同表投影 + 实测状态回填。
   * 只含身份字段，不含 executable 路径等敏感细节。
   * 测试假犬（fake-t1）不进名册——owner 2026-08-17 反馈：生产下拉不应出现
   * 测试夹具；合同表保留（测试/开发冒烟仍可显式 dispatch）。 */
  roster(): Array<{
    adapter_id: string;
    protocol: string;
    expected_provider: string;
    expected_model_id: string;
    variants?: string[];
    model_flag?: string;
    role: 'head' | 'executor';
    effort_levels?: string[];
    effort_injection?: EffortInjection;
    verified: boolean;
    grouped_models?: Record<string, string[]>;
    live_models?: string[];
    probe_status?: LiveProbeStatus;
    actual_model_id?: string;
    model_tiers?: Record<string, ModelTier>;
    supports_model_flag?: boolean;
    default_model_id?: string;
    providers?: HarnessProviderInfo[];
  }> {
    return Object.values(this.contracts)
      .filter((contract) => contract.adapter_id !== 'fake-t1' || process.env.MUSH_INCLUDE_FAKE_ROSTER === '1')
      .map((contract) => {
        const probe = this.liveProbes[contract.adapter_id];
        const actualModel = this.authoritativeModels.get(contract.adapter_id) || probe?.actual_model_id;
        const supportsModelFlag =
          Boolean(contract.model_flag) ||
          contract.protocol === 'pi-rpc' ||
          contract.adapter_id.startsWith('agy') ||
          contract.adapter_id.includes('claude') ||
          contract.adapter_id.includes('codex');
        const computedTiers: Record<string, ModelTier> = { ...(probe?.model_tiers || {}) };
        const discovered = discoverHarnessGroupedModels(contract);
        const hierarchy = getHarnessHierarchy(contract);
        const groupedModels = probe?.grouped_models || discovered.grouped;
        const modelsList = probe?.live_models && probe.live_models.length > 0
          ? probe.live_models
          : discovered.models;
        for (const m of modelsList) {
          if (!computedTiers[m] && m && m !== 'UNKNOWN') {
            computedTiers[m] = classifyModelTier(contract, m, probe?.verified_models, this.now);
          }
        }
        return {
          adapter_id: contract.adapter_id,
          protocol: contract.protocol,
          expected_provider: contract.expected_provider,
          expected_model_id: contract.expected_model_id,
          role: contract.role ?? 'executor',
          verified: this.isAdapterVerified(contract.adapter_id),
          supports_model_flag: supportsModelFlag,
          default_model_id: discovered.defaultModel || contract.expected_model_id,
          model_tiers: computedTiers,
          grouped_models: groupedModels,
          providers: hierarchy.providers,
          ...(contract.variants !== undefined ? { variants: [...contract.variants] } : {}),
          ...(contract.model_flag !== undefined ? { model_flag: contract.model_flag } : {}),
          ...(contract.effort_levels !== undefined ? { effort_levels: [...contract.effort_levels] } : {}),
          ...(contract.effort_injection !== undefined ? { effort_injection: { ...contract.effort_injection } } : {}),
          ...(modelsList && modelsList.length > 0 ? { live_models: modelsList } : {}),
          ...(probe?.status ? { probe_status: probe.status } : {}),
          ...(actualModel ? { actual_model_id: actualModel } : {}),
        };
      });
  }



  /** G011 / DEF-10：默认工作区优先取 .mush/workspace.json 持久化选择。 */
  defaultWorkspace(): string {
    const file = path.join(this.workspaceRoot, '.mush', 'workspace.json');
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { selected?: unknown };
        if (typeof parsed.selected === 'string' && parsed.selected.trim() !== '' && existsSync(path.resolve(parsed.selected))) {
          return path.resolve(parsed.selected);
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    return this.workspaceRoot;
  }

  recent(limit = 20): DispatchRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  /** GOAL-017A & GOAL-056：预算投影——cap 读持久化；spent 仅 real 且 amount>0；
   * admission_count 含 dry-run；返回 Prompt Cache 节省汇总。 */
  budgetProjection(): {
    total_spent_usd: number;
    total_cache_savings_usd: number;
    actors: Array<{
      actor_id: string;
      spent_usd: number;
      cap_usd: number;
      admission_count: number;
      cache_savings_usd: number;
      entries: UsdAdmissionEntry[];
    }>;
  } {
    const actorIds = new Set<string>([...this.contracts ? Object.keys(this.contracts) : [], ...this.ledger.allEntries().map((entry) => entry.actorId), ...Object.keys(this.budgetCaps)]);
    let total_spent_usd = 0;
    let total_cache_savings_usd = 0;
    const actors = [...actorIds].map((actorId) => {
      const allEntries = this.ledger.entries(actorId).filter((entry) => (entry.meta as Record<string, unknown>).kind !== 'CAP_CHANGE');
      const admission_count = allEntries.length;
      const dispatchMap = new Map<string, number>();
      let nonDispatchSum = 0;
      for (const entry of allEntries) {
        if (entry.decision !== 'ADMITTED' || entry.amountUsd <= 0) continue;
        if (entry.meta.real !== true && entry.meta.kind !== 'ACTUAL_COST') continue;
        const did = entry.meta && typeof entry.meta.dispatch_id === 'string' ? entry.meta.dispatch_id : null;
        if (did) {
          if (entry.meta.kind === 'ACTUAL_COST' || !dispatchMap.has(did)) {
            dispatchMap.set(did, entry.amountUsd);
          }
        } else {
          nonDispatchSum += entry.amountUsd;
        }
      }
      let actorTotalSpent = nonDispatchSum;
      for (const val of dispatchMap.values()) {
        actorTotalSpent += val;
      }
      const spent_usd = Math.round(actorTotalSpent * 1_000_000) / 1_000_000;
      const cache_savings_usd = allEntries
        .reduce((sum, entry) => sum + (Number((entry.meta as Record<string, unknown>)?.cache_savings_usd) || 0), 0);
      total_spent_usd += spent_usd;
      total_cache_savings_usd += cache_savings_usd;
      const cap_usd = this.budgetCaps[actorId] ?? DEFAULT_BUDGET_CAP_USD;
      return {
        actor_id: actorId,
        spent_usd,
        cap_usd,
        admission_count,
        cache_savings_usd,
        entries: allEntries as UsdAdmissionEntry[],
      };
    });
    return {
      total_spent_usd: Math.round(total_spent_usd * 1000) / 1000,
      total_cache_savings_usd: Math.round(total_cache_savings_usd * 1000) / 1000,
      actors,
    };
  }


  /** GOAL-017A U3：读取 per-actor caps（缺省 5 不落盘）。 */
  getBudgetCaps(): Record<string, number> {
    return { ...this.budgetCaps };
  }

  /** GOAL-017A U3：更新 per-actor cap，持久化并追加 CAP_CHANGE 台账留痕。 */
  setBudgetCap(actorId: string, capUsd: number): number {
    if (actorId.trim() === '') throw new InputError('actor must be non-blank');
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new InputError('cap_usd must be > 0');
    const previous = this.budgetCaps[actorId] ?? DEFAULT_BUDGET_CAP_USD;
    this.budgetCaps[actorId] = capUsd;
    saveBudgetCaps(this.budgetCapsPath, this.budgetCaps);
    this.appendCapChange(actorId, previous, capUsd);
    return capUsd;
  }

  /** GOAL-018 U7：流列表（含统计）。 */
  listStreams(): WorkStream[] {
    return this.streams.map((stream) => ({
      ...stream,
      events: [...stream.events],
      handoffs: [...stream.handoffs],
    }));
  }

  /** GOAL-018 U7：单流时间线。 */
  getStream(streamId: string): WorkStream | null {
    const stream = this.streams.find((entry) => entry.stream_id === streamId);
    return stream === undefined ? null : { ...stream, events: [...stream.events], handoffs: [...stream.handoffs] };
  }

  /** GOAL-018 U4：头犬/owner 外部写入交接（兜底入口）。 */
  addExternalHandoff(streamId: string, input: { done?: string; decided?: string; files?: string; next?: string; open_issues?: string }): HandoffBlock {
    const stream = this.streams.find((entry) => entry.stream_id === streamId);
    if (stream === undefined) throw new InputError(`stream not found: ${streamId}`);
    const atUtc = this.now().toISOString();
    const raw = [
      'HANDOFF-BEGIN',
      `做了什么: ${input.done ?? ''}`,
      `定了什么: ${input.decided ?? ''}`,
      `文件在哪: ${input.files ?? ''}`,
      `下一步: ${input.next ?? ''}`,
      `未解问题: ${input.open_issues ?? ''}`,
      'HANDOFF-END',
    ].join('\n');
    const block: HandoffBlock = {
      done: input.done ?? '',
      decided: input.decided ?? '',
      files: input.files ?? '',
      next: input.next ?? '',
      open_issues: input.open_issues ?? '',
      raw,
      // GOAL-067：HandoffBlock 哈希保持小写 legacy 口径（与历史台账一致），勿改大写。
      sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
      at_utc: atUtc,
    };
    addHandoffToStream(this.streamsPath, stream, block);
    return block;
  }

  /** GOAL-018 U1/U3/U4：解析/创建流、组装 prompt、决定 resume。 */
  private resolveStreamForDispatch(
    adapterId: string,
    goalId: string | undefined,
    newStream: boolean,
    explicitStreamId: string | undefined,
    contract: AdapterContract,
    rawPrompt: string,
    workspace: string,
  ): { stream: WorkStream; prompt: string; resumeSession?: string } {
    let stream: WorkStream;
    let handoffToInject: HandoffBlock | null = null;
    let openedNewWindow = false;
    const key = streamKey(adapterId, goalId);
    const makeTitle = (): string => `stream-${adapterId}-${goalId ?? 'none'}-${this.streams.length + 1}`;

    if (newStream) {
      stream = createStream(this.streamsPath, { key, title: makeTitle(), goalId, adapterId, now: this.now });
      this.streams.push(stream);
      openedNewWindow = true;
    } else if (explicitStreamId !== undefined) {
      const found = this.streams.find((entry) => entry.stream_id === explicitStreamId);
      if (found === undefined) throw new InputError(`unknown stream: ${explicitStreamId}`);
      stream = found;
      if (shouldSwitchWindow(stream, contract.context_management) && stream.status === 'active') {
        if (stream.handoffs.length > 0) handoffToInject = stream.handoffs[stream.handoffs.length - 1];
        setStreamStatus(this.streamsPath, stream, 'handoff', this.now().toISOString());
        stream = createStream(this.streamsPath, { key, title: makeTitle(), goalId, adapterId, now: this.now });
        this.streams.push(stream);
        openedNewWindow = true;
      }
    } else {
      let active = this.streams.find((entry) => entry.key === key && entry.status === 'active');
      if (active === undefined) {
        active = createStream(this.streamsPath, { key, title: makeTitle(), goalId, adapterId, now: this.now });
        this.streams.push(active);
        openedNewWindow = true;
      } else if (shouldSwitchWindow(active, contract.context_management)) {
        if (active.handoffs.length > 0) handoffToInject = active.handoffs[active.handoffs.length - 1];
        setStreamStatus(this.streamsPath, active, 'handoff', this.now().toISOString());
        active = createStream(this.streamsPath, { key, title: makeTitle(), goalId, adapterId, now: this.now });
        this.streams.push(active);
        openedNewWindow = true;
      }
      stream = active;
    }

    let prompt = rawPrompt;
    const projectBrief = readProjectBrief(workspace);
    if (projectBrief !== '') prompt = `[项目层 AGENTS.md]\n${projectBrief}\n\n${prompt}`;
    if (handoffToInject !== null) {
      prompt = `[最近交接]\n${handoffToInject.raw}\n\n${prompt}`;
    } else if (openedNewWindow && stream.handoffs.length > 0) {
      const last = stream.handoffs[stream.handoffs.length - 1];
      prompt = `[最近交接]\n${last.raw}\n\n${prompt}`;
    }

    let resumeSession: string | undefined;
    if (contract.context_management === 'none') {
      const history = stream.events.map((event) => event.output_preview ?? '').filter(Boolean).join('\n---\n');
      prompt = buildDshStitchedPrompt(DSH_CHARTER_FIXED, history, prompt);
    } else if (!openedNewWindow && contract.resume_flag !== undefined) {
      const lastEvent = stream.events[stream.events.length - 1];
      if (lastEvent?.session_id !== undefined && lastEvent.session_id !== null) resumeSession = lastEvent.session_id;
    }

    return { stream, prompt, resumeSession };
  }

  /** GOAL-018 U1/U4：派发完成后把事件/交接写回流记录。 */
  private recordStreamDispatch(stream: WorkStream, dispatchId: string, adapterId: string, sessionId: string | null, prompt: string, run: RunAdapterResult): void {
    const atUtc = this.now().toISOString();
    addDispatchToStream(this.streamsPath, stream, {
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      session_id: sessionId,
      prompt_chars: prompt.length,
      output_chars: run.stdout.length,
      context_estimate: estimateTokens(prompt.length + run.stdout.length),
      at_utc: atUtc,
      prompt_preview: prompt.slice(-2000),
      output_preview: run.stdout.slice(-2000),
    });
    const handoff = parseHandoffBlock(run.stdout, atUtc);
    if (handoff !== null) addHandoffToStream(this.streamsPath, stream, handoff);
  }


  /** GOAL-019 U2 & GOAL-024 & D67：任务列表（自动扫描 goals/ 新文档并与验收回执对账，折叠最新快照）。 */
  listTasks(): Task[] {
    const receiptsDir = path.join(this.workspaceRoot, 'goals', 'receipts');
    const goalsDir = path.join(this.workspaceRoot, 'goals');
    return syncGoalsDirectoryToTasks(this.tasksPath, goalsDir, receiptsDir, this.now);
  }


  /** GOAL-019 U2：创建任务（append-only 写新行）。 */
  createTask(input: unknown): Task {
    const task = createTask(input, this.now);
    appendTask(this.tasksPath, task);
    return task;
  }

  /** GOAL-019 U2：状态迁移（白名单校验，非法抛 InputError）。 */
  transitionTask(taskId: string, nextStatus: unknown): Task {
    const tasks = loadTasks(this.tasksPath);
    const task = tasks.find((entry) => entry.task_id === taskId);
    if (task === undefined) throw new InputError(`task not found: ${taskId}`);
    let next: Task;
    try {
      next = transitionTask(task, nextStatus, this.now);
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : String(error));
    }
    appendTask(this.tasksPath, next);
    return next;
  }

  /** GOAL-019 U3 & GOAL-024：派发回链——ADMITTED 后把 dispatch_id 追加进任务记录并跃迁至 IN_FLIGHT。 */
  private linkTaskDispatch(taskId: string, dispatchId: string): void {
    const tasks = loadTasks(this.tasksPath);
    const task = tasks.find((entry) => entry.task_id === taskId);
    if (task === undefined) throw new InputError(`task not found: ${taskId}`);
    let next = linkDispatchToTask(task, dispatchId, this.now);
    next = advanceTaskToStatus(next, 'IN_FLIGHT', this.now);
    appendTask(this.tasksPath, next);
  }

  /** GOAL-024：自动将关联任务推进至目标状态（如 DONE 或 BLOCKED），安全幂等。 */
  autoAdvanceTask(taskId: string, targetStatus: TaskStatus): Task | null {
    try {
      const tasks = loadTasks(this.tasksPath);
      const task = tasks.find((entry) => entry.task_id === taskId);
      if (!task) return null;
      if (task.status === targetStatus || task.status === 'DONE' || task.status === 'CANCELLED') {
        return task;
      }
      const next = advanceTaskToStatus(task, targetStatus, this.now);
      appendTask(this.tasksPath, next);
      return next;
    } catch (err) {
      console.warn(`[tasks] auto-advance failed for task ${taskId}:`, err);
      return null;
    }
  }


  listWorkspaces(extraCandidates: string[] = []): WorkspaceInfo[] {
    // F-39：候选先入归一化 Set（同路径不同形态/大小写双条目消除）。
    const candidates = new Set<string>([path.resolve(this.workspaceRoot)]);
    if (this.selectedWorkspace !== null) candidates.add(path.resolve(this.selectedWorkspace));
    // G009 修复：已知工作区持久化列表（<repoRoot>/.mush/known-workspaces.json），
    // 解决列表只含服务 cwd、冷启动选不到其他工作区的问题。
    for (const known of this.knownWorkspaces()) candidates.add(path.resolve(known));
    for (const candidate of extraCandidates) candidates.add(path.resolve(candidate));
    const result: WorkspaceInfo[] = [];
    for (const candidate of candidates) {
      try {
        if (!existsSync(candidate)) continue;
        const stat = statSync(candidate);
        if (!stat.isDirectory()) continue;
        result.push({
          path: candidate,
          is_git: existsSync(path.join(candidate, '.git')),
          mush_managed: existsSync(path.join(candidate, '.mush')),
          selected:
            this.selectedWorkspace !== null && candidate === path.resolve(this.selectedWorkspace),
        });
      } catch {
        // 不可读目录 fail-closed：不返回。
      }
    }
    return result;
  }

  selectWorkspace(target: string): string {
    const resolved = path.resolve(target);
    if (resolved.toLowerCase().includes('意向项目') || resolved.toLowerCase().includes('.agent-bridge')) {
      throw new InputError(`Cannot select frozen golden reference zone as workspace: ${resolved}`);
    }
    if (!existsSync(resolved)) throw new InputError(`workspace does not exist: ${resolved}`);
    if (!statSync(resolved).isDirectory()) throw new InputError(`not a directory: ${resolved}`);
    this.selectedWorkspace = resolved;
    const mushDir = path.join(resolved, '.mush');
    mkdirSync(mushDir, { recursive: true });
    writeFileSync(
      path.join(mushDir, 'workspace.json'),
      JSON.stringify({ schema_version: 1, selected: resolved, selected_at_utc: this.now().toISOString() }) + '\n',
      'utf8',
    );
    this.rememberWorkspace(resolved);
    return resolved;
  }

  /** G009：选中即记住（append 到 repo 侧 known-workspaces.json，去重；F-39：归一后比较）。 */
  private rememberWorkspace(resolved: string): void {
    const known = new Set(this.knownWorkspaces().map((item) => path.resolve(item)));
    known.add(path.resolve(resolved));
    const mushDir = path.join(this.workspaceRoot, '.mush');
    mkdirSync(mushDir, { recursive: true });
    writeFileSync(
      path.join(mushDir, 'known-workspaces.json'),
      JSON.stringify({ schema_version: 1, workspaces: [...known].sort() }, null, 2) + '\n',
      'utf8',
    );
  }

  /** GP-02：自主登记新建目录（mkdir recursive + 记入 known，返回 WorkspaceInfo）。
   * 校验：绝对路径、盘符根内（resolve 后不得逃逸出自身盘符——path.resolve 已保证；
   * 显式拒绝相对路径与已存在目录）。不提供 git init。 */
  createWorkspace(target: string): WorkspaceInfo {
    if (typeof target !== 'string' || target.trim() === '') throw new InputError("field 'path' is required");
    if (!path.isAbsolute(target)) throw new InputError(`workspace path must be absolute: ${target}`);
    const resolved = path.resolve(target);
    if (resolved.toLowerCase().includes('意向项目') || resolved.toLowerCase().includes('.agent-bridge')) {
      throw new InputError(`Cannot create workspace in frozen golden reference zone: ${resolved}`);
    }
    if (existsSync(resolved)) throw new InputError(`workspace already exists: ${resolved}`);
    mkdirSync(resolved, { recursive: true });
    this.rememberWorkspace(resolved);
    return {
      path: resolved,
      is_git: existsSync(path.join(resolved, '.git')),
      mush_managed: existsSync(path.join(resolved, '.mush')),
      selected: this.selectedWorkspace !== null && resolved === this.selectedWorkspace,
    };
  }

  private knownWorkspaces(): string[] {
    const file = path.join(this.workspaceRoot, '.mush', 'known-workspaces.json');
    try {
      if (!existsSync(file)) return [];
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { workspaces?: unknown };
      return Array.isArray(parsed.workspaces)
        ? parsed.workspaces.filter((item): item is string => typeof item === 'string')
        : [];
    } catch (error) {
      if (error instanceof SyntaxError) return []; // JSON 损坏 fail-closed
      throw error; // 编程错误（如未导入符号）不得静默吞掉
    }
  }

  /** F-41：路径是否在白名单内（服务根 + 当前选中 + known-workspaces 持久化
   * 列表；比较前统一 path.resolve 归一，兼治 F-39 双条目形态）。 */
  private isKnownWorkspace(resolved: string): boolean {
    if (resolved === this.workspaceRoot) return true;
    if (this.selectedWorkspace !== null && path.resolve(this.selectedWorkspace) === resolved) return true;
    return this.knownWorkspaces().some((known) => path.resolve(known) === resolved);
  }
}

export class InputError extends Error {}
export class CarveoutAuthError extends Error {}
