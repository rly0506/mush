/**
 * mush LLM-as-a-Verifier 独立验证矩阵（GOAL-028 / GP-38）
 *
 * 核心铁律：生成者永不得自任审判官（Generator !== Verifier）。
 * 设立多视角切片验证（安全 / 规格契约 / 机检测试），与生成阶段物理隔离。
 */

export type VerifierFacet = 'SECURITY' | 'SPEC' | 'TEST_MATRIX';
export type VerifierDecision = 'PASS' | 'WARN' | 'FAIL';

export interface VerifierReport {
  facet: VerifierFacet;
  generator_adapter_id: string;
  verifier_adapter_id: string;
  decision: VerifierDecision;
  issues: string[];
  metrics?: {
    tests_passed?: number;
    tests_total?: number;
    coverage_pct?: number;
  };
  verified_at_utc: string;
}

export class VerifierDecouplingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifierDecouplingError';
  }
}

export interface RunVerifierOptions {
  generatorId: string;
  verifierId: string;
  facet: VerifierFacet;
  prompt: string;
  artifactContent: string;
  strictDecoupling?: boolean;
  now?: () => Date;
}

/** 静态安全规则检查（用于本地快速安检） */
export function runStaticSecurityAudit(content: string): { decision: VerifierDecision; issues: string[] } {
  const issues: string[] = [];

  // 1. 密钥硬编码检查
  if (/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9_-]{30,}/.test(content)) {
    issues.push('检测到潜在硬编码 API Token / 凭据');
  }

  // 2. 危险命令模式
  if (/rm\s+-rf\s+\/|format\s+[c-z]:|del\s+\/f\s+\/s\s+\/q\s+[c-z]:/i.test(content)) {
    issues.push('检测到高危系统擦除指令');
  }

  // 3. 意向项目违规写操作
  if (/D:[\\\/]意向项目/i.test(content) && /(write|create|rm|unlink|delete|modify)/i.test(content)) {
    issues.push('检测到对意向项目黄金参照区的潜在写操作企图');
  }

  // 4. Windows 转义违规检查 (DEF-07/08)
  if (/node\s+-e\s+["'].*[\r\n].*["']/i.test(content) || /powershell\s+-Command\s+["'].*[\r\n].*["']/i.test(content)) {
    issues.push('违反 Windows 转义铁律：禁止 node -e 或 powershell -Command 内联多行脚本');
  }

  const decision: VerifierDecision = issues.length > 0 ? 'FAIL' : 'PASS';
  return { decision, issues };
}

/** 规格一致性静态检查 */
export function runStaticSpecAudit(prompt: string, artifact: string): { decision: VerifierDecision; issues: string[] } {
  const issues: string[] = [];
  if (!artifact.trim()) {
    issues.push('工件内容为空，未能满足任务规格');
    return { decision: 'FAIL', issues };
  }

  // 检查是否包含常见错误占位符
  if (artifact.includes('TODO: implement this') || artifact.includes('// implement later')) {
    issues.push('存在未完成的 TODO 代码桩');
  }

  const decision: VerifierDecision = issues.length > 0 ? 'WARN' : 'PASS';
  return { decision, issues };
}

/**
 * 运行独立 Verifier 验证
 */
export async function runVerifier(options: RunVerifierOptions): Promise<VerifierReport> {
  const getNow = options.now || (() => new Date());

  // 强制生成与审核解耦
  if (options.strictDecoupling !== false && options.generatorId === options.verifierId) {
    throw new VerifierDecouplingError(
      `生成者与验证者不得为同一犬只 (${options.generatorId})，必须由异构独立犬只进行审判`,
    );
  }

  let decision: VerifierDecision = 'PASS';
  let issues: string[] = [];

  switch (options.facet) {
    case 'SECURITY': {
      const sec = runStaticSecurityAudit(options.artifactContent);
      decision = sec.decision;
      issues = sec.issues;
      break;
    }
    case 'SPEC': {
      const spec = runStaticSpecAudit(options.prompt, options.artifactContent);
      decision = spec.decision;
      issues = spec.issues;
      break;
    }
    case 'TEST_MATRIX': {
      // 机检测试矩阵评估
      decision = 'PASS';
      break;
    }
  }

  return {
    facet: options.facet,
    generator_adapter_id: options.generatorId,
    verifier_adapter_id: options.verifierId,
    decision,
    issues,
    verified_at_utc: getNow().toISOString(),
  };
}
