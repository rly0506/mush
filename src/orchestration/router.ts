/**
 * GOAL-039: 异构犬能力感知智能路由引擎 (Smart Task Routing)
 */

export type TaskDimension = 'coding' | 'review' | 'docs' | 'debug' | 'architecture' | 'test';

export interface TaskProfile {
  dimensions: Record<TaskDimension, number>;
  primary_dimension: TaskDimension;
  estimated_complexity: 'trivial' | 'moderate' | 'complex';
  context_size: number;
}

export interface DogCapabilityProfile {
  adapter_id: string;
  model_id?: string;
  strengths: TaskDimension[];
  success_rate: number; // 0~1
  avg_duration_ms: number;
  tier: 'T1' | 'T2' | 'T3' | 'T0';
}

export interface RoutingRecommendation {
  adapter_id: string;
  score: number; // 0~100
  reason: string;
  tier: 'T1' | 'T2' | 'T3';
}

/** 默认犬只能力画像库 */
export const DEFAULT_DOG_PROFILES: DogCapabilityProfile[] = [
  {
    adapter_id: 'claude-code',
    strengths: ['coding', 'architecture', 'review'],
    success_rate: 0.95,
    avg_duration_ms: 12000,
    tier: 'T1',
  },
  {
    adapter_id: 'agy',
    strengths: ['coding', 'test', 'debug', 'architecture'],
    success_rate: 0.96,
    avg_duration_ms: 10000,
    tier: 'T1',
  },
  {
    adapter_id: 'deepseek-code',
    strengths: ['coding', 'debug', 'test'],
    success_rate: 0.90,
    avg_duration_ms: 8000,
    tier: 'T2',
  },
  {
    adapter_id: 'kimi-code',
    strengths: ['docs', 'review', 'coding'],
    success_rate: 0.91,
    avg_duration_ms: 9000,
    tier: 'T2',
  },
  {
    adapter_id: 'opencode',
    strengths: ['docs', 'debug'],
    success_rate: 0.85,
    avg_duration_ms: 6000,
    tier: 'T3',
  },
  {
    adapter_id: 'codex',
    strengths: ['coding'],
    success_rate: 0.0,
    avg_duration_ms: 0,
    tier: 'T0', // 故障受阻
  },
];

/** 任务特征提取器（轻量多维特征分类） */
export function classifyTaskPrompt(prompt: string, files: string[] = []): TaskProfile {
  const text = (prompt || '').toLowerCase();

  const dimensionScores: Record<TaskDimension, number> = {
    coding: 0.1,
    review: 0.1,
    docs: 0.1,
    debug: 0.1,
    architecture: 0.1,
    test: 0.1,
  };

  // 关键词加权
  if (/实现|开发|编码|写一个|implement|create|build|feat|feature/.test(text)) dimensionScores.coding += 0.6;
  if (/审查|review|审阅|检查|audit|lint|sec|security/.test(text)) dimensionScores.review += 0.7;
  if (/文档|doc|readme|md|comment|说明|guide/.test(text)) dimensionScores.docs += 0.7;
  if (/修复|bug|fix|error|crash|崩溃|issue|排查/.test(text)) dimensionScores.debug += 0.7;
  if (/重构|架构|设计|refactor|arch|pattern|拓扑/.test(text)) dimensionScores.architecture += 0.7;
  if (/测试|test|spec|assert|coverage|验证/.test(text)) dimensionScores.test += 0.7;

  // 文件特征修正
  for (const f of files) {
    if (f.endsWith('.md')) dimensionScores.docs += 0.3;
    if (f.includes('test') || f.includes('spec')) dimensionScores.test += 0.4;
    if (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.py')) dimensionScores.coding += 0.2;
  }

  // 归一化并找出主维度
  let maxScore = -1;
  let primary: TaskDimension = 'coding';

  for (const [k, v] of Object.entries(dimensionScores) as [TaskDimension, number][]) {
    dimensionScores[k] = Number(v.toFixed(2));
    if (v > maxScore) {
      maxScore = v;
      primary = k;
    }
  }

  // 复杂度估算
  let complexity: 'trivial' | 'moderate' | 'complex' = 'trivial';
  if (text.length > 500 || files.length > 3 || dimensionScores.architecture > 0.5) {
    complexity = 'complex';
  } else if (text.length > 150 || files.length > 1) {
    complexity = 'moderate';
  }

  return {
    dimensions: dimensionScores,
    primary_dimension: primary,
    estimated_complexity: complexity,
    context_size: text.length + files.length * 100,
  };
}

/** 智能路由推荐 */
export function recommendDogs(
  profile: TaskProfile,
  roster: DogCapabilityProfile[] = DEFAULT_DOG_PROFILES,
): RoutingRecommendation[] {
  const recommendations: RoutingRecommendation[] = [];

  for (const dog of roster) {
    // 排除 T0 受阻犬只
    if (dog.tier === 'T0') continue;

    let matchScore = 0;
    const reasons: string[] = [];

    // 擅长维度匹配
    if (dog.strengths.includes(profile.primary_dimension)) {
      matchScore += 45;
      reasons.push(`擅长 ${profile.primary_dimension} 任务`);
    } else {
      matchScore += 15;
    }

    // 历史成功率贡献
    matchScore += dog.success_rate * 30;

    // 梯队加权
    if (dog.tier === 'T1') matchScore += 20;
    else if (dog.tier === 'T2') matchScore += 12;
    else if (dog.tier === 'T3') matchScore += 5;

    // 复杂度匹配微调
    if (profile.estimated_complexity === 'complex' && dog.tier === 'T1') {
      matchScore += 5;
      reasons.push('复杂架构任务适配 T1 旗舰犬');
    }

    const finalScore = Math.min(100, Math.round(matchScore));
    recommendations.push({
      adapter_id: dog.adapter_id,
      score: finalScore,
      tier: dog.tier,
      reason: reasons.join('；') || '通用能力匹配',
    });
  }

  // 按得分降序排序
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}
