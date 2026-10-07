/**
 * GOAL-084 §3.4：固定阶段协调器——协调(1) → 独立提案(2) → 互评(2) → 修订(2)，
 * 正常恰好 7 次 mush 发起的模型调用；格式/可重试失败共享全场 1 次重试（复用
 * 会话额度机制：每轮经管线 internal.collab 原子占额，不另建计数器）。
 *
 * GOAL-085：同一编排支持三席（A/B/C）——协调(1) → 提案(3) → 两两互评(6) → 修订(3)，
 * 正常恰好 13 次 + 共享重试 1 次。评审轮逐条按授权快照冻结的 review_relations 派发
 * （顺序 A→B,A→C,B→A,B→C,C→A,C→B），每次评审只发送**被评审的那一份提案**与该席位
 * 获准材料（不含任何人的评审）；修订只接收针对自己提案的**全部**评审（不含别人的
 * 修订）。三席使用独立版本的协调模板与 coordination Schema；双席模板/契约与哈希不变。
 *
 * 每轮派发前核对批准的 skill 注册表哈希（变化即停止）；重启后存在未确认结束
 * 的调用 → 标记中断并拒绝自动重派；全部参与席位修订齐备才完成会话。输出按各阶段
 * 正式 Schema 校验，材料引用与回应对象做语义核验；无效输出以派发记录为证，最多
 * 消耗一次共享重试，重试仍无效则会话转 failed。
 */

import { randomUUID } from 'node:crypto';
import { extractAnswerFromEvent, isFailedTerminal, isNativeEventEnvelope, isPlainObject } from '../adapters/answer-envelope.ts';
import {
  COLLAB_SEATS,
  deriveReviewRelations,
  type CollabReviewRelation,
  type CollabSeat,
  type CollaborationBlackboard,
} from './collaboration-blackboard.ts';
import {
  collabSkillRegistrySha256,
  collabSkillSchemasFor,
  collabSkillTemplate,
  validateCollabJson,
} from './collaboration-skills.ts';

export class CollaborationRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollaborationRunError';
  }
}

export interface CollaborationDispatchResultLike {
  dispatch_id?: string;
  status: string;
  error?: string | null;
  structured_output?: unknown;
  stdout_tail?: { text: string; truncated: boolean } | null;
}

export type CollaborationDispatchFn = (
  req: { adapter_id: string; model_id?: string; effort?: string; prompt: string; real: true; timeout_s: number },
  internal: {
    collab: { session_id: string; seat: CollabSeat; kind: 'normal' | 'retry' };
    restrictTools: true;
    /** 各阶段正式 Schema（经管线 output_schema 旗标下发，通道未声明则降级）。 */
    outputSchema?: unknown;
    /** 完整输出累积通道——stdout_tail 只有 2048 字符，长 JSON 从这里读。 */
    onStdout?: (chunk: string) => void;
    /** 预生成派发 ID（32 位十六进制）——看板取消可即时定位在途派发。 */
    dispatchId?: string;
  },
) => Promise<CollaborationDispatchResultLike>;

export type CollaborationRunOutcome = {
  status: 'completed' | 'failed' | 'interrupted';
  reason?: string;
  dispatch_ids: string[];
};

type Phase = 'coordination' | 'proposal' | 'review' | 'revision';

interface CoordinatorSnapshot {
  topic: string;
  constraints?: string;
  single_call_timeout_s: number;
  skill_registry_sha256?: string;
  materials: Array<{ material_id: string; name: string; allowed_seats: CollabSeat[] }>;
  participants: Array<{ seat: CollabSeat; adapter_id: string; model_id?: string; effort?: string; is_coordinator?: boolean }>;
  /** GOAL-085：冻结的两两互评关系；旧快照缺失时按参与者派生（同口径）。 */
  review_relations?: CollabReviewRelation[];
}

class SessionAborted extends Error {
  readonly outcome: 'failed' | 'interrupted';
  constructor(outcome: 'failed' | 'interrupted', message: string) {
    super(message);
    this.name = 'SessionAborted';
    this.outcome = outcome;
  }
}

interface AssignmentPlan {
  a_focus: string;
  b_focus: string;
  c_focus?: string;
  material_plan: Partial<Record<CollabSeat, string[]>>;
  notes: string;
}

interface RoundState {
  sessionId: string;
  snapshot: CoordinatorSnapshot;
  /** 参与席位（固定顺序 A→B→C）——全部轮次按它遍历，不再硬编码两席。 */
  seats: CollabSeat[];
  /** 冻结评审关系（授权快照唯一来源）；评审轮逐条派发。 */
  relations: CollabReviewRelation[];
  dispatchIds: string[];
  retryUsed: boolean;
  assignment?: AssignmentPlan;
}

/** 派发结果 → 本轮观点对象（导出供回归脚本/测试直接对照，不改变生产调用路径）。
 *
 *  GOAL-085（终局优先级，2026-10-05 独立复核）：答案**只由最后一个权威终局**决定。
 *  权威终局 = 标识"本次运行已结束"的原生事件（claude `type:'result'`、
 *  agy `event:'result'`）。规则：
 *    1. 该终局内优先显式 `structured_output`，其次解析终局携带的答案文本；
 *    2. 终局失败（`subtype≠success`/`status≠SUCCESS`/`is_error`）→ **拒绝整段**，
 *       既不沿用更早终局的 `structured_output`，也不回退到更早的答案行；
 *    3. 该终局里没有可解析的答案 → 本段无答案（不拿更早的草稿顶替）；
 *    4. 原生流里**没有**权威终局时，才回退：通道解析器的 `structured_output` 优先，
 *       其次取最后一个非信封对象（fixture 裸 JSON、codex 文本输出）。
 *  此前"倒序扫描 + 带字段才覆盖"会让早期草稿在两种情形胜出：(a) 最后成功终局只在
 *  文本里给答案（纯文本 `FINAL` 不可解析，于是回退到早期终局的结构化草稿）；
 *  (b) 最后终局失败（缓存的早期结构化字段绕过拒绝检查）。 */
export function extractJsonObject(res: CollaborationDispatchResultLike, accumulatedStdout: string): unknown {
  const sources = [accumulatedStdout, res.stdout_tail?.text ?? ''].map((text) => text.trim()).filter((text) => text !== '');
  // 1) 权威终局优先：跨来源取**最后一个**终局事件（更长的完整输出在前，尾部片段在后，
  //    尾部被截断时那条终局解析不出来，不会覆盖完整输出里的终局）。
  let terminal: Record<string, unknown> | undefined;
  const eventsBySource: Array<Array<Record<string, unknown>>> = [];
  for (const text of sources) {
    const events = collectJsonObjects(text);
    eventsBySource.push(events);
    for (const event of events) if (isTerminalEvent(event)) terminal = event;
  }
  if (terminal !== undefined) {
    const payload = payloadOf(terminal);
    if (isFailedTerminal(terminal) || (payload !== undefined && isFailedTerminal(payload))) return undefined;
    return extractAnswerFromEvent(terminal);
  }
  // 2) 无权威终局时回退：通道解析器的结构化结果优先，其次最后一个非信封对象。
  if (isPlainObject(res.structured_output)) return res.structured_output;
  for (const events of eventsBySource) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (!isNativeEventEnvelope(events[i]!)) return events[i];
    }
  }
  return undefined;
}

/** 权威终局事件判定（claude `type:'result'` / agy `event:'result'`）。 */
function isTerminalEvent(record: Record<string, unknown>): boolean {
  return record.type === 'result' || record.event === 'result';
}

/** 终局把结果对象嵌在 `result` 里的形状（agy NDJSON）。 */
function payloadOf(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return isPlainObject(record.result) ? record.result : undefined;
}

/** 文本 → **有序** JSON 对象序列：整段是一个对象则只有它，否则按行取对象（忽略非 JSON 行）。 */
function collectJsonObjects(text: string): Array<Record<string, unknown>> {
  const whole = parseJsonObjectText(text);
  if (whole !== undefined) return [whole];
  const records: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed[0] !== '{') continue;
    const record = parseJsonObjectText(trimmed);
    if (record !== undefined) records.push(record);
  }
  return records;
}

/** 文本 → JSON 对象（非对象/非 JSON 一律 undefined，不抛错）。 */
function parseJsonObjectText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export class CollaborationCoordinator {
  private readonly blackboard: CollaborationBlackboard;
  private readonly dispatch: CollaborationDispatchFn;
  private readonly onEvent?: (event: Record<string, unknown>) => void;

  constructor(
    blackboard: CollaborationBlackboard,
    dispatch: CollaborationDispatchFn,
    onEvent?: (event: Record<string, unknown>) => void,
  ) {
    this.blackboard = blackboard;
    this.dispatch = dispatch;
    this.onEvent = onEvent;
  }

  private emit(event: Record<string, unknown>): void {
    this.onEvent?.(event);
  }

  /** 执行整场会话；只接管已授权会话。in_progress = 上一进程中断遗留——
   *  未确认调用标记中断，整场不自动重派（§2.3 重启语义，保守处理）。
   *  同进程并发启动（活跃运行未结束再次 run）一律拒绝，不得误判为重启恢复。 */
  async run(sessionId: string): Promise<CollaborationRunOutcome> {
    const bb = this.blackboard;
    const row = bb.getSession(sessionId);
    bb.assertDualModelSession(sessionId);
    if (row.status !== 'authorized' && row.status !== 'in_progress') {
      throw new CollaborationRunError(`session ${sessionId} 不在可执行状态（${row.status}）——协调器只接管已授权会话`);
    }
    if (!bb.markRunActive(sessionId)) {
      throw new CollaborationRunError(`session ${sessionId} 已有活跃运行，拒绝并发启动（重复启动不是重启恢复）`);
    }
    try {
      if (row.status === 'in_progress') {
        // 进程遗留（本进程无活跃标记）：未确认调用标记中断，整场不自动重派。
        const startedRows = bb.getExecutionLog(sessionId).filter((r) => r.status === 'started');
        for (const r of startedRows) {
          bb.recordExecutionResult(r.seq as number, 'interrupted', '重启后未确认结束的调用，标记中断（不自动重派）');
        }
        bb.closeSession(sessionId, 'interrupted');
        return { status: 'interrupted', reason: '上一进程中断遗留的会话；未确认调用已标记中断，不自动重派', dispatch_ids: [] };
      }
      this.emit({ kind: 'collab', session_id: sessionId, type: 'session_started' });
      return await this.executeAuthorized(sessionId);
    } finally {
      bb.clearRunActive(sessionId);
      bb.clearStop(sessionId);
      bb.setCurrentDispatch(sessionId, null);
    }
  }

  private async executeAuthorized(sessionId: string): Promise<CollaborationRunOutcome> {
    const bb = this.blackboard;
    const snapshot: CoordinatorSnapshot = bb.getAuthorizationSnapshot(sessionId);
    // 席位与评审关系都取自会话（席位 = 参与者声明顺序 A→B→C；关系 = 冻结集合，
    // 旧快照按参与者派生）——协调器不自行拼装评审对。
    const seats = COLLAB_SEATS.filter((seat) => snapshot.participants.some((p) => p.seat === seat));
    const relations = snapshot.review_relations !== undefined && snapshot.review_relations.length > 0
      ? snapshot.review_relations.map((r) => ({ author: r.author, target: r.target }))
      : deriveReviewRelations(seats);
    const state: RoundState = { sessionId, snapshot, seats, relations, dispatchIds: [], retryUsed: false };

    // 运行实例身份由 mush 分配并绑定（模型自报不作数；§2.1 身份纪律）。
    for (const p of snapshot.participants) {
      bb.bindRunInstance(sessionId, p.seat, `collab/${sessionId}/${p.seat}`);
    }

    try {
      // 阶段一（coordination）：协调者分配建议，1 次。
      const coordinatorSeat = snapshot.participants.find((p) => p.is_coordinator)?.seat;
      if (coordinatorSeat === undefined) throw new CollaborationRunError('会话缺少协调者席位');
      const assignment = await this.round(state, coordinatorSeat, 'coordination', this.assignmentPrompt(state), (raw) =>
        this.validateAssignment(raw, state));
      // Schema 校验已保证形状（coordination required 字段），此处收窄安全。
      state.assignment = assignment.value as AssignmentPlan;

      // 阶段二（proposal）：独立提案，每席位 1 次——互不可见由黑板可见性保证。
      bb.setPhase(sessionId, 'proposal');
      const proposalIds = new Map<CollabSeat, string>();
      for (const seat of state.seats) {
        const vp = await this.round(state, seat, 'proposal', this.proposalPrompt(state, seat), (raw, sentIds) =>
          this.validateEvidence(raw, sentIds));
        proposalIds.set(seat, vp.id);
      }

      // 阶段三（review）：两两互评，每条冻结关系 1 次——只发送被评审的那份提案。
      bb.setPhase(sessionId, 'review');
      for (const relation of state.relations) {
        const targetId = proposalIds.get(relation.target);
        if (targetId === undefined) {
          throw new CollaborationRunError(`评审关系 ${relation.author}→${relation.target} 缺少目标提案`);
        }
        await this.round(state, relation.author, 'review',
          this.reviewPrompt(state, relation.author, relation.target, targetId), (raw, sentIds) =>
            this.validateReview(raw, targetId, sentIds));
      }

      // 阶段四（revision）：修订，每席位 1 次——只见针对自己提案的全部评审。
      bb.setPhase(sessionId, 'revision');
      for (const seat of state.seats) {
        await this.round(state, seat, 'revision', this.revisionPrompt(state, seat), (raw) =>
          this.validateRevision(raw));
      }

      // 完成条件：全部参与席位修订齐备（唯一键保证每席位每阶段至多一条）。
      const missing = bb.missingRevisions(sessionId);
      if (missing.length > 0) {
        const reason = `到达流程末尾但修订未齐备（缺 ${missing.join('、')}）`;
        bb.closeSession(sessionId, 'failed');
        this.emit({ kind: 'collab', session_id: sessionId, type: 'failed', reason });
        return { status: 'failed', reason, dispatch_ids: state.dispatchIds };
      }
      bb.closeSession(sessionId, 'completed');
      this.emit({ kind: 'collab', session_id: sessionId, type: 'completed' });
      return { status: 'completed', dispatch_ids: state.dispatchIds };
    } catch (error) {
      if (bb.isStopRequested(sessionId) && !(error instanceof SessionAborted)) {
        bb.closeSession(sessionId, 'interrupted');
        return { status: 'interrupted', reason: 'owner 在派发预检期间请求停止，未继续启动调用', dispatch_ids: state.dispatchIds };
      }
      if (error instanceof SessionAborted) {
        if (error.outcome === 'failed') {
          try {
            bb.closeSession(sessionId, 'failed');
          } catch {
            // 已被并发关闭则如实保留首个终态。
          }
        }
        return { status: error.outcome, reason: error.message, dispatch_ids: state.dispatchIds };
      }
      // 普通异常收口（owner 复核：派发异常不得让会话停留在 authorized）——
      // 会话转 failed 保留证据后原样上抛。
      try {
        bb.closeSession(sessionId, 'failed');
      } catch {
        // 已终态则保留首个终态。
      }
      throw error;
    }
  }

  // ---- 单轮：派发（原子占额在管线内）→ Schema 校验 → 语义核验 → 观点落板 ----

  private async round(
    state: RoundState,
    seat: CollabSeat,
    phase: Phase,
    prompt: string,
    validate: (raw: object, sentIds: string[]) => { value: object; error?: string },
  ): Promise<{ id: string; value: object }> {
    this.checkTemplateHash(state);
    const bb = this.blackboard;
    const sessionId = state.sessionId;
    const schemas = collabSkillSchemasFor(state.seats.length);
    const participant = state.snapshot.participants.find((p) => p.seat === seat)!;
    const attempts: Array<'normal' | 'retry'> = ['normal'];
    if (!state.retryUsed) attempts.push('retry'); // 全场共享 1 次，占额即计数
    let lastError = '';
    // 本轮实际组装进提示词的获准材料（含正文）——manifest 与 evidence 校验都
    // 以这份实际发送内容为准，不直接复制分配计划（owner 复核）。
    const sentMaterials = phase === 'coordination' ? [] : this.sentMaterials(state, seat);
    const sentIds = sentMaterials.map((m) => m.material_id);

    for (const kind of attempts) {
      // 模板哈希在每次尝试前都核对（owner 复核：首次无效后模板变更，
      // 重试不得沿用新模板执行）。
      this.checkTemplateHash(state);
      // 整场停止：先阻止后续调用（本轮不再派发），在途派发由看板 cancel 收口。
      if (this.blackboard.isStopRequested(sessionId)) {
        bb.closeSession(sessionId, 'interrupted');
        throw new SessionAborted('interrupted', 'owner 请求整场停止：阻止后续调用，会话转中断');
      }
      let stdout = '';
      const template = collabSkillTemplate(phase, state.seats.length);
      // 预生成派发 ID 并登记在途——看板取消可即时定位在途派发（先阻后取消）。
      const dispatchId = randomUUID().replace(/-/g, '');
      bb.setCurrentDispatch(sessionId, dispatchId);
      this.emit({ kind: 'collab', session_id: sessionId, type: 'round_dispatched', phase, seat, dispatch_id: dispatchId, attempt: kind });
      const res = await this.dispatch(
        {
          adapter_id: participant.adapter_id,
          // 批准的模型随轮传递（未批准模型的席位不带 model_id）。
          ...(participant.model_id !== undefined ? { model_id: participant.model_id } : {}),
          ...(participant.effort !== undefined ? { effort: participant.effort } : {}),
          prompt: [
            template.body,
            `【阶段】${phase}`,
            `【席位】${seat}`,
            `【议题】${state.snapshot.topic}`,
            ...(state.snapshot.constraints !== undefined ? [`【约束】${state.snapshot.constraints}`] : []),
            // agy 的原生回合需要 finish 结束；受控 gate 已只允许这个无资源能力的
            // 返回入口。纯文本回答会被宿主继续提示并聚合为多份 JSON，不能绕过
            // D92 选择其中一份。只说明现有结束协议，不改变权限或终局采信规则。
            ...(participant.adapter_id === 'agy' ? [
              '【agy结束协议】本轮只通过原生 finish 工具提交最终答复：按该工具已有参数定义，把本阶段要求的唯一 JSON 对象原样作为最终答案并结束回合。不得先输出答案正文、再调用 finish；不得复制多份 JSON 或继续回应宿主的继续提示。',
              'finish 是当前受控讨论已有的纯答案结束入口，不授权读取、写入、命令、网络、MCP 或子 agent；其它工具仍全部禁止。finish 不可用或被拒时不得用其它工具替代，须如实失败。',
            ] : []),
            ...(kind === 'retry' ? [`【上次输出被拒绝】${lastError}`, '请修正后重新只输出一个 JSON 对象。'] : []),
            '',
            prompt,
          ].join('\n'),
          real: true,
          timeout_s: Math.max(5, Math.min(state.snapshot.single_call_timeout_s, 3600)),
        },
        {
          collab: { session_id: sessionId, seat, kind },
          restrictTools: true,
          outputSchema: schemas[phase],
          onStdout: (chunk: string) => {
            stdout += chunk;
          },
          dispatchId,
        },
      );
      bb.setCurrentDispatch(sessionId, null);
      if (res.dispatch_id !== undefined) state.dispatchIds.push(res.dispatch_id);
      this.emit({ kind: 'collab', session_id: sessionId, type: 'round_settled', phase, seat, status: res.status });

      if (res.status === 'INTERRUPTED') {
        bb.closeSession(sessionId, 'interrupted');
        this.emit({ kind: 'collab', session_id: sessionId, type: 'interrupted', phase, seat });
        throw new SessionAborted('interrupted', 'owner 停止了会话派发');
      }

      if (bb.isStopRequested(sessionId)) {
        bb.closeSession(sessionId, 'interrupted');
        throw new SessionAborted('interrupted', 'owner 请求停止：保留已结束调用，不形成新观点或继续派发');
      }
      const runnerOk = res.status === 'PASS' || res.status === 'DRY_RUN';
      const raw = runnerOk ? extractJsonObject(res, stdout) : undefined;
      let error = !runnerOk
        ? (res.error || `runner status ${res.status}`)
        : raw === undefined
          ? '输出不是单个 JSON 对象'
          : validateCollabJson(raw, schemas[phase]);
      let view: { value: object; error?: string } | undefined;
      if (error === null) {
        view = validate(raw as object, sentIds);
        error = view.error ?? null;
      }

      if (error === null && view !== undefined) {
        const typed = view.value as { evidence?: string[] };
        const viewpoint = bb.appendViewpoint({
          session_id: sessionId,
          author_instance: `collab/${sessionId}/${seat}`,
          body: JSON.stringify(view.value, null, 2),
          ...(phase === 'review' ? { responds_to: (view.value as { responds_to: string }).responds_to } : {}),
          ...(phase !== 'coordination'
            ? {
                evidence_material_ids: typed.evidence ?? [],
                manifest_material_ids: sentIds,
              }
            : {}),
        });
        this.emit({ kind: 'collab', session_id: sessionId, type: 'viewpoint', phase, seat, viewpoint_id: viewpoint.id });
        return { id: viewpoint.id, value: view.value };
      }

      // 无效输出：证据已随派发记录（stdout_tail/回执）保留；最多一次共享重试。
      lastError = error ?? 'unknown';
      if (kind === 'retry' || state.retryUsed) break;
      state.retryUsed = true;
    }

    throw new SessionAborted('failed', `阶段 ${phase} 席位 ${seat} 输出无效且共享重试已用尽：${lastError}`);
  }

  // ---- 语义核验（Schema 之外）：材料引用 ⊆ 实际发送清单；回应对象必须可见 ----

  private validateAssignment(raw: object, state: RoundState): { value: object; error?: string } {
    const plan = (raw as { material_plan: Partial<Record<CollabSeat, string[]>> }).material_plan ?? {};
    for (const seat of state.seats) {
      const assigned = plan[seat] ?? [];
      if (!Array.isArray(assigned)) {
        return { value: raw, error: `material_plan.${seat} 必须是材料 ID 数组` };
      }
      for (const materialId of assigned) {
        const material = state.snapshot.materials.find((m) => m.material_id === materialId);
        if (material === undefined) {
          return { value: raw, error: `material_plan 引用了不存在的材料 ${materialId}（拒绝并反馈，不静默剔除）` };
        }
        if (!material.allowed_seats.includes(seat)) {
          return { value: raw, error: `material_plan 把材料 ${materialId} 分配给未获准席位 ${seat}` };
        }
      }
    }
    return { value: raw };
  }

  /** evidence 引用必须 ⊆ 本轮实际发送清单（由实际组装内容派生，非分配计划）。 */
  private validateEvidence(raw: object, sentIds: string[]): { value: object; error?: string } {
    const evidence = (raw as { evidence?: string[] }).evidence ?? [];
    const unknown = evidence.filter((id) => !sentIds.includes(id));
    if (unknown.length > 0) {
      return { value: raw, error: `evidence 引用了未发送给该席位的材料：${unknown.join(', ')}` };
    }
    return { value: raw };
  }

  private validateReview(raw: object, targetId: string, sentIds: string[]): { value: object; error?: string } {
    const respondsTo = (raw as { responds_to: string }).responds_to;
    if (respondsTo !== targetId) {
      return { value: raw, error: `responds_to 必须是本轮可见的回应对象 ${targetId}` };
    }
    return this.validateEvidence(raw, sentIds);
  }

  private validateRevision(raw: object): { value: object; error?: string } {
    return { value: raw };
  }

  // ---- 提示词组装：模板 + 阶段/席位标记 + 该席位本阶段可见上下文 ----

  /** 该席位的关注点：双席取 a_focus/b_focus，三席取 a_focus/b_focus/c_focus。 */
  private focusFor(state: RoundState, seat: CollabSeat): string {
    const assignment = state.assignment;
    if (assignment === undefined) return '';
    if (seat === 'A') return assignment.a_focus;
    if (seat === 'B') return assignment.b_focus;
    return assignment.c_focus ?? '';
  }

  private assignmentPrompt(state: RoundState): string {
    return [
      '【可用材料清单】（分配建议只能引用这些 ID）',
      ...state.snapshot.materials.map((m) => `${m.material_id}: ${m.name}`),
      `【席位】本场共 ${state.seats.length} 席：${state.seats.join('、')}。`,
      '【任务】产出分配建议。',
    ].join('\n');
  }

  /** 该席位本轮实际发送的材料（含冻结正文）——提示词与 manifest 都以此为准。 */
  private sentMaterials(state: RoundState, seat: CollabSeat): Array<{ material_id: string; name: string; content: string }> {
    const plan = state.assignment?.material_plan[seat] ?? [];
    return this.blackboard
      .getVisibleContext(state.sessionId, seat)
      .materials.filter((m) => plan.includes(m.material_id))
      .map((m) => ({ material_id: m.material_id, name: m.name, content: m.content }));
  }

  private proposalPrompt(state: RoundState, seat: CollabSeat): string {
    return [
      `【席位关注点】${this.focusFor(state, seat)}`,
      '【发送给你的材料（获准正文）】',
      ...this.sentMaterials(state, seat).map((m) => `[${m.material_id}] ${m.name}\n${m.content}`),
      '【任务】产出你的独立提案。evidence 只能引用上列材料 ID。',
    ].join('\n');
  }

  /** 评审提示：只含**被评审的那一份提案**（作者 targetSeat）+ 本席位获准材料。
   *  三席时同一席位会有多轮评审，但每轮只看到该轮的那一份提案，不含任何人的评审。 */
  private reviewPrompt(state: RoundState, seat: CollabSeat, targetSeat: CollabSeat, targetId: string): string {
    const visible = this.blackboard.getVisibleContext(state.sessionId, seat);
    const target = visible.visible.find((v) => v.id === targetId && v.author_seat === targetSeat);
    return [
      `【回应对象】${targetId}`,
      `【被评审提案（席位 ${targetSeat}）】`,
      target?.body ?? '',
      '【发送给你的材料（获准正文）】',
      ...this.sentMaterials(state, seat).map((m) => `[${m.material_id}] ${m.name}\n${m.content}`),
      '【任务】产出你的评审。evidence 只能引用上列材料 ID。',
    ].join('\n');
  }

  /** 修订提示：自己的提案 + **全部**针对自己提案的评审（三席时 2 条），
   *  不含其他席位的修订、也不含与己无关的评审。 */
  private revisionPrompt(state: RoundState, seat: CollabSeat): string {
    const visible = this.blackboard.getVisibleContext(state.sessionId, seat);
    const own = visible.own.find((v) => v.kind === 'proposal');
    const reviews = visible.visible.filter((v) => v.kind === 'review'
      && own !== undefined && v.responds_to === own.id);
    return [
      '【你的原始提案】',
      own?.body ?? '',
      '【针对你提案的评审质疑】',
      ...reviews.map((v) => `[评审席位 ${v.author_seat}]\n${v.body}`),
      '【发送给你的材料（获准正文）】',
      ...this.sentMaterials(state, seat).map((m) => `[${m.material_id}] ${m.name}\n${m.content}`),
      '【任务】产出你的修订。',
    ].join('\n');
  }

  private checkTemplateHash(state: RoundState): void {
    // 注册表按席位数分版：双席会话仍与其 GOAL-084 批准快照一致（三席模板不影响它）。
    if (state.snapshot.skill_registry_sha256 !== collabSkillRegistrySha256(state.seats.length)) {
      throw new SessionAborted('failed', 'skill 模板注册表与批准快照不一致，停止执行（重新授权后方可运行）');
    }
  }
}
