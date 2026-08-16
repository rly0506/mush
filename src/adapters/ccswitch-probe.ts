/**
 * mush 能力注册（GOAL-010）— cc-switch 只读全量模型枚举（D20 落地）。
 *
 * 红线（宪法 §3）：
 * - providers.settings_config 可能含密钥，本探测器**不 SELECT 该列**；
 *   ALLOWED_PROVIDER_COLUMNS 白名单硬编码，测试断言。
 * - 只读打开 DB；输出永不包含 key/token 类材料。
 */

import { DatabaseSync } from 'node:sqlite';

export const ALLOWED_PROVIDER_COLUMNS = ['id', 'app_type', 'name', 'category', 'is_current'] as const;

export interface CcSwitchProvider {
  id: string;
  app_type: string;
  name: string;
  category: string;
  is_current: boolean;
}

export interface RecentModel {
  app_type: string;
  provider_name: string;
  model: string;
  seen_at: string;
}

export interface CcSwitchProbeResult {
  providers: CcSwitchProvider[];
  recentModels: RecentModel[];
  pricingModels: string[];
}

/** 白名单列拼 SQL（列名由常量生成，绝不拼接调用方输入）。 */
function providerColumnList(): string {
  return ALLOWED_PROVIDER_COLUMNS.join(', ');
}

export function probeCcSwitch(dbPath: string): CcSwitchProbeResult {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const providerRows = db
      .prepare(`SELECT ${providerColumnList()} FROM providers ORDER BY is_current DESC, name`)
      .all() as Array<Record<string, unknown>>;
    const providers: CcSwitchProvider[] = providerRows.map((row) => ({
      id: String(row.id ?? ''),
      app_type: String(row.app_type ?? ''),
      name: String(row.name ?? ''),
      category: String(row.category ?? ''),
      is_current: row.is_current === 1 || row.is_current === true,
    }));

    const recentRows = db
      .prepare(
        `SELECT app_type, provider_id, request_model, created_at
         FROM proxy_request_logs
         WHERE request_model IS NOT NULL AND request_model != ''
         ORDER BY created_at DESC LIMIT 500`,
      )
      .all() as Array<Record<string, unknown>>;
    const providerName = new Map(providers.map((provider) => [provider.id, provider.name]));
    const recentModels: RecentModel[] = recentRows.map((row) => ({
      app_type: String(row.app_type ?? ''),
      provider_name: providerName.get(String(row.provider_id ?? '')) ?? String(row.provider_id ?? ''),
      model: String(row.request_model ?? ''),
      seen_at: String(row.created_at ?? ''),
    }));

    const pricingRows = db
      .prepare(`SELECT model_id FROM model_pricing WHERE model_id IS NOT NULL AND model_id != ''`)
      .all() as Array<Record<string, unknown>>;
    const pricingModels = pricingRows.map((row) => String(row.model_id));

    return { providers, recentModels, pricingModels };
  } finally {
    db.close();
  }
}

export interface AdapterRegistryEntry {
  adapter_id: string;
  provider: string;
  models: string[];
  source: 'cc-switch';
  probed_at_utc: string;
  verified: false;
}

export interface CapabilityRegistryFile {
  schema_version: 1;
  probed_at_utc: string;
  adapters: AdapterRegistryEntry[];
}

const APP_TYPE_TO_ADAPTER: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
  gemini: 'gemini',
  grokbuild: 'grokbuild',
};

/** 由探测结果合成能力注册表（adapter → 实测模型清单；verified=false，nonce 另证）。 */
export function buildCapabilityRegistry(
  probe: CcSwitchProbeResult,
  probedAtUtc: string,
): CapabilityRegistryFile {
  const grouped = new Map<string, Set<string>>();
  for (const entry of probe.recentModels) {
    const adapterId = APP_TYPE_TO_ADAPTER[entry.app_type];
    if (adapterId === undefined) continue;
    const model = entry.model.trim();
    if (model === '' || model === 'UNKNOWN') continue;
    if (!grouped.has(adapterId)) grouped.set(adapterId, new Set());
    grouped.get(adapterId)?.add(model);
  }
  for (const model of probe.pricingModels) {
    const modelId = model.trim();
    if (modelId === '' || modelId === 'UNKNOWN') continue;
    // 价格表无 app_type 归属；按命名前缀归入已知犬（claude-* / gpt-* 等）。
    if (/^claude-/i.test(modelId)) grouped.get('claude-code')?.add(modelId);
    else if (/^gpt-/i.test(modelId)) grouped.get('codex')?.add(modelId);
  }
  const adapters: AdapterRegistryEntry[] = [...grouped.entries()]
    .map(([adapterId, models]) => ({
      adapter_id: adapterId,
      provider: adapterId === 'claude-code' ? 'anthropic' : adapterId,
      models: [...models],
      source: 'cc-switch' as const,
      probed_at_utc: probedAtUtc,
      verified: false as const,
    }))
    .sort((a, b) => a.adapter_id.localeCompare(b.adapter_id));
  return { schema_version: 1, probed_at_utc: probedAtUtc, adapters };
}
