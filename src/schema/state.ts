/**
 * mush 生产 schema（M2 骨架）— orchestrator 状态 schema v2。
 * 形状取自已录 epoch50 state.json（黄金参照只读副本 + 哈希清单）。
 */

export interface ActorBinding {
  adapter_id?: string;
  model_profile: string;
  instance_id: string;
  mailbox_path: string;
  lane_path: string;
  executable: string;
  arguments: string[];
  prompt_transport: string;
  capability_id: string;
}

export interface OrchestratorStateV2 {
  schema_version: 2;
  run_id: string;
  goal_id: string;
  goal_path: string;
  assignment_epoch: number;
  parent_role: string;
  executor_role: string;
  actor_bindings: Record<string, ActorBinding>;
  config_digest: string;
  bootstrap_config_sha256: string;
  implementation_owner: string;
  review_owner: string;
  parent_product_edit_policy: string;
  parent_product_snapshot: Record<string, unknown>;
  status: string;
  expected_role: string | null;
  sequence: number;
  max_full_reviews: number;
  review_phase_limit: number;
  review_phase: number;
  phase_transition_pending: boolean;
  full_review_count: number;
  finding_recheck_count: number;
  active_finding_ids: string[];
  finding_attempts: Record<string, unknown>;
  finding_attempt_digests: Record<string, unknown>;
  dispatch_status: string;
  dispatch_role: string | null;
  dispatch_actor_instance_id: string | null;
  dispatch_sequence: number | null;
  dispatch_id: string | null;
  dispatch_job_name: string | null;
  dispatch_process_id: number | null;
  dispatch_process_started_at_utc: string | null;
  resume_status: string | null;
  resume_expected_role: string | null;
  last_event_id: string | null;
  last_packet_path: string | null;
  run_pause_reason: string | null;
  terminal_reason: string | null;
  updated_at_utc: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`orchestrator state '${field}' must be a non-empty string`);
  }
  return value;
}

function requireHex(obj: Record<string, unknown>, field: string, length: number): string {
  const value = requireString(obj, field);
  const re = new RegExp(`^[0-9A-Fa-f]{${length}}$`);
  if (!re.test(value)) {
    throw new Error(`orchestrator state '${field}' must be a ${length}-hex string`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('orchestrator state nullable field must be string or null');
  return value;
}

function parseActorBinding(role: string, value: unknown): ActorBinding {
  if (!isRecord(value)) throw new Error(`actor_bindings['${role}'] must be an object`);
  const modelProfile = requireString(value, 'model_profile');
  const instanceId = requireString(value, 'instance_id');
  const mailboxPath = requireString(value, 'mailbox_path');
  const lanePath = requireString(value, 'lane_path');
  const executable = requireString(value, 'executable');
  if (!Array.isArray(value.arguments) || value.arguments.some((item) => typeof item !== 'string')) {
    throw new Error(`actor_bindings['${role}'].arguments must be an array of strings`);
  }
  const promptTransport = requireString(value, 'prompt_transport');
  const capabilityId = requireHex(value, 'capability_id', 32);
  return {
    adapter_id: typeof value.adapter_id === 'string' ? value.adapter_id : undefined,
    model_profile: modelProfile,
    instance_id: instanceId,
    mailbox_path: mailboxPath,
    lane_path: lanePath,
    executable,
    arguments: value.arguments as string[],
    prompt_transport: promptTransport,
    capability_id: capabilityId,
  };
}

/** 严格解析 orchestrator 状态 schema v2；形状违规 fail-closed 抛错。 */
export function parseOrchestratorStateV2(input: unknown): OrchestratorStateV2 {
  if (!isRecord(input)) throw new Error('orchestrator state must be a JSON object');
  if (Number(input.schema_version) !== 2) throw new Error('orchestrator state schema_version must be 2');

  if (!isRecord(input.actor_bindings)) throw new Error("orchestrator state 'actor_bindings' must be an object");
  const actorBindings: Record<string, ActorBinding> = {};
  for (const [role, binding] of Object.entries(input.actor_bindings)) {
    actorBindings[role] = parseActorBinding(role, binding);
  }
  if (Object.keys(actorBindings).length === 0) throw new Error("orchestrator state 'actor_bindings' must not be empty");

  const assignmentEpoch = input.assignment_epoch;
  if (typeof assignmentEpoch !== 'number' || !Number.isInteger(assignmentEpoch) || assignmentEpoch < 1) {
    throw new Error("orchestrator state 'assignment_epoch' must be an integer >= 1");
  }
  const sequence = input.sequence;
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) {
    throw new Error("orchestrator state 'sequence' must be an integer >= 0");
  }

  const updatedAtUtc = requireString(input, 'updated_at_utc');
  if (Number.isNaN(Date.parse(updatedAtUtc))) {
    throw new Error("orchestrator state 'updated_at_utc' must be a parseable timestamp");
  }

  return {
    schema_version: 2,
    run_id: requireString(input, 'run_id'),
    goal_id: requireString(input, 'goal_id'),
    goal_path: requireString(input, 'goal_path'),
    assignment_epoch: assignmentEpoch,
    parent_role: requireString(input, 'parent_role'),
    executor_role: requireString(input, 'executor_role'),
    actor_bindings: actorBindings,
    config_digest: requireHex(input, 'config_digest', 64),
    bootstrap_config_sha256: requireHex(input, 'bootstrap_config_sha256', 64),
    implementation_owner: requireString(input, 'implementation_owner'),
    review_owner: requireString(input, 'review_owner'),
    parent_product_edit_policy: requireString(input, 'parent_product_edit_policy'),
    parent_product_snapshot: isRecord(input.parent_product_snapshot)
      ? (input.parent_product_snapshot as Record<string, unknown>)
      : {},
    status: requireString(input, 'status'),
    expected_role: nullableString(input.expected_role),
    sequence,
    max_full_reviews: Number(input.max_full_reviews ?? 0),
    review_phase_limit: Number(input.review_phase_limit ?? 0),
    review_phase: Number(input.review_phase ?? 0),
    phase_transition_pending: input.phase_transition_pending === true,
    full_review_count: Number(input.full_review_count ?? 0),
    finding_recheck_count: Number(input.finding_recheck_count ?? 0),
    active_finding_ids: Array.isArray(input.active_finding_ids)
      ? (input.active_finding_ids as string[])
      : [],
    finding_attempts: isRecord(input.finding_attempts) ? (input.finding_attempts as Record<string, unknown>) : {},
    finding_attempt_digests: isRecord(input.finding_attempt_digests)
      ? (input.finding_attempt_digests as Record<string, unknown>)
      : {},
    dispatch_status: requireString(input, 'dispatch_status'),
    dispatch_role: nullableString(input.dispatch_role),
    dispatch_actor_instance_id: nullableString(input.dispatch_actor_instance_id),
    dispatch_sequence: input.dispatch_sequence === null ? null : Number(input.dispatch_sequence),
    dispatch_id: nullableString(input.dispatch_id),
    dispatch_job_name: nullableString(input.dispatch_job_name),
    dispatch_process_id: input.dispatch_process_id === null ? null : Number(input.dispatch_process_id),
    dispatch_process_started_at_utc: nullableString(input.dispatch_process_started_at_utc),
    resume_status: nullableString(input.resume_status),
    resume_expected_role: nullableString(input.resume_expected_role),
    last_event_id: input.last_event_id === null ? null : requireHex(input, 'last_event_id', 32),
    last_packet_path: nullableString(input.last_packet_path),
    run_pause_reason: nullableString(input.run_pause_reason),
    terminal_reason: nullableString(input.terminal_reason),
    updated_at_utc: updatedAtUtc,
  };
}
