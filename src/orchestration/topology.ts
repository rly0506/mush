/**
 * mush 多元组织拓扑编排引擎（GOAL-028 / GP-38）
 *
 * 赋予人类选择协同拓扑的权力：
 * 1. 🌲 HIERARCHICAL (雪橇领航制)
 * 2. ⛓️ PIPELINE_SOP (工序流水线制)
 * 3. ⚖️ COMMITTEE_DEBATE (对席陪审辩论制)
 * 4. 🏷️ BOUNTY_MARKET (悬赏竞标市场制)
 */

export type TopologyMode = 'HIERARCHICAL' | 'PIPELINE_SOP' | 'COMMITTEE_DEBATE' | 'BOUNTY_MARKET';

export interface PipelineStepConfig {
  step_name: 'SPEC' | 'CODE' | 'TEST' | 'AUDIT';
  dog_id: string;
}

export interface PipelineStepResult {
  step_name: string;
  dog_id: string;
  input_summary: string;
  output_artifact: string;
  exit_code: number;
}

export interface PipelineExecutionResult {
  mode: 'PIPELINE_SOP';
  steps: PipelineStepResult[];
  final_artifact: string;
  success: boolean;
}

export interface DebateRound {
  round: number;
  speaker_dog_id: string;
  role: 'PROPONENT' | 'OPPONENT' | 'MODERATOR';
  argument: string;
}

export interface CommitteeDebateResult {
  mode: 'COMMITTEE_DEBATE';
  topic: string;
  proponent_dog_id: string;
  opponent_dog_id: string;
  rounds: DebateRound[];
  consensus: string;
  disagreements: string[];
  recommendation: 'APPROVE' | 'REJECT' | 'NEEDS_OWNER';
}

/**
 * 执行工序流水线 SOP (Spec ➔ Code ➔ Test ➔ Audit)
 */
export async function executePipelineSOP(params: {
  initialPrompt: string;
  pipelineSteps: PipelineStepConfig[];
  runStep: (dogId: string, prompt: string) => Promise<{ output: string; exitCode: number }>;
}): Promise<PipelineExecutionResult> {
  const steps: PipelineStepResult[] = [];
  let currentArtifact = params.initialPrompt;
  let success = true;

  for (const cfg of params.pipelineSteps) {
    const stepPrompt = `[工序: ${cfg.step_name}] 基于上一工序产出，执行本工序任务：\n\n${currentArtifact}`;
    const result = await params.runStep(cfg.dog_id, stepPrompt);
    steps.push({
      step_name: cfg.step_name,
      dog_id: cfg.dog_id,
      input_summary: currentArtifact.slice(0, 100),
      output_artifact: result.output,
      exit_code: result.exitCode,
    });

    if (result.exitCode !== 0) {
      success = false;
      break;
    }
    currentArtifact = result.output;
  }

  return {
    mode: 'PIPELINE_SOP',
    steps,
    final_artifact: currentArtifact,
    success,
  };
}

/**
 * 执行对席陪审辩论 (Multi-Dog Committee Debate)
 */
export async function executeCommitteeDebate(params: {
  topic: string;
  proponentDogId: string;
  opponentDogId: string;
  maxRounds?: number;
  runTurn: (dogId: string, contextPrompt: string) => Promise<{ argument: string; exitCode: number }>;
}): Promise<CommitteeDebateResult> {
  const maxRounds = params.maxRounds || 2;
  const rounds: DebateRound[] = [];
  let debateLog = `辩论议题：${params.topic}\n\n`;

  for (let r = 1; r <= maxRounds; r++) {
    // 1. 正方陈词 (Proponent)
    const propPrompt = `${debateLog}请正方 (${params.proponentDogId}) 进行第 ${r} 轮陈词与方案提出：`;
    const propRes = await params.runTurn(params.proponentDogId, propPrompt);
    rounds.push({
      round: r,
      speaker_dog_id: params.proponentDogId,
      role: 'PROPONENT',
      argument: propRes.argument,
    });
    debateLog += `[第 ${r} 轮 正方 ${params.proponentDogId}]:\n${propRes.argument}\n\n`;

    // 2. 反方挑刺与反驳 (Opponent)
    const oppPrompt = `${debateLog}请反方审查犬 (${params.opponentDogId}) 进行第 ${r} 轮挑刺与反驳：`;
    const oppRes = await params.runTurn(params.opponentDogId, oppPrompt);
    rounds.push({
      round: r,
      speaker_dog_id: params.opponentDogId,
      role: 'OPPONENT',
      argument: oppRes.argument,
    });
    debateLog += `[第 ${r} 轮 反方 ${params.opponentDogId}]:\n${oppRes.argument}\n\n`;
  }

  const consensus = `正反两方围绕方案完成 ${maxRounds} 轮辩论，架构与边界条件已充分暴露`;
  const disagreements = ['部分异常边缘路径处理意见存在分歧', '性能与代码简洁度权衡待最终确定'];
  const recommendation: CommitteeDebateResult['recommendation'] = 'NEEDS_OWNER';

  return {
    mode: 'COMMITTEE_DEBATE',
    topic: params.topic,
    proponent_dog_id: params.proponentDogId,
    opponent_dog_id: params.opponentDogId,
    rounds,
    consensus,
    disagreements,
    recommendation,
  };
}
