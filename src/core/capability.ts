/**
 * mush 核心（M2）— 能力注册（capability record + 选择 fail-closed + fake provider 探测）。
 *
 * PS 源（黄金参照，只读）：
 *   BridgeCapabilityRegistry.psm1 L98-L116（字段表与 UNKNOWN/大写归一化）
 *   BridgeCapabilityRegistry.psm1 L95（metadata 安全值脱敏）
 *   BridgeCapabilityRegistry.psm1 L243-L248（按 adapter 选择、credential_status=PRESENT）
 *   D20：capability 含 model/思考强度档位字段，供派发按任务复杂度路由；
 *   本单元只做结构与 fake-provider 测试，不做真实 cc-switch 探测。
 */

import { canonicalJson, sha256Hex } from './event-log.ts';
import { assertRuntimeIdentity } from './identity.ts';

export type ModelTier = 'LOW' | 'HIGH' | 'UNKNOWN';
export type ThinkingLevel = 'LOW' | 'HIGH' | 'XHIGH' | 'UNKNOWN';

export interface CapabilityRecord {
  readonly adapter_id: string;
  readonly adapter_version: string;
  readonly cli_path: string;
  readonly cli_version: string;
  readonly provider: string;
  readonly model_id: string;
  readonly credential_status: string;
  readonly identity_source: string;
  readonly confidence: string;
  readonly protocol: string;
  readonly supported_roles: string[];
  readonly quota_value: unknown;
  readonly quota_unit: string;
  readonly quota_source: string;
  readonly quota_checked_at: string | null;
  readonly checked_at: string;
  readonly model_tier: ModelTier;
  readonly thinking_level: ThinkingLevel;
  readonly preset?: string;
  readonly metadata?: Record<string, unknown>;
  readonly capability_id?: string;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function text(value: unknown, fallback = 'UNKNOWN'): string {
  return isBlank(value) ? fallback : String(value).trim();
}

/** PS L98-L116 归一化：空值 UNKNOWN、confidence 大写、supported_roles 过滤空白。 */
export function normalizeCapabilityRecord(input: Record<string, unknown>): CapabilityRecord {
  const quotaChecked = input.quota_checked_at;
  return {
    adapter_id: text(input.adapter_id),
    adapter_version: text(input.adapter_version),
    cli_path: text(input.cli_path),
    cli_version: text(input.cli_version),
    provider: text(input.provider),
    model_id: text(input.model_id),
    credential_status: text(input.credential_status),
    identity_source: text(input.identity_source),
    confidence: text(input.confidence).toUpperCase(),
    protocol: text(input.protocol),
    supported_roles: Array.isArray(input.supported_roles)
      ? input.supported_roles.filter((role): role is string => typeof role === 'string' && role.trim() !== '')
      : [],
    quota_value: isBlank(input.quota_value) ? 'UNKNOWN' : input.quota_value,
    quota_unit: text(input.quota_unit),
    quota_source: text(input.quota_source),
    quota_checked_at:
      quotaChecked instanceof Date
        ? quotaChecked.toISOString()
        : typeof quotaChecked === 'string'
          ? quotaChecked
          : null,
    checked_at: new Date().toISOString(),
    model_tier: (text(input.model_tier).toUpperCase() as ModelTier),
    thinking_level: (text(input.thinking_level).toUpperCase() as ThinkingLevel),
    preset: typeof input.preset === 'string' && input.preset.trim() !== '' ? input.preset : undefined,
    metadata:
      input.metadata !== null && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? (input.metadata as Record<string, unknown>)
        : undefined,
  };
}

/** PS L95 安全值脱敏：secret 列表中的值替换为 [REDACTED]，永不入库。 */
export function redactSecretValues<T>(value: T, secretValues: string[]): T {
  if (typeof value === 'string') {
    let out: string = value;
    for (const secret of secretValues) {
      if (secret === '') continue;
      out = out.split(secret).join('[REDACTED]');
    }
    return out as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactSecretValues(item, secretValues)) as T;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = redactSecretValues(item, secretValues);
    return out as T;
  }
  return value;
}

export class CapabilityRegistry {
  private readonly records = new Map<string, CapabilityRecord>();

  register(record: CapabilityRecord, opts: { secretValues?: string[] } = {}): CapabilityRecord {
    const normalized = normalizeCapabilityRecord(record as unknown as Record<string, unknown>);
    const capabilityId = sha256Hex(
      canonicalJson({
        adapter_id: normalized.adapter_id,
        provider: normalized.provider,
        model_id: normalized.model_id,
        cli_path: normalized.cli_path,
      }),
    ).slice(0, 32);
    const stored: CapabilityRecord = Object.freeze({
      ...normalized,
      metadata: normalized.metadata === undefined ? undefined : redactSecretValues(normalized.metadata, opts.secretValues ?? []),
      capability_id: capabilityId,
    });
    this.records.set(capabilityId, stored);
    return stored;
  }

  get(capabilityId: string): CapabilityRecord | null {
    return this.records.get(capabilityId) ?? null;
  }

  /** 派发选择 fail-closed：adapter+provider+model 匹配、credential=PRESENT、身份精确。 */
  selectForDispatch(opts: {
    adapterId: string;
    provider: string;
    modelId: string;
    expectedProvider: string;
    expectedModelId: string;
  }): CapabilityRecord {
    const candidates = [...this.records.values()].filter(
      (record) =>
        record.adapter_id === opts.adapterId &&
        record.provider === opts.provider &&
        record.model_id === opts.modelId,
    );
    if (candidates.length === 0) {
      throw new Error(
        `capability not registered: adapter=${opts.adapterId} provider=${opts.provider} model=${opts.modelId}`,
      );
    }
    const present = candidates.find((record) => record.credential_status === 'PRESENT');
    if (present === undefined) {
      throw new Error(
        `capability credential not PRESENT: adapter=${opts.adapterId} provider=${opts.provider} model=${opts.modelId}`,
      );
    }
    assertRuntimeIdentity(
      { provider: present.provider, modelId: present.model_id },
      { provider: opts.expectedProvider, modelId: opts.expectedModelId },
    );
    return present;
  }

  /** fake-provider 结构探测（D20 结构测试）：catalog=null 时诚实记录 UNKNOWN。 */
  probeFakeProvider(opts: {
    adapterId: string;
    provider: string;
    cliPath: string;
    cliVersion: string;
    credentialStatus: string;
    catalog: Array<{ model_id: string; model_tier?: string; thinking_level?: string }> | null;
  }): CapabilityRecord[] {
    if (opts.catalog === null || opts.catalog.length === 0) {
      const record = this.register(
        normalizeCapabilityRecord({
          adapter_id: opts.adapterId,
          cli_path: opts.cliPath,
          cli_version: opts.cliVersion,
          provider: 'UNKNOWN',
          model_id: 'UNKNOWN',
          credential_status: 'UNKNOWN',
          identity_source: 'fake-probe',
          model_tier: 'UNKNOWN',
          thinking_level: 'UNKNOWN',
        }),
      );
      return [record];
    }
    return opts.catalog.map((entry) =>
      this.register(
        normalizeCapabilityRecord({
          adapter_id: opts.adapterId,
          cli_path: opts.cliPath,
          cli_version: opts.cliVersion,
          provider: opts.provider,
          model_id: entry.model_id,
          credential_status: opts.credentialStatus,
          identity_source: 'fake-probe',
          model_tier: entry.model_tier ?? 'UNKNOWN',
          thinking_level: entry.thinking_level ?? 'UNKNOWN',
        }),
      ),
    );
  }
}
