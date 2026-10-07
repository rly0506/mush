/**
 * GOAL-085 第三阶段：受控讨论的**共享看板客户端**——CLI（`mush collab`）与本地
 * stdio MCP（`mush mcp`）复用同一实现，保证"同一客户端、同一审批门"：
 *
 *   - `--board-url`/baseUrl 只允许本机回环（localhost / 127.0.0.0/8 / ::1），拒绝
 *     userinfo 凭据；fetch 一律 `redirect:'error'`（重定向即失败）；所有请求与
 *     **响应正文读取**都受有限截止时间约束（默认 30s，`MUSH_COLLAB_TIMEOUT_MS`
 *     可覆盖）——材料正文永不外发出回环。
 *   - 所有子命令是既有看板 HTTP API 的 loopback 薄客户端，**零新端点**，底层完全
 *     复用看板的审批/编排/停止/账本；create 只返回待批准会话（PENDING_OWNER_
 *     APPROVAL），批准由 owner 在看板审批卡完成（D30）。
 *   - 协议校验：HTTP 200 但缺各自必需字段一律视为失败——调用方把
 *     `CollabBoardUnreachableError` 映射为"看板不可达"（CLI exit 3 / MCP isError），
 *     `CollabProtocolError` 映射为"响应不符合协议"（CLI exit 1 / MCP isError）。
 *
 * 错误分类（共享层抛出，入口层映射）：
 *   - `InputError`：参数/用法错误（CLI exit 64 / MCP isError）
 *   - `CollabBoardUnreachableError`：连接失败/超时/重定向/正文读取失败（exit 3）
 *   - `CollabProtocolError`：HTTP 状态可接受但响应结构不符（exit 1）
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { InputError } from './dispatch.ts';

export class CollabBoardUnreachableError extends Error {}
export class CollabProtocolError extends Error {}

export const COLLAB_REQUEST_TIMEOUT_MS_DEFAULT = 30_000;

export function collabTimeoutMs(): number {
  const raw = process.env.MUSH_COLLAB_TIMEOUT_MS;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : COLLAB_REQUEST_TIMEOUT_MS_DEFAULT;
}

export function assertLoopbackBoardUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InputError(`--board-url 不是合法 URL：${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InputError(`--board-url 只允许 http/https 协议：${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new InputError('--board-url 不允许携带凭据（userinfo）');
  }
  // WHATWG URL 对 IPv6 字面量返回带方括号的 hostname（'[::1]'），必须剥掉再比较。
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const isLoopbackV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  if (host !== 'localhost' && host !== '::1' && !isLoopbackV4) {
    throw new InputError(`--board-url 只允许本机回环地址（localhost / 127.0.0.0/8 / ::1），收到：${url.hostname}`);
  }
  return url;
}

async function collabFetch(baseUrl: string, apiPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
  assertLoopbackBoardUrl(baseUrl);
  let res: Response;
  try {
    res = await fetch(baseUrl + apiPath, {
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: init?.body,
      redirect: 'error',
      signal: AbortSignal.timeout(collabTimeoutMs()),
    });
  } catch (error) {
    if (error instanceof InputError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CollabBoardUnreachableError(`看板请求失败：${baseUrl}${apiPath}（${detail}）`);
  }
  return res;
}

/** 响应正文读取也受请求截止时间约束——正文挂起的超时与连接超时同样归"看板请求失败"。 */
export async function collabReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (error) {
    throw new CollabBoardUnreachableError(`看板响应读取失败（${error instanceof Error ? error.message : String(error)}）`);
  }
}

export async function collabPostJson(baseUrl: string, apiPath: string, body: unknown): Promise<{ status: number; json: Record<string, unknown>; text: string; contentType: string }> {
  const token = await collabToken(baseUrl);
  const res = await collabFetch(baseUrl, apiPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mush-caller-auth': token },
    body: JSON.stringify(body ?? {}),
  });
  const text = await collabReadText(res);
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* 非 JSON 响应（markdown）原样返回 */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') ?? '' };
}

async function collabToken(baseUrl: string): Promise<string> {
  const res = await collabFetch(baseUrl, '/api/session/token');
  if (!res.ok) throw new CollabBoardUnreachableError(`看板不可达：${baseUrl}（GET /api/session/token → ${res.status}）`);
  let body: { caller_token?: string };
  try {
    body = JSON.parse(await collabReadText(res)) as { caller_token?: string };
  } catch (error) {
    if (error instanceof CollabBoardUnreachableError) throw error;
    throw new CollabBoardUnreachableError('看板响应不是 JSON（/api/session/token）');
  }
  if (typeof body.caller_token !== 'string' || body.caller_token === '') {
    throw new CollabBoardUnreachableError('看板未签发 caller token');
  }
  return body.caller_token;
}

export interface CollabParticipantSelection { adapter_id: string; model_id?: string; effort?: string }

/** 高层操作：check（只读查询，ready=false 仍是成功查询）。 */
export async function collabCheck(baseUrl: string, participants: CollabParticipantSelection[], options: { refresh?: boolean; workspace_root?: string } = {}): Promise<Record<string, unknown>> {
  const res = await collabPostJson(baseUrl, '/api/collaboration/check', {
    participants,
    ...(options.workspace_root !== undefined ? { workspace_root: options.workspace_root } : {}),
    ...(options.refresh === true ? { refresh: true } : {}),
  });
  if (res.status !== 200) {
    throw new CollabProtocolError(String(res.json.error ?? `HTTP ${res.status}`));
  }
  if (res.json.ok !== true || typeof res.json.ready !== 'boolean') {
    throw new CollabProtocolError('看板响应不符合协议（缺少 ok/ready）');
  }
  return res.json;
}

/** 高层操作：create——只创建待批准会话；409 准入/版本拒绝原样透出（调用方映射 exit 2 / isError）。 */
export interface CollabCreateOutcome {
  session_id: string;
  request_file: unknown;
  authorization_readiness: unknown;
  raw: Record<string, unknown>;
  status: number;
  error?: string;
}
export async function collabCreate(baseUrl: string, requestBody: Record<string, unknown>): Promise<CollabCreateOutcome> {
  const res = await collabPostJson(baseUrl, '/api/collaboration/sessions', requestBody);
  if (res.status !== 201) {
    return { session_id: '', request_file: undefined, authorization_readiness: undefined, raw: res.json, status: res.status, error: String(res.json.error ?? res.text.slice(0, 400)) };
  }
  if (res.json.ok !== true || typeof res.json.session_id !== 'string') {
    throw new CollabProtocolError('看板响应不符合协议（缺少 ok/session_id）');
  }
  return { session_id: res.json.session_id, request_file: res.json.request_file, authorization_readiness: res.json.authorization_readiness, raw: res.json, status: res.status };
}

/** 高层操作：status——无 session_id 返回列表，有则返回详情摘要。 */
export async function collabStatus(baseUrl: string, sessionId?: string): Promise<Record<string, unknown>> {
  if (sessionId === undefined || sessionId.trim() === '') {
    const res = await collabFetch(baseUrl, '/api/collaboration/sessions');
    if (!res.ok) throw new CollabBoardUnreachableError(`看板不可达：${baseUrl}（GET /api/collaboration/sessions → ${res.status}）`);
    let body: { ok?: unknown; sessions?: unknown };
    try {
      body = JSON.parse(await collabReadText(res)) as { ok?: unknown; sessions?: unknown };
    } catch (error) {
      if (error instanceof CollabBoardUnreachableError) throw error;
      throw new CollabProtocolError('看板响应不是 JSON（GET /api/collaboration/sessions）');
    }
    if (body.ok !== true || !Array.isArray(body.sessions)) {
      throw new CollabProtocolError('看板响应不符合协议（缺少 ok/sessions）');
    }
    return { sessions: body.sessions };
  }
  const res = await collabPostJson(baseUrl, '/api/collaboration/sessions/detail', { session_id: sessionId.trim() });
  if (res.status !== 200) {
    const err = new InputError(String(res.json.error ?? `HTTP ${res.status}`));
    (err as InputError & { httpStatus?: number }).httpStatus = res.status;
    throw err;
  }
  if (res.json.ok !== true) throw new CollabProtocolError('看板响应不符合协议（缺少 ok）');
  const d = res.json as Record<string, unknown>;
  const snapshot = d.snapshot as Record<string, unknown> | undefined;
  return {
    session_id: d.session_id,
    status: d.status,
    phase: d.phase,
    owner_decision: d.owner_decision,
    execution: d.execution,
    stop_requested: d.stop_requested,
    call_count: d.call_count,
    retry_count: d.retry_count,
    deadline_utc: d.deadline_utc,
    seats: (snapshot?.participants as Array<Record<string, unknown>> | undefined)?.map(p => `${String(p.seat)}=${String(p.adapter_id)}·${String(p.model_id ?? 'UNKNOWN')}·${String(p.effort ?? 'UNKNOWN')}`),
    review_relations: (snapshot?.review_relations as Array<Record<string, unknown>> | undefined)?.map(r => `${String(r.author)}->${String(r.target)}`),
    outcome: d.outcome ?? null,
    authorization_readiness: d.authorization_readiness ?? null,
  };
}

/** 高层操作：result——只读导出；json 校验 ok/result，markdown 校验 content-type。 */
export async function collabResult(baseUrl: string, sessionId: string, format: 'json' | 'markdown'): Promise<{ payload: string }> {
  const res = await collabPostJson(baseUrl, '/api/collaboration/sessions/result', { session_id: sessionId.trim(), format });
  if (res.status !== 200) {
    throw new CollabProtocolError(format === 'markdown' ? res.text.slice(0, 400) : String(res.json.error ?? `HTTP ${res.status}`));
  }
  if (format === 'json') {
    if (res.json.ok !== true || !('result' in res.json)) throw new CollabProtocolError('看板响应不符合协议（缺少 ok/result）');
    return { payload: JSON.stringify(res.json.result, null, 2) + '\n' };
  }
  if (!res.contentType.startsWith('text/markdown')) {
    throw new CollabProtocolError(`看板响应不符合协议（content-type=${res.contentType || '缺失'}，期望 text/markdown）`);
  }
  return { payload: res.text };
}

/** 高层操作：stop——只发停止请求，终态以 status 为准。 */
export async function collabStop(baseUrl: string, sessionId: string): Promise<Record<string, unknown>> {
  const res = await collabPostJson(baseUrl, '/api/collaboration/sessions/cancel', { session_id: sessionId.trim() });
  if (res.status !== 200 && res.status !== 202) {
    const err = new InputError(String(res.json.error ?? `HTTP ${res.status}`));
    (err as InputError & { httpStatus?: number }).httpStatus = res.status;
    throw err;
  }
  const cancelled = res.json.status === 'cancelled';
  const stopRequested = res.json.stop_requested === true;
  if (res.json.ok !== true || (!cancelled && !stopRequested)) {
    throw new CollabProtocolError('看板响应不符合协议（缺少 ok/status/stop_requested）');
  }
  return res.json;
}

/** --out 原子排他创建（flag:'wx'）——existsSync 前置检查只为友好报错，竞态窗口同样拒绝。 */
export function writeOutFileExclusive(outPath: string, payload: string): void {
  if (existsSync(outPath)) throw new InputError(`输出文件已存在，拒绝覆盖：${outPath}`);
  try {
    writeFileSync(outPath, payload, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'EEXIST') throw new InputError(`输出文件已存在，拒绝覆盖：${outPath}`);
    throw error;
  }
}

/** 409/400 等业务拒绝的出口码判定（CLI 用；MCP 映射 isError）。 */
export function collabRejectionExitCode(status: number): number {
  return status === 409 ? 2 : status === 400 ? 64 : 1;
}

/** detail/cancel 的非 200 输入错误附带的 httpStatus（区分 400 与 409）。 */
export function inputErrorHttpStatus(error: unknown): number | undefined {
  return (error as (InputError & { httpStatus?: number }) | null | undefined)?.httpStatus;
}

/** workspace_root 解析（CLI/MCP 共用：本地绝对路径）。 */
export function resolveWorkspaceRoot(raw: string): string {
  return path.resolve(raw);
}
