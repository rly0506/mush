/**
 * mush M5 Web 看板（GOAL-005 U2）— 零依赖 node:http 服务 + SSE 推送。
 *
 * 红线：
 * - 默认且测试只绑 127.0.0.1；对外暴露属触发门 4（不实现开关）。
 * - 数据源只读消费事件流/审批目录；唯一写路径 = append-only owner-response 文件
 *   （与 goals/receipts/approval-requests/ 现有流程同构）。
 * - 内存 EventLog 与 loop 同源（同一 schema/哈希链核心层），非第二状态源。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { EventLog } from '../core/event-log.ts';
import { parseBridgeEventV2 } from '../schema/events.ts';
import { collectBoardSnapshot } from './sources.ts';
import { renderBoardPage } from './page.ts';
import { DispatchPipeline, InputError, CarveoutAuthError } from './dispatch.ts';
import { BoardPersistence } from './persistence.ts';
import { ChatService } from './chat.ts';
import { readAttachment } from './attachments.ts';
import {
  recordActivity,
  queryActivities,
  translateDispatchEvent,
  translateTaskCreate,
  translateTaskTransition,
  translateApprovalResponse,
} from './activity.ts';
import { scanLocalHarnessUsage } from './usage-scanner.ts';
import { assembleContext } from '../orchestration/indexer.ts';
import { captureWorkspaceDiff, revertWorkspaceFile } from '../orchestration/diff-collector.ts';
import { loadDispatchTrace, listDispatchTraces, createDispatchTrace, addTraceStep, finishDispatchTrace } from '../orchestration/trace.ts';
import { DirectSessionManager } from '../orchestration/direct-session.ts';
import { evaluateContextPressure, distillTranscript, saveMemory, loadMemory, listMemories, processFileMention, extractStructuredInvariant, filterExecutionOutput } from '../orchestration/distiller.ts';
import { classifyTaskPrompt, recommendDogs } from '../orchestration/router.ts';
import { createShadowEvaluation, generateShadowReport, saveShadowEvaluation, loadShadowEvaluation, listShadowEvaluations } from '../orchestration/shadow-split.ts';
import { generateAuditReport, saveAuditReport, listAuditReports } from './audit-export.ts';
import { SymbolicMemoryGraph } from '../orchestration/symbolic-memory.ts';
import { AgentCollaborationHub } from '../orchestration/inter-agent.ts';
import { WorkstreamStore } from './workstreams.ts';
import { recommendCollaborationPair, buildCollaborationPacket, type CollaborationMode } from '../orchestration/collaboration-bus.ts';
import { DebateEngine } from '../orchestration/debate-engine.ts';
import { PipelineEngine } from '../orchestration/pipeline-engine.ts';
import { VerifierLoopEngine, VerifierDecouplingError } from '../orchestration/verifier-loop.ts';
import { BountyMarketEngine } from '../orchestration/bounty-market.ts';
import { SkillsFederationEngine } from '../orchestration/skills-federation.ts';
import { TimeTravelKernel } from '../orchestration/time-travel.ts';
import { BlackboardEngine, BlackboardAclError, type BlackboardSection } from '../orchestration/blackboard.ts';
import { LiquidSquadEngine, type SquadStatus, type TaskFeatureWeights } from '../orchestration/liquid-squad.ts';
import { EloRatingEngine, type MatchOutcome, type MatchMetrics } from '../orchestration/elo-engine.ts';
import { SelfEvolvingRoutingOptimizer, type RoutingDomain, type TaskOutcomeFeedback } from '../orchestration/route-optimizer.ts';
import { VelocityMatrixEngine } from '../orchestration/velocity-matrix.ts';
import { renderFloatingSledHtml } from '../companion/floating-page.ts';
import type { QuickActionPayload } from '../companion/tray-service.ts';
import { getModelContextLimit, isFreeModel, calculateUsageCost } from './pricing.ts';
import { ChildSessionRegistry } from '../core/child-sessions.ts';
import { MasterBudgetGate, loadMasterCap } from '../core/budget-master.ts';
import { getHarnessDoctorReport } from '../adapters/live-probe.ts';

export interface BoardServerOptions {
  approvalRoot: string;
  runId: string;
  assignmentEpoch: number;
  host?: string;
  port?: number;
  /** 预载事件日志（如 loop 接线时传入既有日志）；缺省新建空日志。 */
  eventLog?: EventLog;
  /** 派发管线（G006）；缺省按 workspaceRoot/approvalRoot 自建。 */
  dispatch?: DispatchPipeline;
  workspaceRoot?: string;
  ledgerPath?: string;
  /** GP-03：持久化与锁；缺省 <workspaceRoot>/runtime。 */
  runtimeRoot?: string;
  persistence?: BoardPersistence;
  /** G011：聊天服务；缺省按 dispatch + runtimeRoot 自建。 */
  chat?: ChatService;
  /** GOAL-033（GP-31）：会话工作流管理器；缺省 <runtimeRoot>/workstreams.jsonl。 */
  workstreams?: WorkstreamStore;
  /** GOAL-037（D37）：犬只直连会话管理器。 */
  directSessions?: DirectSessionManager;
  /** GOAL-042（Phase C）：符号化记忆图谱与跨犬直连协作 Hub。 */
  memoryGraph?: SymbolicMemoryGraph;
  collaborationHub?: AgentCollaborationHub;
  /** GOAL-044（RM-005 M1）：圆桌辩论对席引擎。 */
  debateEngine?: DebateEngine;
  /** GOAL-045（RM-005 M2）：SOP 工序流水线引擎。 */
  pipelineEngine?: PipelineEngine;
  /** GOAL-046（RM-005 M3）：红蓝对抗验证室引擎。 */
  verifierLoopEngine?: VerifierLoopEngine;
  /** GOAL-047（RM-005 M4）：Contract Net 悬赏大厅引擎。 */
  bountyMarketEngine?: BountyMarketEngine;
  /** GOAL-048（RM-006 M1）：跨 Harness 技能联邦引擎。 */
  skillsFederationEngine?: SkillsFederationEngine;
  /** GOAL-049（RM-006 M2）：时空状态树与时间旅行快照内核。 */
  timeTravelKernel?: TimeTravelKernel;
  /** GOAL-050（RM-006 M3）：跨犬共享黑板协作空间。 */
  blackboardEngine?: BlackboardEngine;
  /** GOAL-051（RM-006 M4）：液态临时战时攻关小队调度器。 */
  liquidSquadEngine?: LiquidSquadEngine;
  /** GOAL-052（RM-007 M1）：影子评测与实战 ELO 战绩天梯引擎。 */
  eloRatingEngine?: EloRatingEngine;
  /** GOAL-053（RM-007 M2）：实战反馈自进化路由优化器。 */
  routeOptimizer?: SelfEvolvingRoutingOptimizer;
  /** GOAL-055（RM-007 M4）：多犬协作全景战报与研发能效度量引擎。 */
  velocityEngine?: VelocityMatrixEngine;
  /** GOAL-068（D2）：跨项目全局资金 Master Cap（USD）；缺省读 ~/.mush/master-cap.json，0=不限。 */
  masterCapUsd?: number;
  /** GOAL-067（F1 选 A）：工犬子会话注册表；缺省 <runtimeRoot>/child-sessions.jsonl。 */
  childSessions?: ChildSessionRegistry;
  /** GOAL-030（GP-32②）：调用者身份鉴别 Token 与安全拦截。 */
  callerToken?: string;
  enforceCallerToken?: boolean;
  /** Browse-Fix-1：原生目录弹窗脚本路径覆写（测试注入无 UI 桩脚本用）。 */
  browseFolderScript?: string;
}

export interface BoardServer {
  server: Server;
  host: string;
  port: number;
  callerToken: string;
  close(): Promise<void>;
}

/**
 * GOAL-067（P0）：路由级异常兜底——磁盘满/文件被占用等 fs 写入异常不得击穿
 * 看板进程（Node ≥15 默认 unhandledRejection 直接退出）。策略（owner 裁决
 * Q1）：stderr 记录 + 尽力回 500，进程保持存活。
 */
function guarded(response: ServerResponse, fn: () => Promise<void>): void {
  fn().catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[mush:server] handler error: ${detail}\n`);
    try {
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: 'internal error (see server log)' });
      }
    } catch {
      // 响应流已不可写：忽略。
    }
  });
}

let rejectionHookInstalled = false;
function installRejectionHook(): void {
  if (rejectionHookInstalled) return;
  rejectionHookInstalled = true;
  process.on('unhandledRejection', (reason: unknown) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    process.stderr.write(`[mush:server] unhandledRejection (process kept alive): ${detail}\n`);
  });
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body) + '\n';
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(payload);
}

async function readBody(request: IncomingMessage, limitBytes = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limitBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const DECISIONS = new Set(['APPROVED', 'REJECTED']);

export async function startBoardServer(options: BoardServerOptions): Promise<BoardServer> {
  installRejectionHook();
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  // GOAL-068（多项目热切换）：以下工作区绑定状态为可变——切换活动项目时由
  // activateWorkspaceContext() 整体重建；路由闭包经名字动态解析拿到最新值。
  let approvalRoot = path.resolve(options.approvalRoot);
  let workspaceRoot = options.workspaceRoot ?? process.cwd();
  // 测试/缺省：runtime 挂在 approvalRoot 下（天然隔离）；生产 CLI 显式传 workspace/runtime。
  let runtimeRoot = options.runtimeRoot ?? path.join(approvalRoot, 'runtime');
  const startupWorkspaceRoot = workspaceRoot; // 宿主安装根（品牌资产等全局资源锚点，不随切换）
  let persistence = options.persistence ?? new BoardPersistence(runtimeRoot);

  // GOAL-068（D2）：全局资金总控门——机器级唯一实例，跨所有工作区上下文共享。
  const masterGate = new MasterBudgetGate({
    filePath: process.env.MUSH_MASTER_LEDGER_PATH ?? path.join(homedir(), '.mush', 'master-ledger.jsonl'),
    capUsd: options.masterCapUsd ?? loadMasterCap(),
  });

  // GOAL-030（GP-32②）：会话级 Caller Token 初始化
  const callerToken = options.callerToken ?? randomUUID().replace(/-/g, '');
  const enforceCallerToken = options.enforceCallerToken ?? (options.callerToken !== undefined);

  // GOAL-013L（rm003-p13，授权唯一后端小改）：品牌图标静态路由。
  // 白名单目录 assets/brands/，仅 .svg；name 先校验纯文件名（拒绝路径穿越），
  // 再经 path.resolve 前缀复核（纵深防御）；content-type image/svg+xml + 短缓存。
  // 锚定宿主安装根（不随项目切换）。
  const brandAssetsRoot = path.resolve(startupWorkspaceRoot, 'assets', 'brands');

  // GP-03 / F-42：单实例锁。已在运行的看板实例拒绝第二个实例。
  persistence.acquireLock();

  // GP-03：事件链持久化回放——启动时读回 JSONL 并重建哈希链日志。
  const log = options.eventLog ?? new EventLog(options.runId, options.assignmentEpoch);
  if (options.eventLog === undefined) {
    for (const line of persistence.loadEventLogLines(options.runId)) {
      log.append(line.event);
    }
  }
  let dispatch =
    options.dispatch ??
    new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      ledgerPath: options.ledgerPath ?? path.join(runtimeRoot, 'budget-ledger.jsonl'),
      registryPath: path.join(workspaceRoot, 'runtime', 'capability-registry.json'),
      persistence,
      masterGate,
      onEvent: (event) => broadcast(event),
    });
  // GOAL-033（GP-31）：会话工作流管理器
  let workstreams = options.workstreams ?? new WorkstreamStore(path.join(runtimeRoot, 'workstreams.jsonl'));
  const sseClients = new Set<ServerResponse>();

  function broadcast(payload: unknown): void {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }
  // GOAL-068：管线生命周期事件接线抽为助手——每个工作区上下文的新 pipeline
  // 都需要同样的 SSE 广播 + 活动时间线转译（活动流落各自 runtime）。
  function wirePipelineEvents(pipeline: DispatchPipeline, wsRuntimeRoot: string): void {
    pipeline.setEventListener((event) => {
      broadcast(event);
      try {
        const record = pipeline.get(event.dispatch_id);
        const act = translateDispatchEvent(event, {
          task_id: record?.task_id,
          goal_id: record?.request?.goal_id,
          // GOAL-069：DispatchRequestSnapshot 刻意不含 amount_usd（GP-10 防虚报），
          // 此处不再读取幻影字段；金额经台账投影另行呈现。
        });
        if (act !== null) {
          recordActivity(wsRuntimeRoot, act);
        }
      } catch (err) {
        console.warn('[activity] failed to record dispatch activity:', err);
      }
    });
  }
  // 注入管线也要把生命周期事件推 SSE 并转译活动时间线（GOAL-023）。
  wirePipelineEvents(dispatch, runtimeRoot);
  // GOAL-068（D2）：缺省管线（含注入式实例）统一共享机器级 Master Cap 门。
  dispatch.setMasterGate(masterGate);
  let directSessions = options.directSessions ?? new DirectSessionManager(runtimeRoot);
  let memoryGraph = options.memoryGraph ?? new SymbolicMemoryGraph(runtimeRoot);
  let collaborationHub = options.collaborationHub ?? new AgentCollaborationHub(runtimeRoot);
  let debateEngine = options.debateEngine ?? new DebateEngine(runtimeRoot);
  let pipelineEngine = options.pipelineEngine ?? new PipelineEngine(runtimeRoot);
  let verifierLoopEngine = options.verifierLoopEngine ?? new VerifierLoopEngine(runtimeRoot);
  let bountyMarketEngine = options.bountyMarketEngine ?? new BountyMarketEngine(runtimeRoot);
  let skillsFederationEngine = options.skillsFederationEngine ?? new SkillsFederationEngine([path.join(workspaceRoot, 'skills'), path.join(runtimeRoot, 'skills')]);
  let timeTravelKernel = options.timeTravelKernel ?? new TimeTravelKernel(workspaceRoot, runtimeRoot);
  let blackboardEngine = options.blackboardEngine ?? new BlackboardEngine(runtimeRoot);
  let liquidSquadEngine = options.liquidSquadEngine ?? new LiquidSquadEngine(runtimeRoot);
  let eloRatingEngine = options.eloRatingEngine ?? new EloRatingEngine(runtimeRoot);
  let routeOptimizer = options.routeOptimizer ?? new SelfEvolvingRoutingOptimizer(runtimeRoot);
  let velocityEngine = options.velocityEngine ?? new VelocityMatrixEngine(runtimeRoot);
  // GOAL-067（F1 选 A）：激活 ChildSessionRegistry——此前生产零接线，前端
  // 工犬抽屉调用 404。显式落 runtimeRoot 下，避免类缺省的 cwd 相对路径。
  let childSessions = options.childSessions ?? new ChildSessionRegistry(path.join(runtimeRoot, 'child-sessions.jsonl'));
  let chat =
    options.chat ??
    new ChatService({
      pipeline: dispatch,
      runtimeRoot,
      onEvent: (event) => broadcast(event as unknown as Record<string, unknown>),
    });

  // GOAL-068（多项目完全数据隔离）：热切换上下文重建。
  //
  // 切换活动项目时，为该工作区**全新构建**一整套数据面服务（派发管线、任务池、
  // 聊天、工犬子会话、时空快照、黑板、ELO……），全部落位 `<ws>/runtime/` 与
  // `<ws>/goals/receipts/approval-requests>`，实现 100% 物理隔离（D1 决议：
  // 沿用 runtime/ 布局，不迁移 .mush/）。要点：
  // - 注入式实例（options.dispatch/chat 等）仅作用于启动缺省上下文；热切构建
  //   的非缺省上下文一律使用默认构造器；
  // - 在途派发绑定其 origin 管线闭包，不受切换影响，SSE/toast 全局照推（D4）；
  // - masterGate 为机器级单例，跨所有上下文共享（D2 资金总控）。
  function activateWorkspaceContext(targetWorkspace: string): { workspace_root: string } {
    const resolved = path.resolve(targetWorkspace);
    if (resolved === path.resolve(workspaceRoot)) {
      return { workspace_root: workspaceRoot };
    }
    if (!existsSync(resolved)) {
      throw new InputError(`workspace does not exist: ${resolved}`);
    }
    const nextRuntime = path.join(resolved, 'runtime');
    const nextApproval = path.join(resolved, 'goals', 'receipts', 'approval-requests');
    mkdirSync(nextRuntime, { recursive: true });

    const nextPersistence = new BoardPersistence(nextRuntime);
    const nextDispatch = new DispatchPipeline({
      workspaceRoot: resolved,
      approvalRoot: nextApproval,
      ledgerPath: path.join(nextRuntime, 'budget-ledger.jsonl'),
      registryPath: path.join(nextRuntime, 'capability-registry.json'),
      persistence: nextPersistence,
      masterGate,
      onEvent: (event) => broadcast(event),
    });
    wirePipelineEvents(nextDispatch, nextRuntime);

    workspaceRoot = resolved;
    approvalRoot = nextApproval;
    runtimeRoot = nextRuntime;
    persistence = nextPersistence;
    dispatch = nextDispatch;
    workstreams = new WorkstreamStore(path.join(nextRuntime, 'workstreams.jsonl'));
    chat = new ChatService({
      pipeline: nextDispatch,
      runtimeRoot: nextRuntime,
      onEvent: (event) => broadcast(event as unknown as Record<string, unknown>),
    });
    directSessions = new DirectSessionManager(nextRuntime);
    memoryGraph = new SymbolicMemoryGraph(nextRuntime);
    collaborationHub = new AgentCollaborationHub(nextRuntime);
    debateEngine = new DebateEngine(nextRuntime);
    pipelineEngine = new PipelineEngine(nextRuntime);
    verifierLoopEngine = new VerifierLoopEngine(nextRuntime);
    bountyMarketEngine = new BountyMarketEngine(nextRuntime);
    skillsFederationEngine = new SkillsFederationEngine([path.join(resolved, 'skills'), path.join(nextRuntime, 'skills')]);
    timeTravelKernel = new TimeTravelKernel(resolved, nextRuntime);
    blackboardEngine = new BlackboardEngine(nextRuntime);
    liquidSquadEngine = new LiquidSquadEngine(nextRuntime);
    eloRatingEngine = new EloRatingEngine(nextRuntime);
    routeOptimizer = new SelfEvolvingRoutingOptimizer(nextRuntime);
    velocityEngine = new VelocityMatrixEngine(nextRuntime);
    childSessions = new ChildSessionRegistry(path.join(nextRuntime, 'child-sessions.jsonl'));

    broadcast({ type: 'workspace_switched', workspace_root: resolved });
    return { workspace_root: workspaceRoot };
  }

  async function handleEventPost(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let raw: string;
    try {
      raw = await readBody(request);
    } catch {
      sendJson(response, 413, { ok: false, error: 'request body too large' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(response, 400, { ok: false, error: 'body must be JSON' });
      return;
    }
    try {
      parseBridgeEventV2(parsed); // schema 违规 → 400
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    let entry;
    try {
      entry = log.append(parsed); // run/epoch/sequence 违规 → 核心层 fail-closed → 409
      persistence.appendEventLog(options.runId, entry); // GP-03：事件链随 append 同步落盘（哈希锚点）
    } catch (error) {
      sendJson(response, 409, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    broadcast({ kind: 'event', entry });
    sendJson(response, 201, { ok: true, sequence: entry.sequence, sha256: entry.sha256 });
  }

  function validRequestFileName(name: unknown): name is string {
    return (
      typeof name === 'string' &&
      /^[^/\\]+\.json$/.test(name) &&
      !name.endsWith('.owner-response.json') &&
      name !== '.' &&
      name !== '..'
    );
  }

  async function handleApprovalRespond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(request));
    } catch {
      sendJson(response, 400, { ok: false, error: 'body must be JSON' });
      return;
    }
    const body = parsed as Record<string, unknown>;
    if (!validRequestFileName(body.request_file)) {
      sendJson(response, 400, { ok: false, error: 'request_file must be a plain *.json file name in the approval root' });
      return;
    }
    if (typeof body.decision !== 'string' || !DECISIONS.has(body.decision)) {
      sendJson(response, 400, { ok: false, error: "decision must be 'APPROVED' or 'REJECTED'" });
      return;
    }
    const requestPath = path.join(approvalRoot, body.request_file);
    if (!existsSync(requestPath)) {
      sendJson(response, 404, { ok: false, error: `approval request not found: ${body.request_file}` });
      return;
    }
    const responsePath = requestPath + '.owner-response.json';
    if (existsSync(responsePath)) {
      sendJson(response, 409, { ok: false, error: 'approval already responded (append-only, no overwrite)' });
      return;
    }
    const ownerResponse = {
      schema_version: 1,
      request_file: body.request_file,
      responded_at_utc: new Date().toISOString(),
      owner_decision: body.decision,
      owner_evidence: typeof body.evidence === 'string' && body.evidence.trim() !== '' ? body.evidence : 'owner response via mush board',
      note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note : undefined,
    };
    writeFileSync(responsePath, JSON.stringify(ownerResponse, null, 2) + '\n', 'utf8');
    broadcast({ kind: 'approval', request_file: body.request_file, decision: body.decision });
    try {
      recordActivity(
        runtimeRoot,
        translateApprovalResponse(String(body.request_file), String(body.decision), 'owner'),
      );
    } catch (err) {
      console.warn('[activity] failed to record approval response activity:', err);
    }
    // GP-32（D30）：派发类请求——批准 = 单次令牌 + approved_via 自动重跑（原单
    // 折 SUPERSEDED）；否决 = 原单折 REJECTED。应答文件先落盘（append-only），
    // 联动失败不吞应答，只降级为 warning。
    // AD-39 修正：重跑**异步启动**（void）——真实犬只任务可跑数十分钟，
    // 应答端点同步等待会拖死前端请求（owner 批准后弹"应答失败"误报）；
    // 执行状态经既有 SSE 生命周期事件实时推送。
    let dispatchOutcome: Record<string, unknown> | null = null;
    try {
      const req = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>;
      if (req.kind === 'dispatch' && typeof req.dispatch_id === 'string' && req.dispatch_id !== '') {
        if (body.decision === 'APPROVED') {
          dispatch.grantApprovalToken(req.dispatch_id);
          void dispatch
            .rerun(req.dispatch_id, { real: true, approved_via: req.dispatch_id })
            .catch((error: unknown) => {
              broadcast({
                kind: 'dispatch',
                dispatch_id: req.dispatch_id,
                warning: `approved rerun failed: ${error instanceof Error ? error.message : String(error)}`,
              });
            });
          dispatchOutcome = { rerun: 'STARTED', original: req.dispatch_id };
        } else {
          const rejected = dispatch.rejectDispatch(req.dispatch_id);
          dispatchOutcome = { dispatch_id: rejected.dispatch_id, status: rejected.status };
        }
      }
    } catch (error) {
      sendJson(response, 201, {
        ok: true,
        response_path: responsePath,
        warning: `approval recorded but dispatch follow-up failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    sendJson(response, 201, { ok: true, response_path: responsePath, ...(dispatchOutcome !== null ? { dispatch: dispatchOutcome } : {}) });
  }

  const server = createServer((request, response) => {
    // DEF-04（安全审查 2026-08-17）：Host 头白名单——阻断 DNS rebinding。
    // 仅绑定 127.0.0.1 不是防线：恶意页面可将其域名 rebind 到 127.0.0.1，
    // 同源策略随之放行；服务端必须自己校验请求的目标主机。
    const hostHeader = (request.headers.host ?? '').toLowerCase();
    const hostName = hostHeader.split(':')[0];
    if (hostName !== '127.0.0.1' && hostName !== 'localhost' && hostName !== '[::1]') {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: false, error: 'forbidden: host header not in loopback allowlist (DEF-04)' }) + '\n');
      return;
    }
    const url = new URL(request.url ?? '/', `http://${host}`);
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderBoardPage(callerToken));
      return;
    }
    if (route === 'GET /api/session/token') {
      const originHeader = request.headers.origin;
      if (typeof originHeader === 'string' && originHeader.trim() !== '') {
        try {
          const originUrl = new URL(originHeader);
          const originHost = originUrl.hostname.toLowerCase();
          if (originHost !== '127.0.0.1' && originHost !== 'localhost' && originHost !== '[::1]') {
            sendJson(response, 403, { ok: false, error: 'Forbidden: cross-origin session token access blocked (CSRF guard)' });
            return;
          }
        } catch {
          sendJson(response, 403, { ok: false, error: 'Forbidden: invalid Origin header' });
          return;
        }
      }
      sendJson(response, 200, { ok: true, caller_token: callerToken });
      return;
    }

    // GOAL-030 & GOAL-063: 状态变更 API 强制 CSRF 校验与调用者身份鉴别
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method ?? '')) {
      // 1. CSRF 防御：若携带 Origin 头部，主机名必须属于 Loopback 白名单
      const originHeader = request.headers.origin;
      if (typeof originHeader === 'string' && originHeader.trim() !== '') {
        try {
          const originUrl = new URL(originHeader);
          const originHost = originUrl.hostname.toLowerCase();
          if (originHost !== '127.0.0.1' && originHost !== 'localhost' && originHost !== '[::1]') {
            request.resume();
            sendJson(response, 403, { ok: false, error: 'Forbidden: cross-origin mutation blocked (CSRF guard)' });
            return;
          }
        } catch {
          request.resume();
          sendJson(response, 403, { ok: false, error: 'Forbidden: invalid Origin header' });
          return;
        }
      }

      // 2. Caller Token 身份门禁校验
      if (enforceCallerToken) {
        const headerVal = request.headers['x-mush-caller-auth'] ?? request.headers['x-mush-caller-token'];
        const queryVal = url.searchParams.get('caller_auth') ?? url.searchParams.get('caller_token');
        const token = typeof headerVal === 'string' ? headerVal.trim() : (queryVal ? queryVal.trim() : '');
        if (!token || token !== callerToken) {
          request.resume();
          sendJson(response, 401, { ok: false, error: 'Unauthorized: missing or invalid X-Mush-Caller-Auth' });
          return;
        }
      }
    }
    const brandMatch = /^\/assets\/brands\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && brandMatch !== null) {
      // GOAL-013L：品牌图标静态服务——白名单目录 + 纯文件名校验（拒绝穿越）+ 仅 .svg。
      const name = brandMatch[1];
      if (!/^[A-Za-z0-9_-]+\.svg$/.test(name)) {
        sendJson(response, 404, { ok: false, error: `brand asset not found: ${name}` });
        return;
      }
      const filePath = path.resolve(brandAssetsRoot, name);
      if (!filePath.startsWith(brandAssetsRoot + path.sep) || !existsSync(filePath)) {
        sendJson(response, 404, { ok: false, error: `brand asset not found: ${name}` });
        return;
      }
      let icon: Buffer;
      try {
        icon = readFileSync(filePath);
      } catch {
        // existsSync 与 readFileSync 之间的 TOCTOU（文件被删/被锁）：按 404 处理。
        sendJson(response, 404, { ok: false, error: `brand asset not found: ${name}` });
        return;
      }
      response.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      });
      response.end(icon);
      return;
    }
    if (route === 'GET /api/snapshot') {
      const snapshot = collectBoardSnapshot({ eventLogs: [log], approvalRoot }) as unknown as Record<string, unknown>;
      // 契约 v1 扩展：dispatches 最近 20 条（G006 管线投影，只读）。
      snapshot.dispatches = dispatch.recent(20).map((record) => ({
        dispatch_id: record.dispatch_id,
        adapter_id: record.adapter_id,
        status: record.status,
        at_utc: record.events.length > 0 ? record.events[record.events.length - 1].at_utc : null,
        receipt_path: record.receipt_path,
      }));
      // G009 修复：在册犬只名册（派发合同表）——下拉取数源应为注册名册而非
      // 活动投影（actors 只在有 loop 事件流后才有值，冷启动必然为空）。
      snapshot.roster = dispatch.roster();
      sendJson(response, 200, snapshot);
      return;
    }
    if (route === 'POST /api/events') {
      guarded(response, () => handleEventPost(request, response));
      return;
    }
    if (route === 'POST /api/approvals/respond') {
      guarded(response, () => handleApprovalRespond(request, response));
      return;
    }
    if (route === 'POST /api/dispatch') {
      guarded(response, async () => {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        let record;
        try {
          record = await dispatch.dispatch(body);
        } catch (error) {
          if (error instanceof InputError) {
            sendJson(response, 400, { ok: false, error: error.message });
          } else {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        const status = record.admission?.decision === 'DENIED' ? 402 : 202;
        sendJson(response, status, {
          ok: true,
          dispatch_id: record.dispatch_id,
          status: record.status,
          admission: record.admission,
        });
      });
      return;
    }
    if (route === 'GET /api/carveout/active') {
      // GOAL-014（M0）：当前 ACTIVE carve-out（或 null）——前端顶部条带数据源。
      sendJson(response, 200, { ok: true, active: dispatch.activeCarveout() });
      return;
    }
    if (route === 'GET /api/carveouts') {
      // GOAL-034（GP-24）：所有切片历史与当前 ACTIVE 状态。
      sendJson(response, 200, { ok: true, ...dispatch.listCarveouts() });
      return;
    }
    if (route === 'POST /api/carveout/grant') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          // loopback（Host 白名单已在入口强制）+ 一次性 token / auth_key 握手。
          const authVal = typeof body.auth_key === 'string'
            ? body.auth_key
            : (typeof body.token === 'string' ? body.token : '');
          const carveout = dispatch.grantCarveout(body, authVal);
          sendJson(response, 201, { ok: true, carveout });
        } catch (error) {
          if (error instanceof CarveoutAuthError) sendJson(response, 403, { ok: false, error: error.message });
          else if (error instanceof InputError) sendJson(response, 400, { ok: false, error: error.message });
          else sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    if (route === 'POST /api/carveout/revoke') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const authVal = typeof body.auth_key === 'string'
            ? body.auth_key
            : (typeof body.token === 'string' ? body.token : '');
          const revoked = dispatch.revokeCarveout(
            typeof body.carveout_id === 'string' ? body.carveout_id : '',
            authVal,
          );
          sendJson(response, 200, { ok: true, carveout_id: revoked.carveout_id, status: revoked.status });
        } catch (error) {
          if (error instanceof CarveoutAuthError) sendJson(response, 403, { ok: false, error: error.message });
          else if (error instanceof InputError) {
            const status = /not found/.test(error.message) ? 404 : 400;
            sendJson(response, status, { ok: false, error: error.message });
          } else {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      });
      return;
    }
    const dispatchGet = /^\/api\/dispatch\/([0-9a-f]{32})$/.exec(url.pathname);
    if (request.method === 'GET' && dispatchGet !== null) {
      const record = dispatch.get(dispatchGet[1]);
      if (record === null) {
        sendJson(response, 404, { ok: false, error: `dispatch not found: ${dispatchGet[1]}` });
      } else {
        sendJson(response, 200, { ok: true, dispatch: record });
      }
      return;
    }
    const dispatchRerun = /^\/api\/dispatch\/([0-9a-f]{32})\/rerun$/.exec(url.pathname);
    if (request.method === 'POST' && dispatchRerun !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          const raw = await readBody(request);
          if (raw.trim() !== '') body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const original = dispatch.get(dispatchRerun[1]);
        if (original === null) {
          sendJson(response, 404, { ok: false, error: `dispatch not found: ${dispatchRerun[1]}` });
          return;
        }
        let record;
        try {
          record = await dispatch.rerun(dispatchRerun[1], body);
        } catch (error) {
          if (error instanceof InputError) {
            sendJson(response, 400, { ok: false, error: error.message });
          } else {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        const status = record.admission?.decision === 'DENIED' ? 402 : 202;
        sendJson(response, status, {
          ok: true,
          dispatch_id: record.dispatch_id,
          status: record.status,
          admission: record.admission,
        });
      });
      return;
    }
    if (route === 'POST /api/workspaces/browse-native') {
      guarded(response, async () => {
        if (process.platform !== 'win32') {
          sendJson(response, 200, { ok: false, error: 'Native folder dialog is currently only supported on Windows' });
          return;
        }
        try {
          const { execFile } = await import('node:child_process');
          const psScript = options.browseFolderScript
            ?? (existsSync(path.resolve('scripts/browse-folder.ps1'))
              ? path.resolve('scripts/browse-folder.ps1')
              : path.resolve(workspaceRoot, 'scripts/browse-folder.ps1'));
          const child = execFile('powershell', ['-NoProfile', '-STA', '-File', psScript], { timeout: 120000, encoding: 'utf8' }, (err, stdout) => {
            if (err) {
              sendJson(response, 200, { ok: false, error: err.message });
              return;
            }
            const selected = (stdout || '').replace(/^\uFEFF/, '').trim();
            if (!selected) {
              sendJson(response, 200, { ok: true, cancelled: true });
              return;
            }
            try {
              try {
                dispatch.createWorkspace(selected);
              } catch {
                // 目录已登记（already exists）或不可建——统一交由下方选中路径处理。
              }
              dispatch.selectWorkspace(selected);
              // GOAL-068 / B1 建完即切：原生目录选定即选中并热切换数据面上下文。
              activateWorkspaceContext(selected);
              sendJson(response, 200, { ok: true, path: selected, workspaces: dispatch.listWorkspaces() });
            } catch (regErr) {
              sendJson(response, 200, { ok: true, path: selected, warning: regErr instanceof Error ? regErr.message : String(regErr), workspaces: dispatch.listWorkspaces() });
            }
          });
          // 仅在客户端真正过早断开时收割子进程（response 未写完即关闭）。
          // 不可用 request 'close'：Node>=15 语义下报文收全即触发，会误杀正常弹窗。
          response.once('close', () => {
            if (!response.writableEnded && !child.killed) {
              try { child.kill(); } catch {}
            }
          });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }

    if (route === 'GET /api/workspaces/fs-tree') {
      try {
        const queryPath = url.searchParams.get('path');
        if (!queryPath || queryPath.trim() === '') {
          const drives: Array<{ name: string; path: string; isDir: boolean }> = [];
          if (process.platform === 'win32') {
            for (let i = 65; i <= 90; i++) {
              const d = String.fromCharCode(i) + ':\\';
              try {
                if (existsSync(d)) {
                  drives.push({ name: String.fromCharCode(i) + ':', path: d, isDir: true });
                }
              } catch {}
            }
          } else {
            drives.push({ name: '/', path: '/', isDir: true });
          }
          sendJson(response, 200, { ok: true, isRoot: true, drives, currentPath: '' });
          return;
        }

        const target = path.resolve(queryPath.trim());
        // GOAL-067（P1-9，owner 裁决 S5=A）：阻断 UNC 路径——恶意网页可借
        // <img>/<link> 对本端口发跨站 GET，path=\\evil.com\share 会让本进程
        // 主动发起 SMB 认证（Windows 凭据泄漏原语）。单机信任边界不含网络
        // 文件系统；本地盘符枚举保留。
        if (queryPath.trim().startsWith('\\\\') || target.startsWith('\\\\')) {
          sendJson(response, 400, { ok: false, error: 'UNC paths are not allowed (SMB probe guard, GOAL-067)' });
          return;
        }
        const parent = path.dirname(target);
        if (!existsSync(target)) {
          sendJson(response, 404, { ok: false, error: 'Directory not found: ' + target });
          return;
        }

        const stat = statSync(target);
        if (!stat.isDirectory()) {
          sendJson(response, 400, { ok: false, error: 'Path is not a directory: ' + target });
          return;
        }

        let entries: Array<import('node:fs').Dirent> = [];
        try {
          entries = readdirSync(target, { withFileTypes: true });
        } catch (readErr) {
          sendJson(response, 200, {
            ok: true,
            currentPath: target,
            parentPath: parent !== target ? parent : null,
            directories: [],
            warning: '目录访问受限或权限不足: ' + (readErr instanceof Error ? readErr.message : String(readErr)),
          });
          return;
        }

        const dirs = entries
          .filter((e) => {
            if (!e.isDirectory()) return false;
            const n = e.name;
            if (n.startsWith('$') || n === 'System Volume Information' || n === '.git' || n === 'node_modules') return false;
            return true;
          })
          .map((e) => ({ name: e.name, path: path.join(target, e.name), isDir: true }))
          .slice(0, 100);

        sendJson(response, 200, {
          ok: true,
          currentPath: target,
          parentPath: parent !== target ? parent : null,
          directories: dirs,
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (route === 'GET /api/workspaces') {
      sendJson(response, 200, { ok: true, workspaces: dispatch.listWorkspaces() });
      return;
    }
    // GOAL-067（F1 选 A / 契约 v1.42 兑现）：工犬子会话路由——此前前端调用
    // 而后端缺失，功能整体 404。
    if (route === 'GET /api/child-sessions') {
      sendJson(response, 200, { ok: true, sessions: childSessions.list(workspaceRoot) });
      return;
    }
    if (route === 'POST /api/child-sessions/chat') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) {
          sendJson(response, 400, { ok: false, error: 'session_id must match [A-Za-z0-9_-]{1,80}' });
          return;
        }
        if (prompt === '') {
          sendJson(response, 400, { ok: false, error: "field 'prompt' is required" });
          return;
        }
        let sess = childSessions.get(sessionId);
        if (!sess) {
          // 会话不存在：允许带 dog（+可选 goal_id）即时建档；dog 必须是合法
          // 犬名形态，防止任意字符串入库。
          const dog = typeof body.dog === 'string' ? body.dog.trim() : '';
          if (!/^[A-Za-z0-9_-]{1,32}$/.test(dog)) {
            sendJson(response, 404, { ok: false, error: `child session not found: ${sessionId}（请从犬头像抽屉打开以自动建档）` });
            return;
          }
          sess = childSessions.getOrCreate(
            dog,
            workspaceRoot,
            typeof body.goal_id === 'string' && body.goal_id.trim() !== '' ? body.goal_id.trim() : undefined,
          );
        }
        childSessions.recordTurn(sess.session_id);
        // 真实切流：复用 ChatService（owner 敲字即批准 originOwner，GP-32/D30
        // 与主聊天通道同语义）；adapter 校验失败同步转 400。
        try {
          // resume = 子会话 id：工犬对话历史落在同一命名空间，多轮上下文连续。
          const ack = await chat.post({ message: prompt, adapter_id: sess.dog, solo: true, resume: sess.session_id });
          sendJson(response, 202, {
            ok: true,
            accepted: true,
            session_id: ack.session_id,
            dispatch_id: ack.dispatch_id,
            reply: `[已受理] 派发单 ${ack.dispatch_id.slice(0, 8)} 已创建；执行结果经看板会话流实时推送。`,
          });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    // GOAL-067（F1 选 A / 契约 v1.41 兑现）：犬队医生——getHarnessDoctorReport
    // 此前已有完整实现与单测，但从未接线到 HTTP 层。
    if (route === 'GET /api/harness/doctor') {
      sendJson(response, 200, { ok: true, harnesses: getHarnessDoctorReport() });
      return;
    }
    if (route === 'POST /api/workspaces/select') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        if (typeof body.path !== 'string' || body.path.trim() === '') {
          sendJson(response, 400, { ok: false, error: "field 'path' is required" });
          return;
        }
        try {
          const selected = dispatch.selectWorkspace(body.path);
          // GOAL-068（多项目完全数据隔离）：选中即热切换整套数据面上下文——
          // 任务池/聊天/工犬会话/派发追踪全部落到目标工作区 runtime。
          activateWorkspaceContext(selected);
          sendJson(response, 201, { ok: true, selected });
        } catch (error) {
          if (error instanceof InputError) sendJson(response, 400, { ok: false, error: error.message });
          else sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    if (route === 'POST /api/workspaces/create') {
      // GP-02（契约 v1.2）：自主登记新建目录——mkdir recursive + 记入 known-workspaces。
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const workspace = dispatch.createWorkspace(body.path as string);
          sendJson(response, 201, { ok: true, workspace });
        } catch (error) {
          if (error instanceof InputError) {
            const status = /already exists/.test(error.message) ? 409 : 400;
            sendJson(response, status, { ok: false, error: error.message });
          } else {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      });
      return;
    }
    if (route === 'GET /api/budget/caps') {
      sendJson(response, 200, { ok: true, caps: dispatch.getBudgetCaps() });
      return;
    }
    const budgetCapPut = /^\/api\/budget\/caps\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && budgetCapPut !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const capUsd = body.cap_usd;
        try {
          const value = dispatch.setBudgetCap(decodeURIComponent(budgetCapPut[1]), Number(capUsd));
          sendJson(response, 200, { ok: true, actor_id: decodeURIComponent(budgetCapPut[1]), cap_usd: value });
        } catch (error) {
          if (error instanceof InputError) sendJson(response, 400, { ok: false, error: error.message });
          else sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    if (route === 'GET /api/budget') {
      sendJson(response, 200, { ok: true, ...dispatch.budgetProjection() });
      return;
    }
    if (route === 'GET /api/streams') {
      const liveStreams = dispatch.listStreams();
      const managedStreams = workstreams.list();
      sendJson(response, 200, { ok: true, streams: liveStreams, managed_streams: managedStreams });
      return;
    }
    if (route === 'POST /api/streams') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const title = typeof body.title === 'string' ? body.title : '';
          const description = typeof body.description === 'string' ? body.description : undefined;
          const parentStreamId = typeof body.parent_stream_id === 'string' ? body.parent_stream_id : undefined;
          const stream = workstreams.create({ title, description, parent_stream_id: parentStreamId });
          sendJson(response, 201, { ok: true, stream });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    const streamGet = /^\/api\/streams\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && streamGet !== null) {
      const streamId = streamGet[1];
      const live = dispatch.getStream(streamId);
      const managed = workstreams.get(streamId);
      if (live === null && managed === null) {
        sendJson(response, 404, { ok: false, error: `stream not found: ${streamId}` });
      } else {
        sendJson(response, 200, { ok: true, stream: live ?? managed, managed });
      }
      return;
    }
    const streamPatch = /^\/api\/streams\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && streamPatch !== null) {
      const streamId = streamPatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const updated = workstreams.update(streamId, {
            title: typeof body.title === 'string' ? body.title : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
            status: typeof body.status === 'string' ? (body.status as any) : undefined,
            handoff_block:
              typeof body.handoff_block === 'object' && body.handoff_block !== null
                ? (body.handoff_block as any)
                : undefined,
          });
          sendJson(response, 200, { ok: true, stream: updated });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    const streamForkPost = /^\/api\/streams\/([A-Za-z0-9_-]+)\/fork$/.exec(url.pathname);
    if (request.method === 'POST' && streamForkPost !== null) {
      const streamId = streamForkPost[1];
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const title = typeof body.title === 'string' ? body.title : '';
          const description = typeof body.description === 'string' ? body.description : undefined;
          const forked = workstreams.fork(streamId, { title, description });
          sendJson(response, 201, { ok: true, stream: forked });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    const streamHandoffPost = /^\/api\/streams\/([A-Za-z0-9_-]+)\/handoff$/.exec(url.pathname);
    if (request.method === 'POST' && streamHandoffPost !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const handoff = dispatch.addExternalHandoff(streamHandoffPost[1], {
            done: typeof body.done === 'string' ? body.done : undefined,
            decided: typeof body.decided === 'string' ? body.decided : undefined,
            files: typeof body.files === 'string' ? body.files : undefined,
            next: typeof body.next === 'string' ? body.next : undefined,
            open_issues: typeof body.open_issues === 'string' ? body.open_issues : undefined,
          });
          sendJson(response, 201, { ok: true, handoff });
        } catch (error) {
          if (error instanceof InputError) {
            const status = /not found/.test(error.message) ? 404 : 400;
            sendJson(response, status, { ok: false, error: error.message });
          } else {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      });
      return;
    }

    if (route === 'GET /api/tasks') {
      sendJson(response, 200, { ok: true, tasks: dispatch.listTasks() });
      return;
    }
    if (route === 'POST /api/tasks') {
      guarded(response, async () => {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const task = dispatch.createTask(body);
          try {
            recordActivity(runtimeRoot, translateTaskCreate(task));
          } catch (err) {
            console.warn('[activity] failed to record task create activity:', err);
          }
          sendJson(response, 201, { ok: true, task });
        } catch (error) {
          if (error instanceof InputError) sendJson(response, 400, { ok: false, error: error.message });
          else sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    const taskTransition = /^\/api\/tasks\/([A-Za-z0-9_-]+)\/transition$/.exec(url.pathname);
    if (request.method === 'POST' && taskTransition !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const task = dispatch.transitionTask(taskTransition[1], body.status);
          try {
            recordActivity(runtimeRoot, translateTaskTransition(task, '', String(body.status)));
          } catch (err) {
            console.warn('[activity] failed to record task transition activity:', err);
          }
          sendJson(response, 200, { ok: true, task });
        } catch (error) {
          if (error instanceof InputError) {
            const status = /not found/.test(error.message) ? 404 : 400;
            sendJson(response, status, { ok: false, error: error.message });
          } else {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      });
      return;
    }

    if (route === 'GET /api/activity') {
      const taskId = url.searchParams.get('task_id') ?? undefined;
      const goalId = url.searchParams.get('goal_id') ?? undefined;
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam !== null ? parseInt(limitParam, 10) : undefined;
      const activities = queryActivities(runtimeRoot, { task_id: taskId, goal_id: goalId, limit });
      sendJson(response, 200, { ok: true, activities });
      return;
    }

    if (route === 'GET /api/models/probe') {
      sendJson(response, 200, { ok: true, probes: dispatch.getLiveProbes() });
      return;
    }
    if (route === 'POST /api/models/probe') {
      guarded(response, async () => {
        let adapterId: string | undefined;
        try {
          const raw = await readBody(request);
          if (raw.trim()) {
            const body = JSON.parse(raw) as Record<string, unknown>;
            if (typeof body.adapter_id === 'string' && body.adapter_id.trim()) {
              adapterId = body.adapter_id.trim();
            }
          }
        } catch {}
        try {
          const probes = await dispatch.probeLiveModels(adapterId);
          sendJson(response, 200, { ok: true, probes });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }

    if (route === 'GET /api/usage') {
      try {
        // GOAL-069：移除 BoardServerOptions 上从未存在的 options.now 幻影属性。
        const usage = scanLocalHarnessUsage({ workspaceRoot: options.workspaceRoot });
        sendJson(response, 200, { ok: true, usage });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }



    if (route === 'GET /api/adapters') {
      sendJson(response, 200, { ok: true, adapters: dispatch.listAdapters() });
      return;
    }
    if (route === 'POST /api/adapters') {
      guarded(response, async () => {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const view = dispatch.upsertAdapter(body);
          sendJson(response, 201, { ok: true, adapter: view });
        } catch (error) {
          if (error instanceof InputError) sendJson(response, 400, { ok: false, error: error.message });
          else sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    const adapterDelete = /^\/api\/adapters\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'DELETE' && adapterDelete !== null) {
      try {
        dispatch.removeAdapter(adapterDelete[1]);
        sendJson(response, 200, { ok: true, adapter_id: adapterDelete[1], removed: true });
      } catch (error) {
        if (error instanceof InputError) {
          const status = /not found/.test(error.message) ? 404 : 400;
          sendJson(response, status, { ok: false, error: error.message });
        } else {
          sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return;
    }
    const attMatch = /^\/api\/attachments\/([A-Za-z0-9_.-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && attMatch !== null) {
      const filename = attMatch[1];
      const att = readAttachment(runtimeRoot, filename);
      if (!att) {
        sendJson(response, 404, { ok: false, error: 'attachment not found' });
        return;
      }
      const headers: Record<string, string | number> = {
        'Content-Type': att.mimeType,
        'Content-Length': att.buffer.length,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      };
      if (att.mimeType === 'image/svg+xml') {
        headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
        headers['Content-Disposition'] = 'inline; filename="' + filename.replace(/[^\w.-]/g, '') + '"';
      }
      response.writeHead(200, headers);
      response.end(att.buffer);
      return;
    }
    if (route === 'POST /api/chat') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          // GOAL-021 U1：异步受理——202 即返 {dispatch_id, session_id}；回复经
          // SSE chat 帧（/api/stream kind=chat）流式推送；会话 JSONL 语义不变。
          const result = await chat.post({
            message: typeof body.message === 'string' ? body.message : '',
            resume: typeof body.resume === 'string' ? body.resume : undefined,
            adapter_id: typeof body.adapter_id === 'string' ? body.adapter_id : undefined,
            effort: typeof body.effort === 'string' ? body.effort : undefined,
            attachments: Array.isArray(body.attachments) ? body.attachments as any : undefined,
            solo: body.solo === true,
          });
          sendJson(response, 202, { ok: true, ...result });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    // GOAL-032 (GP-19): 智能代码上下文自动装配接口
    if (route === 'POST /api/context/assemble') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          const knownWorkspaces = [workspaceRoot, ...dispatch.listWorkspaces().map((w) => w.path)];
          const ws = typeof body.workspace === 'string' ? path.resolve(body.workspace) : (dispatch.defaultWorkspace() || workspaceRoot);
          const isAllowedWs = knownWorkspaces.some((root) => ws === root || ws.startsWith(root + path.sep));
          if (!isAllowedWs) {
            sendJson(response, 403, { ok: false, error: 'Forbidden: workspace is not registered in allowlist' });
            return;
          }
          const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : [];
          if (files.length === 0) {
            sendJson(response, 400, { ok: false, error: 'files must be a non-empty array of file paths' });
            return;
          }
          for (const f of files) {
            const resolvedFile = path.isAbsolute(f) ? path.resolve(f) : path.resolve(ws, f);
            if (!resolvedFile.startsWith(ws + path.sep) && resolvedFile !== ws) {
              sendJson(response, 403, { ok: false, error: `Forbidden: target file is outside workspace: ${f}` });
              return;
            }
          }
          const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;
          const includeTests = typeof body.include_tests === 'boolean' ? body.include_tests : true;
          const maxDepth = typeof body.max_depth === 'number' ? body.max_depth : 2;

          const context = assembleContext({
            workspaceRoot: ws,
            targetFiles: files,
            maxTokensBudget: maxTokens,
            includeTests,
            maxDepth,
          });

          sendJson(response, 200, { ok: true, context });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    // GOAL-035 (GP-11): Git Diff 视觉审查与单文件回滚
    if (route === 'GET /api/diff') {
      const ws = dispatch.defaultWorkspace() ?? workspaceRoot;
      const diff = captureWorkspaceDiff(ws);
      sendJson(response, 200, { ok: true, workspace: ws, diff });
      return;
    }
    const dispatchDiffGet = /^\/api\/dispatch\/([A-Za-z0-9_-]+)\/diff$/.exec(url.pathname);
    if (request.method === 'GET' && dispatchDiffGet !== null) {
      const dispatchId = dispatchDiffGet[1];
      const record = dispatch.get(dispatchId);
      const ws = (record as any)?.request?.workspace_root ?? dispatch.defaultWorkspace() ?? workspaceRoot;
      const diff = captureWorkspaceDiff(ws);
      sendJson(response, 200, { ok: true, dispatch_id: dispatchId, workspace: ws, diff });
      return;
    }
    const dispatchRevertPost = /^\/api\/dispatch\/([A-Za-z0-9_-]+)\/revert$/.exec(url.pathname);
    if (request.method === 'POST' && dispatchRevertPost !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const filePath = typeof body.file === 'string' ? body.file : '';
        if (!filePath) {
          sendJson(response, 400, { ok: false, error: "field 'file' is required" });
          return;
        }
        const dispatchId = dispatchRevertPost[1];
        const record = dispatch.get(dispatchId);
        const ws = (record as any)?.request?.workspace_root ?? dispatch.defaultWorkspace() ?? workspaceRoot;
        const result = revertWorkspaceFile(ws, filePath);
        if (result.ok) {
          sendJson(response, 200, { ok: true, message: result.message });
        } else {
          sendJson(response, 400, { ok: false, error: result.message });
        }
      });
      return;
    }
    // GOAL-036 (D38-L2): Langfuse 式 Trace 步骤树与耗时瀑布
    if (route === 'GET /api/traces') {
      const traces = listDispatchTraces(runtimeRoot);
      sendJson(response, 200, { ok: true, traces });
      return;
    }
    const dispatchTraceGet = /^\/api\/dispatch\/([A-Za-z0-9_-]+)\/trace$/.exec(url.pathname);
    if (request.method === 'GET' && dispatchTraceGet !== null) {
      const dispatchId = dispatchTraceGet[1];
      let trace = loadDispatchTrace(runtimeRoot, dispatchId);
      if (!trace) {
        // 合成从 DispatchRecord 生成的 Trace 回退
        const record = dispatch.get(dispatchId);
        if (record) {
          const t = createDispatchTrace(dispatchId, record.adapter_id);
          let offsetMs = 0;
          for (let i = 0; i < record.events.length; i++) {
            const ev = record.events[i];
            const duration = 100;
            addTraceStep(t, {
              step_id: `step-${i + 1}`,
              name: (ev.phase || ev.kind || 'step').toLowerCase(),
              status: 'ok',
              start_ms: offsetMs,
              duration_ms: duration,
              summary: `${ev.phase || ev.kind} event recorded`,
            });
            offsetMs += duration;
          }
          trace = finishDispatchTrace(t);
        }
      }
      if (trace) {
        sendJson(response, 200, { ok: true, trace });
      } else {
        sendJson(response, 404, { ok: false, error: `trace not found for dispatch: ${dispatchId}` });
      }
      return;
    }
    // GOAL-037 (D37): 犬只直连会话控制台
    const dogSessionsGet = /^\/api\/dogs\/([A-Za-z0-9._-]+)\/sessions$/.exec(url.pathname);
    if (request.method === 'GET' && dogSessionsGet !== null) {
      const adapterId = dogSessionsGet[1];
      const sessions = directSessions.listSessions(adapterId);
      sendJson(response, 200, { ok: true, adapter_id: adapterId, sessions });
      return;
    }
    const dogSessionsPost = /^\/api\/dogs\/([A-Za-z0-9._-]+)\/sessions$/.exec(url.pathname);
    if (request.method === 'POST' && dogSessionsPost !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          const raw = await readBody(request);
          if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
        } catch {}
        const adapterId = dogSessionsPost[1];
        const modelId = typeof body.model_id === 'string' ? body.model_id : undefined;
        const session = directSessions.createSession(adapterId, modelId);
        sendJson(response, 201, { ok: true, session });
      });
      return;
    }
    const dogSessionResumePost = /^\/api\/dogs\/([A-Za-z0-9._-]+)\/sessions\/([A-Za-z0-9._-]+)\/resume$/.exec(url.pathname);
    if (request.method === 'POST' && dogSessionResumePost !== null) {
      const sessionId = dogSessionResumePost[2];
      try {
        const session = directSessions.resumeSession(sessionId);
        sendJson(response, 200, { ok: true, session });
      } catch (err) {
        sendJson(response, 404, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    const dogSessionMsgPost = /^\/api\/dogs\/([A-Za-z0-9._-]+)\/sessions\/([A-Za-z0-9._-]+)\/messages$/.exec(url.pathname);
    if (request.method === 'POST' && dogSessionMsgPost !== null) {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const sessionId = dogSessionMsgPost[2];
        const content = typeof body.content === 'string' ? body.content : '';
        const sender = body.sender === 'dog' ? 'dog' : 'human';
        if (!content) {
          sendJson(response, 400, { ok: false, error: "field 'content' is required" });
          return;
        }
        try {
          const message = directSessions.postMessage(sessionId, sender, content);
          sendJson(response, 201, { ok: true, message });
        } catch (err) {
          sendJson(response, 404, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const dogTranscriptGet = /^\/api\/dogs\/([A-Za-z0-9._-]+)\/transcript$/.exec(url.pathname);
    if (request.method === 'GET' && dogTranscriptGet !== null) {
      const adapterId = dogTranscriptGet[1];
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const messages = directSessions.getTranscript(adapterId, Number.isFinite(limit) ? limit : 50);
      sendJson(response, 200, { ok: true, adapter_id: adapterId, messages });
      return;
    }
    // GOAL-038 (GP-04): 上下文滚动蒸馏与记忆持久化
    if (route === 'GET /api/context/pressure') {
      const current = Number(url.searchParams.get('current') ?? '0');
      const max = Number(url.searchParams.get('max') ?? '200000');
      const sess = url.searchParams.get('session') ?? undefined;
      const status = evaluateContextPressure(current, max, sess);
      sendJson(response, 200, { ok: true, ...status });
      return;
    }
    if (route === 'GET /api/memories') {
      const memories = listMemories(runtimeRoot);
      sendJson(response, 200, { ok: true, memories });
      return;
    }
    const memoryGet = /^\/api\/memory\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && memoryGet !== null && memoryGet[1] !== 'search' && memoryGet[1] !== 'graph') {
      const sessionId = memoryGet[1];
      const mem = loadMemory(runtimeRoot, sessionId);
      if (mem) {
        sendJson(response, 200, { ok: true, memory: mem });
      } else {
        sendJson(response, 404, { ok: false, error: `memory not found for session: ${sessionId}` });
      }
      return;
    }
    if (route === 'POST /api/memory/distill') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
        if (!sessionId) {
          sendJson(response, 400, { ok: false, error: "field 'session_id' is required" });
          return;
        }
        // GOAL-067（P1-8）：session_id 白名单——session_id 会拼进落盘文件名
        // （memory-<id>.json），未消毒时 "../..\" 可在任意可写目录落文件。
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
          sendJson(response, 400, { ok: false, error: 'session_id must match [A-Za-z0-9_-]{1,64}' });
          return;
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        // GOAL-069：distillTranscript 仅两参——旧调用的第三参从未生效，删除。
        const memory = distillTranscript(sessionId, messages as Array<{ sender?: string; content?: string }>);
        saveMemory(runtimeRoot, memory);
        sendJson(response, 201, { ok: true, memory });
      });
      return;
    }
    // GOAL-039 (GP-07): 异构犬能力感知智能路由推荐
    if (route === 'POST /api/route/recommend') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          const raw = await readBody(request);
          if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const files = Array.isArray(body.files) ? (body.files.filter((f) => typeof f === 'string') as string[]) : [];
        const taskProfile = classifyTaskPrompt(prompt, files);
        const recommendations = recommendDogs(taskProfile);
        sendJson(response, 200, { ok: true, task_profile: taskProfile, recommendations });
      });
      return;
    }
    // GOAL-040 (GP-01): 跨 Harness 影子分流评测台
    if (route === 'GET /api/evaluations') {
      const evals = listShadowEvaluations(runtimeRoot);
      sendJson(response, 200, { ok: true, evaluations: evals });
      return;
    }
    const evalGet = /^\/api\/evaluations\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && evalGet !== null) {
      const evalId = evalGet[1];
      const evaluation = loadShadowEvaluation(runtimeRoot, evalId);
      if (evaluation) {
        sendJson(response, 200, { ok: true, evaluation });
      } else {
        sendJson(response, 404, { ok: false, error: `evaluation not found: ${evalId}` });
      }
      return;
    }
    if (route === 'POST /api/evaluations') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        if (!prompt) {
          sendJson(response, 400, { ok: false, error: "field 'prompt' is required" });
          return;
        }
        const adapters = Array.isArray(body.adapters)
          ? (body.adapters.filter((a) => typeof a === 'string') as string[])
          : ['claude-code', 'agy'];
        const evaluation = createShadowEvaluation(prompt, adapters);
        if (Array.isArray(body.candidates)) {
          evaluation.candidates = body.candidates as any;
          generateShadowReport(evaluation);
        }
        saveShadowEvaluation(runtimeRoot, evaluation);
        sendJson(response, 201, { ok: true, evaluation });
      });
      return;
    }
    // GOAL-041 (GP-15): 看板审计日志归档导出
    if (route === 'GET /api/audit/exports') {
      const reports = listAuditReports(runtimeRoot);
      sendJson(response, 200, { ok: true, reports });
      return;
    }
    const auditExportGet = /^\/api\/audit\/exports\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && auditExportGet !== null) {
      const fileName = auditExportGet[1];
      if (fileName === '.' || fileName === '..' || !fileName.endsWith('.md')) {
        sendJson(response, 400, { ok: false, error: 'invalid export filename' });
        return;
      }
      const filePath = path.join(runtimeRoot, 'exports', fileName);
      try {
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const content = readFileSync(filePath, 'utf-8');
          sendJson(response, 200, { ok: true, file_name: fileName, markdown_content: content });
        } else {
          sendJson(response, 404, { ok: false, error: `audit report not found: ${fileName}` });
        }
      } catch {
        sendJson(response, 500, { ok: false, error: 'failed to read export file' });
      }
      return;
    }
    if (route === 'POST /api/audit/export') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          const raw = await readBody(request);
          if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        // GOAL-067：非法 time_range 由 generateAuditReport 归一为 'all'（不再直透任意字符串）。
        const rawRange = body.time_range;
        const timeRange =
          rawRange === 'today' || rawRange === 'week' || rawRange === 'all' ? rawRange : undefined;
        const report = generateAuditReport({
          runtime_root: runtimeRoot,
          approval_root: approvalRoot,
          time_range: timeRange,
        });
        saveAuditReport(runtimeRoot, report);
        sendJson(response, 201, { ok: true, report });
      });
      return;
    }
    // GOAL-042 (Phase C): 符号化记忆图谱与跨犬直连协作协议
    if (route === 'GET /api/memory/graph') {
      sendJson(response, 200, {
        ok: true,
        nodes: Array.from(memoryGraph.nodes.values()),
        edges: memoryGraph.edges,
      });
      return;
    }
    if (route === 'GET /api/memory/search') {
      const tag = url.searchParams.get('tag');
      const file = url.searchParams.get('file');
      let matches: unknown[] = [];
      if (tag) matches = memoryGraph.queryByTags([tag]);
      else if (file) matches = memoryGraph.queryByFile(file);
      else matches = Array.from(memoryGraph.nodes.values()).slice(0, 20);
      sendJson(response, 200, { ok: true, matches });
      return;
    }
    if (route === 'POST /api/memory/nodes') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const type = (body.type as any) || 'decision';
        const content = typeof body.content === 'string' ? body.content : '';
        if (!content) {
          sendJson(response, 400, { ok: false, error: "field 'content' is required" });
          return;
        }
        const tags = Array.isArray(body.tags) ? (body.tags.filter((t) => typeof t === 'string') as string[]) : [];
        const sourceSessionId = typeof body.source_session_id === 'string' ? body.source_session_id : undefined;
        const node = memoryGraph.addNode({ type, content, tags, source_session_id: sourceSessionId });
        sendJson(response, 201, { ok: true, node });
      });
      return;
    }
    if (route === 'POST /api/memory/edges') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const from = typeof body.from === 'string' ? body.from : '';
        const to = typeof body.to === 'string' ? body.to : '';
        const relation = (body.relation as any) || 'relates_to';
        if (!from || !to) {
          sendJson(response, 400, { ok: false, error: "fields 'from' and 'to' are required" });
          return;
        }
        try {
          const edge = memoryGraph.addEdge(from, to, relation);
          sendJson(response, 201, { ok: true, edge });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (route === 'POST /api/collaboration/messages') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const sender = typeof body.sender === 'string' ? body.sender : '';
        const receiver = typeof body.receiver === 'string' ? body.receiver : '';
        const payloadType = (body.payload_type as any) || 'artifact';
        const payload = body.payload;
        if (!sender || !receiver) {
          sendJson(response, 400, { ok: false, error: "fields 'sender' and 'receiver' are required" });
          return;
        }
        const msg = collaborationHub.sendDirectMessage({ sender, receiver, payload_type: payloadType, payload });
        sendJson(response, 201, { ok: true, message: msg });
      });
      return;
    }
    const mailboxGet = /^\/api\/collaboration\/mailbox\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && mailboxGet !== null) {
      const adapterId = mailboxGet[1];
      const messages = collaborationHub.getMailbox(adapterId);
      sendJson(response, 200, { ok: true, adapter_id: adapterId, messages });
      return;
    }
    if (route === 'POST /api/collaboration/plan') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const taskId = typeof body.task_id === 'string' ? body.task_id : '';
        const stages = Array.isArray(body.stages) ? (body.stages as any[]) : [];
        if (!taskId || stages.length === 0) {
          sendJson(response, 400, { ok: false, error: "fields 'task_id' and 'stages' are required" });
          return;
        }
        const dag = collaborationHub.createCollaborationDAG(taskId, stages);
        sendJson(response, 201, { ok: true, dag });
      });
      return;
    }
    if (route === 'POST /api/collaboration/advance') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const taskId = typeof body.task_id === 'string' ? body.task_id : '';
        const stageId = typeof body.stage_id === 'string' ? body.stage_id : '';
        if (!taskId || !stageId) {
          sendJson(response, 400, { ok: false, error: "fields 'task_id' and 'stage_id' are required" });
          return;
        }
        try {
          const unblocked = collaborationHub.advanceDAG(taskId, stageId, body.output);
          const dag = collaborationHub.getDAGStatus(taskId);
          sendJson(response, 200, { ok: true, unblocked_stages: unblocked, dag });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const dagStatusGet = /^\/api\/collaboration\/([A-Za-z0-9._-]+)\/status$/.exec(url.pathname);
    if (request.method === 'GET' && dagStatusGet !== null) {
      const taskId = dagStatusGet[1];
      const dag = collaborationHub.getDAGStatus(taskId);
      if (dag) {
        sendJson(response, 200, { ok: true, dag });
      } else {
        sendJson(response, 404, { ok: false, error: `DAG not found for task: ${taskId}` });
      }
      return;
    }
    // GOAL-043: 协作模式推荐与派发总线
    if (route === 'POST /api/collaboration/recommend-pair') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          body = {};
        }
        const topic = typeof body.topic === 'string' ? body.topic : '';
        const mode = (typeof body.mode === 'string' ? body.mode : 'debate') as CollaborationMode;
        const pair = recommendCollaborationPair(topic, mode);
        sendJson(response, 200, { ok: true, ...pair });
      });
      return;
    }
    if (route === 'POST /api/collaboration/dispatch') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const topic = typeof body.topic === 'string' ? body.topic : '';
        const mode = (typeof body.mode === 'string' ? body.mode : 'free') as CollaborationMode;
        if (!topic) {
          sendJson(response, 400, { ok: false, error: "field 'topic' is required" });
          return;
        }
        const packet = buildCollaborationPacket({
          topic,
          mode,
          workspaceRoot,
          primaryDog: typeof body.primary_dog === 'string' ? body.primary_dog : undefined,
          opposingDog: typeof body.opposing_dog === 'string' ? body.opposing_dog : undefined,
          maxBudgetUsd: typeof body.max_budget_usd === 'number' ? body.max_budget_usd : undefined,
        });
        broadcast({ type: 'collaboration_dispatched', packet });
        sendJson(response, 200, { ok: true, packet });
      });
      return;
    }

    // GOAL-044: 圆桌辩论工作台与仲裁
    if (route === 'POST /api/debates') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const topic = typeof body.topic === 'string' ? body.topic : '';
        const proDog = typeof body.pro_dog === 'string' ? body.pro_dog : 'claude-code';
        const conDog = typeof body.con_dog === 'string' ? body.con_dog : 'deepseek-chat';
        if (!topic) {
          sendJson(response, 400, { ok: false, error: "field 'topic' is required" });
          return;
        }
        const debate = debateEngine.createDebate({
          topic,
          proDog,
          conDog,
          workspaceRoot,
        });
        broadcast({ type: 'debate_created', debate_id: debate.debate_id, topic: debate.topic });
        sendJson(response, 200, { ok: true, debate });
      });
      return;
    }
    if (route === 'GET /api/debates') {
      const debates = debateEngine.listDebates();
      sendJson(response, 200, { ok: true, debates, total: debates.length });
      return;
    }
    const debateGetMatch = /^\/api\/debates\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && debateGetMatch !== null) {
      const debateId = debateGetMatch[1];
      const debate = debateEngine.getDebate(debateId);
      if (debate) {
        sendJson(response, 200, { ok: true, debate });
      } else {
        sendJson(response, 404, { ok: false, error: `Debate session not found: ${debateId}` });
      }
      return;
    }
    const debateTurnPostMatch = /^\/api\/debates\/([A-Za-z0-9._-]+)\/turn$/.exec(url.pathname);
    if (request.method === 'POST' && debateTurnPostMatch !== null) {
      const debateId = debateTurnPostMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        try {
          const round = typeof body.round === 'number' ? body.round : 1;
          const phase = (typeof body.phase === 'string' ? body.phase : 'PROPOSE') as any;
          const dogId = typeof body.dog_id === 'string' ? body.dog_id : 'claude-code';
          const role = (typeof body.role === 'string' ? body.role : 'PRO') as 'PRO' | 'CON';
          const title = typeof body.title === 'string' ? body.title : '';
          const content = typeof body.content === 'string' ? body.content : '';
          const session = debateEngine.addTurn(debateId, {
            round,
            phase,
            dog_id: dogId,
            role,
            title,
            content,
          });
          broadcast({ type: 'debate_turn_added', debate_id: debateId, round, phase, dog_id: dogId });
          sendJson(response, 200, { ok: true, debate: session });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const debateArbitratePostMatch = /^\/api\/debates\/([A-Za-z0-9._-]+)\/arbitrate$/.exec(url.pathname);
    if (request.method === 'POST' && debateArbitratePostMatch !== null) {
      const debateId = debateArbitratePostMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        try {
          const chosenPlan = (typeof body.chosen_plan === 'string' ? body.chosen_plan : 'PRO') as 'PRO' | 'CON' | 'MERGED';
          const notes = typeof body.notes === 'string' ? body.notes : '';
          const session = debateEngine.arbitrateDebate(debateId, chosenPlan, notes);
          broadcast({ type: 'debate_settled', debate_id: debateId, chosen_plan: chosenPlan });
          sendJson(response, 200, { ok: true, debate: session });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-045: SOP 工序流水线与工件自动接力
    if (route === 'POST /api/pipelines') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const taskTitle = typeof body.task_title === 'string' ? body.task_title : '';
        const initialPrompt = typeof body.initial_prompt === 'string' ? body.initial_prompt : '';
        if (!taskTitle) {
          sendJson(response, 400, { ok: false, error: "field 'task_title' is required" });
          return;
        }
        const pipeline = pipelineEngine.createPipeline({
          taskTitle,
          initialPrompt: initialPrompt || taskTitle,
          workspaceRoot,
          maxBudgetUsd: typeof body.max_budget_usd === 'number' ? body.max_budget_usd : undefined,
          dogMapping: typeof body.dog_mapping === 'object' && body.dog_mapping !== null ? (body.dog_mapping as any) : undefined,
          gateRules: typeof body.gate_rules === 'object' && body.gate_rules !== null ? (body.gate_rules as any) : undefined,
        });
        broadcast({ type: 'pipeline_created', pipeline_id: pipeline.pipeline_id, task_title: pipeline.task_title });
        sendJson(response, 200, { ok: true, pipeline });
      });
      return;
    }
    if (route === 'GET /api/pipelines') {
      const pipelines = pipelineEngine.listPipelines();
      sendJson(response, 200, { ok: true, pipelines, total: pipelines.length });
      return;
    }
    const pipelineGetMatch = /^\/api\/pipelines\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && pipelineGetMatch !== null) {
      const pipelineId = pipelineGetMatch[1];
      const pipeline = pipelineEngine.getPipeline(pipelineId);
      if (pipeline) {
        sendJson(response, 200, { ok: true, pipeline });
      } else {
        sendJson(response, 404, { ok: false, error: `Pipeline not found: ${pipelineId}` });
      }
      return;
    }
    const pipelineStageCompleteMatch = /^\/api\/pipelines\/([A-Za-z0-9._-]+)\/stage\/([A-Za-z0-9._-]+)\/complete$/.exec(url.pathname);
    if (request.method === 'POST' && pipelineStageCompleteMatch !== null) {
      const pipelineId = pipelineStageCompleteMatch[1];
      const stageId = pipelineStageCompleteMatch[2];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        try {
          const artifact = typeof body.artifact === 'object' && body.artifact !== null
            ? (body.artifact as any)
            : { summary: typeof body.summary === 'string' ? body.summary : '完成工步', content: typeof body.content === 'string' ? body.content : '' };
          const costUsd = typeof body.cost_usd === 'number' ? body.cost_usd : undefined;
          const notes = typeof body.notes === 'string' ? body.notes : undefined;
          const session = pipelineEngine.completeStage(pipelineId, stageId, artifact, { costUsd, notes });
          broadcast({ type: 'pipeline_stage_completed', pipeline_id: pipelineId, stage_id: stageId, status: session.status });
          sendJson(response, 200, { ok: true, pipeline: session });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const pipelineStageApproveMatch = /^\/api\/pipelines\/([A-Za-z0-9._-]+)\/stage\/([A-Za-z0-9._-]+)\/approve$/.exec(url.pathname);
    if (request.method === 'POST' && pipelineStageApproveMatch !== null) {
      const pipelineId = pipelineStageApproveMatch[1];
      const stageId = pipelineStageApproveMatch[2];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          body = {};
        }
        try {
          const notes = typeof body.notes === 'string' ? body.notes : undefined;
          const session = pipelineEngine.approveGate(pipelineId, stageId, notes);
          broadcast({ type: 'pipeline_gate_approved', pipeline_id: pipelineId, stage_id: stageId, status: session.status });
          sendJson(response, 200, { ok: true, pipeline: session });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-046: 红蓝对抗验证室与闭环自动打回流
    if (route === 'POST /api/verify/red-blue') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const taskTitle = typeof body.task_title === 'string' ? body.task_title : '';
        const generatorDog = typeof body.generator_dog === 'string' ? body.generator_dog : 'agy';
        const verifierDog = typeof body.verifier_dog === 'string' ? body.verifier_dog : 'deepseek-code';
        const initialCode = typeof body.initial_code === 'object' && body.initial_code !== null
          ? (body.initial_code as any)
          : { summary: '初始实现代码', code: typeof body.code === 'string' ? body.code : '' };
        if (!taskTitle) {
          sendJson(response, 400, { ok: false, error: "field 'task_title' is required" });
          return;
        }
        try {
          const session = verifierLoopEngine.createSession({
            taskTitle,
            workspaceRoot,
            generatorDog,
            verifierDog,
            initialCode,
            maxRetries: typeof body.max_retries === 'number' ? body.max_retries : undefined,
          });
          broadcast({ type: 'redblue_session_created', session_id: session.session_id, task_title: session.task_title });
          sendJson(response, 200, { ok: true, session });
        } catch (err) {
          const statusCode = err instanceof VerifierDecouplingError ? 400 : 500;
          sendJson(response, statusCode, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (route === 'GET /api/verify/red-blue') {
      const sessions = verifierLoopEngine.listSessions();
      sendJson(response, 200, { ok: true, sessions, total: sessions.length });
      return;
    }
    const redblueGetMatch = /^\/api\/verify\/red-blue\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && redblueGetMatch !== null) {
      const sessionId = redblueGetMatch[1];
      const session = verifierLoopEngine.getSession(sessionId);
      if (session) {
        sendJson(response, 200, { ok: true, session });
      } else {
        sendJson(response, 404, { ok: false, error: `Verification session not found: ${sessionId}` });
      }
      return;
    }
    const redblueAttackMatch = /^\/api\/verify\/red-blue\/([A-Za-z0-9._-]+)\/attack$/.exec(url.pathname);
    if (request.method === 'POST' && redblueAttackMatch !== null) {
      const sessionId = redblueAttackMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        try {
          const redCases = Array.isArray(body.red_cases) ? (body.red_cases as any) : [];
          const passed = Boolean(body.passed);
          const failedTests = Array.isArray(body.failed_tests) ? (body.failed_tests as any) : undefined;
          const feedback = typeof body.feedback === 'string' ? body.feedback : undefined;
          const session = verifierLoopEngine.submitAttackRound(sessionId, {
            redCases,
            passed,
            failedTests,
            feedback,
          });
          broadcast({ type: 'redblue_attack_submitted', session_id: sessionId, round: session.current_round, status: session.status });
          sendJson(response, 200, { ok: true, session });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const redblueCorrectMatch = /^\/api\/verify\/red-blue\/([A-Za-z0-9._-]+)\/correct$/.exec(url.pathname);
    if (request.method === 'POST' && redblueCorrectMatch !== null) {
      const sessionId = redblueCorrectMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        try {
          const codeArtifact = typeof body.code_artifact === 'object' && body.code_artifact !== null
            ? (body.code_artifact as any)
            : { summary: '蓝方修正代码', code: typeof body.code === 'string' ? body.code : '' };
          const session = verifierLoopEngine.submitBlueCorrection(sessionId, { codeArtifact });
          broadcast({ type: 'redblue_correction_submitted', session_id: sessionId, round: session.current_round });
          sendJson(response, 200, { ok: true, session });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-047: Contract Net 悬赏招投标市场
    if (route === 'POST /api/bounties') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const title = typeof body.title === 'string' ? body.title : '';
        const description = typeof body.description === 'string' ? body.description : '';
        const maxCapUsd = typeof body.max_cap_usd === 'number' ? body.max_cap_usd : (typeof body.maxCapUsd === 'number' ? body.maxCapUsd : 1.0);
        const tags = Array.isArray(body.tags) ? (body.tags as string[]) : ['feature'];
        const deadlineSeconds = typeof body.deadline_seconds === 'number' ? body.deadline_seconds : undefined;
        if (!title) {
          sendJson(response, 400, { ok: false, error: "field 'title' is required" });
          return;
        }
        try {
          const bounty = bountyMarketEngine.createBounty({
            title,
            description,
            tags,
            maxCapUsd,
            deadlineSeconds,
          });
          broadcast({ type: 'bounty_created', bounty_id: bounty.bounty_id, title: bounty.title });
          sendJson(response, 200, { ok: true, bounty });
        } catch (err) {
          sendJson(response, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (route === 'GET /api/bounties') {
      const status = typeof url.searchParams.get('status') === 'string' ? (url.searchParams.get('status') as any) : undefined;
      const bounties = bountyMarketEngine.listBounties(status);
      sendJson(response, 200, { ok: true, bounties, total: bounties.length });
      return;
    }
    const bountyGetMatch = /^\/api\/bounties\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && bountyGetMatch !== null) {
      const bountyId = bountyGetMatch[1];
      const bounty = bountyMarketEngine.getBounty(bountyId);
      if (bounty) {
        sendJson(response, 200, { ok: true, bounty });
      } else {
        sendJson(response, 404, { ok: false, error: `Bounty not found: ${bountyId}` });
      }
      return;
    }
    const bountyBidsMatch = /^\/api\/bounties\/([A-Za-z0-9._-]+)\/bids$/.exec(url.pathname);
    if (request.method === 'POST' && bountyBidsMatch !== null) {
      const bountyId = bountyBidsMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        try {
          const adapterId = typeof body.adapter_id === 'string' ? body.adapter_id : 'agy';
          const estimatedCostUsd = typeof body.estimated_cost_usd === 'number' ? body.estimated_cost_usd : 0.5;
          const estimatedTimeMs = typeof body.estimated_time_ms === 'number' ? body.estimated_time_ms : 60000;
          const confidenceScore = typeof body.confidence_score === 'number' ? body.confidence_score : 0.9;
          const bidRationale = typeof body.bid_rationale === 'string' ? body.bid_rationale : '自主竞标';
          const bid = bountyMarketEngine.submitBid(bountyId, {
            adapter_id: adapterId,
            estimated_cost_usd: estimatedCostUsd,
            estimated_time_ms: estimatedTimeMs,
            confidence_score: confidenceScore,
            bid_rationale: bidRationale,
          });
          broadcast({ type: 'bounty_bid_submitted', bounty_id: bountyId, bid_id: bid.bid_id, adapter_id: adapterId });
          sendJson(response, 200, { ok: true, bid });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const bountyAutoBidMatch = /^\/api\/bounties\/([A-Za-z0-9._-]+)\/auto-bid$/.exec(url.pathname);
    if (request.method === 'POST' && bountyAutoBidMatch !== null) {
      const bountyId = bountyAutoBidMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          body = {};
        }
        try {
          const roster = Array.isArray(body.roster) ? (body.roster as string[]) : undefined;
          const bids = bountyMarketEngine.collectAutomaticBids(bountyId, roster);
          broadcast({ type: 'bounty_auto_bids_collected', bounty_id: bountyId, count: bids.length });
          sendJson(response, 200, { ok: true, bids, count: bids.length });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const bountyAwardMatch = /^\/api\/bounties\/([A-Za-z0-9._-]+)\/award$/.exec(url.pathname);
    if (request.method === 'POST' && bountyAwardMatch !== null) {
      const bountyId = bountyAwardMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          body = {};
        }
        try {
          const bidId = typeof body.bid_id === 'string' ? body.bid_id : undefined;
          const bounty = bountyMarketEngine.awardBounty(bountyId, bidId);
          broadcast({ type: 'bounty_awarded', bounty_id: bountyId, awarded_bid: bounty.awarded_bid });
          sendJson(response, 200, { ok: true, bounty });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const bountySettleMatch = /^\/api\/bounties\/([A-Za-z0-9._-]+)\/settle$/.exec(url.pathname);
    if (request.method === 'POST' && bountySettleMatch !== null) {
      const bountyId = bountySettleMatch[1];
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          body = {};
        }
        try {
          const summary = typeof body.summary === 'string' ? body.summary : '悬赏任务履约完成';
          const bounty = bountyMarketEngine.settleBounty(bountyId, summary);
          broadcast({ type: 'bounty_settled', bounty_id: bountyId, summary: bounty.settlement_summary });
          sendJson(response, 200, { ok: true, bounty });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-048: 跨 Harness 技能联邦与双向转译
    if (route === 'GET /api/skills') {
      const skills = skillsFederationEngine.listSkills();
      const mounted = skillsFederationEngine.listMountedDirectories();
      sendJson(response, 200, { ok: true, skills, total: skills.length, mounted_directories: mounted });
      return;
    }
    const skillTranspileMatch = /^\/api\/skills\/([A-Za-z0-9._-]+)\/transpile$/.exec(url.pathname);
    if (request.method === 'GET' && skillTranspileMatch !== null) {
      const skillName = skillTranspileMatch[1];
      const targetHarness = (url.searchParams.get('target') || 'agy') as any;
      const transpiled = skillsFederationEngine.getSkillForHarness(skillName, targetHarness);
      if (transpiled !== undefined) {
        sendJson(response, 200, { ok: true, name: skillName, target_harness: targetHarness, content: transpiled });
      } else {
        sendJson(response, 404, { ok: false, error: `Skill not found: ${skillName}` });
      }
      return;
    }
    const skillGetMatch = /^\/api\/skills\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && skillGetMatch !== null) {
      const skillName = skillGetMatch[1];
      const skill = skillsFederationEngine.getSkill(skillName);
      if (skill) {
        sendJson(response, 200, { ok: true, skill });
      } else {
        sendJson(response, 404, { ok: false, error: `Skill not found: ${skillName}` });
      }
      return;
    }
    if (route === 'POST /api/skills/mount') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const dirPath = typeof body.path === 'string' ? body.path : '';
        if (!dirPath) {
          sendJson(response, 400, { ok: false, error: "field 'path' is required" });
          return;
        }
        const res = skillsFederationEngine.mountDirectory(dirPath);
        broadcast({ type: 'skills_directory_mounted', path: dirPath, count: res.count });
        sendJson(response, 200, { ok: true, ...res });
      });
      return;
    }
    if (route === 'POST /api/skills/unmount') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const dirPath = typeof body.path === 'string' ? body.path : '';
        if (!dirPath) {
          sendJson(response, 400, { ok: false, error: "field 'path' is required" });
          return;
        }
        const success = skillsFederationEngine.unmountDirectory(dirPath);
        sendJson(response, 200, { ok: true, unmounted: success });
      });
      return;
    }

    // GOAL-049: 时空状态树与因果时间旅行快照
    if (route === 'GET /api/time-travel/tree') {
      const tree = timeTravelKernel.getTree();
      sendJson(response, 200, { ok: true, ...tree, total_nodes: tree.nodes.length });
      return;
    }
    const timeTravelNodeMatch = /^\/api\/time-travel\/nodes\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && timeTravelNodeMatch !== null) {
      const nodeId = timeTravelNodeMatch[1];
      const node = timeTravelKernel.getNode(nodeId);
      if (node) {
        sendJson(response, 200, { ok: true, node });
      } else {
        sendJson(response, 404, { ok: false, error: `State node not found: ${nodeId}` });
      }
      return;
    }
    if (route === 'POST /api/time-travel/snapshot') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const reason = typeof body.reason === 'string' ? body.reason : '手动创建快照';
        const files = Array.isArray(body.files) ? (body.files as string[]) : [];
        const branchName = typeof body.branch_name === 'string' ? body.branch_name : 'main';
        const parentId = typeof body.parent_id === 'string' ? body.parent_id : undefined;
        try {
          const node = timeTravelKernel.createSnapshot(reason, files, branchName, parentId);
          broadcast({ type: 'time_travel_snapshot_created', node_id: node.node_id, branch: node.branch_name, reason: node.reason });
          sendJson(response, 200, { ok: true, node });
        } catch (err) {
          sendJson(response, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (route === 'POST /api/time-travel/fork') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const fromNodeId = typeof body.from_node_id === 'string' ? body.from_node_id : '';
        const branchName = typeof body.branch_name === 'string' ? body.branch_name : '';
        const reason = typeof body.reason === 'string' ? body.reason : '派生平行分支';
        if (!fromNodeId || !branchName) {
          sendJson(response, 400, { ok: false, error: "fields 'from_node_id' and 'branch_name' are required" });
          return;
        }
        try {
          const forkedNode = timeTravelKernel.forkBranch(fromNodeId, branchName, reason);
          broadcast({ type: 'time_travel_branch_forked', node_id: forkedNode.node_id, branch: branchName, parent: fromNodeId });
          sendJson(response, 200, { ok: true, node: forkedNode });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (route === 'POST /api/time-travel/revert') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const nodeId = typeof body.node_id === 'string' ? body.node_id : '';
        if (!nodeId) {
          sendJson(response, 400, { ok: false, error: "field 'node_id' is required" });
          return;
        }
        try {
          const result = timeTravelKernel.travelToNode(nodeId);
          broadcast({ type: 'time_travel_reverted', node_id: nodeId, restored_files_count: result.restored_files_count });
          // GOAL-069：result 自带 ok 字段，不再重复指定。
          sendJson(response, 200, { ...result });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-050: 跨犬共享黑板协作空间与读写白名单仲裁
    if (route === 'GET /api/blackboard') {
      const allSections = blackboardEngine.getAllItems();
      sendJson(response, 200, { ok: true, sections: allSections });
      return;
    }
    const bbSectionMatch = /^\/api\/blackboard\/(artifacts|issues|hypotheses|decisions)$/.exec(url.pathname);
    if (request.method === 'GET' && bbSectionMatch !== null) {
      const section = bbSectionMatch[1] as BlackboardSection;
      const items = blackboardEngine.getSectionItems(section);
      sendJson(response, 200, { ok: true, section, items, count: items.length });
      return;
    }
    const bbItemMatch = /^\/api\/blackboard\/items\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && bbItemMatch !== null) {
      const itemId = bbItemMatch[1];
      const item = blackboardEngine.getItem(itemId);
      if (item) {
        sendJson(response, 200, { ok: true, item });
      } else {
        sendJson(response, 404, { ok: false, error: `Blackboard item not found: ${itemId}` });
      }
      return;
    }
    if (route === 'POST /api/blackboard') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const authorDog = typeof body.author_dog === 'string' ? body.author_dog : 'unknown';
        const section = typeof body.section === 'string' ? (body.section as BlackboardSection) : 'artifacts';
        const title = typeof body.title === 'string' ? body.title : '';
        const content = typeof body.content === 'string' ? body.content : '';
        const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];
        const metadata = (typeof body.metadata === 'object' && body.metadata !== null) ? (body.metadata as Record<string, unknown>) : undefined;

        if (!title || !content) {
          sendJson(response, 400, { ok: false, error: "fields 'title' and 'content' are required" });
          return;
        }

        try {
          const item = blackboardEngine.writeItem(authorDog, section, title, content, tags, metadata);
          broadcast({ type: 'blackboard_item_written', item_id: item.id, section: item.section, author: item.author_dog, version: item.version });
          sendJson(response, 200, { ok: true, item });
        } catch (err) {
          if (err instanceof BlackboardAclError) {
            sendJson(response, 403, { ok: false, error: err.message });
          } else {
            sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
      });
      return;
    }

    // GOAL-051: 液态临时战时攻关小队与指挥犬选举
    if (route === 'GET /api/squads') {
      const status = url.searchParams.get('status') as SquadStatus | null;
      const squads = liquidSquadEngine.listSquads(status || undefined);
      sendJson(response, 200, { ok: true, squads, count: squads.length });
      return;
    }
    const squadDisbandMatch = /^\/api\/squads\/([A-Za-z0-9._-]+)\/disband$/.exec(url.pathname);
    if (request.method === 'POST' && squadDisbandMatch !== null) {
      guarded(response, async () => {
        const squadId = squadDisbandMatch[1];
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          body = {};
        }
        const summary = typeof body.summary === 'string' ? body.summary : '任务攻坚完成，小队正常解散';
        try {
          const squad = liquidSquadEngine.disbandSquad(squadId, summary);
          broadcast({ type: 'liquid_squad_disbanded', squad_id: squadId, summary: squad.summary });
          sendJson(response, 200, { ok: true, squad });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    const squadGetMatch = /^\/api\/squads\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && squadGetMatch !== null) {
      const squadId = squadGetMatch[1];
      const squad = liquidSquadEngine.getSquad(squadId);
      if (squad) {
        sendJson(response, 200, { ok: true, squad });
      } else {
        sendJson(response, 404, { ok: false, error: `Squad not found: ${squadId}` });
      }
      return;
    }
    if (route === 'POST /api/squads') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const taskId = typeof body.task_id === 'string' ? body.task_id : `task-${Date.now()}`;
        const taskDesc = typeof body.task_description === 'string' ? body.task_description : '临时战时攻关任务';
        const candidateDogs = Array.isArray(body.candidates) ? (body.candidates as string[]) : ['agy', 'claude-code'];
        const features = (typeof body.features === 'object' && body.features !== null) ? (body.features as TaskFeatureWeights) : {};

        try {
          const squad = liquidSquadEngine.formSquad(taskId, taskDesc, candidateDogs, features);
          broadcast({ type: 'liquid_squad_formed', squad_id: squad.squad_id, lead_dog: squad.lead_dog, members: squad.member_dogs });
          sendJson(response, 200, { ok: true, squad });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-052: 影子评测与实战战绩 ELO 天梯
    if (route === 'GET /api/elo/rankings') {
      const rankings = eloRatingEngine.getRankings();
      sendJson(response, 200, { ok: true, rankings, count: rankings.length });
      return;
    }
    const eloProfileMatch = /^\/api\/elo\/profiles\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && eloProfileMatch !== null) {
      const dog = eloProfileMatch[1];
      const profile = eloRatingEngine.getProfile(dog);
      sendJson(response, 200, { ok: true, profile });
      return;
    }
    if (route === 'POST /api/elo/match') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const dogA = typeof body.dog_a === 'string' ? body.dog_a : '';
        const dogB = typeof body.dog_b === 'string' ? body.dog_b : '';
        const outcome = typeof body.outcome === 'string' ? (body.outcome as MatchOutcome) : 'DRAW';
        const notes = typeof body.notes === 'string' ? body.notes : undefined;

        if (!dogA || !dogB) {
          sendJson(response, 400, { ok: false, error: "fields 'dog_a' and 'dog_b' are required" });
          return;
        }

        try {
          const result = eloRatingEngine.recordMatch(dogA, dogB, outcome, notes);
          broadcast({ type: 'elo_match_recorded', dog_a: dogA, dog_b: dogB, outcome, change_a: result.changeA, change_b: result.changeB });
          sendJson(response, 200, { ok: true, result });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (route === 'POST /api/elo/auto-eval') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const dogA = typeof body.dog_a === 'string' ? body.dog_a : '';
        const dogB = typeof body.dog_b === 'string' ? body.dog_b : '';
        const metricsA = body.metrics_a as MatchMetrics;
        const metricsB = body.metrics_b as MatchMetrics;
        const summary = typeof body.summary === 'string' ? body.summary : undefined;

        if (!dogA || !dogB || !metricsA || !metricsB) {
          sendJson(response, 400, { ok: false, error: "fields 'dog_a', 'dog_b', 'metrics_a', 'metrics_b' are required" });
          return;
        }

        try {
          const result = eloRatingEngine.recordAutoEval(dogA, dogB, metricsA, metricsB, summary);
          broadcast({ type: 'elo_auto_eval_recorded', dog_a: dogA, dog_b: dogB, outcome: result.outcome });
          sendJson(response, 200, { ok: true, result });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-053: 战绩反馈闭环与自适应路由权重自进化
    if (route === 'GET /api/routing/weights') {
      const data = routeOptimizer.getAllWeights();
      sendJson(response, 200, { ok: true, weights: data.weights, count: data.count });
      return;
    }
    if (route === 'GET /api/routing/recommend') {
      const domain = (url.searchParams.get('domain') ?? 'general') as RoutingDomain;
      const capUsd = url.searchParams.get('cap_usd') ? Number(url.searchParams.get('cap_usd')) : undefined;
      const rec = routeOptimizer.recommendBestDog(domain, capUsd);
      sendJson(response, 200, { ok: true, recommendation: rec });
      return;
    }
    if (route === 'POST /api/routing/feedback') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const taskId = typeof body.task_id === 'string' ? body.task_id : `task-${Date.now()}`;
        const domain = (typeof body.domain === 'string' ? body.domain : 'general') as RoutingDomain;
        const adapterId = typeof body.adapter_id === 'string' ? body.adapter_id : '';
        const humanAccepted = Boolean(body.human_accepted);
        const testPassed = Boolean(body.test_passed);
        const costUsd = Number(body.cost_usd ?? 0.01);

        if (!adapterId) {
          sendJson(response, 400, { ok: false, error: "field 'adapter_id' is required" });
          return;
        }

        try {
          const record = routeOptimizer.recordFeedback({
            task_id: taskId,
            domain,
            adapter_id: adapterId,
            human_accepted: humanAccepted,
            test_passed: testPassed,
            cost_usd: costUsd,
          });
          broadcast({ type: 'routing_feedback_recorded', task_id: taskId, domain, adapter_id: adapterId });
          sendJson(response, 200, { ok: true, feedback: record });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    // GOAL-054: 极简系统托盘常驻伴侣与全局热键雪橇浮窗
    if (route === 'GET /companion/spotlight') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderFloatingSledHtml(callerToken));
      return;
    }
    if (route === 'POST /api/companion/quick-action') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be valid JSON' });
          return;
        }
        const actionType = (typeof body.action_type === 'string' ? body.action_type : 'DEBATE') as QuickActionPayload['action_type'];
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const selectedCode = typeof body.selected_code === 'string' ? body.selected_code : undefined;

        if (!prompt) {
          sendJson(response, 400, { ok: false, error: "field 'prompt' is required" });
          return;
        }

        const fullPrompt = selectedCode ? `${prompt}\n\n\`\`\`\n${selectedCode}\n\`\`\`` : prompt;
        const dispatchId = `disp-companion-${Date.now()}`;

        broadcast({
          type: 'companion_quick_action',
          dispatch_id: dispatchId,
          action_type: actionType,
          prompt: fullPrompt,
        });

        sendJson(response, 200, {
          ok: true,
          dispatch_id: dispatchId,
          mode: actionType,
          message: `已成功速派至 ${actionType} 模式`,
        });
      });
      return;
    }

    // GOAL-055: 多犬协作全景战报与研发能效大屏
    if (route === 'GET /api/velocity/metrics') {
      const metrics = velocityEngine.calculateVelocityMetrics();
      sendJson(response, 200, { ok: true, metrics });
      return;
    }
    if (route === 'POST /api/velocity/report') {
      guarded(response, async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(await readBody(request));
        } catch {}
        const title = typeof body.title === 'string' && body.title ? body.title : undefined;
        const report = velocityEngine.generateSledReport(title);
        sendJson(response, 200, { ok: true, report });
      });
      return;
    }

    if (route === 'POST /api/chat/compact') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const compact = extractStructuredInvariant(messages as any);
        sendJson(response, 200, { ok: true, compact });
      });
      return;
    }

    if (route === 'GET /api/chat/context-gauge') {
      const activeSession = url.searchParams.get('session');
      const activeModel = (url.searchParams.get('model') || url.searchParams.get('adapter') || 'claude-sonnet-5').trim();
      const maxContextTokens = getModelContextLimit(activeModel);
      const isFree = isFreeModel(activeModel);

      let inputTokens = 600; // 基础 system prompt
      let outputTokens = 0;
      let reasoningTokens = 0;
      let tSys = 600;
      let tTools = 400;

      if (activeSession && /^[A-Za-z0-9_-]{1,64}$/.test(activeSession.trim())) {
        try {
          const histFile = path.join(runtimeRoot, 'chat', `${activeSession.trim()}.jsonl`);
          if (existsSync(histFile)) {
            const histLines = readFileSync(histFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
            for (const line of histLines) {
              try {
                const turn = JSON.parse(line) as { role?: string; text?: string };
                const text = turn.text || '';
                const tokens = Math.ceil(text.length / 3.8);
                if (turn.role === 'user') {
                  inputTokens += tokens;
                } else if (turn.role === 'head') {
                  outputTokens += tokens;
                  // 提取思维链思考 Token
                  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i) || text.match(/\[thinking\]([\s\S]*?)\[\/thinking\]/i);
                  if (thinkMatch && thinkMatch[1]) {
                    reasoningTokens += Math.ceil(thinkMatch[1].length / 3.8);
                  } else if (activeModel.includes('reasoner') || activeModel.includes('r1') || activeModel.includes('thinking')) {
                    reasoningTokens += Math.ceil(tokens * 0.4);
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }

      const tHist = Math.max(0, inputTokens - tSys) + outputTokens;
      const totalTokens = tSys + tTools + tHist;
      // 缓存命中有利度评估：多轮对话中历史前缀自动命中 Prompt Cache
      const cacheReadTokens = inputTokens > 1000 ? Math.floor(inputTokens * 0.72) : 0;
      const cacheWriteTokens = Math.max(0, inputTokens - cacheReadTokens);
      const cacheHitRatio = inputTokens > 0 ? Number((cacheReadTokens / inputTokens).toFixed(2)) : 0;
      const costUsd = isFree ? 0 : calculateUsageCost(activeModel, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });
      const pressurePct = Number(Math.min(100, Math.max(0.1, (totalTokens / Math.max(1, maxContextTokens)) * 100)).toFixed(1));

      sendJson(response, 200, {
        ok: true,
        gauge: {
          model_id: activeModel,
          total_tokens: totalTokens,
          max_context_tokens: maxContextTokens,
          pressure_pct: pressurePct,
          percent: pressurePct,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          reasoning_tokens: reasoningTokens,
          cache_read_tokens: cacheReadTokens,
          cache_write_tokens: cacheWriteTokens,
          in_cnt: inputTokens,
          out_cnt: outputTokens,
          reason_cnt: reasoningTokens,
          cache_read: cacheReadTokens,
          cache_hit_ratio: cacheHitRatio,
          cost_usd: costUsd,
          is_free: isFree,
          t_total: totalTokens,
          t_max: maxContextTokens,
          t_sys: tSys,
          t_tools: tTools,
          t_hist: tHist,
        },
      });
      return;
    }

    if (route === 'POST /api/chat/mention-file') {
      guarded(response, async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
        if (!filePath) {
          sendJson(response, 400, { ok: false, error: 'filePath is required' });
          return;
        }
        const ws = dispatch.defaultWorkspace() || workspaceRoot || process.cwd();
        const knownWorkspaces = [workspaceRoot, ws, ...dispatch.listWorkspaces().map((w) => w.path)];
        let content = typeof body.content === 'string' ? body.content : '';
        if (!content) {
          const fullPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(ws, filePath);
          const isAllowed = knownWorkspaces.some((root) => fullPath === root || fullPath.startsWith(root + path.sep));
          if (!isAllowed) {
            sendJson(response, 403, { ok: false, error: 'Forbidden: file path is outside allowed workspace roots' });
            return;
          }
          if (fullPath.toLowerCase().includes('意向项目') || fullPath.toLowerCase().includes('.agent-bridge')) {
            content = '// [Security Notice: Access to frozen golden reference zone is restricted]';
          } else {
            try {
              content = readFileSync(fullPath, 'utf8');
            } catch {
              content = '';
            }
          }
        }
        const result = processFileMention(filePath, content);
        sendJson(response, 200, { ok: true, ...result });
      });
      return;
    }
    if (route === 'GET /api/chat/history') {
      guarded(response, async () => {
        const session = (url.searchParams.get('session') ?? '').trim();
        const limit = Number(url.searchParams.get('limit') ?? '50');
        if (session === '') {
          sendJson(response, 400, { ok: false, error: 'session query param is required' });
          return;
        }
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) {
          sendJson(response, 400, { ok: false, error: 'invalid session query param format' });
          return;
        }
        try {
          const history = await chat.history(session, Number.isFinite(limit) ? limit : 50);
          sendJson(response, 200, { ok: true, ...history });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      return;
    }
    if (route === 'GET /api/stream') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      sseClients.add(response);
      request.on('close', () => {
        sseClients.delete(response);
      });
      response.on('error', () => {
        sseClients.delete(response);
      });
      return;
    }
    sendJson(response, 404, { ok: false, error: `not found: ${route}` });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  persistence.recordLockPort(boundPort); // DEF-06：锁内回填端口供重复启动提示

  // GP-03 / F-42：SIGINT 优雅释放锁（CLI 的 SIGINT 会调 close）。
  const release = (): void => {
    persistence.releaseLock();
  };
  process.once('SIGINT', release);

  return {
    server,
    host,
    port: boundPort,
    callerToken,
    close: () =>
      new Promise<void>((resolve) => {
        process.removeListener('SIGINT', release);
        for (const client of sseClients) client.end();
        sseClients.clear();
        server.close(() => {
          release();
          resolve();
        });
      }),
  };
}
