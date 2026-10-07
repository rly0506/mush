/**
 * GOAL-085 第三阶段第二片（owner 2026-10-06）：受控讨论的**本地 stdio MCP** 薄入口。
 *
 * 边界（与 CLI 片同一纪律，owner 既有裁定 §6.3/§7.9）：
 *  - 复用同一客户端：`src/web/collab-client.ts`（回环限制/禁重定向/请求与正文读取
 *    截止时间/协议校验）——不另写第二份 HTTP 客户端；
 *  - 复用同一审批门：`collab_create` 工具只创建待批准会话并返回
 *    `PENDING_OWNER_APPROVAL`（D30）——批准由 owner 在看板审批卡完成，本 server
 *    不提供 approve/reject 工具；`collab_stop` 只发停止请求，终态以 collab_status 为准；
 *  - **工具面不含文件系统**（Codex 二轮复核缺口 1，owner 裁定 MCP 只接收材料正文、
 *    返回结果内容）：materials 只接受 `content` 内联正文（不接受 path），
 *    `collab_result` 只返回内容（不提供 out 落盘）；CLI 保留文件能力，MCP 不保留；
 *  - 零新 HTTP 端点、零网络监听：本进程只经 stdio（newline-delimited JSON-RPC 2.0）
 *    与启动它的本地客户端通信；board URL 在**启动参数**固定且必须本机回环——
 *    工具入参不暴露 board_url，调用方无法改道；启动错误写 stderr，stdout 只承载
 *    协议帧（Codex 二轮复核缺口 4）；
 *  - 零依赖：不引入 MCP SDK，按 2024-11-05 规范最小实现生命周期与工具面：
 *    连接级初始化状态（未收到 notifications/initialized 前拒绝其它请求，
 *    Codex 二轮复核缺口 2）、请求帧校验（jsonrpc 必须 '2.0'、无效请求回 -32600
 *    而不是静默丢弃）、工具入参**存在但类型错误一律拒绝**（Codex 二轮复核缺口 3）。
 */

import { createInterface } from 'node:readline';
import path from 'node:path';
import { InputError } from './web/dispatch.ts';
import {
  CollabBoardUnreachableError,
  CollabProtocolError,
  assertLoopbackBoardUrl,
  collabCheck,
  collabCreate,
  collabResult,
  collabStatus,
  collabStop,
  type CollabParticipantSelection,
} from './web/collab-client.ts';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'mush-collab', version: '0.2.0' } as const;

export interface McpSession {
  baseUrl: string;
  /** 完整握手状态（Codex 三轮复核缺口 1）：先收到并响应过 `initialize` 请求
   *  （initializeResponded），`notifications/initialized` 通知才置 initialized——
   *  只发通知不发 initialize 无法绕过。 */
  initializeResponded: boolean;
  initialized: boolean;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const participantSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    adapter_id: { type: 'string' },
    model_id: { type: 'string' },
    effort: { type: 'string' },
  },
  required: ['adapter_id'],
};

export function mcpCollabTools(): McpToolDef[] {
  return [
    {
      name: 'collab_check',
      description: '只读检查两位参与者的当前准入/版本/实测组合状态（不创建会话、不占额、不调用模型；ready=false 仍是成功查询）',
      inputSchema: {
        type: 'object',
        properties: {
          participants: { type: 'array', items: participantSchema, minItems: 2, maxItems: 2, description: '两位参与者（A/B）' },
          refresh: { type: 'boolean', description: '强制刷新原生版本观测缓存' },
          workspace_root: { type: 'string' },
        },
        required: ['participants'],
      },
    },
    {
      name: 'collab_create',
      description: '创建受控双模型讨论会话——仅返回待批准会话与审批卡信息（approval=PENDING_OWNER_APPROVAL）；批准必须由 owner 在看板审批卡完成；批准前零模型调用。材料只接收内联正文（content），不接受本地文件路径',
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          participants: { type: 'array', items: participantSchema, minItems: 2, maxItems: 2 },
          materials: {
            type: 'array',
            description: '冻结材料（name+content 必填；allowed_seats 席位权限透传服务端校验；不支持本地文件路径）',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                content: { type: 'string' },
                allowed_seats: { type: 'array', items: { type: 'string', enum: ['A', 'B'] } },
              },
              required: ['name', 'content'],
            },
          },
          constraints: { type: 'string' },
          workspace_root: { type: 'string' },
        },
        required: ['topic', 'participants'],
      },
    },
    {
      name: 'collab_status',
      description: '查询协作会话状态（无 session_id 时列出全部会话）',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
      },
    },
    {
      name: 'collab_result',
      description: '只读导出会话结果并作为工具结果返回（JSON 或 Markdown 文本）；MCP 不提供落盘（文件输出请用 mush collab CLI）',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          format: { type: 'string', enum: ['json', 'markdown'] },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'collab_stop',
      description: '请求停止整场讨论（只发停止请求；终态以 collab_status 为准，不提前显示为已停止）',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
      },
    },
  ];
}

function requireArguments(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new InputError('工具参数必须是对象');
  return args as Record<string, unknown>;
}

/** 字段存在但类型错误一律拒绝（Codex 二轮复核缺口 3：effort:99 不得被静默丢弃）。 */
function optionalString(rec: Record<string, unknown>, field: string, where: string): string | undefined {
  const value = rec[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputError(`${where}.${field} 存在但必须是字符串（收到 ${typeof value}）`);
  return value;
}

/** 布尔可选字段同样严格：存在但非 boolean 一律拒绝（Codex 三轮复核缺口 2）。 */
function optionalBoolean(rec: Record<string, unknown>, field: string, where: string): boolean | undefined {
  const value = rec[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new InputError(where + '.' + field + ' 存在但必须是 boolean（收到 ' + typeof value + '）');
  return value;
}

function parseParticipants(raw: unknown): CollabParticipantSelection[] {
  if (!Array.isArray(raw) || raw.length !== 2) throw new InputError('participants 必须是恰两位参与者');
  return raw.map((p, index) => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new InputError(`participants[${index}] 必须是对象`);
    const rec = p as Record<string, unknown>;
    const adapterId = optionalString(rec, 'adapter_id', `participants[${index}]`);
    if (adapterId === undefined || adapterId.trim() === '') throw new InputError(`participants[${index}] 需要 adapter_id`);
    const modelId = optionalString(rec, 'model_id', `participants[${index}]`);
    const effort = optionalString(rec, 'effort', `participants[${index}]`);
    return {
      adapter_id: adapterId,
      ...(modelId !== undefined ? { model_id: modelId } : {}),
      ...(effort !== undefined ? { effort: effort.toUpperCase() } : {}),
    };
  });
}

function parseMaterials(raw: unknown): Array<Record<string, unknown>> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new InputError('materials 必须是数组');
  return raw.map((m, index) => {
    if (m === null || typeof m !== 'object' || Array.isArray(m)) throw new InputError(`materials[${index}] 必须是对象`);
    const rec = m as Record<string, unknown>;
    const name = optionalString(rec, 'name', `materials[${index}]`);
    if (name === undefined || name.trim() === '') throw new InputError(`materials[${index}] 需要 name`);
    // Codex 二轮复核缺口 1：MCP 工具面不含文件系统——path 不受支持（CLI 保留文件能力）。
    if (rec.path !== undefined) throw new InputError(`materials[${index}].path 不受支持——MCP 只接收材料正文（content）；本地文件请用 mush collab CLI`);
    const content = optionalString(rec, 'content', `materials[${index}]`);
    if (content === undefined || content.trim() === '') throw new InputError(`materials[${index}] 需要 content`);
    const material: Record<string, unknown> = { name, content };
    if (rec.allowed_seats !== undefined) {
      if (!Array.isArray(rec.allowed_seats) || rec.allowed_seats.some((s) => typeof s !== 'string')) {
        throw new InputError(`materials[${index}].allowed_seats 存在但必须是字符串数组`);
      }
      material.allowed_seats = rec.allowed_seats;
    }
    return material;
  });
}

/** 工具执行：成功返回 {content, isError?}；错误按 MCP 惯例转 isError 文本，不抛出协议层异常。 */
async function callTool(name: string, rawArgs: unknown, session: McpSession): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const text = (value: unknown): { content: Array<{ type: string; text: string }> } =>
    ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
  try {
    const args = requireArguments(rawArgs);
    if (name === 'collab_check') {
      const participants = parseParticipants(args.participants);
      const refresh = optionalBoolean(args, 'refresh', 'collab_check');
      const workspaceRoot = optionalString(args, 'workspace_root', 'collab_check');
      return text(await collabCheck(session.baseUrl, participants, {
        ...(refresh === true ? { refresh: true } : {}),
        ...(workspaceRoot !== undefined ? { workspace_root: path.resolve(workspaceRoot) } : {}),
      }));
    }
    if (name === 'collab_create') {
      const topic = optionalString(args, 'topic', 'collab_create');
      if (topic === undefined || topic.trim() === '') throw new InputError('collab_create 需要 topic');
      const participants = parseParticipants(args.participants);
      const constraints = optionalString(args, 'constraints', 'collab_create');
      const workspaceRoot = optionalString(args, 'workspace_root', 'collab_create');
      const isolationRequired = optionalBoolean(args, 'isolation_required', 'collab_create');
      if (isolationRequired === false) throw new InputError('受控协作必须启用材料与工具隔离');
      const requestBody: Record<string, unknown> = {
        topic: topic.trim(),
        participants,
        materials: parseMaterials(args.materials),
        ...(constraints !== undefined && constraints.trim() !== '' ? { constraints } : {}),
        ...(workspaceRoot !== undefined ? { workspace_root: path.resolve(workspaceRoot) } : {}),
        isolation_required: true,
      };
      const outcome = await collabCreate(session.baseUrl, requestBody);
      if (outcome.status !== 201) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, status: outcome.status, error: outcome.error }, null, 2) }], isError: true };
      }
      return text({
        ok: true,
        session_id: outcome.session_id,
        status: 'pending_approval',
        request_file: outcome.request_file,
        authorization_readiness: outcome.authorization_readiness,
        approval: 'PENDING_OWNER_APPROVAL',
        note: '会话已创建为待批准；MCP 不自动批准——请到看板审批卡批准后才开始讨论（批准前零模型调用）',
      });
    }
    if (name === 'collab_status') {
      const sessionId = optionalString(args, 'session_id', 'collab_status');
      return text(await collabStatus(session.baseUrl, sessionId?.trim()));
    }
    if (name === 'collab_result') {
      const sessionId = optionalString(args, 'session_id', 'collab_result');
      if (sessionId === undefined || sessionId.trim() === '') throw new InputError('collab_result 需要 session_id');
      // Codex 二轮复核缺口 1：MCP 不提供落盘——out 参数明确拒绝，不悄悄忽略。
      if (args.out !== undefined) throw new InputError('collab_result 不支持 out（MCP 只返回内容）；落盘请用 mush collab CLI');
      const format = args.format === undefined ? 'json' : args.format;
      if (format !== 'json' && format !== 'markdown') throw new InputError(`format 存在但必须是 'json' 或 'markdown'（收到 ${JSON.stringify(format)}）`);
      const { payload } = await collabResult(session.baseUrl, sessionId, format);
      return text(payload);
    }
    if (name === 'collab_stop') {
      const sessionId = optionalString(args, 'session_id', 'collab_stop');
      if (sessionId === undefined || sessionId.trim() === '') throw new InputError('collab_stop 需要 session_id');
      return text(await collabStop(session.baseUrl, sessionId));
    }
    throw new InputError(`未知工具：${name}`);
  } catch (error) {
    // MCP 惯例：业务/边界错误在 result.isError 里返回（协议层保持 200 语义），进程不退出。
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

/**
 * 单条 JSON-RPC 消息处理（携带连接级会话状态）；通知返回 null（不回包）。
 * 帧校验（Codex 二/三轮复核缺口）：jsonrpc 必须 '2.0'；请求 id 必须是 string 或
 * number（MCP 2024-11-05 规范——对象/布尔/null id 一律 -32600，响应 id 用 null）；
 * 缺 method 的无效请求回 -32600（不静默丢弃）；完整握手：未响应过 initialize 时
 * 只接受 initialize/ping，notifications/initialized 不构成握手完成。
 */
export async function handleMcpMessage(message: unknown, session: McpSession): Promise<Record<string, unknown> | null> {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const msg = message as Record<string, unknown>;
  const { id, method } = msg as { id?: unknown; method?: unknown };
  const hasUsableId = typeof id === 'number' || typeof id === 'string';
  if (!hasUsableId && id !== undefined) {
    const detail = id === null ? 'request id must not be null' : 'request id must be a string or number';
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: ' + detail } };
  }
  const responseId = hasUsableId ? id : null;
  if (msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: responseId, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } };
  }
  if (typeof method !== 'string') {
    return { jsonrpc: '2.0', id: responseId, error: { code: -32600, message: 'Invalid Request: missing method' } };
  }
  const isNotification = id === undefined;
  const respond = (result: unknown): Record<string, unknown> | null =>
    isNotification ? null : { jsonrpc: '2.0', id, result };
  const respondError = (code: number, errMessage: string): Record<string, unknown> | null =>
    isNotification ? null : { jsonrpc: '2.0', id, error: { code, message: errMessage } };

  switch (method) {
    case 'initialize': {
      void requireArguments(msg.params); // 客户端能力当前不影响本 server 的最小实现。
      // Codex 四轮复核：仅合法的 initialize **请求**（有可响应 id）在产生响应后才
      // 置位握手状态——无 id 的 initialize 通知不回响应、不推进握手。
      if (!isNotification) session.initializeResponded = true;
      return respond({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case 'notifications/initialized':
      // MCP 生命周期：仅在 initialize 已响应后，该通知才完成握手；
      // 只发通知的绕过路径在这里不置位（Codex 三轮复核缺口 1）。
      if (session.initializeResponded) session.initialized = true;
      return null;
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return respond({});
    default:
      break;
  }
  if (!session.initialized) {
    // 初始化未完成（未响应 initialize 或未收到合法 initialized 通知）：拒绝其它请求。
    return respondError(-32600, 'Server not initialized: send initialize then notifications/initialized first');
  }
  switch (method) {
    case 'tools/list':
      return respond({ tools: mcpCollabTools() });
    case 'tools/call': {
      const params = requireArguments(msg.params);
      const name = typeof params.name === 'string' ? params.name : '';
      if (name === '') return respondError(-32602, 'tools/call 需要 name');
      const outcome = await callTool(name, params.arguments, session);
      return respond({ ...outcome });
    }
    default:
      return respondError(-32601, `Method not found: ${method}`);
  }
}

/** 常驻 stdio 服务：逐行读 JSON-RPC，写响应到 stdout；stdin EOF 即退出。 */
export async function runMcpCollabServer(options: { baseUrl: string }): Promise<void> {
  // 启动即校验：非回环/带凭据的 board URL 拒绝启动（调用方负责把错误写 stderr）。
  assertLoopbackBoardUrl(options.baseUrl);
  const session: McpSession = { baseUrl: options.baseUrl, initializeResponded: false, initialized: false };
  const rl = createInterface({ input: process.stdin, terminal: false });
  const writeLine = (value: Record<string, unknown>): void => {
    process.stdout.write(JSON.stringify(value) + '\n');
  };
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue; // 空行是帧边界噪音，不是请求。
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      writeLine({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    try {
      const response = await handleMcpMessage(message, session);
      if (response !== null) writeLine(response);
    } catch (error) {
      // handler 内部已兜底；此处是最后防线——把意外错误作为 JSON-RPC error 返回。
      const msg = error instanceof Error ? error.message : String(error);
      const id = (message as { id?: unknown } | null)?.id ?? null;
      writeLine({ jsonrpc: '2.0', id, error: { code: -32603, message: msg } });
    }
  }
}
