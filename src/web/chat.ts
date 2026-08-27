/**
 * mush 看板会话流式服务（GOAL-021）
 *
 * 核心职责：
 *  1. 接收前端消息（POST /api/chat），立即返回 202 异步受理 {dispatch_id, session_id}；
 *  2. 驱动头犬执行，并经 EventEmitter 产生会话阶段事件（ADMITTED, EXECUTE, HEARTBEAT, REPORT）；
 *  3. 会话记录以 JSONL 格式持久化在 runtime/chat/<session_id>.jsonl；
 *  4. 支持历史回溯（GET /api/chat/history?session=<id>）。
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { DispatchPipeline } from './dispatch.ts';
import { saveAttachment, type AttachmentInput, type StoredAttachment } from './attachments.ts';

export interface ChatTurn {
  role: 'user' | 'head';
  text: string;
  at_utc: string;
  dispatch_id?: string;
  attachments?: StoredAttachment[];
  /** GOAL-076 返工（承接 075 附录）：三段式帧持久化——思考/工具/计划卡随轮落盘，
   *  使历史会话回看时仍能重建三段式气泡（此前帧随会话结束即丢）。 */
  thinking?: string;
  tools?: string[];
  plan?: unknown;
}

export interface ChatAck {
  session_id: string;
  role: 'head';
  dispatch_id: string;
  status: 'PENDING';
  note: string;
}

export interface ChatFrameEvent {
  kind: 'chat';
  session_id: string;
  dispatch_id: string;
  phase: 'ADMITTED' | 'EXECUTE' | 'HEARTBEAT' | 'REPORT' | 'PLAN_WAIT' | 'PLAN_DECIDED';
  payload: Record<string, unknown>;
}

/** GOAL-075 切片3：计划门协议段（追加进非 solo 章程；solo 直聊不受门控）。 */
export const PLAN_GATE_CHARTER_SECTION = `

[派发计划门（Plan Gate）协议]
当且仅当 Owner 的请求需要多步骤执行、或需要向工犬派发子任务时：不要直接执行，也不要输出长篇方案正文——
只输出一个 <PLAN> 块（块外最多允许两句话说明）：
<PLAN>
{"goal_summary":"一句话目标","steps":[{"dog":"执行犬adapter_id","model":"provider/model 可省略","task":"该步任务描述","cap_usd":0.1,"timeout_s":300}],"est_cost_usd":0}
</PLAN>
规则：steps 每项对应一次派发；dog 必须使用在册通道名；cap 与 timeout 保守估计。
单轮问答、代码答疑、小段代码编写等无需派发子任务的请求：正常直接回答，禁止输出 <PLAN>。`;

export interface DispatchPlanStep {
  dog: string;
  model?: string;
  task: string;
  cap_usd?: number;
  timeout_s?: number;
}

export interface DispatchPlan {
  goal_summary?: string;
  steps: DispatchPlanStep[];
  est_cost_usd?: number;
}

export interface PendingPlan {
  plan_id: string;
  session_id: string;
  dispatch_id: string;
  adapter_id: string;
  effort: string;
  solo: boolean;
  plan: DispatchPlan;
  status: 'WAITING' | 'APPROVED' | 'REJECTED';
  created_at: string;
}

/** 从头犬回复中提取 <PLAN> 块；缺失/畸形（无 steps 或 step 缺 dog/task）返回 null
 * ——畸形按"未触发计划门"处理，头犬回复照常展示（fail-safe，不吞回复）。 */
export function extractPlanBlock(text: string): { plan: DispatchPlan } | null {
  const m = /<PLAN>\s*([\s\S]*?)\s*<\/PLAN>/.exec(text);
  if (m === null) return null;
  try {
    const parsed = JSON.parse(m[1]) as DispatchPlan;
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
    const stepsOk = parsed.steps.every(
      (s) => s !== null && typeof s === 'object' && typeof s.dog === 'string' && s.dog.trim() !== '' &&
        typeof s.task === 'string' && s.task.trim() !== '',
    );
    if (!stepsOk) return null;
    return { plan: parsed };
  } catch {
    return null;
  }
}

export const HEAD_DOG_CHARTER = `[系统角色设定]
你处于 mush 多 Agent 编排体系中的【头犬（Head Dog）】角色。
你的常设职责是：
  1. 需求澄清与方案架构：与人类 Owner 对话，拆解任务，输出清晰的实施规格；
  2. 队列与犬只编排：向工犬派发具体任务（通过派发机制），组织流水线或攻防协作；
  3. 安全与质量把关：严格执行单机安全红线，审查工犬回执，给出明确的验收裁决。
请用专业、精炼、清晰的中文回复人类 Owner。`;

export const SOLO_HEAD_DOG_CHARTER = `[系统角色设定：独奏直聊模式（Solo Direct Mode）]
你与人类 Owner 处于 1 对 1 沉浸式直聊模式。
在此模式下：
  1. 你全权负责当前需求的一切思考、方案规划、代码生成与答疑；
  2. 严禁向外部工犬派发子任务或转交第三方 Agent；
  3. 请直接输出完整、详尽、高质量的解决方案和代码实现。`;


export class ChatService extends EventEmitter {
  private readonly runtimeRoot: string;
  private readonly pipeline: DispatchPipeline;
  private readonly onEvent?: (event: ChatFrameEvent) => void;
  /** D82 修订：头犬聊天派发超时（秒）。旧硬编码 300s 在免费档通道抖动期
   *  （实测 pong 单发 41~58s 波动）必然截断长回复——f62c928f 实证。
   *  对齐 real 派发缺省 900s；可经 options 覆盖。 */
  private readonly chatTimeoutS: number;
  private readonly pending = new Map<string, Promise<void>>();
  /** GOAL-075 切片3：待决断派发计划（plan_id → 计划；内存态，重载后未决计划失效）。 */
  private readonly plans = new Map<string, PendingPlan>();

  constructor(options: { runtimeRoot: string; pipeline: DispatchPipeline; onEvent?: (event: ChatFrameEvent) => void; chatTimeoutS?: number }) {
    super();
    this.runtimeRoot = options.runtimeRoot;
    this.pipeline = options.pipeline;
    this.onEvent = options.onEvent;
    this.chatTimeoutS = options.chatTimeoutS ?? 900;
  }

  private chatDir(): string {
    const dir = path.join(this.runtimeRoot, 'chat');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private append(sessionId: string, turn: ChatTurn): void {
    const s = sessionId.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
      throw new Error('invalid session_id format (must match ^[A-Za-z0-9_-]{1,64}$)');
    }
    const file = path.join(this.chatDir(), `${s}.jsonl`);
    appendFileSync(file, JSON.stringify(turn) + '\n', 'utf8');
  }

  private emitFrame(
    phase: 'ADMITTED' | 'EXECUTE' | 'HEARTBEAT' | 'REPORT' | 'PLAN_WAIT' | 'PLAN_DECIDED',
    sessionId: string,
    dispatchId: string,
    payload: Record<string, unknown>,
  ): void {
    const frame: ChatFrameEvent = {
      kind: 'chat',
      session_id: sessionId,
      dispatch_id: dispatchId,
      phase,
      payload,
    };
    this.emit(phase, frame);
    this.emit('frame', frame);
    if (this.onEvent) {
      try {
        this.onEvent(frame);
      } catch (err) {
        console.warn('[chat] onEvent callback error:', err);
      }
    }
  }

  /** 解析头犬适配器与档位（缺省 head-dog / HIGH；支持已验证执行犬）。 */
  private resolveHeadAdapter(adapterId: string): { adapterId: string; effortLevels: string[] } {
    const target = adapterId.trim() !== '' ? adapterId.trim() : 'head-dog';
    let adapters: any[] = [];
    if (typeof (this.pipeline as any).listAdapters === 'function') {
      adapters = (this.pipeline as any).listAdapters();
    } else if (typeof (this.pipeline as any).roster === 'function') {
      adapters = (this.pipeline as any).roster();
    }
    const found = adapters.find((a) => a.adapter_id === target);
    if (!found) {
      throw new Error(`adapter ${target} is UNVERIFIED or unknown, only verified adapters can serve as head-dog`);
    }
    if (found.role !== 'head' && !found.verified) {
      throw new Error(`adapter ${target} is UNVERIFIED and cannot serve as head-dog`);
    }
    const effortLevels = (found.effort_levels ?? ['LOW', 'MEDIUM', 'HIGH']).map((l: string) => l.toUpperCase());
    return { adapterId: target, effortLevels };
  }

  /**
   * POST /api/chat 入口（GOAL-021 U1）：
   *  立即返回 202 异步受理回执；后台异步执行并通过 SSE chat 帧流式推送；
   *  校验错误（空消息/未知/未验证 adapter/非法 effort）仍同步抛（HTTP 400）。
   */
  async post(input: { message: string; resume?: string; adapter_id?: string; effort?: string; attachments?: AttachmentInput[]; solo?: boolean }): Promise<ChatAck> {
    const message = String(input.message ?? '').trim();
    if (message === '') throw new Error('message must be non-blank');
    const requestedAdapter =
      input.adapter_id !== undefined && input.adapter_id.trim() !== '' ? input.adapter_id.trim() : 'head-dog';
    const { adapterId, effortLevels } = this.resolveHeadAdapter(requestedAdapter);
    const defaultEffort = effortLevels.includes('HIGH') ? 'HIGH' : effortLevels.includes('LOW') ? 'LOW' : effortLevels[0];
    const effort = input.effort !== undefined && input.effort.trim() !== '' ? input.effort.trim().toUpperCase() : defaultEffort;
    if (!effortLevels.includes(effort)) {
      throw new Error(`effort must be one of ${effortLevels.join('|')} (got: ${input.effort})`);
    }
    let sessionId: string;
    if (input.resume && input.resume.trim() !== '') {
      const r = input.resume.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(r)) {
        throw new Error('invalid resume session_id format (must match ^[A-Za-z0-9_-]{1,64}$)');
      }
      sessionId = r;
    } else {
      sessionId = randomUUID().replace(/-/g, '');
    }
    const dispatchId = randomUUID().replace(/-/g, '');
    let storedAttachments: StoredAttachment[] = [];
    if (Array.isArray(input.attachments) && input.attachments.length > 0) {
      storedAttachments = input.attachments.map((att) => saveAttachment(this.runtimeRoot, att));
    }
    this.append(sessionId, {
      role: 'user',
      text: message,
      at_utc: new Date().toISOString(),
      attachments: storedAttachments.length > 0 ? storedAttachments : undefined,
    });

    // 后台执行：ADMITTED → EXECUTE(增量) → HEARTBEAT → REPORT。
    const run = this.execute(adapterId, effort, sessionId, dispatchId, message, storedAttachments, input.solo === true);
    this.pending.set(dispatchId, run);
    void run.finally(() => this.pending.delete(dispatchId));

    return {
      session_id: sessionId,
      role: 'head',
      dispatch_id: dispatchId,
      status: 'PENDING',
      note: 'accepted; reply streams over GET /api/stream (kind=chat)',
    };
  }

  /** GOAL-021 U1/U2/U3：真实派发后台执行 + chat 帧推送 + 回复落盘。 */
  private async execute(
    adapterId: string,
    effort: string,
    sessionId: string,
    dispatchId: string,
    message: string,
    attachments: StoredAttachment[] = [],
    solo: boolean = false,
  ): Promise<void> {
    const startedAt = Date.now();
    this.emitFrame('ADMITTED', sessionId, dispatchId, { status: 'ADMITTED' });
    // F-48 修复：dsh headless 无 --resume——多轮上下文改为 prompt 缝合。
    const prior = (await this.history(sessionId, 12)).turns.filter((t) => t.text && !t.text.startsWith('[dry-run'));
    const transcript = prior.length > 1
      ? '\n\n[对话历史（最近，供上下文）]\n' + prior.slice(0, -1).map((t) => (t.role === 'user' ? 'Owner: ' : '头犬: ') + t.text).join('\n') + '\n'
      : '';
    // 累加增量文本作为回复全文（REPORT 用）；若通道未给增量，回退 stdout_tail。
    let replyAccum = '';
    const activeCharter = solo ? SOLO_HEAD_DOG_CHARTER : HEAD_DOG_CHARTER + PLAN_GATE_CHARTER_SECTION;
    try {
      const record = await this.pipeline.dispatch({
        adapter_id: adapterId,
        prompt: activeCharter + transcript + (attachments.length > 0 ? '\n\n[附加本地图片/多模态视觉文件]:\n' + attachments.map((a, i) => `  ${i + 1}. ${a.name} -> ${a.localPath}`).join('\n') : '') + '\n\nOwner: ' + message,
        effort,
        real: true, // 聊天即真实执行；GP-32/D30：owner 亲自敲字即批准（originOwner）
        timeout_s: this.chatTimeoutS,
      }, {
        originOwner: true,
        dispatchId,
        onStdout: (chunk) => {
          replyAccum += chunk;
          // 心跳（耗时）随增量帧同出：前端实时看生成进度 + 已耗时。
          this.emitFrame('HEARTBEAT', sessionId, dispatchId, { elapsed_ms: Date.now() - startedAt });
          this.emitFrame('EXECUTE', sessionId, dispatchId, { stream_text: chunk });
        },
      });
      const headText = replyAccum !== '' ? replyAccum : record.stdout_tail?.text ?? `[dry-run ${record.status}]`;
      // D82 修订：超时/失败但已有部分产出时如实标注——f62c928f 实证 300s 截断
      // 时 stdout 非空，已生成内容不应被终态淹没。
      const degraded = record.status === 'TIMEOUT' || record.status === 'FAIL' || record.status === 'INTERRUPTED';
      const partialNote =
        degraded && headText.trim() !== '' && !headText.startsWith('[dry-run')
          ? `\n\n[注意：本单 ${record.status}，以上为中断前已产出的部分回复；可点「重试」重发]`
          : '';
      // GOAL-075 切片3：计划门拦截——头犬输出 <PLAN> 块时转为待决断计划，
      // 气泡折叠为一句等待语（原始计划进 PLAN_WAIT 帧），owner 批准后自动续跑。
      const planHit = solo ? null : extractPlanBlock(headText);
      // GOAL-076 返工（承接 075 附录）：拆分思考/工具块随轮持久化，供历史回看重建三段式。
      const thinkM = /<think>([\s\S]*?)<\/think>/i.exec(headText);
      const persistedThinking = thinkM ? thinkM[1].trim() : undefined;
      const persistedTools = (headText.match(/<tool>[\s\S]*?<\/tool>/gi) || [])
        .map((t) => t.replace(/<\/?tool>/gi, '').trim()).filter((t) => t !== '');
      let bubbleText = headText + partialNote;
      let planIdForFrame: string | undefined;
      if (planHit !== null) {
        const planId = randomUUID().replace(/-/g, '');
        this.plans.set(planId, {
          plan_id: planId,
          session_id: sessionId,
          dispatch_id: dispatchId,
          adapter_id: adapterId,
          effort,
          solo,
          plan: planHit.plan,
          status: 'WAITING',
          created_at: new Date().toISOString(),
        });
        planIdForFrame = planId;
        bubbleText =
          `📋 已生成派发计划（${planHit.plan.steps.length} 步` +
          (planHit.plan.est_cost_usd !== undefined ? ` · 预估 $${planHit.plan.est_cost_usd}` : '') +
          `），等待 owner 决断。`;
      }
      this.append(sessionId, {
        role: 'head',
        text: bubbleText,
        at_utc: new Date().toISOString(),
        dispatch_id: record.dispatch_id,
        ...(persistedThinking ? { thinking: persistedThinking } : {}),
        ...(persistedTools.length > 0 ? { tools: persistedTools } : {}),
        ...(planHit !== null ? { plan: planHit.plan } : {}),
      });
      this.emitFrame('REPORT', sessionId, dispatchId, {
        status: record.status,
        elapsed_ms: Date.now() - startedAt,
        reply: bubbleText,
        ...(planIdForFrame !== undefined ? { plan_id: planIdForFrame } : {}),
      });
      if (planHit !== null && planIdForFrame !== undefined) {
        this.emitFrame('PLAN_WAIT', sessionId, dispatchId, { plan_id: planIdForFrame, plan: planHit.plan });
      }
    } catch (error) {
      const text = `[error] 头犬回复失败：${error instanceof Error ? error.message : String(error)}`;
      this.append(sessionId, { role: 'head', text, at_utc: new Date().toISOString(), dispatch_id: dispatchId });
      this.emitFrame('REPORT', sessionId, dispatchId, {
        status: 'FAIL',
        elapsed_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        reply: text,
      });
    }
  }

  /** GOAL-075 切片3：owner 对派发计划的决断。批准 = 以同会话续跑执行（计划
   * 全文随续跑指令下发，头犬按计划派发工犬）；可携 amended_steps 修订后执行；
   * 否决 = 计划终结，不产生任何派发。 */
  decidePlan(
    planId: string,
    decision: 'approve' | 'reject',
    amendedSteps?: DispatchPlanStep[],
  ): { ok: true; status: PendingPlan['status'] } {
    const pending = this.plans.get(planId);
    if (pending === undefined) throw new Error(`plan not found: ${planId}`);
    if (pending.status !== 'WAITING') throw new Error(`plan already decided (${pending.status}): ${planId}`);
    if (decision === 'approve') {
      const steps = (amendedSteps ?? pending.plan.steps).filter(
        (s) => s !== null && typeof s === 'object' && typeof s.dog === 'string' && typeof s.task === 'string',
      );
      if (steps.length === 0) throw new Error('amended steps must be non-empty');
      pending.status = 'APPROVED';
      const continuation =
        '[Owner 决断：计划已批准]\n请严格按以下计划立即执行（自行向对应工犬派发），完成后给出验收结论：\n' +
        JSON.stringify({ goal_summary: pending.plan.goal_summary, steps }, null, 2);
      const dispatchId = randomUUID().replace(/-/g, '');
      const run = this.execute(pending.adapter_id, pending.effort, pending.session_id, dispatchId, continuation, [], pending.solo);
      this.pending.set(dispatchId, run);
      void run.finally(() => this.pending.delete(dispatchId));
      this.emitFrame('PLAN_DECIDED', pending.session_id, pending.dispatch_id, {
        plan_id: planId,
        decision,
        new_dispatch_id: dispatchId,
        steps,
      });
      return { ok: true, status: pending.status };
    }
    pending.status = 'REJECTED';
    this.emitFrame('PLAN_DECIDED', pending.session_id, pending.dispatch_id, { plan_id: planId, decision });
    return { ok: true, status: pending.status };
  }

  async whenSettled(dispatchId?: string): Promise<void> {
    if (dispatchId !== undefined) {
      await (this.pending.get(dispatchId) ?? Promise.resolve());
      return;
    }
    await Promise.all(Array.from(this.pending.values()));
  }

  async history(sessionId: string, limit = 50): Promise<{ turns: ChatTurn[] }> {
    const s = String(sessionId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
      throw new Error('invalid session_id format (must match ^[A-Za-z0-9_-]{1,64}$)');
    }
    const file = path.join(this.chatDir(), `${s}.jsonl`);
    if (!existsSync(file)) return { turns: [] };
    const turns = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as ChatTurn];
        } catch {
          return [];
        }
      });
    return { turns: turns.slice(-Math.max(1, Math.floor(limit))) };
  }
}
