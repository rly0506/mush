/**
 * mush loop 层（M4 dogfood）— dispatch 闭环前置检查器。
 * 输出 READY / BLOCKED_ENV / BLOCKED_WAITING_OWNER（诚实，不碰凭据内容）。
 */

export interface ClosureDispatchEvent {
  adapter_id: string;
  status?: string;
  exit_code?: number;
  nonce_matched?: boolean;
}

export interface ClosureInput {
  approvals: string[];
  dispatchEvents: ClosureDispatchEvent[];
  envReady: { deepseek: boolean; claude: boolean };
}

export interface ClosureResult {
  status: 'READY' | 'BLOCKED_ENV' | 'BLOCKED_WAITING_OWNER';
  reasons: string[];
}

const DOGS = [
  { adapter_id: 'deepseek-dsh', envKey: 'deepseek' as const },
  { adapter_id: 'claude-code', envKey: 'claude' as const },
];

export function checkDispatchClosure(input: ClosureInput): ClosureResult {
  const reasons: string[] = [];
  for (const dog of DOGS) {
    const hasApproval = input.approvals.some((name) => name.startsWith(dog.adapter_id));
    if (!hasApproval) reasons.push(`${dog.adapter_id}: owner approval record missing (D6)`);
  }
  if (reasons.length > 0) {
    return { status: 'BLOCKED_WAITING_OWNER', reasons };
  }

  for (const dog of DOGS) {
    const pass = input.dispatchEvents.find(
      (event) =>
        event.adapter_id === dog.adapter_id &&
        (event.status === 'PASS' || event.exit_code === 0) &&
        event.nonce_matched === true,
    );
    if (pass === undefined) reasons.push(`${dog.adapter_id}: no PASS dispatch evidence with runtime nonce proof`);
    if (!input.envReady[dog.envKey]) reasons.push(`${dog.adapter_id}: credential environment not ready`);
  }
  if (reasons.length > 0) return { status: 'BLOCKED_ENV', reasons };
  return { status: 'READY', reasons: [] };
}
