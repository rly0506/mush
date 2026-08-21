/**
 * GOAL-045: SOP 工序流水线与工件自动接力引擎 (Pipeline Engine)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

export type PipelineStageType = 'SPEC' | 'ARCH' | 'CODE' | 'TEST' | 'AUDIT';

export type StageStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED_GATE' | 'FAILED';

export interface StageArtifact {
  summary: string;
  content: string;
  files?: string[];
  metadata?: Record<string, unknown>;
}

export interface PipelineStage {
  stage_id: string;
  type: PipelineStageType;
  name: string;
  assigned_dog: string;
  status: StageStatus;
  input_artifact: StageArtifact;
  output_artifact?: StageArtifact;
  gate_required: boolean;
  gate_passed: boolean;
  notes?: string;
  started_at_utc?: string;
  completed_at_utc?: string;
}

export interface PipelineSession {
  pipeline_id: string;
  task_title: string;
  workspace_root: string;
  status: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'ABORTED';
  current_stage_index: number;
  stages: PipelineStage[];
  max_budget_usd: number;
  spent_budget_usd: number;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface CreatePipelineParams {
  taskTitle: string;
  workspaceRoot: string;
  initialPrompt: string;
  maxBudgetUsd?: number;
  dogMapping?: Partial<Record<PipelineStageType, string>>;
  gateRules?: Partial<Record<PipelineStageType, boolean>>;
}

export const DEFAULT_STAGE_DOGS: Record<PipelineStageType, string> = {
  SPEC: 'kimi-code',
  ARCH: 'claude-code',
  CODE: 'agy',
  TEST: 'deepseek-code',
  AUDIT: 'zcode',
};

export const STAGE_DISPLAY_NAMES: Record<PipelineStageType, string> = {
  SPEC: '1. 需求与契约规格',
  ARCH: '2. 架构与依赖拓扑',
  CODE: '3. 核心功能实现',
  TEST: '4. 破坏性用例测试',
  AUDIT: '5. 头犬门禁与安全审计',
};

export class PipelineEngine {
  private runtimeRoot: string;
  private pipelinesDir: string;
  private cache: Map<string, PipelineSession> = new Map();

  constructor(runtimeRoot: string) {
    this.runtimeRoot = runtimeRoot;
    this.pipelinesDir = path.join(runtimeRoot, 'pipelines');
    if (!existsSync(this.pipelinesDir)) {
      try {
        mkdirSync(this.pipelinesDir, { recursive: true });
      } catch {}
    }
    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.pipelinesDir)) return;
    try {
      const files = readdirSync(this.pipelinesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const raw = readFileSync(path.join(this.pipelinesDir, file), 'utf-8');
            const data = JSON.parse(raw) as PipelineSession;
            if (data && data.pipeline_id) {
              this.cache.set(data.pipeline_id, data);
            }
          } catch {}
        }
      }
    } catch {}
  }

  public createPipeline(params: CreatePipelineParams): PipelineSession {
    const pipelineId = `pipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const stageTypes: PipelineStageType[] = ['SPEC', 'ARCH', 'CODE', 'TEST', 'AUDIT'];
    const dogMap = { ...DEFAULT_STAGE_DOGS, ...(params.dogMapping || {}) };
    const gateRules = { ARCH: true, CODE: true, ...(params.gateRules || {}) };

    const stages: PipelineStage[] = stageTypes.map((type, idx) => {
      const isFirst = idx === 0;
      return {
        stage_id: `stage-${type.toLowerCase()}`,
        type,
        name: STAGE_DISPLAY_NAMES[type],
        assigned_dog: dogMap[type] || 'claude-code',
        status: isFirst ? 'RUNNING' : 'PENDING',
        input_artifact: isFirst
          ? { summary: params.taskTitle, content: params.initialPrompt, files: [] }
          : { summary: '', content: '' },
        gate_required: !!gateRules[type],
        gate_passed: false,
        started_at_utc: isFirst ? now : undefined,
      };
    });

    const session: PipelineSession = {
      pipeline_id: pipelineId,
      task_title: params.taskTitle,
      workspace_root: params.workspaceRoot,
      status: 'IN_PROGRESS',
      current_stage_index: 0,
      stages,
      max_budget_usd: params.maxBudgetUsd ?? 2.5,
      spent_budget_usd: 0.0,
      created_at_utc: now,
      updated_at_utc: now,
    };

    this.cache.set(pipelineId, session);
    this.savePipeline(session);
    return session;
  }

  public getPipeline(pipelineId: string): PipelineSession | undefined {
    return this.cache.get(pipelineId);
  }

  public listPipelines(): PipelineSession[] {
    return Array.from(this.cache.values()).sort(
      (a, b) => new Date(b.created_at_utc).getTime() - new Date(a.created_at_utc).getTime()
    );
  }

  public completeStage(
    pipelineId: string,
    stageId: string,
    outputArtifact: StageArtifact,
    options: { costUsd?: number; notes?: string } = {}
  ): PipelineSession {
    const session = this.cache.get(pipelineId);
    if (!session) {
      throw new Error(`Pipeline session not found: ${pipelineId}`);
    }

    const stageIdx = session.stages.findIndex((s) => s.stage_id === stageId);
    if (stageIdx === -1) {
      throw new Error(`Stage not found: ${stageId}`);
    }

    const currentStage = session.stages[stageIdx];
    const now = new Date().toISOString();

    currentStage.output_artifact = outputArtifact;
    currentStage.completed_at_utc = now;
    if (options.notes) currentStage.notes = options.notes;
    if (options.costUsd) session.spent_budget_usd += options.costUsd;

    // 检查是否需要门禁拦截
    if (currentStage.gate_required && !currentStage.gate_passed) {
      currentStage.status = 'BLOCKED_GATE';
      session.status = 'PAUSED';
    } else {
      currentStage.status = 'COMPLETED';
      this.advanceToNextStage(session, stageIdx, outputArtifact, now);
    }

    session.updated_at_utc = now;
    this.savePipeline(session);
    return session;
  }

  public approveGate(pipelineId: string, stageId: string, notes?: string): PipelineSession {
    const session = this.cache.get(pipelineId);
    if (!session) {
      throw new Error(`Pipeline session not found: ${pipelineId}`);
    }

    const stageIdx = session.stages.findIndex((s) => s.stage_id === stageId);
    if (stageIdx === -1) {
      throw new Error(`Stage not found: ${stageId}`);
    }

    const currentStage = session.stages[stageIdx];
    currentStage.gate_passed = true;
    currentStage.status = 'COMPLETED';
    if (notes) {
      currentStage.notes = currentStage.notes ? `${currentStage.notes} | 门禁审批: ${notes}` : `门禁审批: ${notes}`;
    }

    const now = new Date().toISOString();
    const outputArtifact = currentStage.output_artifact || { summary: '无工件', content: '' };
    this.advanceToNextStage(session, stageIdx, outputArtifact, now);

    session.status = session.current_stage_index >= session.stages.length ? 'COMPLETED' : 'IN_PROGRESS';
    session.updated_at_utc = now;
    this.savePipeline(session);
    return session;
  }

  private advanceToNextStage(
    session: PipelineSession,
    completedIdx: number,
    outputArtifact: StageArtifact,
    now: string
  ): void {
    const nextIdx = completedIdx + 1;
    if (nextIdx < session.stages.length) {
      session.current_stage_index = nextIdx;
      const nextStage = session.stages[nextIdx];
      nextStage.status = 'RUNNING';
      nextStage.started_at_utc = now;
      nextStage.input_artifact = {
        summary: `基于前序工步【${session.stages[completedIdx].name}】产出`,
        content: outputArtifact.content,
        files: outputArtifact.files || [],
        metadata: outputArtifact.metadata,
      };
      session.status = 'IN_PROGRESS';
    } else {
      session.current_stage_index = session.stages.length;
      session.status = 'COMPLETED';
    }
  }

  private savePipeline(session: PipelineSession): void {
    try {
      if (!existsSync(this.pipelinesDir)) {
        mkdirSync(this.pipelinesDir, { recursive: true });
      }
      const filePath = path.join(this.pipelinesDir, `${session.pipeline_id}.json`);
      writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[pipeline-engine] failed to persist pipeline session:', err);
    }
  }
}
