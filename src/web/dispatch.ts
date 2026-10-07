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
import { validateAdapterContract, contractPermissionFingerprint, DEFAULT_EFFORT_LEVELS, type AdapterContract, type EffortInjection } from '../adapters/contract.ts';
import { defaultCollabEffort, defaultCollabModelId } from './collab-effort.ts';
import type { CollaborationBlackboard, CollabSeat } from '../orchestration/collaboration-blackboard.ts';
import { buildDeepSeekContract } from '../adapters/deepseek.ts';
import { buildClaudeContract } from '../adapters/claude.ts';
import { buildZcodeContract } from '../adapters/zcode.ts';
import { buildPiContract } from '../adapters/pi.ts';
import { buildCodexContract } from '../adapters/codex.ts';
import { inspectCodexDiscussionRuntime, verifyCodexDiscussionBinding, type CodexDiscussionInspector } from '../adapters/codex-discussion-profile.ts';
import { inspectAgyDiscussionVersion, readAgyVersionDriftAcceptanceDir, verifyAgyDiscussionBinding, type AgyDiscussionInspector } from '../adapters/agy-discussion-profile.ts';
import { inspectClaudeDiscussionVersion, normalizeClaudeVersion, readClaudeVersionDriftAcceptanceDir, verifyClaudeDiscussionBinding, type ClaudeDiscussionInspector } from '../adapters/claude-discussion-profile.ts';
import { buildOpencodeContract } from '../adapters/opencode.ts';
import { buildKimiContract } from '../adapters/kimi.ts';
import { buildAgyContract, parseAgyOutput } from '../adapters/agy.ts';
import { buildHeadDogContract, extractSessionId } from '../adapters/head-dog.ts';
import { runT1, type SpawnFn } from '../adapters/t1-runner.ts';
import { normalizeOpencodeEvents } from '../adapters/opencode.ts';
import { runClaudeStreamRun, parseClaudeStreamJson } from '../adapters/claude.ts';
import { arbitrateUnattended, type UnattendedPolicy } from '../core/unattended-policy.ts';
import type { CircuitBreaker } from '../core/circuit-breaker.ts';
import type { LivenessGate } from '../core/liveness-ladder.ts';
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
  stripAssembledLayers,
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
  /** Internal chat linkage survives approval replay and server restart. */
  chat?: { session_id: string; solo: boolean };
  /** GOAL-084（owner 复核缺口，2026-10-03）：审批后重跑必须恢复的执行配置——
   *  restrictTools/outputSchema 决定实际 argv（沙箱/工具限制/schema 下发），
   *  不冻结会让 D30 批准重跑降级为无限制派发（审批所见 ≠ 重跑所跑）。 */
  restrictTools?: boolean;
  outputSchema?: unknown;
  /** GOAL-084（owner 复核缺口，2026-10-03）：批准时生效合同指纹（变体应用后、
   *  档位注入前的整份合同 sha256）——重跑时与当前生效合同比对，漂移即拒绝。 */
  contract_fingerprint?: string;
  /** Preparation persists a request without admission or model execution. */
  prepared_only?: boolean;
  probe_id?: 'C6' | 'A6' | 'C3' | 'A3' | 'C7' | 'A9' | 'A10' | 'A11' | 'A12' | 'A13' | 'A14' | 'A15' | 'A16' | 'C8' | 'C9' | 'C10' | 'C11';
  execution_cwd?: string;
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
  /** GOAL-084 §3.2（2026-10-01）：结构化观点完整对象（如 claude structured_output）。
   *  不经 2048 字符 tail 截断，协调器从此读取；持久化在回执 JSON 的同名段落。 */
  structured_output?: unknown;
  /** GOAL-085（2026-10-05）：运行时原生流上报的模型身份（如 claude stream-json system init 的
   *  `model` 字段）。仅作审计与身份比对依据；**不**等于供应商背后的模型权重证明。 */
  observed_model_id?: string;
  /** GOAL-085 D95（owner 2026-10-05 裁定）：本条派发在**显式接受原生版本漂移**下放行的依据
   *  （决议号 + 冻结版本 + 观察版本 + 接受者）。记录事实，不改变席位指纹与证据归属。 */
  version_drift_accepted?: { decision: string; accepted_by: string; frozen_native_version: string; observed_native_version: string };
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
  /** GOAL-080：故障转移来源犬（首犬失败换道重试时留痕）。 */
  failover_from?: string;
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

/** GOAL-071：观察模式只读参演章程——冻结区写面约束的提示级实现
 * （GP-14 运行时隔离到位前，配套事后零写入审计兜底）。 */
const OBSERVATION_CHARTER = `[观察模式｜只读参演]
你处于黄金参照区（宪法冻结区）的观察模式，本目录受最高级别写面保护。
绝对禁止：创建/修改/删除/移动任何文件或目录；禁止一切写命令（echo >、重定向、git commit/checkout/clean、npm install 等）。
只允许：读取与分析类操作（dir/ls、type/cat、git status/log/diff/show、grep/findstr）。
产出方式：所有结论与分析直接写在回复文本中，不落盘。`;

/** 深度受限目录清单（观察模式审计用）：不写任何临时文件到被测区。 */
function walkListingDepthLimited(dir: string, maxDepth = 3, maxEntries = 5000): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string, lvl: number): void => {
    if (lvl > maxDepth || out.length >= maxEntries) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxEntries) return;
      const relPath = rel !== '' ? `${rel}\\${name}` : name;
      out.push(relPath);
      try {
        if (statSync(path.join(d, name)).isDirectory()) walk(path.join(d, name), relPath, lvl + 1);
      } catch {}
    }
  };
  walk(dir, '', 0);
  return out.sort();
}

export interface RunAdapterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
  /** GOAL-069：真实 runner（runT1）返回完整回执；fake 可省略。 */
  receipt?: { telemetry?: import('../core/budget.ts').TokenUsageTelemetry };
  /** GOAL-075 切片2：ndjson-events 归一化回填的结构化会话锚点；fake 可省略。 */
  sessionId?: string;
  /** GOAL-084 §3.2：runner 提取的结构化结果（如 claude result.structured_output）——
   *  完整对象随结果上浮，不经 stdout_tail 截断。 */
  structuredOutput?: unknown;
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
    /** D82 批次：增量 stderr 透传（可选）——CLI 工具活动/构建进度通道。 */
    onStderr?: (chunk: string) => void;
    /** D84（2026-09-06）：owner 停止按钮的中断句柄注册（可选）——spawn 成功后
     *  runner 回调注册树杀函数；管线凭此实现 cancel()。缺失 = 不可中断。 */
    registerKill?: (kill: () => void) => void;
    /** GOAL-084 §3.2：讨论通道工具限制（internal 专用；runner 侧 fail-closed 兜底）。 */
    restrictTools?: boolean;
    /** GOAL-084 §3.2：mush 预写的输出 schema 文件路径（file 运输，internal 专用）。 */
    outputSchemaPath?: string;
    /** GOAL-084 §3.2：输出 schema JSON 文本（inline 运输，internal 专用）。 */
    outputSchemaJson?: string;
  },
) => Promise<RunAdapterResult>;

export interface DispatchPipelineOptions {
  workspaceRoot: string;
  /** D86（2026-09-06）：元数据根——审批/台账/任务池/探针缓存/令牌等 mush 数据面的
   *  派生基根；缺省 = workspaceRoot（宿主在库形态不变）。外部工作区由 server 传入
   *  宿主集中目录（<host>/runtime/workspaces/<slug>-<hash8>），目标文件夹零足迹。
   *  执行语义（spawn cwd、carve-out 路径校验、goals 目录读取）仍看 workspaceRoot。 */
  dataRoot?: string;
  /** D86：工作区选择与登记簿目录（workspace.json / known-workspaces.json）；
   *  缺省 = dataRoot/.mush。宿主级单点存储由 server 钉在启动根（修复热切换后
   *  注册表随工作区碎片化、DEF-10 重启恢复失准的问题）。 */
  registryDir?: string;
  approvalRoot: string;
  /** G009：real-dispatch 犬只批准目录；缺省 <workspaceRoot>/goals/receipts/dispatch-approvals。 */
  dispatchApprovalRoot?: string;
  /** GP-32（D30）：派发类审批请求落盘目录（看板审批视图数据源）；
   * 缺省 <workspaceRoot>/goals/receipts/approval-requests。 */
  approvalRequestRoot?: string;
  /** GOAL-084 §3.3：受控会话黑板——会话授权派发的校验/占额/结算入口；
   * 缺省 undefined = 会话派发不可用（fail-closed），D30 逐单门不受影响。 */
  collabBlackboard?: CollaborationBlackboard;
  /** GP-32（D30）：单次审批令牌目录（读即焚）；缺省 <workspaceRoot>/runtime/approval-tokens。 */
  approvalTokensPath?: string;
  ledgerPath: string;
  contracts?: Record<string, AdapterContract>;
  runAdapter?: RunAdapterFn;
  codexDiscussionInspector?: CodexDiscussionInspector;
  agyDiscussionInspector?: AgyDiscussionInspector;
  claudeDiscussionInspector?: ClaudeDiscussionInspector;
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
  /** GOAL-071：观察模式共享状态（热切换重建管线时跨上下文保持；缺省实例私有）。
   *  server 层以同一对象注入所有上下文管线。 */
  observationState?: { path: string | null };
  /** GOAL-073：无人值守分级授权（档位策略对象 + 熔断器实例；server 层共享注入）。
   *  缺省不启用 = 恒 L0 全弹卡行为。 */
  unattended?: { policy: UnattendedPolicy; breaker: CircuitBreaker };
  /** GOAL-080：探针阶梯门（预检 + 故障转移排序）。缺省不启用 = 无预检无换道
   *  （测试与旧场景零行为变化；server 层以 createLivenessGate 注入）。 */
  liveness?: LivenessGate;
  /** GOAL-082：完成核验门——G024 自动推进 PASS→DONE 前询问；拒绝则不落 DONE。 */
  completionGate?: (taskId: string, claim: string) => Promise<{ done: boolean; reason?: string }>;
  /** D82 批次：看板实时输出——开启后 stdout/stderr 增量以 EXECUTE 事件广播
   *  （SSE 直达浏览器，直连抽屉/派发卡可滚动观看干活过程）。默认关闭：
   *  测试与无宿主场景维持既有单帧语义。 */
  streamLiveOutput?: boolean;
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
    // TBTK 网关（New API 中转，Anthropic 兼容）：claude-code harness 指到 tbtk.asia，
    // 模型走网关实测可用的 k3-256k（owner 2026-08-27 提供密钥，经 MUSH_CLAUDE_TBTK_API_KEY 注入）。
    'claude-tbtk': validateAdapterContract({
      ...buildClaudeContract('k3-256k'),
      adapter_id: 'claude-tbtk',
      role: 'executor',
      provider_base_url: 'https://tbtk.asia',
    }),
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
  'claude-tbtk',
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
 *（旗标值替换为变体名）。GOAL-084 §3.2：声明 model_flag 但参数无占位的通道，
 * 旗标对补在合同参数尾部（运行时 prompt 恒在其后，flag-before-positional 不变）；
 * 无 flag 通道仅记录身份期望（切换能力见 F-G9-02）。 */
function applyModelVariant(contract: AdapterContract, modelId: string): AdapterContract {
  const arguments_ =
    contract.model_flag !== undefined
      ? contract.arguments.includes(contract.model_flag)
        ? contract.arguments.map((arg, index) =>
            index > 0 && contract.arguments[index - 1] === contract.model_flag ? modelId : arg,
          )
        : [...contract.arguments, contract.model_flag, modelId]
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
  const normalized = normalizeEffortValue(effort);
  const value = injection.config_key !== undefined ? injection.config_key + '=' + normalized : normalized;
  const args = [...contract.arguments];
  // Config flags may repeat for unrelated keys: rewrite only the approved effort key.
  const idx = injection.config_key === undefined ? args.indexOf(injection.name) :
    args.findIndex((arg, i) => arg === injection.name &&
      args[i + 1]?.split('=', 1)[0].trim() === injection.config_key);
  if (idx >= 0) {
    if (idx + 1 >= args.length) throw new InputError(`adapter ${contract.adapter_id} has malformed ${injection.name} default`);
    args[idx + 1] = value;
  } else {
    args.push(injection.name, value);
  }
  return validateAdapterContract({ ...contract, arguments: args });
}

const EFFORTS = new Set(['LOW', 'HIGH', 'XHIGH']);

/** D86（2026-09-06）：外部工作区的宿主集中数据目录——<hostRoot>/runtime/workspaces/
 *  <slug>-<路径哈希8>。宿主根自身返回在库位置（runtime/ 已是仓库惯例，不迁移）。
 *  确定性派生（slug + sha256(lowercase path) 前 8 位）：无需注册表即可从路径找回
 *  数据目录；同名不同路径不冲突。目标工作区文件夹零足迹。 */
export function centralWorkspaceDataDir(hostRoot: string, workspace: string): string {
  const resolvedHost = path.resolve(hostRoot);
  const resolved = path.resolve(workspace);
  if (resolved === resolvedHost) return resolvedHost;
  const slug = path.basename(resolved).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32) || 'workspace';
  const hash = sha256Hex(resolved.toLowerCase()).slice(0, 8);
  return path.join(resolvedHost, 'runtime', 'workspaces', `${slug}-${hash}`);
}
export interface DiscussionChannelCheck {
  adapter_id: string;
  ready: boolean;
  checked_at_utc: string;
  frozen_version?: string;
  observed_version?: string;
  config_fingerprint?: string;
  reason?: string;
}

export class DispatchPipeline {
  private readonly discussionObservations = new Map<string, {
    at: number; value: string | Awaited<ReturnType<CodexDiscussionInspector>>;
  }>();
  private exclusiveProbe?: { id: string; dispatched: boolean };

  /** Host-only configuration experiment: excludes other dispatches and allows one real call. */
  async withExclusiveProbe<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.exclusiveProbe !== undefined || this.recent(Number.MAX_SAFE_INTEGER).some(r => r.status === 'ADMITTED')
      || this.collabBlackboard?.listSessions().some(r => this.collabBlackboard!.isRunActive(r.id))) {
      throw new InputError('configuration probe requires an idle pipeline');
    }
    this.exclusiveProbe = { id, dispatched: false };
    try { return await action(); } finally { this.exclusiveProbe = undefined; }
  }

  /** Zero-model preflight for the selected room; no arguments checks all activated channels. */
  async checkDiscussionChannels(adapterIds: readonly string[], fresh = false): Promise<DiscussionChannelCheck[]> {
    const checks: DiscussionChannelCheck[] = [];
    for (const id of [...new Set(adapterIds)]) {
      const check: DiscussionChannelCheck = { adapter_id: id, ready: false, checked_at_utc: new Date().toISOString() };
      try {
        const base = this.contracts[id];
        if (base === undefined) throw new InputError('unknown selected discussion channel: ' + id);
        const profile = base.codex_discussion_profile ?? base.claude_discussion_profile ?? base.agy_discussion_profile;
        if (profile === undefined) throw new InputError('讨论档案未激活，请在看板激活通道 ' + id);
        const contract = this.collaborationContract(id, profile.model_id);
        check.config_fingerprint = contractPermissionFingerprint(contract);
        check.frozen_version = profile.native_version;
        if (contract.agy_discussion_profile) verifyAgyDiscussionBinding(contract, profile.model_id);
        else if (contract.claude_discussion_profile) verifyClaudeDiscussionBinding(contract, profile.model_id);
        else verifyCodexDiscussionBinding(contract, profile.model_id);
        // Cache observations only. Assets and acceptance policies are checked on every request.
        const key = JSON.stringify(contract);
        const cached = this.discussionObservations.get(key);
        let observed: string | Awaited<ReturnType<CodexDiscussionInspector>>;
        if (!fresh && cached !== undefined && Date.now() - cached.at < 30_000) {
          observed = cached.value;
          check.checked_at_utc = new Date(cached.at).toISOString();
        } else {
          observed = contract.agy_discussion_profile !== undefined
            ? await this.agyDiscussionInspector(contract, this.dataRoot)
            : contract.claude_discussion_profile !== undefined
              ? await this.claudeDiscussionInspector(contract, this.dataRoot)
              : await this.codexDiscussionInspector(contract, this.workspaceRoot, this.dataRoot);
          const at = Date.now();
          if (this.discussionObservations.size >= 64) this.discussionObservations.clear();
          this.discussionObservations.set(key, { at, value: observed });
          check.checked_at_utc = new Date(at).toISOString();
        }
        check.observed_version = typeof observed === 'string' ? observed : observed.nativeVersion;
        if (contract.agy_discussion_profile !== undefined) {
          verifyAgyDiscussionBinding(contract, profile.model_id, check.observed_version,
            readAgyVersionDriftAcceptanceDir(path.dirname(contract.agy_discussion_profile.workspace_root)));
        } else if (contract.claude_discussion_profile !== undefined) {
          check.observed_version = normalizeClaudeVersion(check.observed_version);
          verifyClaudeDiscussionBinding(contract, profile.model_id, check.observed_version,
            readClaudeVersionDriftAcceptanceDir(path.dirname(contract.claude_discussion_profile.workspace_root)));
        } else if (typeof observed !== 'string') verifyCodexDiscussionBinding(contract, profile.model_id, observed);
        else throw new InputError('unparseable Codex runtime observation');
        check.ready = true;
      } catch (error) { check.reason = error instanceof Error ? error.message : String(error); }
      checks.push(check);
    }
    return checks;
  }

  async preflightDiscussionChannels(adapterIds?: readonly string[]): Promise<void> {
    const ids = adapterIds ?? Object.keys(this.contracts).filter(id => {
      const c = this.contracts[id]!;
      return c.codex_discussion_profile || c.claude_discussion_profile || c.agy_discussion_profile;
    });
    const failed = (await this.checkDiscussionChannels(ids, true)).find(c => !c.ready);
    if (failed !== undefined) throw new InputError(failed.reason ?? 'discussion channel unavailable');
  }
  private readonly codexDiscussionInspector: CodexDiscussionInspector;
  private readonly agyDiscussionInspector: AgyDiscussionInspector;
  private readonly claudeDiscussionInspector: ClaudeDiscussionInspector;
  readonly workspaceRoot: string;
  /** D86：元数据根（数据面派生基根）；执行语义仍看 workspaceRoot。 */
  private readonly dataRoot: string;
  /** D86：选择与登记簿目录（workspace.json/known-workspaces.json）。 */
  private readonly registryDir: string;
  readonly approvalRoot: string;
  private readonly dispatchApprovalRoot: string;
  private readonly approvalRequestRoot: string;
  private readonly approvalTokensPath: string;
  readonly ledgerPath: string;
  private contracts: Record<string, AdapterContract>;
  private readonly runAdapter: RunAdapterFn;
  private onEvent: (event: DispatchLifecycleEvent) => void;
  private readonly streamLiveOutput: boolean;
  private readonly ledger = new UsdBudgetLedger();
  /** GOAL-068（D2）：跨项目全局资金总控门（可选；多项目热切换防逃逸）。 */
  private masterGate?: MasterBudgetGateLike;
  private readonly records = new Map<string, DispatchRecord>();
  /** D84（2026-09-06）：owner 停止按钮——运行中派发的树杀句柄表（spawn 成功即注册，结算即清除）。 */
  private readonly runningKills = new Map<string, () => void>();
  /** D84：owner 已请求中断的派发——run 结算时终态改记 INTERRUPTED（不计 FAIL、不触发故障转移/熔断）。 */
  private readonly cancelRequested = new Set<string>();
  private selectedWorkspace: string | null = null;
  /** GOAL-071：观察模式状态（可注入共享对象——热切换重建管线时跨上下文保持，
   * 与 masterGate 同模式；缺省实例私有）。 */
  private readonly observationState: { path: string | null };
  /** GOAL-084 §3.3：受控会话黑板（缺省 undefined = 会话派发 fail-closed 不可用）。 */
  private readonly collabBlackboard?: CollaborationBlackboard;
  /** GOAL-084 §3.5：只读访问当前管线绑定的黑板（看板会话创建/应答走同源黑板）。 */
  get collabBlackboardRef(): CollaborationBlackboard | undefined {
    return this.collabBlackboard;
  }
  /** GOAL-073：无人值守分级授权（档位策略 + 失控熔断器）；缺省未启用=恒 L0 行为。 */
  private readonly unattended?: { policy: UnattendedPolicy; breaker: CircuitBreaker };
  /** GOAL-080：探针阶梯门（预检 + 故障转移）；缺省未启用=无预检无换道。 */
  private livenessGate?: LivenessGate;

  /** GOAL-080：server 装配时注入探针门（合同表随热切换变化，门持惰性 thunk）。 */
  setLivenessGate(gate: LivenessGate): void {
    this.livenessGate = gate;
  }

  /** GOAL-082：完成核验门（可注入）。G024 自动推进 PASS→DONE 前询问；
   *  拒绝则任务不落 DONE。缺省未启用=既有行为（诚实 unverified）。 */
  completionGate?: (taskId: string, claim: string) => Promise<{ done: boolean; reason?: string }>;

  /** GOAL-080：当前生效合同表只读视图（探针门/监理装配用）。 */
  getContractMap(): Record<string, AdapterContract> {
    return this.contracts;
  }

  collaborationContract(adapterId: string, modelId?: string): AdapterContract {
    const contract = this.contracts[adapterId];
    if (contract === undefined) throw new InputError(`unknown adapter: ${adapterId}`);
    const model = modelId ?? contract.expected_model_id;
    if (model.trim() === '' || model === 'UNKNOWN') {
      throw new InputError(`select a registered model for adapter '${adapterId}'`);
    }
    if (model !== contract.expected_model_id && !contract.variants?.includes(model)) {
      throw new InputError(`model_id '${model}' not in variants of ${adapterId}`);
    }
    return applyModelVariant(contract, model);
  }

  sessionAuthorizationRequestPath(sessionId: string): string {
    this.collabBlackboard?.getSession(sessionId);
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new InputError('invalid collaboration session id');
    return path.join(this.approvalRequestRoot, `collab-session-${sessionId}.json`);
  }

  sessionOwnerDecision(sessionId: string): 'APPROVED' | 'REJECTED' | undefined {
    const file = this.sessionAuthorizationRequestPath(sessionId) + '.owner-response.json';
    if (!existsSync(file)) return undefined;
    try {
      const response = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      return response.owner_decision === 'APPROVED' || response.owner_decision === 'REJECTED'
        ? response.owner_decision : undefined;
    } catch {
      return undefined;
    }
  }
  /** GOAL-073：当日自动批累计与自增。 */
  private autoSpentToday(): number {
    const key = new Date().toISOString().slice(0, 10);
    return this.autoSpendByDay.get(key) ?? 0;
  }

  private bumpAutoSpend(usd: number): void {
    const key = new Date().toISOString().slice(0, 10);
    this.autoSpendByDay.set(key, Math.round(((this.autoSpendByDay.get(key) ?? 0) + usd) * 1_000_000) / 1_000_000);
  }

  /** 当日自动批累计（YYYY-MM-DD → USD），内存态（重启清零，fail-safe 偏保守）。 */
  private readonly autoSpendByDay = new Map<string, number>();
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
    // D86：元数据根与执行根分离——数据面默认随仓库（向后兼容），外部工作区集中托管。
    this.dataRoot = path.resolve(options.dataRoot ?? options.workspaceRoot);
    this.registryDir = path.resolve(options.registryDir ?? path.join(this.dataRoot, '.mush'));
    this.approvalRoot = path.resolve(options.approvalRoot);
    // G009 修复：real-dispatch 的犬只批准目录与看板审批视图（approval-requests）
    // 是两类记录，默认分开——犬只批准在 dispatch-approvals（D6 惯例）。
    this.dispatchApprovalRoot = path.resolve(
      options.dispatchApprovalRoot ?? path.join(this.dataRoot, 'goals', 'receipts', 'dispatch-approvals'),
    );
    // GP-32（D30）：逐单审批——被拦的真实派发自动生成审批请求文件（进看板
    // 审批视图），批准后写单次令牌（读即焚），常设文件不再参与放行。
    this.approvalRequestRoot = path.resolve(
      options.approvalRequestRoot ?? path.join(this.dataRoot, 'goals', 'receipts', 'approval-requests'),
    );
    this.approvalTokensPath = path.resolve(
      options.approvalTokensPath ?? path.join(this.dataRoot, 'runtime', 'approval-tokens'),
    );
    this.ledgerPath = path.resolve(options.ledgerPath);
    this.registryPath = path.resolve(
      options.registryPath ?? path.join(this.dataRoot, 'runtime', 'capability-registry.json'),
    );
    this.adaptersPath = path.resolve(
      options.adaptersPath ?? path.join(this.dataRoot, 'runtime', 'adapters.json'),
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
    this.observationState = options.observationState ?? { path: null };
    this.collabBlackboard = options.collabBlackboard;
    this.unattended = options.unattended;
    this.livenessGate = options.liveness;
    this.completionGate = options.completionGate;
    this.streamLiveOutput = options.streamLiveOutput === true;
    this.now = options.now ?? (() => new Date());
    this.persistence = options.persistence ?? null;
    this.masterGate = options.masterGate;
    this.profilesRoot = path.resolve(options.profilesRoot ?? path.join(homedir(), '.dsh', 'profiles'));
    this.budgetCapsPath = path.resolve(
      options.budgetCapsPath ?? path.join(this.dataRoot, 'runtime', 'budget-caps.json'),
    );
    this.budgetCaps = loadBudgetCaps(this.budgetCapsPath);
    this.streamsPath = path.resolve(
      options.streamsPath ?? path.join(this.dataRoot, 'runtime', 'streams.jsonl'),
    );
    this.streams = loadStreams(this.streamsPath);
    this.tasksPath = path.resolve(
      options.tasksPath ?? path.join(this.dataRoot, 'runtime', 'tasks.jsonl'),
    );
    this.carveoutsPath = path.resolve(
      options.carveoutsPath ?? path.join(this.dataRoot, 'runtime', 'carveouts.jsonl'),
    );
    this.carveoutTokenPath = path.resolve(
      options.carveoutTokenPath ?? path.join(this.dataRoot, '.mush', 'carveout-token'),
    );
    // GOAL-014（M0）：owner 授权通道最小握手——启动时确保 token 文件存在
    // （缺省自动生成，owner 可读文件取得），权限 0600，每次 grant 旋转。
    if (readCarveoutToken(this.carveoutTokenPath) === null) {
      rotateCarveoutToken(this.carveoutTokenPath, this.now);
    }
    this.liveProbesPath = path.resolve(
      options.liveProbesPath ?? path.join(this.dataRoot, 'runtime', 'live-probes.json'),
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
    this.codexDiscussionInspector = options.codexDiscussionInspector ?? inspectCodexDiscussionRuntime;
    this.agyDiscussionInspector = options.agyDiscussionInspector ?? inspectAgyDiscussionVersion;
    this.claudeDiscussionInspector = options.claudeDiscussionInspector ?? inspectClaudeDiscussionVersion;
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
          if (contract.protocol === 'stream-json') {
            // GOAL-072 通道修复：claude-code stream-json 执行路径——此前泛用
            // 管线只支持 t1/pi-rpc，claude-code 无法经看板派发。成本经合成
            // telemetry 回流台账（token 计数渠道未提供，置 0 并保留真实费用）。
            const res = await runClaudeStreamRun({
              contract,
              prompt,
              workspaceRoot: opts!.workspaceRoot,
              timeoutMs,
              onStdout: opts!.onStdout,
              onStderr: opts!.onStderr,
              spawn: options.spawn,
              // GOAL-084 §3.2：默认执行路径取消接线——管线传入的树杀句柄直达 claude runner。
              ...(opts!.registerKill !== undefined ? { registerKill: opts!.registerKill } : {}),
              // GOAL-084 §3.2：能力注入透传（工具限制在 runner 侧 fail-closed 兜底）。
              ...(opts!.restrictTools !== undefined ? { restrictTools: opts!.restrictTools } : {}),
              ...(opts!.outputSchemaPath !== undefined ? { outputSchemaPath: opts!.outputSchemaPath } : {}),
              ...(opts!.outputSchemaJson !== undefined ? { outputSchemaJson: opts!.outputSchemaJson } : {}),
              ...(opts!.cwd !== undefined ? { cwd: opts!.cwd } : {}),
            });
            return {
              exitCode: res.exitCode,
              stdout: res.stdout,
              stderr: res.stderr,
              timedOut: res.timedOut,
              childKilled: res.childKilled,
              sessionId: res.sessionId,
              // GOAL-084 §3.2：结构化结果随 runner 上浮（此前在重包装处丢失，
              // 协调器只能拿到 2048 字符的 stdout_tail）。
              ...(res.structuredOutput !== undefined ? { structuredOutput: res.structuredOutput } : {}),
              ...(res.totalCostUsd !== undefined
                ? {
                    receipt: {
                      telemetry: {
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_creation_tokens: 0,
                        cache_read_tokens: 0,
                        total_cost_usd: res.totalCostUsd,
                        cache_savings_usd: 0,
                      },
                    },
                  }
                : {}),
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
            onStderr: opts!.onStderr,
            // GOAL-084 §3.2：默认执行路径取消接线——runT1 本已支持 registerKill
            // （t1-runner spawn 即注册），此前默认分支漏传，生产真实派发不可中断。
            ...(opts!.registerKill !== undefined ? { registerKill: opts!.registerKill } : {}),
            // GOAL-084 §3.2：能力注入透传（工具限制在 runner 侧 fail-closed 兜底）。
            ...(opts!.restrictTools !== undefined ? { restrictTools: opts!.restrictTools } : {}),
            ...(opts!.outputSchemaPath !== undefined ? { outputSchemaPath: opts!.outputSchemaPath } : {}),
            ...(opts!.outputSchemaJson !== undefined ? { outputSchemaJson: opts!.outputSchemaJson } : {}),
            // GOAL-075 切片2：声明 ndjson-events 的通道由 runner 归一化 stdout，
            // 回填 sessionId 与真实 token 计量（台账成本反馈回路）。
            ...(contract.output_format === 'ndjson-events'
              ? {
                  outputFormat: 'ndjson-events' as const,
                  outputNormalizer: (raw: string) => normalizeOpencodeEvents(raw, contract.expected_model_id),
                }
              : {}),
            // GOAL-084（owner 复核缺口 1，2026-10-03）：合同 output_parser 声明的
            // 通道由 runner 在退出后解析完整 stdout 并透传 structuredOutput——
            // 协调器 extractJsonObject 的第一优先来源（裸/包装/NDJSON 三形状）。
            ...(contract.output_parser === 'agy'
              ? { structuredParser: (raw: string) => parseAgyOutput(raw).structured }
              : {}),
            ...(opts!.cwd !== undefined ? { cwd: opts!.cwd } : {}),
          });
          return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
            childKilled: result.childKilled,
            ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}),
            ...(result.structuredOutput !== undefined ? { structuredOutput: result.structuredOutput } : {}),
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
      chat?: DispatchRequestSnapshot['chat'];
      /** GOAL-021 U1：外部预生成 dispatch_id（聊天 202 即返需在受理前拿到 id）。 */
      dispatchId?: string;
      /** GOAL-021 U3：增量 stdout 透传 + 触发 EXECUTE 增量派发帧。 */
      onStdout?: (chunk: string) => void;
      /** GOAL-084 §3.2：受控会话能力注入——internal 专用通道，不来自 HTTP body。
       *  restrictTools = 讨论通道工具限制（合同未声明即派发入口拒绝）；
       *  outputSchema = 原生输出 schema（写文件后经合同旗标下发，未声明则降级）。 */
      restrictTools?: boolean;
      outputSchema?: unknown;
      /** Trusted host only: generate a D30 card before any execution gate or admission. */
      prepareOnly?: boolean;
      probeId?: 'C6' | 'A6' | 'C3' | 'A3' | 'C7' | 'A9' | 'A10' | 'A11' | 'A12' | 'A13' | 'A14' | 'A15' | 'A16' | 'C8' | 'C9' | 'C10' | 'C11';
      /** GOAL-084 §3.3：受控会话派发——单场授权替代 D30 逐单卡（D87）。
       *  session_id 必属已授权会话；seat = 本轮发言席位；kind = normal/retry。 */
      collab?: { session_id: string; seat?: CollabSeat; kind?: 'normal' | 'retry' };
      /** GOAL-084（owner 复核缺口，2026-10-03）：合同漂移核对——rerun 恢复冻结
       *  的批准时指纹；受理时与当前生效合同（变体应用后、档位注入前）不符即
       *  拒绝派发（拒绝沿用旧批准），不来自 HTTP body。 */
      expectContractFingerprint?: string;
    },
  ): Promise<DispatchRecord> {
    if (this.exclusiveProbe !== undefined) {
      if (internal?.probeId !== this.exclusiveProbe.id) throw new InputError('configuration probe is active; other dispatches are blocked');
      if (internal.prepareOnly !== true) {
        if (this.exclusiveProbe.dispatched) throw new InputError('configuration probe permits exactly one dispatch, no automatic retry');
        this.exclusiveProbe.dispatched = true;
      }
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new InputError('body must be a JSON object');
    }
    const body = input as Record<string, unknown>;
    const adapterId = typeof body.adapter_id === 'string' ? body.adapter_id : '';
    const contract = this.contracts[adapterId];
    if (contract === undefined) throw new InputError(`unknown adapter: ${adapterId}`);
    // G009：模型变体选择——必须属于合同声明的 variants（fail-closed）。
    if (internal?.prepareOnly === true && (body.real !== true || internal.originOwner === true || internal.approvedVia !== undefined || internal.collab !== undefined)) {
      throw new InputError('preparation requires a new real request without an execution authorization');
    }
    const scopedContext = internal?.collab !== undefined || internal?.probeId !== undefined;
    if (scopedContext && ['stream_id', 'new_stream', 'resume_session', 'profile'].some(key => body[key] !== undefined)) {
      throw new InputError('collaboration/probe context cannot accept native resume, stream or profile controls');
    }
    let effectiveContract = contract;
    let modelId: string | undefined;
    if (body.model_id !== undefined) {
      modelId = String(body.model_id);
      if (modelId === 'UNKNOWN' || (modelId !== contract.expected_model_id && !contract.variants?.includes(modelId))) {
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
    // Blackboard rounds and fixed probes own their entire prompt. Ordinary work-stream
    // history, AGENTS expansion and native resume must not bypass material visibility.
    const prep: { stream: WorkStream | null; prompt: string; resumeSession?: string } = scopedContext
      ? { stream: null, prompt: rawPrompt }
      : this.resolveStreamForDispatch(
      adapterId,
      goalId,
      newStreamRequested,
      explicitStreamId,
      effectiveContract,
      rawPrompt,
      earlyWorkspace,
    );
    body.prompt = prep.prompt;
    // GOAL-071：观察模式——冻结区零写入参演。提示级写面约束（GP-14 到位前的
    // owner 批准口径）+ 事后审计兜底；快照仍存 owner 原始指令。
    const observationDispatch = this.observationState.path !== null && earlyWorkspace === this.observationState.path;
    if (observationDispatch) body.prompt = OBSERVATION_CHARTER + '\n\n' + body.prompt;
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
    // 批准配置指纹基于变体应用后、档位注入前的合同——档位是质量旋钮不是权限面，
    // 注入 --effort 会改变 JSON 但不改变批准语义（§3.3 指纹语义）。
    const preEffortFingerprint = contractPermissionFingerprint(effectiveContract);
    // GOAL-084（owner 复核缺口，2026-10-03）：合同漂移核对——待审批期间更换
    // 合同（换模型/换权限参数）后，旧批准不得沿用：指纹不符即拒绝派发，
    // 原记录保持 BLOCKED，需重新审批。在快照/审批卡写盘之前拦截。
    if (internal?.expectContractFingerprint !== undefined && internal.expectContractFingerprint !== preEffortFingerprint) {
      throw new InputError(
        `contract has drifted since approval (expected ${internal.expectContractFingerprint.slice(0, 12)}…, current ${preEffortFingerprint.slice(0, 12)}…) — approval is void, re-approve the dispatch`,
      );
    }
    // D82 批次：档位真正进入 spawn 命令行（此前校验后被丢弃）。
    effectiveContract = applyEffortInjection(effectiveContract, effort);
    // D82 批次：派发可指定头犬——仅接受实证在册且头犬白名单内的通道。
    // D82 修订：头犬资格与 GOAL-017A U2（verifiedAdapters）同一判据——
    // 模板/注册表/实测 ONLINE 三路任一 verified 即可。旧实现只认静态白名单
    // + 注册表两路，实测验证过的通道（opencode 等）反被拒之门外。
    const headId = typeof body.head_id === 'string' && body.head_id.trim() !== '' ? body.head_id.trim() : undefined;
    if (headId !== undefined) {
      const headCapable = new Set<string>(
        Object.keys(this.contracts).filter((id) => this.isAdapterVerified(id)),
      );
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
    // RF-C 诊断犬 120s 被掐）。默认 real=900 / dry=120，范围 5..3600。
    // D82 修订：dry 缺省 5→120——dry_run 对 argument 运输通道仍是真实模型
    // 往返（opencode free 实测 ~30s），旧 5s 使每次干跑必然 TIMEOUT。
    const timeoutSec = body.timeout_s === undefined ? (body.real === true ? 900 : 120) : Number(body.timeout_s);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 5 || timeoutSec > 3600) {
      throw new InputError('timeout_s must be 5..3600 seconds');
    }
    let effectiveTimeoutSec = timeoutSec;
    const real = body.real === true;
    const workspace = typeof body.workspace === 'string' && body.workspace.trim() !== '' ? path.resolve(body.workspace) : this.defaultWorkspace();
    if (!existsSync(workspace)) throw new InputError(`workspace does not exist: ${workspace}`);
    // F-41（安全审查 2026-08-17）：workspace 白名单——dispatch 只允许落在
    // 服务根目录或已登记（known-workspaces/当前选中）的工作区，防止任意
    // 本地目录被选为犬的执行范围（纵深防御，配合 DEF-04 Host 校验）。
    // GOAL-071：观察态派发豁免工作区登记（冻结区不注册、不落元数据）。
    const observationRun = observationDispatch || (this.observationState.path !== null && workspace === this.observationState.path);
    if (!observationRun && workspace !== this.workspaceRoot && !this.isKnownWorkspace(workspace)) {
      throw new InputError(`workspace not registered: ${workspace}（先经 POST /api/workspaces/select 登记）`);
    }

    // GOAL-084 §3.3：受控会话派发前置校验——先于预算门与占额，越界零副作用
    // （不 spawn 子进程、不占会话额度、不留台账/审批条目）：席位必填且绑定
    // 批准的通道/提供方/模型；单次超时不得超出冻结授权；隔离会话的执行配置
    // 从冻结授权派生（restrictTools 强制开启——调用方不能靠遗漏字段降低限制）。
    let restrictToolsEffective = internal?.restrictTools === true;
    let collabTimeoutCapMs: number | undefined;
    if (internal?.collab !== undefined) {
      if (this.collabBlackboard === undefined) {
        throw new InputError('collab session dispatch requires a collaboration blackboard (fail-closed)');
      }
      if (internal.collab.seat === undefined) {
        throw new InputError('collab dispatch requires an explicit seat (no default participant)');
      }
      const collab = internal.collab;
      const session = this.collabBlackboard.getSession(collab.session_id);
      if (path.resolve(session.workspace_root) !== path.resolve(workspace)) {
        throw new InputError('collab session is bound to its creation workspace; refusing dispatch from another workspace');
      }
      const snapshot = this.collabBlackboard.getAuthorizationSnapshot(collab.session_id);
      const participant = snapshot.participants.find((p) => p.seat === collab.seat);
      if (participant === undefined) {
        throw new InputError(`seat ${collab.seat} is not a participant of session ${collab.session_id}`);
      }
      if (participant.effort !== undefined && (body.effort === undefined || effort !== participant.effort)) {
        throw new InputError(`effort ${effort} does not match the approved effort ${participant.effort} for seat ${internal.collab.seat}`);
      }
      if (participant.adapter_id !== adapterId) {
        throw new InputError(
          `adapter '${adapterId}' is not authorized for seat ${internal.collab.seat} (approved: ${participant.adapter_id})`,
        );
      }
      if (participant.provider_id !== undefined && effectiveContract.expected_provider !== participant.provider_id) {
        throw new InputError(
          `provider '${effectiveContract.expected_provider}' is not the approved provider for seat ${internal.collab.seat} (approved: ${participant.provider_id})`,
        );
      }
      const effectiveModelId = modelId ?? effectiveContract.expected_model_id;
      if (participant.model_id !== undefined) {
        if (effectiveModelId !== participant.model_id) {
          throw new InputError(
            `model '${effectiveModelId}' is not the approved model for seat ${internal.collab.seat} (approved: ${participant.model_id})`,
          );
        }
      } else if (modelId !== undefined) {
        throw new InputError('model selection was not approved for this seat');
      }
      // 批准配置指纹 vs 当前执行配置：整份有效合同的 sha256 必须与该席位批准
      // 指纹一致——同适配器/模型换限制配置（read-only→danger-full-access）即拒。
      // 隔离会话的席位必须声明指纹（authorize 已强制），此处逐派发再比对。
      if (participant.config_fingerprint !== undefined) {
        const currentFingerprint = preEffortFingerprint;
        if (currentFingerprint !== participant.config_fingerprint) {
          throw new InputError(
            `current execution config fingerprint ${currentFingerprint.slice(0, 12)}… does not match the approved config for seat ${collab.seat}（批准配置已变更须重新授权）`,
          );
        }
      } else if (snapshot.isolation_required === true) {
        throw new InputError('isolation session seats must declare an approved config fingerprint');
      }
      const singleCallCap = snapshot.single_call_timeout_s;
      if (body.timeout_s === undefined) {
        effectiveTimeoutSec = Math.min(timeoutSec, singleCallCap);
      } else if (timeoutSec > singleCallCap) {
        throw new InputError(`timeout_s ${timeoutSec}s exceeds the session single-call limit ${singleCallCap}s`);
      }
      if (snapshot.isolation_required === true) {
        restrictToolsEffective = true;
      }
    }
    // GOAL-084 §3.2/§3.3：限制声明 fail-closed——限制生效前合同必须声明执行配置。
    if (restrictToolsEffective && (effectiveContract.tool_restriction_args === undefined || effectiveContract.tool_restriction_args.length === 0)) {
      throw new InputError(
        `adapter '${adapterId}' does not declare tool_restriction_args; discussion execution config cannot be enforced`,
      );
    }

    let executionWorkspace = workspace;
    let versionDrift: DispatchRecord['version_drift_accepted'];
    if (restrictToolsEffective && effectiveContract.agy_discussion_profile !== undefined) {
      if (body.cwd !== undefined || body.carveout_id !== undefined) throw new InputError('agy discussion rejects alternate cwd controls');
      verifyAgyDiscussionBinding(effectiveContract, modelId ?? effectiveContract.expected_model_id);
      if (internal?.prepareOnly !== true) {
        const version = await this.agyDiscussionInspector(effectiveContract, this.dataRoot);
        const verified = verifyAgyDiscussionBinding(effectiveContract, modelId ?? effectiveContract.expected_model_id, version,
          readAgyVersionDriftAcceptanceDir(path.dirname(effectiveContract.agy_discussion_profile.workspace_root)));
        versionDrift = verified.drift_accepted;
      }
      executionWorkspace = effectiveContract.agy_discussion_profile.workspace_root;
    }
    if (restrictToolsEffective && effectiveContract.codex_discussion_profile !== undefined) {
      if (body.cwd !== undefined || body.carveout_id !== undefined) throw new InputError('closed profile rejects alternate cwd controls');
      verifyCodexDiscussionBinding(effectiveContract, modelId ?? effectiveContract.expected_model_id);
      if (internal?.prepareOnly !== true) {
        const observed = await this.codexDiscussionInspector(effectiveContract, workspace, this.dataRoot);
        verifyCodexDiscussionBinding(effectiveContract, modelId ?? effectiveContract.expected_model_id, observed);
      }
    }
    // GOAL-085：Claude Code 讨论通道——实际 cwd 从绑定派生（独立讨论工作目录），
    // 派发前复核模型/参数形态/资产哈希；非仅准备时另做原生版本探测。
    // GOAL-085 D95（owner 2026-10-05 裁定显式接受版本漂移）：仅当 owner 登记文件逐个列出该
    // 观察版本时放行，并把依据写进派发记录（不改指纹、不改证据归属）。
    if (restrictToolsEffective && effectiveContract.claude_discussion_profile !== undefined) {
      if (body.cwd !== undefined || body.carveout_id !== undefined) throw new InputError('Claude discussion rejects alternate cwd controls');
      const claudeModel = modelId ?? effectiveContract.expected_model_id;
      verifyClaudeDiscussionBinding(effectiveContract, claudeModel);
      if (internal?.prepareOnly !== true) {
        const version = await this.claudeDiscussionInspector(effectiveContract, this.dataRoot);
        // D95 登记目录由合同自身的 workspace_root 父目录确定性推出（= profile.json 所在目录），
        // 不依赖 dataRoot/runtime 的布局假设。
        const verified = verifyClaudeDiscussionBinding(
          effectiveContract, claudeModel, version,
          readClaudeVersionDriftAcceptanceDir(path.dirname(effectiveContract.claude_discussion_profile.workspace_root)),
        );
        versionDrift = verified.drift_accepted;
        if (versionDrift !== undefined) {
          console.warn(`[dispatch] Claude native version drift accepted by ${versionDrift.decision}: frozen=${versionDrift.frozen_native_version} observed=${versionDrift.observed_native_version}`);
        }
      }
      executionWorkspace = effectiveContract.claude_discussion_profile.workspace_root;
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
      // D82 修订：快照存 owner 原始指令，不存组装后 prompt——组装（章程缝合/
      // AGENTS 简报/流历史）是执行时行为，随流状态变化；存组装版会让 rerun/
      // 预填层层套娃（RM-011 演练实证）。最终发犬文本仍走 body.prompt 组装版。
      prompt: rawPrompt,
      effort,
      workspace,
      timeout_s: effectiveTimeoutSec,
      cap_usd: capUsd,
      real,
      // GOAL-084（owner 复核缺口，2026-10-03）：执行配置随快照冻结——D30 批准
      // 重跑须恢复 restrictTools/outputSchema，否则审批所见（受限 argv）与重跑
      // 所跑（无限制 argv）不一致。outputSchema 做 JSON 深拷贝：快照必须独立
      // 于调用方持有的引用（owner 复核四轮——共享引用时，待审批期间修改原
      // schema 对象会同时改掉快照，重跑采用修改后内容）。
      ...(internal?.restrictTools !== undefined ? { restrictTools: internal.restrictTools } : {}),
      ...(internal?.outputSchema !== undefined
        ? { outputSchema: JSON.parse(JSON.stringify(internal.outputSchema)) as unknown }
        : {}),
      // GOAL-084（owner 复核缺口，2026-10-03）：冻结批准时生效合同指纹——
      // 重跑核对漂移（换模型/换权限参数后旧批准失效）。
      contract_fingerprint: preEffortFingerprint,
      ...(executionWorkspace !== workspace ? { execution_cwd: executionWorkspace } : {}),
      ...(internal?.prepareOnly === true ? { prepared_only: true } : {}),
      ...(internal?.probeId !== undefined ? { probe_id: internal.probeId } : {}),
      ...(internal?.chat !== undefined ? { chat: internal.chat } : {}),
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
      ...(versionDrift !== undefined ? { version_drift_accepted: versionDrift } : {}),
      request,
    };

    // Preparation is a separate zero-execution path. Approved replay still runs
    // all normal gates, including the persisted global breaker.
    if (internal?.prepareOnly === true) {
      record.status = 'BLOCKED_WAITING_OWNER';
      record.error = 'prepared request awaits owner approval; execution checks and budget admission have not run';
      this.records.set(dispatchId, record);
      this.persistence?.saveDispatchHeader(record);
      this.createDispatchApprovalRequest(record, capUsd);
      this.emit(record, 'EXECUTE', 'BLOCKED_WAITING_OWNER', { approval_request: `dispatch-${dispatchId}.json`, prepared_only: true });
      this.emit(record, 'REVIEW', 'BLOCKED_WAITING_OWNER', { reason: record.error });
      return record;
    }

    // GOAL-080：派发预检门——L0/L1 零成本探针（缓存 TTL 内不重复探），不过即拒。
    // 零台账副作用：不进 admission、不写 ledger；错误带修复指引（人话）。
    if (this.livenessGate !== undefined) {
      const lv = await this.livenessGate.check(adapterId);
      if (!lv.ok) {
        record.status = 'REJECTED';
        record.error = `preflight gate：${lv.detail}`;
        this.emit(record, 'ADMISSION', 'FAIL', { preflight: true, liveness_label: lv.label });
        this.emit(record, 'REVIEW', 'REJECTED', { reason: record.error });
        this.records.set(dispatchId, record);
        this.persistence?.saveDispatchHeader(record);
        return record;
      }
    }

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

    // GOAL-073：无人值守分级仲裁——熔断停机即拒；L1/L2 低额自动批走自铸
    // 一次性令牌（复用下方原子消费路径），台账留痕 auto_approved。
    let autoApproved = false;
    let autoApproveReason = '';
    if (this.unattended !== undefined && real === true && internal?.originOwner !== true) {
      if (this.unattended.breaker.halted) {
        record.status = 'REJECTED';
        record.error = `circuit breaker halted: ${this.unattended.breaker.snapshot().halt_reason ?? 'unknown'}`;
        this.emit(record, 'ADMISSION', 'FAIL', { circuit_breaker: true });
        this.emit(record, 'REVIEW', 'REJECTED', { reason: record.error });
        this.records.set(dispatchId, record);
        this.persistence?.saveDispatchHeader(record);
        return record;
      }
      const arb = arbitrateUnattended({
        level: this.unattended.policy.level,
        cap_usd: capUsd,
        auto_approve_cap_usd: this.unattended.policy.auto_approve_cap_usd,
        daily_auto_budget_usd: this.unattended.policy.daily_auto_budget_usd,
        task_whitelist_prefixes: this.unattended.policy.task_whitelist_prefixes,
        goal_id: goalId,
        daily_auto_spent_usd: this.autoSpentToday(),
      });
      if (arb.decision === 'auto-approve') {
        mkdirSync(this.approvalTokensPath, { recursive: true });
        writeFileSync(
          path.join(this.approvalTokensPath, `dispatch-${dispatchId}.token.json`),
          JSON.stringify({ auto_approved: true, reason: arb.reason, at_utc: new Date().toISOString() }),
          'utf8',
        );
        autoApproved = true;
        autoApproveReason = arb.reason;
        this.bumpAutoSpend(capUsd);
        this.unattended.breaker.recordAutoSpend(capUsd);
      }
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
        ...(autoApproved ? { auto_approved: true, auto_approve_reason: autoApproveReason } : {}),
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

    // GOAL-084 §3.3：受控会话派发以单场会话授权替代 D30 逐单卡（D87）；
    // collab 缺席时 D30 旧门原样生效（旧派发不受影响）。
    if (real && internal?.originOwner !== true && internal?.collab === undefined) {
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

    // GOAL-084 §3.3：受控会话派发——预算门/预检门已通过，此处原子占用会话额度
    // （占额失败=InputError，不产生回执）；会话绑定创建时工作区，拒绝跨工作区执行；
    // 执行记录在 run 结算后如实回写（pass/fail/timeout/interrupted）。
    let collabLogSeq: number | bigint | undefined;
    if (internal?.collab !== undefined) {
      // 前置校验（席位/通道/模型/工作区/超时/隔离配置/指纹）已在预算门前完成（§3.3）；
      // 此处仅在派发真正执行前原子占用会话额度，并把 runner 超时钳到剩余会话时间。
      try {
        const occupied = this.collabBlackboard!
          .occupyCall(internal.collab.session_id, internal.collab.kind ?? 'normal', internal.collab.seat);
        collabLogSeq = occupied.log_seq;
        collabTimeoutCapMs = occupied.remaining_ms;
      } catch (error) {
        throw new InputError(`collab session quota: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // GOAL-071：观察态回执重定向——冻结区内不落任何文件（含回执），
    // 回执归档到宿主 runtime 的 observation 子目录，审计链不断。
    const receiptDir = observationRun
      ? path.join(this.workspaceRoot, '.mush-receipts', 'observation')
      : path.join(internal?.collab !== undefined ? this.dataRoot : workspace, '.mush-receipts');
    mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, `dispatch-${dispatchId}.json`);
    // GOAL-084 §3.2：受控会话输出 schema（internal 专用，不来自 HTTP body）。
    // file 运输：固化到回执旁文件后下发路径（codex --output-schema <FILE>）；
    // inline 运输：直接下发 JSON 文本（claude --json-schema <schema>）。
    // 通道未声明 output_schema_flag 时静默降级——mush 侧每轮仍自行校验观点的
    // 引用、阶段与语义，降级不降责。
    let outputSchemaPath: string | undefined;
    let outputSchemaJson: string | undefined;
    if (internal?.outputSchema !== undefined) {
      if (effectiveContract.output_schema_inline === true) {
        outputSchemaJson = JSON.stringify(internal.outputSchema);
      } else {
        outputSchemaPath = path.join(receiptDir, `dispatch-${dispatchId}.output-schema.json`);
        writeFileSync(outputSchemaPath, JSON.stringify(internal.outputSchema) + '\n', 'utf8');
      }
    }
    this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', {
      workspace,
      ...(observationRun ? { observation: true } : {}),
    });
    // 观察态零写入审计基线：运行前内存快照（深度3/上限5000项），不写被测区。
    let observationBaseline: string[] | null = null;
    if (observationRun) observationBaseline = walkListingDepthLimited(workspace);
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
    // D82 批次：看板实时输出——streamLiveOutput 开启时 stdout/stderr 双通道
    // 增量广播。stderr 是 opencode 等 CLI 的工具活动通道（$ ls、build 进度），
    // 看板直连抽屉靠它呈现"干活过程"。progress 标记通道来源。
    const stderrThrottle = this.streamLiveOutput
      ? createThrottledStream({
          emit: (text) => {
            this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', {
              workspace,
              progress: 'stderr',
              stream_text: text,
            });
          },
          now: () => this.now().getTime(),
        })
      : null;
    const liveStdoutThrottle =
      this.streamLiveOutput && streamThrottle === null
        ? createThrottledStream({
            emit: (text) => {
              this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', {
                workspace,
                progress: 'stream',
                stream_text: text,
              });
            },
            now: () => this.now().getTime(),
          })
        : null;
    const stdoutSink =
      streamThrottle !== null
        ? (chunk: string) => streamThrottle.push(chunk)
        : liveStdoutThrottle !== null
          ? (chunk: string) => liveStdoutThrottle.push(chunk)
          : undefined;
    const execStartedAt = Date.now(); // GOAL-073：熔断器单任务超时计量起点
    // GOAL-080：故障转移尝试链——real 且接入探针门且无验证犬绑定才换道；
    // GOAL-084 §3.3：受控会话派发关闭隐式故障转移（§2.3），链长恒 1。
    // 候选=verified 异构犬且探针通过（预检同样覆盖换道目标），按置信降序，
    // 上限 2 次尝试（换道一跳，成本有界）。
    const attemptChain: string[] = [adapterId];
    if (real && internal?.collab === undefined && internal?.probeId === undefined && verifierDog === undefined && this.livenessGate !== undefined) {
      const snapshot = this.livenessGate.snapshot();
      const candidates = Object.keys(this.contracts)
        .filter((id) => id !== adapterId && this.isAdapterVerified(id))
        .sort((a, b) => {
          const la = snapshot.find((s) => s.adapter_id === a)?.level_reached ?? 0;
          const lb = snapshot.find((s) => s.adapter_id === b)?.level_reached ?? 0;
          return lb - la || a.localeCompare(b);
        });
      for (const candidate of candidates) {
        const lv = await this.livenessGate.check(candidate);
        if (lv.ok) {
          attemptChain.push(candidate);
          break; // 一跳
        }
      }
    }
    let run: Awaited<ReturnType<RunAdapterFn>> | undefined;
    let attemptAdapterId = adapterId;
    let attemptContract = effectiveContract;
    let failoverFrom: string | undefined;
    let breakerFeedbackForFinal = false; // 循环内已为"最终尝试"记过熔断反馈的标记（防双计）
    // GOAL-085：运行时观测到的模型身份（最后一次尝试的 system init 上报），入回执供审计。
    let observedModelId: string | undefined;
    let expectedIdentityModel: string | undefined;
    let identityMismatch = false;
    let identityReason: string | undefined;
    for (let attempt = 0; attempt < attemptChain.length; attempt++) {
      attemptAdapterId = attemptChain[attempt];
      attemptContract = attempt === 0 ? effectiveContract : this.contractForFailover(attemptAdapterId, effort);
      if (attempt > 0) {
        failoverFrom = failoverFrom ?? adapterId;
        this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', {
          progress: 'failover_retry',
          failover_to: attemptAdapterId,
          failover_from: adapterId,
        });
      }
      run = await this.runAdapter(attemptContract, prompt, {
        workspaceRoot: executionWorkspace,
        receiptPath,
        timeoutMs: collabTimeoutCapMs !== undefined
          ? Math.min(effectiveTimeoutSec * 1000, collabTimeoutCapMs)
          : effectiveTimeoutSec * 1000,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(stdoutSink !== undefined ? { onStdout: stdoutSink } : {}),
        ...(stderrThrottle !== null ? { onStderr: (chunk: string) => stderrThrottle.push(chunk) } : {}),
        registerKill: (kill: () => void) => {
          this.runningKills.set(dispatchId, kill);
        },
        // GOAL-084 §3.2/§3.3：受控会话能力注入——隔离会话的 restrictTools 从冻结授权派生。
        ...(restrictToolsEffective ? { restrictTools: true } : {}),
        ...(outputSchemaPath !== undefined ? { outputSchemaPath } : {}),
        ...(outputSchemaJson !== undefined ? { outputSchemaJson } : {}),
      });
      const attemptPass = run.exitCode === 0 && !run.timedOut;
      // GOAL-085（2026-10-05 独立审核要求）：**运行时模型身份逐轮比对**。
      // 此处只做解析与标记；状态改写必须放在下方终态结算之后（否则会被 pass 归一化抹掉）。
      // 只对声明了结构化身份来源的讨论档案生效（claude stream-json 的 system init）。
      // 并且**只在执行本身成功时**才做身份判定：超时/非零退出时原生流可能根本没有 init，
      // 此时真正的原因就是超时/退出码，不能被"身份缺失"掩盖（实测：超时被错报成身份失败）。
      if (attemptPass && attemptContract.claude_discussion_profile !== undefined) {
        const parsed = parseClaudeStreamJson(run.stdout ?? '');
        const expectedModel = attemptContract.expected_model_id;
        expectedIdentityModel = expectedModel;
        const proven = parsed.identity.proven && parsed.identity.modelId !== 'UNKNOWN';
        if (proven) observedModelId = parsed.identity.modelId;
        const expectedKnown = expectedModel !== undefined && expectedModel !== 'UNKNOWN';
        // GOAL-085 第二轮边界修复（独立复核发现）：受控讨论席位**身份必须存在且匹配**——
        // 缺失/不可解析（UNKNOWN）与不匹配一律拒绝，不再"只在解析到已知身份时比较"。
        if (!proven) {
          identityMismatch = true;
          identityReason = 'runtime model identity missing or unparseable';
        } else if (!expectedKnown || observedModelId !== expectedModel) {
          identityMismatch = true;
          identityReason = `runtime model identity mismatch: observed ${observedModelId}, approved ${expectedModel ?? 'UNKNOWN'}`;
        }
      }
      const isLastAttempt = attempt + 1 >= attemptChain.length;
      if (attemptPass || isLastAttempt || !real || this.cancelRequested.has(dispatchId)) break;
      // 失败尝试即时反馈熔断器（真实单才计）；保险丝优先——停机即停链，不许换道。
      if (this.unattended !== undefined) {
        const durationMs = Date.now() - execStartedAt;
        if (run.timedOut) this.unattended.breaker.recordTimeout(durationMs, dispatchId);
        else this.unattended.breaker.recordFailure({ dispatch_id: dispatchId });
        if (this.unattended.breaker.halted) {
          breakerFeedbackForFinal = true;
          break;
        }
      }
      // 失败尝试旁路回执（不复写正式回执路径，审计链留全程）
      const attemptReceipt = {
        schema_version: 1,
        dispatch_id: dispatchId,
        adapter_id: attemptAdapterId,
        attempt: attempt + 1,
        exit_code: run.exitCode,
        timed_out: run.timedOut,
        stdout_sha256: sha256Hex(run.stdout),
        stderr_sha256: sha256Hex(run.stderr),
        finished_at_utc: this.now().toISOString(),
      };
      try {
        writeFileSync(receiptPath.replace(/\.json$/, `.attempt${attempt + 1}.json`), JSON.stringify(attemptReceipt) + '\n', 'utf8');
      } catch {}
    }
    if (run === undefined) throw new Error('unreachable: attempt chain is never empty');
    if (failoverFrom !== undefined) {
      record.failover_from = failoverFrom;
      record.adapter_id = attemptAdapterId; // 归因真实化：受阻/回执/台账都认实际执飞犬
    }
    // GOAL-085（第二轮边界修复，独立复核发现）：身份判定必须**早于回执落盘**，
    // 否则会出现"记录已 FAIL/已删结构化输出，回执却仍带那份合法输出"的不一致。
    // 真正的状态覆盖放在下方终态结算之后（否则会被 pass 归一化抹掉）；此处先算好标志与原因。
    void identityMismatch;
    void identityReason;
    streamThrottle?.flush();
    liveStdoutThrottle?.flush();
    stderrThrottle?.flush();
    record.receipt_path = receiptPath;
    record.stdout_tail = tailOf(run.stdout, 2048);
    record.stderr_tail = tailOf(run.stderr, 256);
    record.session_id = run.sessionId ?? extractSessionId(run.stdout);
    // GOAL-084 §3.2：结构化观点完整对象随 record 与回执 JSON 持久化——
    // 不依赖 2048 字符 tail，协调器可直接读取。身份不符时上面已删除该字段。
    if (run.structuredOutput !== undefined && !identityMismatch) record.structured_output = run.structuredOutput;
    // GOAL-085：运行时观测到的模型身份入回执（审计用；身份不符已在上面判 FAIL）。
    if (observedModelId !== undefined) record.observed_model_id = observedModelId;
    const telemetry = run.receipt?.telemetry;
    const receipt = {
      schema_version: 1,
      dispatch_id: dispatchId,
      adapter_id: attemptAdapterId,
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
      // GOAL-085（2026-10-05 独立审核要求）：原始流是**唯一可核验的行为证据**
      // （system/init 的模型身份、tool_use/tool_result、permission_denied、task_*）。
      // 只留哈希会把事实丢掉、只剩自报；这里在 64 KiB 以内直接保留原文，便于事后独立核对。
      raw_stream_bytes: (run.stdout ?? '').length,
      ...((run.stdout ?? '').length <= 65536 ? { raw_stream: run.stdout } : {}),
      ...(observedModelId !== undefined ? { observed_model_id: observedModelId } : {}),
      // D95 收口（2026-10-05 交接 §4.1）：回执与派发记录同源携带放行依据。
      ...(record.version_drift_accepted !== undefined ? { version_drift_accepted: record.version_drift_accepted } : {}),
      // 身份不符时**不得**在回执里保留那份结构化输出（原始流仍留作审计证据）。
      ...(run.structuredOutput !== undefined && !identityMismatch ? { structured_output: run.structuredOutput } : {}),
      ...(identityMismatch ? { identity_failed: true, identity_reason: record.error } : {}),
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
    // GOAL-085（第二轮边界修复，独立复核发现）：身份判定在此处**统一结算**——
    // 必须晚于上面的 pass 归一化（否则被抹掉），同时**回执已在上面按同一判定落盘**
    // （身份不符时不含 structured_output），因此记录与回执一致。
    // 规则：受控讨论席位的身份**缺失/不可解析/不匹配一律拒绝**。
    if (identityMismatch) {
      record.status = 'FAIL';
      record.error = identityReason ?? 'runtime model identity check failed';
      delete record.structured_output;
      if (observedModelId === undefined) delete record.observed_model_id;
    }
    this.runningKills.delete(dispatchId);
    // D84：owner 请求过的中断——终态如实改记 INTERRUPTED（不判 FAIL、不计熔断、不进 Verifier）。
    const interruptedByOwner = this.cancelRequested.delete(dispatchId);
    if (interruptedByOwner) {
      record.status = 'INTERRUPTED';
      record.error = '已由 owner 停止（中断按钮）';
    }
    // GOAL-084 §3.3：会话执行记录如实结算（仅一次；settlement 失败不改写已终态
    // 的派发，日志行保持 started 以暴露异常）。
    if (collabLogSeq !== undefined && this.collabBlackboard !== undefined) {
      try {
        this.collabBlackboard.recordExecutionResult(
          collabLogSeq,
          record.status === 'PASS' || record.status === 'DRY_RUN' ? 'pass'
            : record.status === 'TIMEOUT' ? 'timeout'
              : record.status === 'INTERRUPTED' ? 'interrupted'
                : 'fail',
          record.error ?? undefined,
        );
      } catch {
        // 结算冲突不吞证据：execution_log 行保持 started，供对账发现。
      }
    }

    // GOAL-028: LLM-as-a-Verifier 独立审判验证
    // GOAL-084 §3.3：受控会话派发不进 Verifier——讨论流程自身即验证，不增设隐形模型（§2.3）。
    if (verifierDog !== undefined && !interruptedByOwner && internal?.collab === undefined) {
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
        attemptAdapterId,
        effectiveModel,
        pass,
        pass ? undefined : record.error || undefined,
        this.now,
      );
      if (pass) {
        this.authoritativeModels.set(attemptAdapterId, effectiveModel);
        const probeEntry = this.liveProbes[attemptAdapterId];
        if (probeEntry !== undefined) {
          probeEntry.actual_model_id = effectiveModel;
          probeEntry.model_tiers = probeEntry.model_tiers || {};
          probeEntry.model_tiers[effectiveModel] = 'T1_VERIFIED';
        }
      }
    }

    this.emit(record, 'REPORT', record.status, { receipt_path: receiptPath, exit_code: run.exitCode });
    // REPORT 时点 record 已带 stdout_tail/session_id/structured_output——回写持久化
    // header，使派发输出可事后核验（事件行仍 append-only，见 persistence）。
    this.persistence?.saveDispatchHeader(record);
    this.emit(record, 'REVIEW', record.status, { verdict: pass ? 'PASS' : 'FAIL' });
    // GOAL-073：熔断器反馈回路——真实单才计入（干跑/诊断噪声不触发熔断）；
    // GOAL-080：换道循环内已记过最终尝试的反馈时不再双计。
    if (this.unattended !== undefined && real === true && !breakerFeedbackForFinal && !interruptedByOwner) {
      const durationMs = Date.now() - execStartedAt;
      if (pass) this.unattended.breaker.recordSuccess();
      else if (run.timedOut) this.unattended.breaker.recordTimeout(durationMs, dispatchId);
      else this.unattended.breaker.recordFailure({ dispatch_id: dispatchId });
    }
    // GOAL-071：观察态零写入事后审计——对比运行前后内存清单，任何新增即违规留痕。
    if (observationRun && observationBaseline !== null) {
      const created = walkListingDepthLimited(workspace).filter((x) => !observationBaseline!.includes(x));
      if (created.length > 0) {
        this.emit(record, 'REVIEW', record.status, {
          observation_violation: true,
          created_paths: created.slice(0, 50),
        });
        record.error = [record.error, `观察模式违规写入 ${created.length} 项（见事件链）`].filter(Boolean).join('；');
      } else {
        this.emit(record, 'REVIEW', record.status, { observation_zero_write: true });
      }
    }
    if (resolvedStream !== null) {
      this.recordStreamDispatch(resolvedStream, dispatchId, adapterId, record.session_id, prompt, run);
    }
    // GOAL-024: 自动将关联任务推进到完成池 (DONE) 或受阻池 (BLOCKED)；
    // GOAL-082：完成核验门——PASS≠DONE，配置了 completionGate 时先核验，
    // 拒绝则任务不落 DONE（保持 IN_FLIGHT 留在监理视野）。
    if (typeof record.task_id === 'string' && record.task_id !== '') {
      let target: TaskStatus | null = pass ? 'DONE' : 'BLOCKED';
      if (target === 'DONE' && this.completionGate !== undefined) {
        const verdict = await this.completionGate(record.task_id, `派发 ${dispatchId} PASS`);
        if (!verdict.done) {
          this.emit(record, 'REVIEW', record.status, {
            completion_rejected: true,
            reason: verdict.reason ?? 'verification failed',
          });
          target = null; // 拦下：不自动 DONE（也不改 BLOCKED——交给监理阶梯）
        }
      }
      if (target !== null) this.autoAdvanceTask(record.task_id, target);
    }
    return record;
  }

  /** GP-10：派发重跑——克隆历史请求快照，生成新 dispatch；amount_usd 不克隆。 */
  async rerun(dispatchId: string, overrides: Record<string, unknown> = {}, internal?: Parameters<DispatchPipeline['dispatch']>[1]): Promise<DispatchRecord> {
    const original = this.get(dispatchId);
    if (original === null) throw new InputError(`dispatch not found: ${dispatchId}`);
    if (original.request === undefined) {
      throw new InputError(`dispatch ${dispatchId} has no replayable request snapshot (created before v1.4)`);
    }
    const request = original.request;
    const real = overrides.real === undefined ? request.real : overrides.real === true;
    if (request.prepared_only === true && !real) {
      throw new InputError('prepared real-model requests cannot bypass approval through dry-run replay');
    }
    const capUsd = overrides.cap_usd === undefined ? request.cap_usd : Number(overrides.cap_usd);
    // D82 修订：干跑重跑的超时缺陷指纹修复——旧缺省 5s 时代落盘的快照
    // （表单无超时字段，用户从未自选过 5s；如 RM-011 演练 04b21c32）原样重放
    // 必然复现 TIMEOUT。仅当克隆值恰为旧缺省 5 且本次仍是干跑时抬升到新缺省
    // 120s；显式自选的超时（如 30s）忠实保留；real 重跑完全不动；
    // overrides.timeout_s 显式指定时永远优先。
    const timeoutSec =
      overrides.timeout_s !== undefined
        ? Number(overrides.timeout_s)
        : real || request.timeout_s !== 5
          ? request.timeout_s
          : 120;
    // GP-32（D30）：审批通过的重跑携带 approved_via——新派发消费原单令牌，
    // 原被拦记录折算 SUPERSEDED（终态），审计链：审批应答→令牌→新派发回执。
    const approvedVia =
      typeof overrides.approved_via === 'string' && overrides.approved_via.trim() !== ''
        ? overrides.approved_via.trim()
        : undefined;
    const replacement = await this.dispatch(
      {
        adapter_id: request.adapter_id,
        prompt: request.prompt,
        effort: request.effort,
        workspace: request.workspace,
        timeout_s: timeoutSec,
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
      { ...internal, approvedVia, chat: request.chat,
        ...(request.probe_id !== undefined ? { probeId: request.probe_id } : {}),
        // GOAL-084（owner 复核缺口，2026-10-03）：重跑恢复冻结的执行配置——
        // 冻结值优先于调用方传入（审批所见 = 重跑所跑；重跑不得降限也不得
        // 加限），未冻结的旧记录回退调用方值（向后兼容）。
        ...(request.restrictTools !== undefined ? { restrictTools: request.restrictTools } : {}),
        ...(request.outputSchema !== undefined ? { outputSchema: request.outputSchema } : {}),
        // 合同漂移核对：当前生效合同与批准时不符即拒绝（含换模型/换权限参数）。
        ...(request.contract_fingerprint !== undefined
          ? { expectContractFingerprint: request.contract_fingerprint }
          : {}),
      },
    );
    if (approvedVia === dispatchId && original.status === 'BLOCKED_WAITING_OWNER') {
      original.status = 'SUPERSEDED';
      original.error = 'superseded by owner-approved rerun (D30)';
      this.emit(original, 'REVIEW', 'SUPERSEDED', { reason: 'approved rerun executed' });
    }
    return replacement;
  }

  get(dispatchId: string): DispatchRecord | null {
    return this.records.get(dispatchId) ?? null;
  }

  /** D84（2026-09-06）：owner 停止运行中的派发——杀子进程树，run 结算后终态
   *  如实记 INTERRUPTED（不判 FAIL、不触发故障转移、不计熔断失败），可点重试。
   *  无在途子进程（未 spawn/已结算/通道不支持）时抛 InputError（HTTP 409）。 */
  cancel(dispatchId: string): DispatchRecord {
    const record = this.records.get(dispatchId);
    if (record === undefined) throw new InputError(`dispatch not found: ${dispatchId}`);
    const terminal: DispatchStatus[] = ['PASS', 'FAIL', 'DRY_RUN', 'TIMEOUT', 'BLOCKED_WAITING_OWNER', 'BLOCKED_ENV', 'INTERRUPTED', 'REJECTED', 'SUPERSEDED'];
    if (terminal.includes(record.status)) throw new InputError(`dispatch ${dispatchId} already finished (${record.status})`);
    const kill = this.runningKills.get(dispatchId);
    if (kill === undefined) throw new InputError(`dispatch ${dispatchId} has no killable child process right now`);
    this.cancelRequested.add(dispatchId);
    kill();
    return record;
  }

  /** GP-32（D30）：被拦的真实派发自动生成审批请求文件（看板审批视图数据源），
   * 报备信息齐全：犬只/强度/超时/工作区/预算已花与 cap/完整 prompt/流关联。 */
  /** GOAL-084 §3.3：单场会话授权卡——复用 D30 审批卡目录与 append-only owner
   *  response（kind='collab-session'，审批沿用现有响应入口 §2.4）。卡片字段
   *  **全部来自冻结授权快照**（议题/参与者/材料/边界/证据/快照哈希）——owner
   *  看到的就是实际获准执行的内容，不接受调用方传入显示文案。重复创建
   *  fail-closed；应答经 respondSessionApproval，重复应答由黑板状态机拒绝。 */
  createSessionAuthorizationRequest(input: { session_id: string; reason?: string }): { request_file: string } {
    if (this.collabBlackboard === undefined) {
      throw new InputError('collab session authorization requires a collaboration blackboard (fail-closed)');
    }
    const snapshot = this.collabBlackboard.getAuthorizationSnapshot(input.session_id);
    const session = this.collabBlackboard.getSession(input.session_id);
    mkdirSync(this.approvalRequestRoot, { recursive: true });
    const file = path.join(this.approvalRequestRoot, `collab-session-${input.session_id}.json`);
    if (existsSync(file)) {
      throw new InputError(`session authorization request already exists: ${input.session_id}`);
    }
    writeFileSync(file, JSON.stringify({
      schema_version: 1,
      kind: 'collab-session',
      gate: 'GOAL-084-session-authorization',
      session_id: input.session_id,
      authorization_hash: session.authorization_hash,
      title: `会话授权：${snapshot.topic}`,
      reason: input.reason ?? `受控会话单场授权（${snapshot.participants.length} 参与者，call_limit=${snapshot.call_limit}+retry=${snapshot.retry_limit}，isolation=${snapshot.isolation_required === true}）`,
      requested_at_utc: this.now().toISOString(),
      topic: snapshot.topic,
      workspace_root: snapshot.workspace_root,
      participants: snapshot.participants,
      materials: snapshot.materials,
      call_limit: snapshot.call_limit,
      retry_limit: snapshot.retry_limit,
      single_call_timeout_s: snapshot.single_call_timeout_s,
      session_timeout_min: snapshot.session_timeout_min,
      isolation_required: snapshot.isolation_required === true,
      capability_evidence: snapshot.capability_evidence ?? [],
      // D89 条件化准入：被接受的已知缺口随卡展示（owner 所见即所批）。
      // 证据等级不因此改变——缺口条目在 capability_evidence 里仍是 declared/unmet。
      ...(snapshot.policy_decision_ref !== undefined ? { policy_decision_ref: snapshot.policy_decision_ref } : {}),
      ...(snapshot.accepted_gaps !== undefined ? { accepted_gaps: snapshot.accepted_gaps } : {}),
      // GOAL-085：评审关系随卡冻结展示（参会者数量由 participants 长度体现）。
      ...(snapshot.review_relations !== undefined ? { review_relations: snapshot.review_relations } : {}),
    }, null, 2) + '\n', 'utf8');
    return { request_file: path.basename(file) };
  }

  /** GOAL-084 §3.3：会话授权应答（由既有 /api/approvals/respond 路由进入）。
   *  APPROVED → 黑板授权（隔离会话按证据 fail-closed 准入）；REJECTED → 会话取消。
   *  重复应答由黑板状态机拒绝（已授权/已终态）。 */
  respondSessionApproval(sessionId: string, decision: 'APPROVED' | 'REJECTED'): Record<string, unknown> {
    if (this.collabBlackboard === undefined) {
      throw new InputError('collab session approval requires a collaboration blackboard (fail-closed)');
    }
    if (decision === 'APPROVED') {
      this.collabBlackboard.authorizeSession(sessionId);
      return { session_id: sessionId, status: 'authorized' };
    }
    this.collabBlackboard.closeSession(sessionId, 'cancelled');
    return { session_id: sessionId, status: 'cancelled' };
  }

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
      // GOAL-071：观察态派发在审批卡如实标注（冻结区只读参演）。
      ...(this.observationState.path !== null && request.workspace === this.observationState.path ? { observation: true } : {}),
      // owner 2026-08-17 反馈：审批名必须带 Goal 编号利于人识别 + 任务池关联。
      title: `真实派发：${record.adapter_id}${request.goal_id !== undefined ? ' · ' + request.goal_id : ''}`,
      actor_id: record.adapter_id,
      goal_id: request.goal_id ?? null,
      reason: `${request.goal_id !== undefined ? request.goal_id + ' · ' : ''}${request.probe_id ?? ''} real 派发逐单审批（effort=${request.effort} timeout=${request.timeout_s}s cap=$${capUsd}）${request.prepared_only === true ? '；仅准备：未执行、未占预算；批准不复位熔断；实际费用 UNKNOWN' : ''}`,
      requested_at_utc: this.now().toISOString(),
      ...(request.prepared_only === true ? { prepared_only: true } : {}),
      ...(request.probe_id !== undefined ? { probe_id: request.probe_id } : {}),
      adapter_id: record.adapter_id,
      effort: request.effort,
      // GOAL-084（owner 复核缺口，2026-10-03）：审批卡展示执行配置——模型、
      // 工具限制参数与输出 schema（内容 + sha256 锚点）随卡可见，否则
      // 「审批所见＝执行所跑」不可核验。模型展示**实际生效值**：未显式指定
      // 时为合同默认（审批者必须知道实际跑什么模型）。
      ...((() => {
        const effectiveModelId = request.model_id ?? this.contracts[record.adapter_id]?.expected_model_id;
        return effectiveModelId !== undefined ? { model_id: effectiveModelId } : {};
      })()),
      ...(request.restrictTools === true
        ? {
            restrict_tools: true,
            // 实际将注入的限制参数序列来自当前合同（与 rerun 实际 argv 一致）；
            // 合同缺失时如实写 null，不伪造。
            tool_restriction_args: this.contracts[record.adapter_id]?.tool_restriction_args ?? null,
          }
        : {}),
      ...(request.outputSchema !== undefined
        ? {
            output_schema: request.outputSchema,
            output_schema_sha256: sha256Hex(JSON.stringify(request.outputSchema)),
          }
        : {}),
      // GOAL-084（owner 复核缺口，2026-10-03）：批准时生效合同指纹随卡可见——
      // 审批者核对模型/参数之外还有整份合同的锚点；重跑前服务端据它拒漂移。
      ...(request.contract_fingerprint !== undefined
        ? { contract_fingerprint: request.contract_fingerprint }
        : {}),
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
    /** GOAL-085：该通道作为协作席位时的**默认强度**（界面下拉的初值，与服务端创建口径同源）。 */
    collab_default_effort?: string;
    /** GOAL-085：该通道作为协作席位时的**默认模型** = 讨论档案绑定的模型（证据/批准按它登记）；
     *  协作表单用它作模型初值，避免用名册默认模型撞上隔离准入门。 */
    collab_default_model_id?: string;
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
          ...(defaultCollabEffort(contract) !== undefined ? { collab_default_effort: defaultCollabEffort(contract)! } : {}),
          ...(defaultCollabModelId(contract) !== undefined ? { collab_default_model_id: defaultCollabModelId(contract)! } : {}),
          ...(modelsList && modelsList.length > 0 ? { live_models: modelsList } : {}),
          ...(probe?.status ? { probe_status: probe.status } : {}),
          ...(actualModel ? { actual_model_id: actualModel } : {}),
        };
      });
  }



  /** G011 / DEF-10：默认工作区优先取持久化选择（D86：读宿主级 registryDir，热切换后仍单点）。 */
  defaultWorkspace(): string {
    const file = path.join(this.registryDir, 'workspace.json');
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

  /** GOAL-071：冻结区特征判定（意向项目黄金参照 / .agent-bridge 任意仓）。 */
  static isFrozenZoneLike(p: string): boolean {
    const lower = p.toLowerCase();
    return lower.includes('意向项目') || lower.includes('.agent-bridge');
  }

  /** GOAL-071：进入观察模式——仅冻结区路径可观察；不注册工作区、不写任何
   * 元数据到目标（零写入承诺从进入这一刻开始）。 */
  enterObservation(target: string): { observing: boolean; path: string } {
    const resolved = path.resolve(target);
    if (!existsSync(resolved) || !DispatchPipeline.isFrozenZoneLike(resolved)) {
      throw new InputError(`observation mode only applies to existing frozen-zone paths (意向项目/.agent-bridge): ${resolved}`);
    }
    this.observationState.path = resolved;
    return { observing: true, path: resolved };
  }

  exitObservation(): void {
    this.observationState.path = null;
  }

  /** 当前观察目标；null = 未处于观察态（server 快照/UI 徽标数据源）。 */
  get observingWorkspace(): string | null {
    return this.observationState.path;
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

    // D82 修订：先剥掉历史快照叠加的组装层（旧数据自愈），再单次组装。
    const projectBrief = readProjectBrief(workspace);
    let prompt = stripAssembledLayers(rawPrompt, projectBrief);
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

  /** 手动标记完成：owner/头犬确认目标已在 mush 之外完成时使用。
   *  走 advanceTaskToStatus 平滑跃迁链（同 receipt 对账口径），append-only 留痕。 */
  markTaskDone(taskId: string): Task {
    const tasks = loadTasks(this.tasksPath);
    const task = tasks.find((entry) => entry.task_id === taskId);
    if (task === undefined) throw new InputError(`task not found: ${taskId}`);
    const next = advanceTaskToStatus(task, 'DONE', this.now);
    if (next !== task) appendTask(this.tasksPath, next);
    return next;
  }

  /** GOAL-082：监理自解冻——受阻任务转就绪（BLOCKED→READY 合法跃迁），append-only 留痕。 */
  unblockTask(taskId: string): Task {
    const tasks = loadTasks(this.tasksPath);
    const task = tasks.find((entry) => entry.task_id === taskId);
    if (task === undefined) throw new InputError(`task not found: ${taskId}`);
    if (task.status !== 'BLOCKED') return task; // 幂等：非受阻态原样返回
    const next = advanceTaskToStatus(task, 'READY', this.now);
    if (next !== task) appendTask(this.tasksPath, next);
    return next;
  }

  /** GOAL-080：换道犬的执行合同——基线合同 + 同 effort 注入；resume 会话锚点不跨犬移植。 */
  private contractForFailover(failoverId: string, effort: string): AdapterContract {
    return applyEffortInjection(this.contracts[failoverId], effort);
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

  /** Host-owned profile setup: register its verified execution folder without changing the selected workspace. */
  registerAgyDiscussionWorkspace(): void {
    const contract = this.contracts.agy;
    const profile = contract?.agy_discussion_profile;
    if (!profile) throw new InputError('agy discussion profile is not configured');
    verifyAgyDiscussionBinding(contract, profile.model_id);
    this.rememberWorkspace(profile.workspace_root);
  }

  /** GOAL-085：Claude 讨论通道的宿主侧工作目录登记（同样不改选中工作区）。 */
  registerClaudeDiscussionWorkspace(): void {
    const contract = this.contracts['claude-code'];
    const profile = contract?.claude_discussion_profile;
    if (!profile) throw new InputError('Claude discussion profile is not configured');
    verifyClaudeDiscussionBinding(contract, profile.model_id);
    this.rememberWorkspace(profile.workspace_root);
  }

  /** 只读原生版本探测（零模型调用）：探针准备与激活入口使用。 */
  inspectClaudeDiscussionVersion(contract: AdapterContract, dataRoot: string): Promise<string> {
    return this.claudeDiscussionInspector(contract, dataRoot);
  }

  selectWorkspace(target: string): string {
    const resolved = path.resolve(target);
    // D85（2026-09-06，owner 裁定）：意向项目可选为工作区处理业务（切换是正当
    // 需求，拒绝属设计缺陷）；写保护收敛到派发级——真实派发仍逐单审批（D30），
    // 观察参演模式保留。.agent-bridge（旧 PowerShell 黄金实现档案区）仍冻结。
    if (resolved.toLowerCase().includes('.agent-bridge')) {
      throw new InputError(`Cannot select frozen golden reference zone as workspace: ${resolved}`);
    }
    if (!existsSync(resolved)) throw new InputError(`workspace does not exist: ${resolved}`);
    if (!statSync(resolved).isDirectory()) throw new InputError(`not a directory: ${resolved}`);
    this.selectedWorkspace = resolved;
    // D86：选择落宿主级登记簿（registryDir）——目标文件夹零足迹；DEF-10 重启恢复
    // 始终读同一份文件，修复此前"选择写进目标 .mush、宿主文件滞后"的恢复失准。
    mkdirSync(this.registryDir, { recursive: true });
    writeFileSync(
      path.join(this.registryDir, 'workspace.json'),
      JSON.stringify({ schema_version: 1, selected: resolved, selected_at_utc: this.now().toISOString() }) + '\n',
      'utf8',
    );
    this.rememberWorkspace(resolved);
    return resolved;
  }

  /** G009：选中即记住（append 到 registryDir 的 known-workspaces.json，去重；F-39：归一后比较）。 */
  private rememberWorkspace(resolved: string): void {
    const known = new Set(this.knownWorkspaces().map((item) => path.resolve(item)));
    known.add(path.resolve(resolved));
    mkdirSync(this.registryDir, { recursive: true });
    writeFileSync(
      path.join(this.registryDir, 'known-workspaces.json'),
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
    // D85：意向项目内允许选中已有目录做工作区；仅禁止在看板里"新建"目录
    //（防误建，需要新目录时 owner 手工创建后再切换）。
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
    const file = path.join(this.registryDir, 'known-workspaces.json');
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
