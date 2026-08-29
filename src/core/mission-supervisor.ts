/**
 * GOAL-082：任务监理（Mission Supervisor）
 *
 * 只对一个问题的闭环负责：这个任务还活着吗？卡住了我怎么办？
 * 心跳滞判 → 干预阶梯（换道重试 → 失败现场喂头犬重排 → 升级提问）→ 完成核验。
 *
 * 心跳语义（审计修正 P0）：只有"新尝试启动/成功"是进展——ADMITTED/PASS/DRY_RUN
 * 复位心跳；FAIL/TIMEOUT/REJECTED 不复位（否则死通道反复重试永不滞判）。
 *
 * 阶梯跃迁（审计修正 P0）：一级钩子返回 'queued'（已入队）| 'rejected'
 * （被熔断/预检拒绝——按验收口径直接跳三级升级）| false（其它入队失败→升二级）。
 *
 * 红线：监理无免死金牌——所有干预都是钩子，真正派发仍走管线 admission
 * （D30/预算门/熔断一律生效）。自包含内核，经钩子与宿主解耦，零反向依赖。
 */

export type StallPhase = 'HEALTHY' | 'RETRYING' | 'REPLAN_PENDING' | 'ESCALATED';

export type RetryQueued = boolean | 'rejected';

export interface SupervisorEvent {
  kind: 'intervene-retry' | 'intervene-replan' | 'escalate' | 'unfrozen' | 'verified-done' | 'unverified-done' | 'completion-rejected';
  task_id: string;
  detail: string;
  at_utc: string;
}

export interface MissionState {
  task_id: string;
  phase: StallPhase;
  last_progress_at_utc: string;
  failure_count: number;
  last_dispatch_id?: string;
  last_real?: boolean;
}

export interface StallReport {
  task_id: string;
  phase: StallPhase;
  stalled_for_ms: number;
  failure_count: number;
  last_dispatch_id?: string;
  last_real?: boolean;
  summary: string;
}

export interface SupervisorHooks {
  /** 一级：换道重试——宿主重跑最近失败单（走同一 admission）。返回：
   *  true=已入队；'rejected'=被熔断/预检拒绝（跳三级）；false=其它失败（升二级）。 */
  retryDispatch?(taskId: string, report: StallReport): Promise<RetryQueued>;
  /** 二级：失败现场喂头犬走计划门重排（复用 G075 amend 通道）。 */
  replanRequest?(taskId: string, report: StallReport): Promise<void>;
  /** 三级：升级提问——内核拼好人话提问文本交给宿主广播（owner 裁决通道）。 */
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
  real?: boolean;
}

const DEFAULT_STALL_MS = 8 * 60_000; // 默认 8 分钟无实质进展判滞（保守，可配）

export class MissionSupervisor {
  private readonly missions = new Map<string, MissionState>();
  private readonly events: SupervisorEvent[] = [];
  private readonly now: () => Date;
  private readonly stallThresholdMs: number;
  private readonly hooks: SupervisorHooks;
  private sweeping = false; // 读时触发无定时器；防并发轮询插级/双干预

  constructor(opts: { now?: () => Date; stallThresholdMs?: number; hooks?: SupervisorHooks } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.stallThresholdMs = opts.stallThresholdMs ?? DEFAULT_STALL_MS;
    this.hooks = opts.hooks ?? {};
  }

  /** 管线事件监听入口（server 把 setEventListener 接进来）。有任务回链的事件才跟踪。
   *  心跳语义：ADMITTED/PASS/DRY_RUN 复位；FAIL/TIMEOUT/REJECTED 不复位只计数。 */
  observeDispatch(record: ObservedDispatchLike): void {
    const taskId = record.task_id;
    if (taskId === undefined || taskId === '') return;
    const state = this.ensure(taskId);
    state.last_dispatch_id = record.dispatch_id;
    state.last_real = record.real;
    if (record.status === 'FAIL' || record.status === 'TIMEOUT') {
      state.failure_count += 1;
      return; // 失败终态不是进展：不复位心跳（死通道反复重试也要能滞判）
    }
    if (record.status === 'REJECTED' || record.status === 'BLOCKED_WAITING_OWNER') {
      return; // 被拒/等审批同样不是进展
    }
    state.last_progress_at_utc = this.now().toISOString();
    if (state.phase !== 'ESCALATED') {
      state.phase = 'HEALTHY';
    }
    if (record.status === 'PASS' || record.status === 'DRY_RUN') state.failure_count = 0;
  }

  /** 滞涩扫描（读时触发）。每个滞涩任务沿阶梯走一步；并发调用直接让路。 */
  async sweep(): Promise<{ swept: number; escalated: string[]; retried: string[]; replanned: string[] }> {
    if (this.sweeping) return { swept: 0, escalated: [], retried: [], replanned: [] };
    this.sweeping = true;
    try {
      const at = this.now();
      const result = { swept: 0, escalated: [] as string[], retried: [] as string[], replanned: [] as string[] };
      for (const state of this.missions.values()) {
        if (state.phase === 'ESCALATED') continue; // 已移交 owner，监理不再自动干预
        const stalledForMs = at.getTime() - new Date(state.last_progress_at_utc).getTime();
        if (stalledForMs < this.stallThresholdMs) continue;
        result.swept += 1;
        const report = this.buildReport(state, stalledForMs);
        if (state.phase === 'HEALTHY') {
          // 一级：换道重试
          state.phase = 'RETRYING';
          this.pushEvent({ kind: 'intervene-retry', task_id: state.task_id, detail: report.summary, at_utc: at.toISOString() });
          if (this.hooks.retryDispatch !== undefined) {
            const queued = await this.hooks.retryDispatch(state.task_id, report);
            if (queued === 'rejected') {
              // 熔断/预检拒绝：一级走不通，按验收口径直接跳三级（不空转）
              this.escalate(state, report, at, '一级重试被拒（熔断/预检）');
              result.escalated.push(state.task_id);
              continue;
            }
            if (queued === false) {
              // 其它入队失败→立即执行二级（失败现场喂头犬重排），不留空档
              state.phase = 'REPLAN_PENDING';
              this.pushEvent({ kind: 'intervene-replan', task_id: state.task_id, detail: report.summary, at_utc: at.toISOString() });
              await this.hooks.replanRequest?.(state.task_id, report);
              result.replanned.push(state.task_id);
            }
          }
          result.retried.push(state.task_id);
        } else if (state.phase === 'RETRYING') {
          // 二级：失败现场喂头犬重排
          state.phase = 'REPLAN_PENDING';
          this.pushEvent({ kind: 'intervene-replan', task_id: state.task_id, detail: report.summary, at_utc: at.toISOString() });
          await this.hooks.replanRequest?.(state.task_id, report);
          result.replanned.push(state.task_id);
        } else if (state.phase === 'REPLAN_PENDING') {
          // 三级：升级提问（移交 owner）
          this.escalate(state, report, at);
          result.escalated.push(state.task_id);
        }
      }
      return result;
    } finally {
      this.sweeping = false;
    }
  }

  private escalate(state: MissionState, report: StallReport, at: Date, prefix?: string): void {
    state.phase = 'ESCALATED';
    const question =
      (prefix !== undefined ? `【${prefix}】` : '') +
      `任务 ${state.task_id} 滞涩 ${Math.round(report.stalled_for_ms / 60_000)} 分钟：` +
      `已尝试换道与重排仍无进展（累计失败 ${state.failure_count} 次，最近派发 ${state.last_dispatch_id ?? 'n/a'}）。` +
      `请确认：任务描述是否需要修正，或授权放弃该任务？`;
    this.pushEvent({ kind: 'escalate', task_id: state.task_id, detail: question, at_utc: at.toISOString() });
    // GOAL-081 修正： escalate 钩子契约传升级提问文本（宿主广播 owner 裁决问题）；
    // 此前误传 StallReport 对象，SSE supervisor_escalate 帧 question 字段为对象。
    this.hooks.escalate?.(state.task_id, question);
  }

  /** 受阻自解冻：归因犬恢复在线（探针 ok）→ 自动转就绪。unblockFn 失败不记假证据。 */
  unfreezeRecovered(aliveAdapterIds: Set<string>, unblockFn: (taskId: string) => void): string[] {
    const unfrozen: string[] = [];
    for (const [taskId, adapterId] of this.blockedByAdapter) {
      if (!aliveAdapterIds.has(adapterId)) continue;
      let ok = false;
      try {
        unblockFn(taskId);
        ok = true;
      } catch {
        ok = false; // 跨工作区陈旧任务等：不删归因、不发假事件
      }
      if (!ok) continue;
      this.blockedByAdapter.delete(taskId);
      unfrozen.push(taskId);
      this.pushEvent({
        kind: 'unfrozen',
        task_id: taskId,
        detail: `通道 ${adapterId} 恢复在线，受阻任务自动转就绪`,
        at_utc: this.now().toISOString(),
      });
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
    this.ensure(taskId).last_progress_at_utc = this.now().toISOString();
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
    return [...this.missions.values()].map((m) => ({ ...m }));
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
        failure_count: 0,
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
      last_real: state.last_real,
      summary: `滞涩 ${Math.round(stalledForMs / 60_000)} 分钟，累计失败 ${state.failure_count} 次`,
    };
  }

  private pushEvent(event: SupervisorEvent): void {
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500); // 有界留痕
  }
}
