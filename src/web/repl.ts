/**
 * GOAL-081：`mush chat` 交互式 REPL——终端即雪橇队。
 *
 * codex/zcode 用户住在终端；本模块复用看板既有契约（零新端点）：
 *  - POST /api/chat（v1.9 异步受理，202 + {session_id, dispatch_id}）；
 *  - GET /api/stream（SSE kind=chat 帧：EXECUTE 增量 / REPORT 全文 / HEARTBEAT）；
 *  - GET /api/session（Caller-Token 协商，同源 loopback）。
 *
 * 行为：发送 → 流式渐显（EXECUTE 增量直接写 stdout）→ Ctrl+C 中断当前回合
 * （不退出会话）→ Ctrl+T 展开/收起思考链 → /quit 或空 EOF 退出。
 * 会话持久化天然与看板一致——两侧共用 runtime/chat/<session_id>.jsonl，
 * /resume <session_id> 可继续看板上开过的会话。
 */

export interface ChatReplOptions {
  baseUrl: string;
  sessionId?: string;
  /** 注入点：测试替换。默认全局 fetch。 */
  fetchImpl?: typeof fetch;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

interface SseFrame {
  kind?: string;
  phase?: string;
  session_id?: string;
  dispatch_id?: string;
  payload?: { stream_text?: string; reply?: string; status?: string; error?: string; elapsed_ms?: number };
}

type Out = (s: string) => void;

/** 极简 SSE 消费：按行缓冲，`data: <json>` 帧解析回调。返回中断器。 */
function subscribeSse(
  baseUrl: string,
  headers: Record<string, string>,
  onFrame: (frame: SseFrame) => void,
  fetchImpl: typeof fetch,
): { close: () => void; ready: Promise<void> } {
  const controller = new AbortController();
  const ready = (async () => {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api/stream`, { headers, signal: controller.signal });
    } catch {
      return; // 连接失败：REPL 退化为纯轮询-free 模式（REPORT 靠 history 对账也可，但此处只静默降级）
    }
    if (!res.ok || res.body === null) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const rawEvent = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data:')) continue;
            try {
              onFrame(JSON.parse(line.slice(5).trim()) as SseFrame);
            } catch {
              /* 坏帧静默跳过（append-only 纪律：不因此中断流） */
            }
          }
        }
      }
    } catch {
      /* abort 到达即收尾 */
    }
  })();
  return { close: () => controller.abort(), ready };
}

/** 从回复全文中剥离 <think> 块（Ctrl+T 折叠态正文口径）。 */
export function splitThinking(raw: string): { thinking: string; body: string } {
  const match = /<think>([\s\S]*?)<\/think>/i.exec(raw);
  if (!match) return { thinking: '', body: raw.trim() };
  return { thinking: match[1].trim(), body: raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim() };
}

export async function runChatRepl(opts: ChatReplOptions): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const write: Out = (s) => output.write(s);

  // Caller-Token 协商（v1.43+ 强制鉴权；同源 loopback 放行）。
  let callerToken = '';
  try {
    const res = await fetchImpl(`${opts.baseUrl}/api/session`);
    if (res.ok) {
      const body = (await res.json()) as { caller_token?: string };
      callerToken = typeof body.caller_token === 'string' ? body.caller_token : '';
    }
  } catch {
    write('mush chat：无法连接看板 ' + opts.baseUrl + '（先 `mush board` 启动）。\n');
    return 3;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (callerToken !== '') headers['x-mush-caller-auth'] = callerToken;

  let sessionId = opts.sessionId ?? null;
  let showThinking = false;
  let cancelled = false;
  let interrupted = false; // Ctrl+C 中断标记（当前回合）
  // 头犬终审修正（P2）：raw 模式下 Ctrl+C 是 keypress 不触发 SIGINT——
  // 统一取消点：回合中=中断本地渲染；空转期=退出 REPL。
  let cancelCurrentTurn: (() => void) | null = null;

  const sse = subscribeSse(
    opts.baseUrl,
    callerToken !== '' ? { 'x-mush-caller-auth': callerToken } : {},
    (frame) => {
      if (frame.kind !== 'chat') return;
      if (sessionId !== null && frame.session_id !== undefined && frame.session_id !== sessionId) return;
      if (frame.phase === 'EXECUTE' && typeof frame.payload?.stream_text === 'string') {
        if (!cancelled) write(frame.payload.stream_text);
      } else if (frame.phase === 'HEARTBEAT' && typeof frame.payload?.elapsed_ms === 'number') {
        // 心跳静默（REPL 不刷屏）；需要耗时见 REPORT 尾注。
      } else if (frame.phase === 'REPORT') {
        cancelCurrentTurn = null; // 回合收尾：Ctrl+C 恢复「退出」语义
        const reply = frame.payload?.reply ?? '';
        const status = frame.payload?.status ?? '';
        const err = frame.payload?.error;
        if (cancelled) { cancelled = false; return; }
        if (err !== undefined) {
          write(`\n[头犬回复失败] ${err}\n`);
        } else if (showThinking && reply !== '') {
          const { thinking } = splitThinking(reply);
          if (thinking !== '') write(`\n--- 思考链 ---\n${thinking}\n-------------\n`);
          write(`[${status === '' ? '完成' : status}]\n`);
        } else {
          write(`\n[${status === '' ? '完成' : status}]\n`);
        }
      }
    },
    fetchImpl,
  );

  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input, output, terminal: false, prompt: '' });
  write(`mush chat（${opts.baseUrl}）——输入消息回车发送；Ctrl+T 思维链开关；Ctrl+C 中断当前回合；/quit 退出。\n`);
  if (sessionId !== null) write(`已续接会话 ${sessionId}（与看板共用 runtime/chat 持久化）。\n`);

  // Ctrl+T 思维链开关 + Ctrl+C 统一取消（raw 模式 keypress；非 TTY 走全局 SIGINT）。
  const onInterruptRequest = (): void => {
    if (cancelCurrentTurn !== null) cancelCurrentTurn();
    else {
      write('\n');
      rl.close(); // 空转期 Ctrl+C = 退出（ask() 收到 close → 循环结束）
    }
  };
  if (typeof (input as NodeJS.ReadStream).isTTY === 'boolean' && (input as NodeJS.ReadStream).isTTY) {
    const { emitKeypressEvents } = await import('node:readline');
    emitKeypressEvents(input);
    (input as NodeJS.ReadStream).setRawMode(true);
    input.on('keypress', (_ch, key: { name?: string; ctrl?: boolean }) => {
      if (key && key.ctrl === true && key.name === 't') {
        showThinking = !showThinking;
        write(`\n[思维链${showThinking ? '展开' : '折叠'}]\nmush> `);
      } else if (key && key.ctrl === true && key.name === 'c') {
        onInterruptRequest();
      }
    });
  }
  process.on('SIGINT', onInterruptRequest);

  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      write('mush> ');
      const onLine = (line: string) => {
        rl.removeListener('line', onLine);
        rl.removeListener('close', onClose);
        resolve(line);
      };
      const onClose = () => {
        rl.removeListener('line', onLine);
        resolve(null);
      };
      rl.on('line', onLine);
      rl.on('close', onClose);
    });

  for (;;) {
    const line = await ask();
    if (line === null) break;
    const text = line.trim();
    if (text === '') continue;
    if (text === '/quit' || text === '/exit') break;
    if (text === '/think') {
      showThinking = !showThinking;
      write(`[思维链${showThinking ? '展开' : '折叠'}]\n`);
      continue;
    }
    if (text.startsWith('/resume ')) {
      sessionId = text.slice(8).trim();
      write(`已续接会话 ${sessionId}\n`);
      continue;
    }
    interrupted = false;
    cancelCurrentTurn = () => {
      interrupted = true;
      cancelled = true;
      write('\n[已中断当前回合；头犬侧派发仍在跑，可看板查看]\n');
    };
    let res;
    try {
      res = await fetchImpl(`${opts.baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(sessionId !== null ? { message: text, resume: sessionId } : { message: text }),
      });
    } catch (e) {
      cancelCurrentTurn = null;
      throw e;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      write(`[受理失败 ${res.status}] ${body.error ?? ''}\n`);
      continue;
    }
    const ack = (await res.json()) as { session_id?: string; dispatch_id?: string };
    if (typeof ack.session_id === 'string' && sessionId === null) {
      sessionId = ack.session_id;
      write(`（会话 ${sessionId} 已建立，与看板一致）\n`);
    }
    if (interrupted) write('[提示] 中断仅停本地渲染，不撤销服务端派发。\n');
  }

  sse.close();
  rl.close();
  write('mush chat 结束。\n');
  return 0;
}
