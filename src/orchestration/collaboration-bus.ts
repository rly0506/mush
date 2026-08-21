/**
 * GOAL-043: 聊天底栏协作模式快捷开关与调度总线 (Collaboration Bus)
 */

import { classifyTaskPrompt, recommendDogs } from './router.ts';

export type CollaborationMode = 'free' | 'debate' | 'pipeline' | 'verify' | 'bounty';

export interface CollaborationDogPair {
  primaryDog: string;   // 正方/首选犬
  opposingDog: string;  // 反方/质询犬/验证犬
  reason: string;       // 推荐理由
}

export interface CollaborationRequest {
  topic: string;
  mode: CollaborationMode;
  workspaceRoot: string;
  primaryDog?: string;
  opposingDog?: string;
  maxBudgetUsd?: number;
  effort?: string;
}

export interface CollaborationPacket {
  packetId: string;
  topic: string;
  mode: CollaborationMode;
  primaryDog: string;
  opposingDog: string;
  workspaceRoot: string;
  maxBudgetUsd: number;
  effort: string;
  createdAtUtc: string;
}

/** 基于任务文本与协作模式智能推荐最佳对立犬阵容 */
export function recommendCollaborationPair(taskPrompt: string, mode: CollaborationMode): CollaborationDogPair {
  const profile = classifyTaskPrompt(taskPrompt);
  const recommendations = recommendDogs(profile);

  let primary = 'claude-code';
  let opposing = 'deepseek-code';

  if (recommendations.length >= 2) {
    primary = recommendations[0].adapter_id;
    opposing = recommendations[1].adapter_id;
  } else if (recommendations.length === 1) {
    primary = recommendations[0].adapter_id;
    opposing = primary === 'claude-code' ? 'deepseek-code' : 'claude-code';
  }

  // 针对不同协作模式的推荐理由优化
  let reason = '';
  switch (mode) {
    case 'debate':
      reason = `针对任务特征（${profile.primary_dimension}），推荐【${primary}】立论方案，由【${opposing}】进行对席交叉质询与反驳。`;
      break;
    case 'verify':
      reason = `由【${primary}】生成实现代码，物理隔离由【${opposing}】作为 Verifier 进行攻击性用例测试。`;
      break;
    case 'pipeline':
      reason = `由【${primary}】主导需求与架构工序，由【${opposing}】主导编码与审计工序。`;
      break;
    default:
      reason = `推荐首发犬【${primary}】，备选协同犬【${opposing}】。`;
      break;
  }

  return {
    primaryDog: primary,
    opposingDog: opposing,
    reason,
  };
}

/** 装配协作派发数据包 */
export function buildCollaborationPacket(req: CollaborationRequest): CollaborationPacket {
  const pair = recommendCollaborationPair(req.topic, req.mode);
  const primaryDog = req.primaryDog || pair.primaryDog;
  const opposingDog = req.opposingDog || pair.opposingDog;

  return {
    packetId: `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    topic: req.topic.trim(),
    mode: req.mode,
    primaryDog,
    opposingDog,
    workspaceRoot: req.workspaceRoot,
    maxBudgetUsd: req.maxBudgetUsd ?? 2.0,
    effort: req.effort ?? 'medium',
    createdAtUtc: new Date().toISOString(),
  };
}
