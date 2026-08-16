/**
 * mush 适配器层（M3）— D20 实测能力注册（cc-switch 只读枚举 + 逐 provider /models 探测）。
 *
 * 边界：provider 目录只读枚举；凭据文件不打开、不复制、不入任何输出；
 * 探测失败/不可用一律诚实 UNKNOWN（D13）。
 * 注册只拷贝白名单字段——探测返回中的任何额外字段（含密钥）永不进 record。
 */

import { CapabilityRegistry, normalizeCapabilityRecord, type CapabilityRecord } from '../core/capability.ts';

export interface ModelProbeResult {
  model_id: string;
  model_tier?: string;
  thinking_level?: string;
  [extra: string]: unknown;
}

export interface ProviderEnumeration {
  available: boolean;
  providers: string[];
  reason: string;
}

export function enumerateCcSwitchProviders(
  lister: () => string[] | null,
): ProviderEnumeration {
  const providers = lister();
  if (providers === null) {
    return { available: false, providers: [], reason: 'cc-switch provider directory unavailable' };
  }
  const clean = providers.filter((provider) => typeof provider === 'string' && provider.trim() !== '');
  return { available: true, providers: clean, reason: '' };
}

function unknownRecord(opts: {
  adapterId: string;
  cliPath: string;
  cliVersion: string;
  registry: CapabilityRegistry;
}): CapabilityRecord {
  return opts.registry.register(
    normalizeCapabilityRecord({
      adapter_id: opts.adapterId,
      cli_path: opts.cliPath,
      cli_version: opts.cliVersion,
      provider: 'UNKNOWN',
      model_id: 'UNKNOWN',
      credential_status: 'UNKNOWN',
      identity_source: 'cc-switch-readonly',
      model_tier: 'UNKNOWN',
      thinking_level: 'UNKNOWN',
    }),
  );
}

/** D20 探测主流程：枚举 → 逐 provider 探测 → 白名单字段注册；不可得即 UNKNOWN。 */
export async function runD20CapabilityProbe(opts: {
  adapterId: string;
  cliPath: string;
  cliVersion: string;
  registry: CapabilityRegistry;
  providerLister: () => string[] | null;
  modelProbe: (provider: string) => Promise<ModelProbeResult[] | null>;
}): Promise<CapabilityRecord[]> {
  const enumeration = enumerateCcSwitchProviders(opts.providerLister);
  if (!enumeration.available) {
    return [unknownRecord(opts)];
  }
  const records: CapabilityRecord[] = [];
  for (const provider of enumeration.providers) {
    let probed: ModelProbeResult[] | null = null;
    try {
      probed = await opts.modelProbe(provider);
    } catch {
      probed = null;
    }
    const entries = Array.isArray(probed) ? probed : null;
    if (entries === null || entries.length === 0) {
      records.push(unknownRecord(opts));
      continue;
    }
    for (const entry of entries) {
      // 白名单字段拷贝：任何额外字段（api_key 等）一律丢弃。
      records.push(
        opts.registry.register(
          normalizeCapabilityRecord({
            adapter_id: opts.adapterId,
            cli_path: opts.cliPath,
            cli_version: opts.cliVersion,
            provider,
            model_id: typeof entry.model_id === 'string' ? entry.model_id : 'UNKNOWN',
            credential_status: 'PRESENT',
            identity_source: 'cc-switch-readonly',
            model_tier: typeof entry.model_tier === 'string' ? entry.model_tier : 'UNKNOWN',
            thinking_level: typeof entry.thinking_level === 'string' ? entry.thinking_level : 'UNKNOWN',
          }),
        ),
      );
    }
  }
  return records;
}
