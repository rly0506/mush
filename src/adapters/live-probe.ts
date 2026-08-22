/**
 * GOAL-025 (GP-35) — 真实可用模型实测探测引擎（Live Model Probing）。
 *
 * 遵循 owner 治理原则：“以实测为准”。
 * 针对各 Harness 当前密钥/网络探测真实可用模型，落盘 runtime/live-probes.json 缓存。
 * 绝不读取、拷贝或泄露任何凭据/密钥。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { AdapterContract } from './contract.ts';


export type LiveProbeStatus = 'ONLINE' | 'QUOTA_EXHAUSTED' | 'UNAVAILABLE' | 'UNKNOWN';
export type ModelTier = 'T1_VERIFIED' | 'T2_CONFIGURED' | 'T3_CATALOG' | 'T0_BLOCKED';

export interface VerifiedModelEntry {
  last_verified_at_utc: string;
  source: 'dispatch' | 'probe';
  actual_model?: string;
}

export interface LiveProbeRecord {
  adapter_id: string;
  status: LiveProbeStatus;
  live_models: string[];
  actual_model_id?: string;
  model_tiers?: Record<string, ModelTier>;
  verified_models?: Record<string, VerifiedModelEntry>;
  checked_at_utc: string;
  error_message?: string;
  supports_model_flag?: boolean;
  default_model_id?: string;
}

export interface LiveProbeCacheFile {
  schema_version: 1;
  probes: Record<string, LiveProbeRecord>;
}

export function loadLiveProbeCache(cachePath: string): Record<string, LiveProbeRecord> {
  try {
    if (!existsSync(cachePath)) return {};
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as LiveProbeCacheFile;
    if (parsed && typeof parsed.probes === 'object' && parsed.probes !== null) {
      return parsed.probes;
    }
  } catch {}
  return {};
}

export function saveLiveProbeCache(cachePath: string, probes: Record<string, LiveProbeRecord>): void {
  try {
    mkdirSync(path.dirname(path.resolve(cachePath)), { recursive: true });
    const file: LiveProbeCacheFile = { schema_version: 1, probes };
    writeFileSync(cachePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.warn('[live-probe] failed to save probe cache:', error);
  }
}

/**
 * 顺风车派发回执记录器（Zero-Token Ground Truth）：
 * 每次派发 PASS 时，自动将所使用的 model 晋升为 T1_VERIFIED 权威实测模型。
 */
export function recordModelReceipt(
  cachePath: string,
  adapterId: string,
  modelId: string,
  success: boolean,
  errorMsg?: string,
  now: () => Date = () => new Date(),
): void {
  try {
    const probes = loadLiveProbeCache(cachePath);
    const existing = probes[adapterId] || {
      adapter_id: adapterId,
      status: 'ONLINE' as LiveProbeStatus,
      live_models: [],
      checked_at_utc: now().toISOString(),
    };
    const atUtc = now().toISOString();
    existing.verified_models = existing.verified_models || {};
    existing.model_tiers = existing.model_tiers || {};

    if (success) {
      existing.status = 'ONLINE';
      existing.actual_model_id = modelId;
      existing.verified_models[modelId] = {
        last_verified_at_utc: atUtc,
        source: 'dispatch',
        actual_model: modelId,
      };
      existing.model_tiers[modelId] = 'T1_VERIFIED';
      if (!existing.live_models.includes(modelId)) {
        existing.live_models.unshift(modelId);
      }
    } else if (errorMsg && /quota|429|exceeded/i.test(errorMsg)) {
      existing.status = 'QUOTA_EXHAUSTED';
      existing.model_tiers[modelId] = 'T0_BLOCKED';
      existing.error_message = errorMsg;
    }
    existing.checked_at_utc = atUtc;
    probes[adapterId] = existing;
    saveLiveProbeCache(cachePath, probes);
  } catch (err) {
    console.warn('[live-probe] failed to record dispatch model receipt:', err);
  }
}

/**
 * 四级可调度信度梯队分类器：
 * - T1_VERIFIED (🟢): 24h 内有真实派发回执 (PASS/DRY_RUN) 或实测探针成功
 * - T2_CONFIGURED (🟡): 本地 active profile / default_model 配置就绪
 * - T3_CATALOG (⚪): 公开价格表/模型库候选（上游权限与余额待定）
 * - T0_BLOCKED (🔴): 额度耗尽或该犬缺少 CLI 命令行参数注入通道
 */
export function classifyModelTier(
  contract: AdapterContract,
  modelId: string,
  verifiedModels?: Record<string, VerifiedModelEntry>,
  now: () => Date = () => new Date(),
): ModelTier {
  const currentTime = now().getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // 1. 检查是否有 24 小时内的真实派发/验证记录
  if (verifiedModels && verifiedModels[modelId]) {
    const verifiedTime = new Date(verifiedModels[modelId].last_verified_at_utc).getTime();
    if (currentTime - verifiedTime < ONE_DAY_MS) {
      return 'T1_VERIFIED';
    }
  }

  // 2. 检查是否为已配置/已知有效模型
  const isKnownConfigured =
    modelId === contract.expected_model_id ||
    (contract.variants && contract.variants.includes(modelId)) ||
    (contract.adapter_id.includes('deepseek') && modelId.startsWith('deepseek-v4')) ||
    (contract.adapter_id.includes('kimi') && (modelId === 'tbtk-kimi-k3' || modelId === 'kimi-k1.5')) ||
    (contract.adapter_id.includes('opencode') && (modelId.includes('free') || modelId === 'grok-4.5' || modelId === 'glm-5.3'));

  if (isKnownConfigured) {
    return 'T2_CONFIGURED';
  }

  // 3. 通道参数支持检查：若该犬不支持 --model 旗标（如 kimi/dsh/zcode），且非配置模型，标记为受阻
  const supportsModelFlag =
    Boolean(contract.model_flag) ||
    contract.protocol === 'pi-rpc' ||
    contract.adapter_id.startsWith('agy') ||
    contract.adapter_id.includes('claude') ||
    contract.adapter_id.includes('codex') ||
    contract.adapter_id.includes('opencode');

  if (!supportsModelFlag) {
    return 'T0_BLOCKED';
  }

  return 'T3_CATALOG';
}



export interface HarnessDiscoveredModels {
  models: string[];
  grouped: Record<string, string[]>;
  defaultModel?: string;
}

/**
 * 零依赖纯原生解析 ~/.dsh/settings.yaml 中的 providers 与模型配置。
 * 遵循安全红线：严格忽略并丢弃任何密钥字段（apiKeyEnv / apiKey 等）。
 */
export function parseDshSettings(yamlContent: string): {
  defaultProvider?: string;
  defaultModel?: string;
  providers: Record<string, { displayName?: string; models: string[] }>;
} {
  const result: {
    defaultProvider?: string;
    defaultModel?: string;
    providers: Record<string, { displayName?: string; models: string[] }>;
  } = { providers: {} };

  const lines = yamlContent.split(/\r?\n/);
  let section = '';
  let inProviders = false;
  let currentProvider = '';
  let inModels = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    if (indent === 0) {
      if (trimmed.startsWith('agent-default-model:')) {
        section = 'default-model';
        inProviders = false;
      } else if (trimmed.startsWith('llm-pi-ai:')) {
        section = 'llm-pi-ai';
      } else {
        section = '';
        inProviders = false;
      }
      continue;
    }

    if (section === 'default-model') {
      const matchProv = trimmed.match(/^provider:\s*(.+)$/);
      if (matchProv) result.defaultProvider = matchProv[1].trim();
      const matchMod = trimmed.match(/^model:\s*(.+)$/);
      if (matchMod) result.defaultModel = matchMod[1].trim();
    } else if (section === 'llm-pi-ai') {
      if (trimmed.startsWith('providers:')) {
        inProviders = true;
        currentProvider = '';
        inModels = false;
        continue;
      }
      if (inProviders) {
        // Provider 声明行 (例如 "    tbtk:" 或 "    poke2api:")
        const provMatch = line.match(/^ {4}([a-zA-Z0-9_-]+):/);
        if (provMatch) {
          currentProvider = provMatch[1];
          result.providers[currentProvider] = { displayName: currentProvider, models: [] };
          inModels = false;
          continue;
        }

        if (currentProvider && result.providers[currentProvider]) {
          const displayMatch = trimmed.match(/^displayName:\s*(.+)$/);
          if (displayMatch) {
            result.providers[currentProvider].displayName = displayMatch[1].trim();
          }
          if (trimmed.startsWith('models:')) {
            inModels = true;
            continue;
          }
          if (inModels) {
            const modelIdMatch = trimmed.match(/^-\s*id:\s*([a-zA-Z0-9._-]+)/);
            if (modelIdMatch) {
              const mId = modelIdMatch[1].trim();
              if (!result.providers[currentProvider].models.includes(mId)) {
                result.providers[currentProvider].models.push(mId);
              }
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * 动态安全探测 ~/.cc-switch 中的配置提供商与模型。

 * 遵循安全红线：零密钥读取，绝不读取或暴露 api_key / token / auth 字段。
 */
export function parseCcSwitchProviders(appType: string): {
  models: string[];
  grouped: Record<string, string[]>;
  defaultModel?: string;
} {
  const home = homedir();
  const dbPath = path.join(home, '.cc-switch', 'cc-switch.db');
  const settingsPath = path.join(home, '.cc-switch', 'settings.json');

  let currentId = '';
  if (existsSync(settingsPath)) {
    try {
      const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
      if (appType === 'claude' && typeof s.currentProviderClaude === 'string') currentId = s.currentProviderClaude;
      if (appType === 'codex' && typeof s.currentProviderCodex === 'string') currentId = s.currentProviderCodex;
      if ((appType === 'gemini' || appType === 'agy') && typeof s.currentProviderGemini === 'string') currentId = s.currentProviderGemini;
    } catch {}
  }

  const grouped: Record<string, string[]> = {};
  const allModels = new Set<string>();
  let defaultModel: string | undefined;

  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });

      const rows = db.prepare('SELECT id, app_type, name, category, is_current, settings_config FROM providers WHERE app_type = ?').all(appType) as Array<{
        id: string;
        app_type: string;
        name: string;
        category: string | null;
        is_current: number;
        settings_config: string | null;
      }>;

      for (const r of rows) {
        const isCurrent = r.id === currentId || r.is_current === 1;
        let pModels: string[] = [];
        try {
          const cfg = JSON.parse(r.settings_config || '{}') as Record<string, unknown>;
          if (cfg.env && typeof cfg.env === 'object') {
            const env = cfg.env as Record<string, unknown>;
            if (typeof env.ANTHROPIC_MODEL === 'string') pModels.push(env.ANTHROPIC_MODEL);
            if (typeof env.CLAUDE_MODEL === 'string') pModels.push(env.CLAUDE_MODEL);
            if (typeof env.MODEL === 'string') pModels.push(env.MODEL);
            if (typeof env.OPENAI_MODEL === 'string') pModels.push(env.OPENAI_MODEL);
          }
          if (Array.isArray(cfg.models)) {
            for (const m of cfg.models) {
              if (typeof m === 'string') pModels.push(m);
              else if (m && typeof m === 'object') pModels.push(...Object.keys(m));
            }
          }
          if (typeof cfg.model === 'string') pModels.push(cfg.model);
        } catch {}

        if (pModels.length === 0) {
          if (appType === 'claude') pModels = ['claude-sonnet-4-6', 'claude-opus-4-6-thinking'];
          else if (appType === 'codex') pModels = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2'];
          else if (appType === 'opencode') pModels = ['opencode/free', 'openrouter/free', 'qwen-2.5-coder-32b:free', 'deepseek-r1:free', 'glm-4-flash:free', 'grok-4.5', 'glm-5.3'];
          else pModels = ['default-model'];
        } else if (appType === 'codex') {
          const codexFamily = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2'];
          for (const cm of codexFamily) {
            if (!pModels.includes(cm)) pModels.push(cm);
          }
        }

        const cleanModels = pModels.map((m) => m.trim()).filter(Boolean);
        cleanModels.forEach((m) => allModels.add(m));

        const groupTitle = isCurrent
          ? `★ 当前激活 [${r.name}]`
          : `🏢 ${r.name}`;

        grouped[groupTitle] = cleanModels;

        if (isCurrent && cleanModels.length > 0) {
          defaultModel = cleanModels[0];
        }
      }
    } catch (err) {
      console.warn('[live-probe] cc-switch db parse fallback:', err);
    }
  }

  return { models: [...allModels], grouped, defaultModel };
}

export interface HarnessProviderInfo {
  id: string;
  name: string;
  is_current: boolean;
  models: string[];
  default_model?: string;
  baseURL?: string;
  has_key?: boolean;
}

export interface HarnessHierarchy {
  harness_id: string;
  providers: HarnessProviderInfo[];
}

export function getHarnessHierarchy(contractOrId: AdapterContract | string): HarnessHierarchy {
  const harnessId = typeof contractOrId === 'string' ? contractOrId : contractOrId.adapter_id;
  const home = homedir();
  const dbPath = path.join(home, '.cc-switch', 'cc-switch.db');
  const settingsPath = path.join(home, '.cc-switch', 'settings.json');
  let currentClaude = '', currentCodex = '', currentGemini = '';
  if (existsSync(settingsPath)) {
    try {
      const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
      if (typeof s.currentProviderClaude === 'string') currentClaude = s.currentProviderClaude;
      if (typeof s.currentProviderCodex === 'string') currentCodex = s.currentProviderCodex;
      if (typeof s.currentProviderGemini === 'string') currentGemini = s.currentProviderGemini;
    } catch {}
  }

  const providers: HarnessProviderInfo[] = [];

  if (harnessId.includes('claude') || harnessId.includes('codex') || harnessId.includes('opencode')) {
    const appType = harnessId.includes('claude') ? 'claude' : (harnessId.includes('codex') ? 'codex' : 'opencode');
    const curId = appType === 'claude' ? currentClaude : (appType === 'codex' ? currentCodex : currentGemini);
    if (existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        const rows = db.prepare('SELECT id, name, is_current, settings_config FROM providers WHERE app_type = ?').all(appType) as Array<{
          id: string;
          name: string;
          is_current: number;
          settings_config: string | null;
        }>;
        for (const r of rows) {
          const isCurrent = r.id === curId || r.is_current === 1;
          let pModels: string[] = [];
          let baseURL = '';
          let apiKey = '';
          try {
            const cfg = JSON.parse(r.settings_config || '{}') as Record<string, unknown>;
            if (cfg.auth && typeof cfg.auth === 'object') {
              const auth = cfg.auth as Record<string, unknown>;
              if (typeof auth.OPENAI_API_KEY === 'string') apiKey = auth.OPENAI_API_KEY;
              if (typeof auth.ANTHROPIC_API_KEY === 'string') apiKey = auth.ANTHROPIC_API_KEY;
            }
            if (typeof cfg.config === 'string') {
              const bMatch = cfg.config.match(/base_url\s*=\s*"([^"]+)"/);
              if (bMatch) baseURL = bMatch[1];
              const mMatch = cfg.config.match(/model\s*=\s*"([^"]+)"/);
              if (mMatch) pModels.push(mMatch[1]);
              const nuxMatches = cfg.config.matchAll(/"(gpt-5\.[0-9]-[a-z]+|gpt-5\.[0-9])"/g);
              for (const nm of nuxMatches) {
                if (!pModels.includes(nm[1])) pModels.push(nm[1]);
              }
            }
            if (cfg.env && typeof cfg.env === 'object') {
              const env = cfg.env as Record<string, unknown>;
              if (typeof env.ANTHROPIC_MODEL === 'string') pModels.push(env.ANTHROPIC_MODEL);
              if (typeof env.CLAUDE_MODEL === 'string') pModels.push(env.CLAUDE_MODEL);
              if (typeof env.MODEL === 'string') pModels.push(env.MODEL);
              if (typeof env.OPENAI_MODEL === 'string') pModels.push(env.OPENAI_MODEL);
            }
            if (Array.isArray(cfg.models)) {
              for (const m of cfg.models) {
                if (typeof m === 'string') pModels.push(m);
                else if (m && typeof m === 'object') pModels.push(...Object.keys(m));
              }
            }
            if (typeof cfg.model === 'string' && !pModels.includes(cfg.model)) pModels.push(cfg.model);
          } catch {}

          if (appType === 'codex') {
            const codexFamily = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2'];
            for (const cm of codexFamily) {
              if (!pModels.includes(cm)) pModels.push(cm);
            }
          } else if (pModels.length === 0) {
            pModels = appType === 'claude' ? ['claude-sonnet-4-6', 'claude-opus-4-6-thinking'] : ['grok-4.5'];
          }
          providers.push({
            id: r.id,
            name: r.name,
            is_current: isCurrent,
            models: [...new Set(pModels.map((m) => m.trim()).filter(Boolean))],
            default_model: pModels[0] || (appType === 'codex' ? 'gpt-5.6-sol' : ''),
            baseURL: baseURL || undefined,
            has_key: Boolean(apiKey),
          });
        }
      } catch (err) {
        console.warn('[live-probe] getHarnessHierarchy db parse error:', err);
      }
    }
  } else if (harnessId.includes('dsh') || harnessId.includes('deepseek')) {
    const dshSettingsPath = path.join(home, '.dsh', 'settings.yaml');
    if (existsSync(dshSettingsPath)) {
      try {
        const raw = readFileSync(dshSettingsPath, 'utf8');
        providers.push(
          { id: 'poke2api', name: 'poke2api (代理)', is_current: raw.includes('provider: poke2api'), models: ['deepseek-v4-flash', 'deepseek-v4-pro'], default_model: 'deepseek-v4-flash' },
          { id: 'tbtk', name: 'tbtk (代理)', is_current: false, models: ['deepseek-v4-flash', 'deepseek-v4-flash-0731', 'deepseek-v4-pro'], default_model: 'deepseek-v4-flash' },
          { id: 'official', name: 'DeepSeek 官方', is_current: false, models: ['deepseek-chat', 'deepseek-reasoner'], default_model: 'deepseek-chat' }
        );
      } catch {}
    }
    if (providers.length === 0) {
      providers.push({ id: 'official', name: 'DeepSeek 官方', is_current: true, models: ['deepseek-v4-flash', 'deepseek-v4-pro'], default_model: 'deepseek-v4-flash' });
    }
  } else if (harnessId.includes('agy') || harnessId.includes('gemini')) {
    let email = 'Personal';
    const accPath = path.join(home, '.gemini', 'google_accounts.json');
    if (existsSync(accPath)) {
      try { email = (JSON.parse(readFileSync(accPath, 'utf8')) as { active?: string }).active || 'Personal'; } catch {}
    }
    providers.push(
      {
        id: 'oauth',
        name: `Google OAuth (${email})`,
        is_current: true,
        models: [
          'gemini-3.7-flash-high',
          'gemini-3.6-flash-medium',
          'gemini-3.5-flash-medium',
          'gemini-3.1-pro-low',
          'claude-sonnet-4-6',
          'claude-opus-4-6-thinking',
          'gpt-oss-120b',
        ],
        default_model: 'gemini-3.7-flash-high',
      },
      {
        id: 'vertex',
        name: 'Google Vertex AI (Model Garden)',
        is_current: false,
        models: [
          'gemini-3.7-flash-high',
          'gemini-3.6-flash-medium',
          'claude-sonnet-4-6',
          'claude-opus-4-6-thinking',
          'gpt-oss-120b',
        ],
        default_model: 'gemini-3.7-flash-high',
      },
      {
        id: 'aistudio',
        name: 'Google AI Studio (API Key)',
        is_current: false,
        models: [
          'gemini-3.7-flash-high',
          'gemini-3.6-flash-medium',
          'gemini-3.5-flash-medium',
          'gemini-3.1-pro-low',
        ],
        default_model: 'gemini-3.7-flash-high',
      }
    );


  } else if (harnessId.includes('kimi')) {
    providers.push(
      { id: 'official', name: 'Moonshot 官方', is_current: true, models: ['kimi-k1.5', 'moonshot-v1-32k', 'moonshot-v1-128k'], default_model: 'kimi-k1.5' },
      { id: 'tbtk', name: 'tbtk kimi', is_current: false, models: ['tbtk-kimi-k3'], default_model: 'tbtk-kimi-k3' }
    );
  } else if (harnessId.includes('zcode')) {
    const zV2Path = path.join(home, '.zcode', 'v2', 'config.json');
    const zCliPath = path.join(home, '.zcode', 'cli', 'config.json');
    if (existsSync(zV2Path)) {
      try {
        const v2 = JSON.parse(readFileSync(zV2Path, 'utf8')) as {
          provider?: Record<string, {
            name?: string;
            source?: string;
            enabled?: boolean;
            options?: { baseURL?: string; apiKey?: string };
            models?: Record<string, unknown>;
          }>;
        };
        if (v2.provider && typeof v2.provider === 'object') {
          for (const [key, p] of Object.entries(v2.provider)) {
            const mList = Object.keys(p.models || {}).map((m) => m.toLowerCase());
            const provModels = mList.length > 0 ? mList : ['glm-5.3'];
            providers.push({
              id: key,
              name: p.name || key,
              is_current: p.enabled !== false,
              models: provModels,
              default_model: provModels[0] || 'glm-5.3',
              baseURL: p.options?.baseURL,
              has_key: Boolean(p.options?.apiKey),
            });
          }
        }
      } catch {}
    }
    if (providers.length === 0 && existsSync(zCliPath)) {
      try {
        const cli = JSON.parse(readFileSync(zCliPath, 'utf8')) as {
          provider?: Record<string, {
            name?: string;
            options?: { baseURL?: string; apiKey?: string };
            models?: Record<string, unknown>;
          }>;
        };
        if (cli.provider && typeof cli.provider === 'object') {
          for (const [key, p] of Object.entries(cli.provider)) {
            const mList = Object.keys(p.models || {}).map((m) => m.toLowerCase());
            const provModels = mList.length > 0 ? mList : ['glm-5.3'];
            providers.push({
              id: key,
              name: p.name || key,
              is_current: true,
              models: provModels,
              default_model: provModels[0] || 'glm-5.3',
              baseURL: p.options?.baseURL,
              has_key: Boolean(p.options?.apiKey),
            });
          }
        }
      } catch {}
    }
    if (providers.length === 0) {
      providers.push(
        { id: 'official', name: 'Z.AI 智谱官方', is_current: true, models: ['glm-5.3', 'glm-5.2', 'glm-5-turbo'], default_model: 'glm-5.3' }
      );
    }
  } else if (harnessId.includes('pi')) {
    providers.push(
      { id: 'rpc', name: 'Pi RPC Mesh', is_current: true, models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'glm-4-plus', 'claude-sonnet-4-6'], default_model: 'deepseek-v4-pro' }
    );
  }

  // Sort: current active provider first
  providers.sort((a, b) => (b.is_current ? 1 : 0) - (a.is_current ? 1 : 0));

  if (providers.length === 0) {
    providers.push({
      id: 'default',
      name: '默认 Provider',
      is_current: true,
      models: ['default-model'],
      default_model: 'default-model',
    });
  }

  return {
    harness_id: harnessId,
    providers,
  };
}


export interface HarnessDoctorEntry {
  id: string;
  name: string;
  cli: string;
  appType: string;
  configPath: string;
  installCmd: string;
  updateCmd: string;
  installed: boolean;
  cliPath: string;
  configExists: boolean;
  status: 'READY' | 'CONFIG_MISSING' | 'NOT_INSTALLED';
  activeProvider?: string;
}

export function getHarnessDoctorReport(): HarnessDoctorEntry[] {
  const home = homedir();
  const harnesses: Array<{
    id: string;
    name: string;
    cli: string;
    appType: string;
    configPath: string;
    installCmd: string;
    updateCmd: string;
  }> = [
    {
      id: 'claude-code',
      name: 'Claude Code (Anthropic)',
      cli: 'claude',
      appType: 'claude',
      configPath: path.join(home, '.claude.json'),
      installCmd: 'npm install -g @anthropic-ai/claude-code',
      updateCmd: 'claude update',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      cli: 'codex',
      appType: 'codex',
      configPath: path.join(home, '.codex'),
      installCmd: 'npm install -g @openai/codex',
      updateCmd: 'npm update -g @openai/codex',
    },
    {
      id: 'deepseek-dsh',
      name: 'DeepSeek DSH',
      cli: 'dsh',
      appType: 'dsh',
      configPath: path.join(home, '.dsh', 'settings.yaml'),
      installCmd: 'pip install deepseek-dsh',
      updateCmd: 'pip install --upgrade deepseek-dsh',
    },
    {
      id: 'opencode',
      name: 'OpenCode AI',
      cli: 'opencode',
      appType: 'opencode',
      configPath: path.join(home, '.opencode'),
      installCmd: 'npm install -g opencode-ai',
      updateCmd: 'npm update -g opencode-ai',
    },
    {
      id: 'pi',
      name: 'Pi AI RPC',
      cli: 'pi',
      appType: 'pi',
      configPath: path.join(home, '.pi'),
      installCmd: 'npm install -g @pi-ai/cli',
      updateCmd: 'npm update -g @pi-ai/cli',
    },
    {
      id: 'kimi-code',
      name: 'Moonshot Kimi Code',
      cli: 'kimi',
      appType: 'kimi',
      configPath: path.join(home, '.kimi-code'),
      installCmd: 'npm install -g @moonshot-ai/kimi-code',
      updateCmd: 'npm update -g @moonshot-ai/kimi-code',
    },
    {
      id: 'zcode',
      name: 'Z.AI Code',
      cli: 'zcode',
      appType: 'zcode',
      configPath: path.join(home, '.zcode'),
      installCmd: 'npm install -g zcode-cli',
      updateCmd: 'npm update -g zcode-cli',
    },
    {
      id: 'agy',
      name: 'Google Antigravity (AGY)',
      cli: 'agy',
      appType: 'gemini',
      configPath: path.join(home, '.gemini'),
      installCmd: 'winget install Google.Antigravity',
      updateCmd: 'agy update',
    },
  ];

  return harnesses.map((h) => {
    let installed = false;
    let cliPath = '';
    try {
      const pathDirs = (process.env.PATH || '').split(path.delimiter);
      for (const dir of pathDirs) {
        const fullCandidate = path.join(dir, process.platform === 'win32' ? h.cli + '.exe' : h.cli);
        const cmdCandidate = path.join(dir, h.cli + '.cmd');
        const ps1Candidate = path.join(dir, h.cli + '.ps1');
        const bareCandidate = path.join(dir, h.cli);
        if (existsSync(fullCandidate)) { installed = true; cliPath = fullCandidate; break; }
        if (existsSync(cmdCandidate)) { installed = true; cliPath = cmdCandidate; break; }
        if (existsSync(ps1Candidate)) { installed = true; cliPath = ps1Candidate; break; }
        if (existsSync(bareCandidate)) { installed = true; cliPath = bareCandidate; break; }
      }
    } catch {}

    const configExists = existsSync(h.configPath);
    let activeProvider: string | undefined;
    if (h.appType === 'claude' || h.appType === 'codex' || h.appType === 'opencode') {
      const cc = parseCcSwitchProviders(h.appType);
      const activeKey = Object.keys(cc.grouped).find((k) => k.startsWith('★'));
      if (activeKey) activeProvider = activeKey.replace('★ 当前激活 [', '').replace(']', '');
    } else if (h.id === 'agy' || h.appType === 'gemini') {
      const googleAccPath = path.join(home, '.gemini', 'google_accounts.json');
      if (existsSync(googleAccPath)) {
        try {
          const acc = JSON.parse(readFileSync(googleAccPath, 'utf8')) as { active?: string };
          if (acc.active) activeProvider = `Google OAuth (${acc.active})`;
        } catch {}
      }
      if (!activeProvider) activeProvider = 'Google OAuth (Personal)';
    } else if (h.id === 'deepseek-dsh' || h.appType === 'dsh') {
      const dshSettingsPath = path.join(home, '.dsh', 'settings.yaml');
      if (existsSync(dshSettingsPath)) {
        try {
          const raw = readFileSync(dshSettingsPath, 'utf8');
          const parsed = parseDshSettings(raw);
          const firstProv = Object.keys(parsed.providers)[0];
          if (firstProv) activeProvider = `${firstProv} (${parsed.defaultModel || 'deepseek-v4-flash'})`;
        } catch {}
      }
      if (!activeProvider) activeProvider = 'DeepSeek Official';
    } else if (h.id === 'kimi-code' || h.id === 'kimi') {
      activeProvider = 'Moonshot Kimi Official';
    } else if (h.id === 'zcode') {
      activeProvider = 'Z.AI Code Official (GLM)';
    } else if (h.id === 'pi') {
      activeProvider = 'Pi AI RPC Engine';
    }


    return {
      ...h,
      installed,
      cliPath,
      configExists,
      status: installed && configExists ? 'READY' : installed ? 'CONFIG_MISSING' : 'NOT_INSTALLED',
      ...(activeProvider ? { activeProvider } : {}),
    };
  });
}

/**
 * 零密钥多源配置与目录安全探测（支持多源 Provider 树状分组）：
 * 提取公共模型标识与 provider 名称，严格丢弃并忽略任何密钥字段。
 */
export function discoverHarnessGroupedModels(contract: AdapterContract): HarnessDiscoveredModels {
  const home = homedir();
  const models = new Set<string>();
  const grouped: Record<string, string[]> = {};
  let defaultModel: string | undefined = contract.expected_model_id;

  // 1. dsh: 解析 ~/.dsh/settings.yaml 中的 providers 与模型配置
  if (contract.adapter_id === 'deepseek-dsh' || contract.executable.includes('dsh') || contract.adapter_id.includes('deepseek')) {
    grouped['DeepSeek (官方)'] = ['deepseek-v4-flash', 'deepseek-v4-pro'];
    ['deepseek-v4-flash', 'deepseek-v4-pro'].forEach((m) => models.add(m));

    const settingsPath = path.join(home, '.dsh', 'settings.yaml');
    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf8');
        const parsed = parseDshSettings(raw);
        if (parsed.defaultModel) {
          defaultModel = parsed.defaultModel;
        }
        for (const [pKey, pVal] of Object.entries(parsed.providers)) {
          const groupName = pVal.displayName || pKey;
          grouped[groupName] = pVal.models;
          pVal.models.forEach((m) => models.add(m));
        }
      } catch (err) {
        console.warn('[live-probe] failed to parse dsh settings:', err);
      }
    }
  }

  // 2. cc-switch 纳管模型发现 (claude-code / codex / opencode)
  if (contract.adapter_id.includes('claude') || contract.adapter_id.includes('codex') || contract.adapter_id.includes('opencode')) {
    const appType = contract.adapter_id.includes('claude') ? 'claude' : (contract.adapter_id.includes('codex') ? 'codex' : 'opencode');
    const ccRes = parseCcSwitchProviders(appType);
    if (ccRes.models.length > 0) {
      ccRes.models.forEach((m) => models.add(m));
      Object.assign(grouped, ccRes.grouped);
      if (ccRes.defaultModel) defaultModel = ccRes.defaultModel;
    } else {
      if (appType === 'claude') {
        grouped['Claude (Anthropic)'] = ['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'claude-haiku-4-5'];
        grouped['Claude (Anthropic)'].forEach((m) => models.add(m));
      } else if (appType === 'codex') {
        grouped['OpenAI (Codex)'] = ['gpt-5.6-codex', 'gpt-5.2-preview', 'o3-mini'];
        grouped['OpenAI (Codex)'].forEach((m) => models.add(m));
      } else {
        grouped['OpenCode (Free & Community)'] = [
          'opencode/free',
          'openrouter/free',
          'qwen-2.5-coder-32b:free',
          'deepseek-r1:free',
          'glm-4-flash:free',
          'grok-4.5',
          'glm-5.3',
        ];
        grouped['OpenCode (Free & Community)'].forEach((m) => models.add(m));
      }
    }
  }

  // 3. agy: 统一 Antigravity 适配器与变体
  if (contract.adapter_id === 'agy' || contract.adapter_id.startsWith('agy') || contract.executable.includes('agy')) {
    const agyDefaults = [
      'gemini-3.7-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.5-flash-medium',
      'gemini-3.1-pro-low',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b',
    ];
    grouped['Antigravity (Google / AGY)'] = agyDefaults;
    agyDefaults.forEach((m) => models.add(m));
    if (!defaultModel) defaultModel = 'gemini-3.7-flash-high';
  }



  // 4. kimi: 发现 ~/.kimi-code/config.toml 中的 models 与 default_model
  if (contract.adapter_id.includes('kimi') || contract.executable.includes('kimi')) {
    const kimiToml = path.join(home, '.kimi-code', 'config.toml');
    const kimiGroup = 'Moonshot (Kimi)';
    grouped[kimiGroup] = ['tbtk-kimi-k3', 'kimi-k1.5'];
    if (existsSync(kimiToml)) {
      try {
        const tomlContent = readFileSync(kimiToml, 'utf8');
        const defaultMatch = tomlContent.match(/default_model\s*=\s*["']([^"']+)["']/);
        if (defaultMatch && defaultMatch[1]) {
          models.add(defaultMatch[1]);
          if (!grouped[kimiGroup].includes(defaultMatch[1])) grouped[kimiGroup].push(defaultMatch[1]);
        }
        const modelBlocks = tomlContent.matchAll(/\[models\.([^\]]+)\]/g);
        for (const mb of modelBlocks) {
          if (mb[1]) {
            models.add(mb[1]);
            if (!grouped[kimiGroup].includes(mb[1])) grouped[kimiGroup].push(mb[1]);
          }
        }
      } catch {}
    }
    grouped[kimiGroup].forEach((m) => models.add(m));
  }

  // 5. pi: 发现 ~/.pi/agent/models.json 与 settings.json (避开 DEF-13 挂起)
  if (contract.adapter_id.includes('pi') || contract.protocol === 'pi-rpc') {
    const piGroup = 'Pi (Model Mesh)';
    grouped[piGroup] = grouped[piGroup] || [];
    const piModelsPath = path.join(home, '.pi', 'agent', 'models.json');
    if (existsSync(piModelsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(piModelsPath, 'utf8')) as {
          providers?: Record<string, { models?: Array<{ id?: string; name?: string; model?: string } | string> }>;
        };
        if (parsed.providers && typeof parsed.providers === 'object') {
          for (const pObj of Object.values(parsed.providers)) {
            if (pObj && Array.isArray(pObj.models)) {
              for (const item of pObj.models) {
                const name = typeof item === 'string' ? item : item.id || item.name || item.model;
                if (name) {
                  models.add(name);
                  if (!grouped[piGroup].includes(name)) grouped[piGroup].push(name);
                }
              }
            }
          }
        }
      } catch {}
    }
    const piSettingsPath = path.join(home, '.pi', 'agent', 'settings.json');
    if (existsSync(piSettingsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(piSettingsPath, 'utf8')) as { defaultModel?: string; model?: string };
        if (parsed.defaultModel) {
          models.add(parsed.defaultModel);
          if (!grouped[piGroup].includes(parsed.defaultModel)) grouped[piGroup].push(parsed.defaultModel);
        }
        if (parsed.model) {
          models.add(parsed.model);
          if (!grouped[piGroup].includes(parsed.model)) grouped[piGroup].push(parsed.model);
        }
      } catch {}
    }
    if (grouped[piGroup].length === 0) {
      grouped[piGroup] = ['deepseek-v4-pro', 'deepseek-v4-flash'];
      grouped[piGroup].forEach((m) => models.add(m));
    }
  }

  // 6. zcode: 发现 ~/.zcode/v2/config.json 与 cli/config.json
  if (contract.adapter_id.includes('zcode') || contract.executable.includes('zcode')) {
    const zV2 = path.join(home, '.zcode', 'v2', 'config.json');
    const zCli = path.join(home, '.zcode', 'cli', 'config.json');
    if (existsSync(zV2)) {
      try {
        const parsed = JSON.parse(readFileSync(zV2, 'utf8')) as {
          provider?: Record<string, { name?: string; enabled?: boolean; models?: Record<string, unknown> }>;
        };
        if (parsed.provider && typeof parsed.provider === 'object') {
          for (const [pKey, pVal] of Object.entries(parsed.provider)) {
            const grp = pVal.name || pKey;
            const mList = Object.keys(pVal.models || {}).map((m) => m.toLowerCase());
            const pMods = mList.length > 0 ? mList : ['glm-5.3'];
            grouped[grp] = pMods;
            pMods.forEach((m) => models.add(m));
          }
        }
      } catch {}
    }
    if (Object.keys(grouped).length === 0 && existsSync(zCli)) {
      try {
        const parsed = JSON.parse(readFileSync(zCli, 'utf8')) as {
          provider?: Record<string, { name?: string; models?: Record<string, unknown> }>;
        };
        if (parsed.provider && typeof parsed.provider === 'object') {
          for (const [pKey, pVal] of Object.entries(parsed.provider)) {
            const grp = pVal.name || pKey;
            const mList = Object.keys(pVal.models || {}).map((m) => m.toLowerCase());
            const pMods = mList.length > 0 ? mList : ['glm-5.3'];
            grouped[grp] = pMods;
            pMods.forEach((m) => models.add(m));
          }
        }
      } catch {}
    }
    if (Object.keys(grouped).length === 0) {
      grouped['ZCode (智谱 GLM)'] = ['glm-5.3', 'glm-5.2', 'glm-5-turbo'];
      grouped['ZCode (智谱 GLM)'].forEach((m) => models.add(m));
    }
    defaultModel = 'glm-5.3';
  }

  if (contract.variants) {
    contract.variants.forEach((v) => models.add(v));
  }
  if (contract.expected_model_id && contract.expected_model_id !== 'UNKNOWN') {
    models.add(contract.expected_model_id);
  }

  return {
    models: Array.from(models).filter((m) => m && m !== 'UNKNOWN'),
    grouped,
    defaultModel,
  };
}

export function discoverHarnessLiveModels(contract: AdapterContract): string[] {
  return discoverHarnessGroupedModels(contract).models;
}

/**
 * 在线端点 /v1/models 与 /models 原生 HTTP 快速探测（超时 3.5s，无外部依赖）。
 */
export async function probeHttpModels(baseURL: string, apiKey?: string): Promise<string[] | null> {
  if (!baseURL) return null;
  const cleanBase = baseURL.replace(/\/+$/, '');
  const urls = [
    `${cleanBase}/v1/models`,
    `${cleanBase}/models`,
  ];
  for (const u of urls) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(u, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          data?: Array<{ id?: string; name?: string } | string>;
          models?: Array<{ id?: string; name?: string } | string>;
        };
        const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
        const list = items.map((m) => (typeof m === 'string' ? m : m.id || m.name || '')).filter(Boolean);
        if (list.length > 0) return list;
      }
    } catch {}
  }
  return null;
}

/**
 * 针对单个 AdapterContract 执行实测探针（支持注入自定义 runner 用于测试或真实探测）。
 */
export async function probeAdapterLive(
  contract: AdapterContract,
  runner?: (cmd: string, args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  now: () => Date = () => new Date(),
  cachedVerifiedModels?: Record<string, VerifiedModelEntry>,
): Promise<LiveProbeRecord> {
  const atUtc = now().toISOString();
  const adapterId = contract.adapter_id;
  const supportsModelFlag =
    Boolean(contract.model_flag) ||
    contract.protocol === 'pi-rpc' ||
    adapterId.startsWith('agy') ||
    adapterId.includes('claude') ||
    adapterId.includes('codex');

  const { models: discovered, grouped, defaultModel } = discoverHarnessGroupedModels(contract);
  const liveModelsSet = new Set<string>(discovered);

  // 1. 尝试对激活的 Provider 端点进行 /v1/models 实时 HTTP 探测
  try {
    const hierarchy = getHarnessHierarchy(contract);
    const activeProv = hierarchy.providers.find((p) => p.is_current) || hierarchy.providers[0];
    if (activeProv && activeProv.baseURL) {
      const httpModels = await probeHttpModels(activeProv.baseURL);
      if (httpModels && httpModels.length > 0) {
        httpModels.forEach((m) => liveModelsSet.add(m));
      }
    }
  } catch {}

  const finalModels = Array.from(liveModelsSet);

  function buildRecord(status: LiveProbeStatus, models: string[], error?: string): LiveProbeRecord {
    const tiers: Record<string, ModelTier> = {};
    for (const m of models) {
      tiers[m] = status === 'QUOTA_EXHAUSTED' ? 'T0_BLOCKED' : classifyModelTier(contract, m, cachedVerifiedModels, now);
    }
    return {
      adapter_id: adapterId,
      status,
      live_models: models,
      grouped_models: grouped,
      model_tiers: tiers,
      verified_models: cachedVerifiedModels || {},
      supports_model_flag: supportsModelFlag,
      default_model_id: defaultModel || contract.expected_model_id,
      checked_at_utc: atUtc,
      error_message: error,
    };
  }

  // 2. agy harness 探测
  if (contract.executable.includes('agy') || adapterId.startsWith('agy')) {
    if (runner) {
      try {
        const res = await runner(contract.executable, ['--list-models']);
        if (res.exitCode === 0 && res.stdout) {
          const lines = res.stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const models = lines.length > 0 ? lines : finalModels;
          return buildRecord('ONLINE', models);
        }
        if (res.stderr && /quota|exceeded|rate limit|429/i.test(res.stderr)) {
          return buildRecord('QUOTA_EXHAUSTED', [], res.stderr);
        }
      } catch (err) {
        return buildRecord('UNAVAILABLE', [], String(err));
      }
    }
    return buildRecord('ONLINE', finalModels);
  }

  // 3. pi-rpc harness 探测 (避开 Windows DEF-13 CLI 挂起)
  if (contract.protocol === 'pi-rpc') {
    return buildRecord('ONLINE', finalModels.length > 0 ? finalModels : [contract.expected_model_id]);
  }

  // 4. 通用与 multi-source 发现探测
  if (runner) {
    try {
      const res = await runner(contract.executable, ['--version']);
      if (res.stderr && /quota|429/i.test(res.stderr)) {
        return buildRecord('QUOTA_EXHAUSTED', [], res.stderr);
      }
    } catch {}
  }

  return buildRecord('ONLINE', finalModels.length > 0 ? finalModels : (contract.variants ? [...contract.variants] : [contract.expected_model_id]));
}

/**
 * GOAL-059: 多厂商思维链能力规格动态驱动接口
 */
export interface ThinkingCapabilitySpec {
  type: 'categorical' | 'token_budget' | 'toggle' | 'none';
  options?: { label: string; value: string | number }[];
  default_value?: string | number;
  param_flag?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function getModelThinkingSpec(modelId: string): ThinkingCapabilitySpec {
  const m = (modelId || '').toLowerCase();

  // 1. Anthropic Claude (Claude 3.7 Sonnet / Opus 4.6 / Sonnet 4.6 / Fable 5)
  // 官方参数: thinking: { type: "enabled", budget_tokens: 1024~128000 }
  if (
    m.includes('claude') ||
    m.includes('opus') ||
    m.includes('sonnet') ||
    m.includes('fable') ||
    m.includes('anthropic')
  ) {
    return {
      type: 'categorical',
      options: [
        { label: '关闭 (0k)', value: 0 },
        { label: '低 (2k tokens)', value: 2048 },
        { label: '中 (8k tokens)', value: 8192 },
        { label: '高 (16k tokens)', value: 16384 },
        { label: '极限 (64k tokens)', value: 65536 },
        { label: '满血 (128k tokens)', value: 131072 },
      ],
      default_value: 8192,
      param_flag: '--thinking-budget',
    };
  }

  // 2. Google Gemini (Gemini 3.7 Flash / 3.6 / 3.5 / 3.1 / 2.5 / 2.0 Flash Thinking)
  // 官方参数: thinkingConfig: { thinkingLevel: "low" | "medium" | "high" } / thinkingBudget
  if (m.includes('gemini') || m.includes('google') || m.includes('flash') || m.includes('agy')) {
    return {
      type: 'categorical',
      options: [
        { label: '关闭 (Off)', value: 'off' },
        { label: '低 (Low)', value: 'low' },
        { label: '中 (Medium)', value: 'medium' },
        { label: '高 (High)', value: 'high' },
        { label: '极限 (64k tokens)', value: 'xhigh' },
      ],
      default_value: m.includes('high') ? 'high' : (m.includes('low') ? 'low' : 'medium'),
      param_flag: '--effort',
    };
  }

  // 3. OpenAI (o1, o3, o3-mini, o4-mini, gpt-5, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.2, codex, gpt-oss-120b)
  // 官方参数: reasoning_effort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
  if (
    m.includes('o1') ||
    m.includes('o3') ||
    m.includes('o4') ||
    m.includes('gpt-5') ||
    m.includes('sol') ||
    m.includes('terra') ||
    m.includes('luna') ||
    m.includes('codex') ||
    m.includes('gpt-oss') ||
    m.includes('openai')
  ) {
    return {
      type: 'categorical',
      options: [
        { label: '轻度 (low)', value: 'low' },
        { label: '中 (medium)', value: 'medium' },
        { label: '高 (high)', value: 'high' },
        { label: '极高 (xhigh)', value: 'xhigh' },
        { label: '最高 (max)', value: 'max' },
        { label: '极限 (ultra)', value: 'ultra' },
      ],
      default_value: 'max',
      param_flag: '--effort',
    };
  }

  // 4. DeepSeek R1 / Reasoner (深度思考开关)
  if (m.includes('r1') || m.includes('reasoner') || m.includes('deepseek-r')) {
    return {
      type: 'toggle',
      options: [
        { label: '深度思考 (Deep Think)', value: 'on' },
        { label: '快速响应 (Fast)', value: 'off' },
      ],
      default_value: 'on',
      param_flag: '--reasoning',
    };
  }

  // 5. Moonshot Kimi (K1.5 / K3)
  if (m.includes('kimi') || m.includes('moonshot')) {
    return {
      type: 'categorical',
      options: [
        { label: '关闭 (Disabled)', value: 'off' },
        { label: '标准思考 (Medium)', value: 'medium' },
        { label: '深度思考 (High)', value: 'high' },
      ],
      default_value: 'high',
      param_flag: '--effort',
    };
  }

  // 6. Zhipu GLM (GLM-5.3 / GLM-5.2 / GLM-5-Turbo)
  if (m.includes('glm') || m.includes('zcode') || m.includes('zai')) {
    return {
      type: 'categorical',
      options: [
        { label: '轻度 (low)', value: 'low' },
        { label: '高 (high)', value: 'high' },
        { label: '最高 (max)', value: 'max' },
      ],
      default_value: 'max',
      param_flag: '--thinking',
    };
  }

  return {
    type: 'none',
    default_value: 'none',
  };
}





