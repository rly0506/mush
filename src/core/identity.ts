/**
 * mush 核心（M2）— 运行时身份 fail-closed。
 *
 * PS 源（黄金参照，只读）：
 *   invoke-managed-pi-agent.ps1 L351-L352（provider/model 不符 → wrong-runtime-model）
 *   start-goal-orchestrator.ps1 L1858-L1868（身份 tuple 绑定校验）
 */

export interface RuntimeIdentity {
  provider: string;
  modelId: string;
  role?: string;
  instanceId?: string;
}

/** 任一维度不符即抛错（fail-closed，语义同 PS wrong-runtime-model 分支）。 */
export function assertRuntimeIdentity(
  observed: RuntimeIdentity,
  expected: Required<Omit<RuntimeIdentity, 'role' | 'instanceId'>> &
    Pick<RuntimeIdentity, 'role' | 'instanceId'>,
): void {
  if (observed.provider !== expected.provider) {
    throw new Error(
      `identity mismatch: provider=${observed.provider} expected=${expected.provider}`,
    );
  }
  if (observed.modelId !== expected.modelId) {
    throw new Error(`identity mismatch: model=${observed.modelId} expected=${expected.modelId}`);
  }
  if (expected.role !== undefined && observed.role !== expected.role) {
    throw new Error(`identity mismatch: role=${observed.role ?? ''} expected=${expected.role}`);
  }
  if (expected.instanceId !== undefined && observed.instanceId !== expected.instanceId) {
    throw new Error(
      `identity mismatch: instance=${observed.instanceId ?? ''} expected=${expected.instanceId}`,
    );
  }
}
