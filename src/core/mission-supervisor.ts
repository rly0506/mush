/**
 * GOAL-082：任务监理（Mission Supervisor）
 *
 * 只对一个问题的闭环负责：这个任务还活着吗？卡住了我怎么办？
 * 心跳滞判 → 干预阶梯（换道重试 → 失败现场喂头犬重排 → 升级提问）→ 完成核验。
 *
 * 红线：监理无免死金牌——所有干预都是"建议/钩子"，真正派发仍走管线 admission
 * （D30/预算门/熔断一律生效）；停机期间一级/二级干预被拒，直接三级升级。
 * 设计为自包含内核：经钩子与宿主（server）解耦，零反向依赖。
 */

export type StallPhase = 'HEALTHY' | 'STALLED' | 'RETRYING' | 'REPLAN_PENDING' | 'ESCALATED';

export interface SupervisorEvent {
  kind: 'stall-detected' | 'intervene-retry' | 'intervene-replan' | 'escalate' | 'unfrozen' | 'verified-done' | 'unverified-done' | 'completion-rejected';
  task_id: string;
  detail: string;
  at_utc: string;
}

export interface MissionState {
  task_id: string;
  phase: StallPhase;
  last_progress_at_utc: string;
  stall_since_utc: string | null;
  interventions: Array<{ at_utc: string; step: string; detail: string }>;
  failure_count: number;
  completion_claims: number;
  last_dispatch_id?: string;
}

export interface StallReport {
  task_id: string;
  phase: StallPhase;
  stalled_for_ms: number;
  failure_count: number;
  last_dispatch_id?: string;
  summary: string;
}

export interface SupervisorHooks {
  /** 一级：换道重试——宿主经 080 故障转移语义重新入队该子级；返回是否成功入队。 */
  retryDispatch?(taskId: string, report: StallReport): Promise<boolean>;
  /** 二级：失败现场喂头犬走计划门重排（复用 G075 amend 通道）。 */
  replanRequest?(taskId: string, report: StallReport): Promise<void>;
  /** 三级：向 owner 升级一个具体可答的问题（聊天流 + toast，而非笼统受阻）。 */
  escalate?(taskId: string, question: string): void;
  /** 完成核验：G028 独立验证犬对照 GoD 核验完工声明；未配置 = 诚实放行但标 unverified。 */
  verifyCompletion?(taskId: string, claim: string): Promise<{ ok: boolean; reason?: string }>;
}

interface ObservedDispatchLike {
  dispatch_id: string;
  task_id?: string;
  adapter_id: string;
  status: string;
  error: string | null;
}

const DEFAULT_STALL_MS = 8 * 60_000; // 默认 8 分钟无实质进展判滞（保守，可配）

export class MissionSupervisor {
  private readonly missions = new Map<string, MissionState>();
  private readonly events: SupervisorEvent[] = [];
  private readonly now: () => Date;
  private readonly stallThresholdMs: number;
  private readonly hooks: SupervisorHooks;

  constructor(opts: { now?: () => Date; stallThresholdMs?: number; hooks?: SupervisorHooks } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.stallThresholdMs = opts.stallThresholdMs ?? DEFAULT_STALL_MS;
    this.hooks = opts.hooks ?? {};
  }

  /** 管线事件监听入口（server 把 setEventListener 接进来）。有任务回链的事件才算心跳。 */
  observeDispatch(record: ObservedDispatchLike): void {
    const taskId = record.task_id;
    if (taskId === undefined || taskId === '') return;
    const state = this.ensure(taskId);
    const at = this.now().toISOString();
    // 任何派发活动（含失败的尝试）都是进展信号——尝试本身即"还活着"
    state.last_progress_at_utc = at;
    state.last_dispatch_id = record.dispatch_id;
    if (state.phase === 'STALLED' || state.phase === 'RETRYING' || state.phase === 'REPLAN_PENDING') {
      state.phase = 'HEALTHY';
      state.stall_since_utc = null;
    }
    if (record.status === 'FAIL' || record.status === 'TIMEOUT') state.failure_count += 1;
    if (record.status === 'PASS' || record.status === 'DRY_RUN') state.failure_count = 0;
    // 进展信号不发事件（噪声治理）：仅终态与干预经 pushEvent 留痕。
  }

  /** 滞涩扫描（读时触发，无定时器——测试确定性）。每个滞涩任务沿阶梯走一步。 */
  async sweep(): Promise<{ swept: number; escalated: string[]; retried: string[]; replanned: string[] }> {
    const at = this.now();
    const result = { swept: 0, escalated: [] as string[], retried: [] as string[], replanned: [] as string[] };
    for (const state of this.missions.values()) {
      if (state.phase === 'ESCALATED') continue; // 已移交 owner，监理不再自动干预
      const stalledForMs = at.getTime() - new Date(state.last_progress_at_utc).getTime();
      if (stalledForMs < this.stallThresholdMs) continue;
      result.swept += 1;
      if (state.stall_since_utc === null) state.stall_since_utc = state.last_progress_at_utc;
      const report = this.buildReport(state, stalledForMs);
      if (state.phase === 'HEALTHY' || state.phase === 'STALLED') {
        // 一级：换道重试
        state.phase = 'RETRYING';
        state.interventions.push({ at_utc: at.toISOString(), step: 'retry', detail: report.summary });
        this.pushEvent({ kind: 'intervene-retry', task_id: state.task_id, detail: report.summary, at_utc: at.toISOString() });
        if (this.hooks.retryDispatch !== undefined) {
          const queued = await this.hooks.retryDispatch(state.task_id, report);
          if (!queued) state.phase = 'REPLAN_PENDING'; // 入队失败即升二级
        }
        result.retried.push(state.task_id);
      } else if (state.phase === 'RETRYING') {
        // 二级：失败现场喂头犬重排
        state.phase = 'REPLAN_PENDING';
        state.interventions.push({ at_utc: at.toISOString(), step: 'replan', detail: report.summary });
        this.pushEvent({ kind: 'intervene-replan', task_id: state.task_id, detail: report.summary, at_utc: at.toISOString() });
        await this.hooks.replanRequest?.(state.task_id, report);
        result.replanned.push(state.task_id);
      } else if (state.phase === 'REPLAN_PENDING') {
        // 三级：升级提问——具体可答的问题，不笼统受阻
        state.phase = 'ESCALATED';
        const question =
          `任务 ${state.task_id} 滞涩 ${Math.round(stalledForMs / 60_000)} 分钟：已尝试换道与重排仍无进展` +
          `（累计失败 ${state.failure_count} 次，最近派发 ${report.last_dispatch_id ?? 'n/a'}）。` +
          `请确认：任务描述是否需要修正，或授权放弃该任务？`;
        state.interventions.push({ at_utc: at.toISOString(), step: 'escalate', detail: question });
        this.pushEvent({ kind: 'escalate', task_id: state.task_id, detail: question, at_utc: at.toISOString() });
        this.hooks.escalate?.(state.task_id, question);
        result.escalated.push(state.task_id);
      }
    }
    return result;
  }

  /** 受阻自解冻：给定"当前活着的犬集合"，其上有受阻任务的自动转就绪（留痕）。 */
  unfreezeRecovered(aliveAdapterIds: Set<string>, unblockFn: (taskId: string, by: string) => void): string[] {
    const unfrozen: string[] = [];
    for (const taskId of this.blockedByAdapter.keys()) {
      const adapterId = this.blockedByAdapter.get(taskId)!;
      if (aliveAdapterIds.has(adapterId)) {
        unblockFn(taskId, 'mission-supervisor');
        this.blockedByAdapter.delete(taskId);
        unfrozen.push(taskId);
        this.pushEvent({
          kind: 'unfrozen',
          task_id: taskId,
          detail: `通道 ${adapterId} 恢复在线，受阻任务自动转就绪`,
          at_utc: this.now().toISOString(),
        });
      }
    }
    return unfrozen;
  }

  /** 派发受阻（BLOCKED 推进）时登记"受阻归因犬"，供通道恢复后自解冻。 */
  noteBlocked(taskId: string, adapterId: string): void {
    this.blockedByAdapter.set(taskId, adapterId);
  }

  /** 完成核验门：头犬宣称完成 ≠ DONE。配置了验证钩子则强制核验；
   *  未配置钩子时诚实放行但标 unverified（绝不冒充已验证）。 */
  async approveCompletion(taskId: string, claim: string): Promise<{ done: boolean; verified: boolean; reason?: string }> {
    const state = this.ensure(taskId);
    state.completion_claims += 1;
    const at = this.now().toISOString();
    if (this.hooks.verifyCompletion === undefined) {
      this.pushEvent({ kind: 'unverified-done', task_id: taskId, detail: claim.slice(0, 200), at_utc: at });
      return { done: true, verified: false };
    }
    const verdict = await this.hooks.verifyCompletion(taskId, claim);
    if (verdict.ok) {
      this.pushEvent({ kind: 'verified-done', task_id: taskId, detail: claim.slice(0, 200), at_utc: at });
      return { done: true, verified: true };
    }
    this.pushEvent({
      kind: 'completion-rejected',
      task_id: taskId,
      detail: `完工声明被验证犬拦截：${verdict.reason ?? 'unspecified'}`,
      at_utc: at,
    });
    return { done: false, verified: false, reason: verdict.reason ?? 'verification failed' };
  }

  overview(): MissionState[] {
    return [...this.missions.values()].map((m) => ({ ...m, interventions: [...m.interventions] }));
  }

  eventLog(): SupervisorEvent[] {
    return [...this.events];
  }

  private blockedByAdapter = new Map<string, string>();

  private ensure(taskId: string): MissionState {
    let state = this.missions.get(taskId);
    if (state === undefined) {
      state = {
        task_id: taskId,
        phase: 'HEALTHY',
        last_progress_at_utc: this.now().toISOString(),
        stall_since_utc: null,
        interventions: [],
        failure_count: 0,
        completion_claims: 0,
      };
      this.missions.set(taskId, state);
    }
    return state;
  }

  private buildReport(state: MissionState, stalledForMs: number): StallReport {
    return {
      task_id: state.task_id,
      phase: state.phase,
      stalled_for_ms: stalledForMs,
      failure_count: state.failure_count,
      last_dispatch_id: state.last_dispatch_id,
      summary: `滞涩 ${Math.round(stalledForMs / 60_000)} 分钟，累计失败 ${state.failure_count} 次`,
    };
  }

  private pushEvent(event: SupervisorEvent): void {
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500); // 有界留痕
  }
}
