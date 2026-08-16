/**
 * mush loop 层（M4 dogfood）— 头犬机检审核门。
 * 机器规则：exit 0 + 未超时 + 身份未 fail-closed + nonce 运行时证明在案（若字段
 * 存在则必须 matched）；FAIL 永远不推进 ACCEPT（D15 机检验收同源规则）。
 */

import type { LoopStateMachine } from './loop.ts';

export interface MachineVerdict {
  verdict: 'PASS' | 'FAIL';
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function machineReview(receipt: unknown): MachineVerdict {
  const reasons: string[] = [];
  if (!isRecord(receipt) || Number(receipt.schema_version) !== 1) {
    return { verdict: 'FAIL', reasons: ['receipt schema_version must be 1'] };
  }
  if (receipt.exit_code !== 0) reasons.push(`exit_code must be 0, got ${String(receipt.exit_code)}`);
  if (receipt.timed_out === true) reasons.push('dispatch timed out');
  if (receipt.identity_fail_closed === true) reasons.push('identity fail-closed');
  if ('nonce_matched' in receipt && receipt.nonce_matched !== true) {
    reasons.push('runtime nonce identity not proven');
  }
  if (typeof receipt.stdout_sha256 === 'string' && !/^[0-9A-Fa-f]{64}$/.test(receipt.stdout_sha256)) {
    reasons.push('stdout_sha256 must be a 64-hex anchor');
  }
  return reasons.length === 0 ? { verdict: 'PASS', reasons: [] } : { verdict: 'FAIL', reasons };
}

/** REPORT → REVIEW（带 verdict）；仅 PASS 允许 REVIEW → ACCEPT。 */
export function advanceAfterReview(
  loop: LoopStateMachine,
  receipt: unknown,
): MachineVerdict {
  if (loop.state !== 'REPORT') {
    throw new Error(`review gate requires REPORT state, got ${loop.state}`);
  }
  const verdict = machineReview(receipt);
  loop.transition('REVIEW', { verdict: verdict.verdict, reasons: verdict.reasons });
  if (verdict.verdict === 'PASS') {
    loop.transition('ACCEPT', { verdict: 'PASS' });
  }
  return verdict;
}
