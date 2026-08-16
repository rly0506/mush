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
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { EventLog } from '../core/event-log.ts';
import { parseBridgeEventV2 } from '../schema/events.ts';
import { collectBoardSnapshot } from './sources.ts';
import { renderBoardPage } from './page.ts';
import { DispatchPipeline, InputError } from './dispatch.ts';
import { BoardPersistence } from './persistence.ts';
import { ChatService } from './chat.ts';

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
}

export interface BoardServer {
  server: Server;
  host: string;
  port: number;
  close(): Promise<void>;
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
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const approvalRoot = path.resolve(options.approvalRoot);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  // 测试/缺省：runtime 挂在 approvalRoot 下（天然隔离）；生产 CLI 显式传 workspace/runtime。
  const runtimeRoot = options.runtimeRoot ?? path.join(approvalRoot, 'runtime');
  const persistence = options.persistence ?? new BoardPersistence(runtimeRoot);

  // GOAL-013L（rm003-p13，授权唯一后端小改）：品牌图标静态路由。
  // 白名单目录 assets/brands/，仅 .svg；name 先校验纯文件名（拒绝路径穿越），
  // 再经 path.resolve 前缀复核（纵深防御）；content-type image/svg+xml + 短缓存。
  const brandAssetsRoot = path.resolve(workspaceRoot, 'assets', 'brands');

  // GP-03 / F-42：单实例锁。已在运行的看板实例拒绝第二个实例。
  persistence.acquireLock();

  // GP-03：事件链持久化回放——启动时读回 JSONL 并重建哈希链日志。
  const log = options.eventLog ?? new EventLog(options.runId, options.assignmentEpoch);
  if (options.eventLog === undefined) {
    for (const line of persistence.loadEventLogLines(options.runId)) {
      log.append(line.event);
    }
  }
  const dispatch =
    options.dispatch ??
    new DispatchPipeline({
      workspaceRoot,
      approvalRoot,
      ledgerPath: options.ledgerPath ?? path.join(runtimeRoot, 'budget-ledger.jsonl'),
      registryPath: path.join(workspaceRoot, 'runtime', 'capability-registry.json'),
      persistence,
      onEvent: (event) => broadcast(event),
    });
  const sseClients = new Set<ServerResponse>();

  function broadcast(payload: Record<string, unknown>): void {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  }
  // 注入管线也要把生命周期事件推 SSE（构造期 onEvent 无法前向引用 broadcast）。
  dispatch.setEventListener((event) => broadcast(event));
  const chat = options.chat ?? new ChatService({ pipeline: dispatch, runtimeRoot });

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
    sendJson(response, 201, { ok: true, response_path: responsePath });
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
      response.end(renderBoardPage());
      return;
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
      response.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      });
      response.end(readFileSync(filePath));
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
      void handleEventPost(request, response);
      return;
    }
    if (route === 'POST /api/approvals/respond') {
      void handleApprovalRespond(request, response);
      return;
    }
    if (route === 'POST /api/dispatch') {
      void (async () => {
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
      })();
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
    if (route === 'GET /api/workspaces') {
      sendJson(response, 200, { ok: true, workspaces: dispatch.listWorkspaces() });
      return;
    }
    if (route === 'POST /api/workspaces/select') {
      void (async () => {
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
          sendJson(response, 201, { ok: true, selected });
        } catch (error) {
          if (error instanceof InputError) sendJson(response, 400, { ok: false, error: error.message });
          else sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return;
    }
    if (route === 'POST /api/workspaces/create') {
      // GP-02（契约 v1.2）：自主登记新建目录——mkdir recursive + 记入 known-workspaces。
      void (async () => {
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
      })();
      return;
    }
    if (route === 'GET /api/budget') {
      sendJson(response, 200, { ok: true, ...dispatch.budgetProjection() });
      return;
    }
    if (route === 'POST /api/chat') {
      void (async () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        try {
          // GOAL-012B：D1 参数化（adapter_id/effort 可选透传）+ D3 同步语义
          // （200 + reply/status，前端响应到达即渲染头犬气泡；异步化留 M3+）。
          const result = await chat.post({
            message: typeof body.message === 'string' ? body.message : '',
            resume: typeof body.resume === 'string' ? body.resume : undefined,
            adapter_id: typeof body.adapter_id === 'string' ? body.adapter_id : undefined,
            effort: typeof body.effort === 'string' ? body.effort : undefined,
          });
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return;
    }
    if (route === 'GET /api/chat/history') {
      void (async () => {
        const session = url.searchParams.get('session') ?? '';
        const limit = Number(url.searchParams.get('limit') ?? '50');
        if (session === '') {
          sendJson(response, 400, { ok: false, error: 'session query param is required' });
          return;
        }
        sendJson(response, 200, { ok: true, ...(await chat.history(session, Number.isFinite(limit) ? limit : 50)) });
      })();
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
