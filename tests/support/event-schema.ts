/**
 * M1 fixture-reference（非生产实现）：
 * agent-bridge 事件 schema v2 的 TS 类型与严格解析守卫，供 U3 回放冒烟使用。
 * 类型来自已录 epoch50 事件 JSON（黄金参照，只读副本 + 哈希清单）。
 * U4 的 M2 骨架将在此类型基础上建立生产 src/schema。
 *
 * 黄金参照（只读）：
 *   D:\意向项目\.agent-bridge\runtime\orchestrator\RM065-GOAL-010-epoch50\events\active\
 */

export interface EvidencePathAndHash {
  path: string;
  sha256: string;
}

export interface BridgeEventV2 {
  schema_version: 2;
  event_id: string;
  goal_id: string;
  run_id: string;
  assignment_epoch: number;
  sequence: number;
  parent_instance_id: string;
  actor_role: string;
  actor_instance_id: string;
  dispatch_id: string;
  event_type: string;
  phase: number;
  finding_ids: string[];
  finding_material_digests?: Record<string, unknown>;
  packet_path: string;
  packet_sha256: string;
  config_digest: string;
  capability_id: string;
  signature: string;
  provider?: string;
  model_id?: string;
  summary?: string;
  changed_paths?: string[];
  tests_run?: string[];
  test_results?: unknown[];
  evidence_paths_and_hashes?: EvidencePathAndHash[];
  open_findings?: unknown[];
  requested_decision?: string;
  next_step?: string;
  created_at_utc: string;
  resume_target?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`bridge event '${field}' must be a non-empty string`);
  }
  return value;
}

function requireHex(obj: Record<string, unknown>, field: string, length: number): string {
  const value = requireString(obj, field);
  const re = new RegExp(`^[0-9A-Fa-f]{${length}}$`);
  if (!re.test(value)) {
    throw new Error(`bridge event '${field}' must be a ${length}-hex string`);
  }
  return value;
}

function requireInteger(obj: Record<string, unknown>, field: string, min: number): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`bridge event '${field}' must be an integer >= ${min}`);
  }
  return value;
}

function optionalStringArray(obj: Record<string, unknown>, field: string): string[] | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`bridge event '${field}' must be an array of strings`);
  }
  return value as string[];
}

/**
 * 严格解析事件 schema v2：必需字段、哈希锚点形状、序列/epoch 整数、时间戳
 * 可解析；可选 completion 字段在存在时校验形状。解析失败即抛错（fail-closed）。
 */
export function parseBridgeEventV2(input: unknown): BridgeEventV2 {
  if (!isRecord(input)) throw new Error('bridge event must be a JSON object');
  if (Number(input.schema_version) !== 2) throw new Error('bridge event schema_version must be 2');

  const eventId = requireHex(input, 'event_id', 32);
  const goalId = requireString(input, 'goal_id');
  const runId = requireString(input, 'run_id');
  const assignmentEpoch = requireInteger(input, 'assignment_epoch', 1);
  const sequence = requireInteger(input, 'sequence', 1);
  const parentInstanceId = requireString(input, 'parent_instance_id');
  const actorRole = requireString(input, 'actor_role');
  const actorInstanceId = requireString(input, 'actor_instance_id');
  const dispatchId = requireHex(input, 'dispatch_id', 32);
  const eventType = requireString(input, 'event_type');
  const phase = requireInteger(input, 'phase', 0);
  if (!Array.isArray(input.finding_ids)) throw new Error("bridge event 'finding_ids' must be an array");
  const packetPath = requireString(input, 'packet_path');
  const packetSha256 = requireHex(input, 'packet_sha256', 64);
  const configDigest = requireHex(input, 'config_digest', 64);
  const capabilityId = requireHex(input, 'capability_id', 32);
  const signature = requireHex(input, 'signature', 64);
  const createdAtUtc = requireString(input, 'created_at_utc');
  if (Number.isNaN(Date.parse(createdAtUtc))) {
    throw new Error("bridge event 'created_at_utc' must be a parseable timestamp");
  }

  const evidence = input.evidence_paths_and_hashes;
  if (evidence !== undefined) {
    if (
      !Array.isArray(evidence) ||
      evidence.some(
        (entry) =>
          !isRecord(entry) ||
          typeof entry.path !== 'string' ||
          typeof entry.sha256 !== 'string' ||
          !/^[0-9A-Fa-f]{64}$/.test(entry.sha256),
      )
    ) {
      throw new Error("bridge event 'evidence_paths_and_hashes' must be [{path, sha256(64-hex)}]");
    }
  }

  return {
    schema_version: 2,
    event_id: eventId,
    goal_id: goalId,
    run_id: runId,
    assignment_epoch: assignmentEpoch,
    sequence,
    parent_instance_id: parentInstanceId,
    actor_role: actorRole,
    actor_instance_id: actorInstanceId,
    dispatch_id: dispatchId,
    event_type: eventType,
    phase,
    finding_ids: input.finding_ids as string[],
    finding_material_digests: isRecord(input.finding_material_digests)
      ? (input.finding_material_digests as Record<string, unknown>)
      : undefined,
    packet_path: packetPath,
    packet_sha256: packetSha256,
    config_digest: configDigest,
    capability_id: capabilityId,
    signature,
    provider: typeof input.provider === 'string' ? input.provider : undefined,
    model_id: typeof input.model_id === 'string' ? input.model_id : undefined,
    summary: typeof input.summary === 'string' ? input.summary : undefined,
    changed_paths: optionalStringArray(input, 'changed_paths'),
    tests_run: optionalStringArray(input, 'tests_run'),
    test_results: Array.isArray(input.test_results) ? input.test_results : undefined,
    evidence_paths_and_hashes: evidence as EvidencePathAndHash[] | undefined,
    open_findings: Array.isArray(input.open_findings) ? input.open_findings : undefined,
    requested_decision: typeof input.requested_decision === 'string' ? input.requested_decision : undefined,
    next_step: typeof input.next_step === 'string' ? input.next_step : undefined,
    created_at_utc: createdAtUtc,
    resume_target: typeof input.resume_target === 'string' ? input.resume_target : undefined,
  };
}
