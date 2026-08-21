/**
 * GOAL-017A U1 — 适配器注册表 CRUD（runtime/adapters.json，schema v1）。
 *
 * 用户级合同覆盖层叠加在 baseContracts 之上：
 * - 同 adapter_id 覆盖；新增 id 追加；
 * - 软删写 removed:true，roster 隐藏，历史派发不受影响。
 *
 * 安全：POST 只允许选基础模板 + 模板内白名单参数；模板外字段 fail-closed。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateAdapterContract, type AdapterContract } from '../adapters/contract.ts';
import { buildDeepSeekContract } from '../adapters/deepseek.ts';
import { buildClaudeContract } from '../adapters/claude.ts';
import { buildCodexContract } from '../adapters/codex.ts';
import { buildKimiContract } from '../adapters/kimi.ts';
import { buildOpencodeContract } from '../adapters/opencode.ts';
import { buildZcodeContract } from '../adapters/zcode.ts';
import { buildPiContract } from '../adapters/pi.ts';
import { buildAgyContract } from '../adapters/agy.ts';

export type AdapterTemplateId = 'dsh' | 'claude' | 'codex' | 'kimi' | 'opencode' | 'zcode' | 'pi' | 'agy';

export const ADAPTER_TEMPLATES: readonly AdapterTemplateId[] = [
  'dsh',
  'claude',
  'codex',
  'kimi',
  'opencode',
  'zcode',
  'pi',
  'agy',
];

export interface UserAdapterParams {
  /** dsh 模板：默认 profile 名（替换 --profile 值）。 */
  profile?: string;
  /** 带模型轴的模板：期望模型 id（如 claude-sonnet-5 / gpt-5-codex / kimi-k3 / gemini-3.7-flash-high）。 */
  model_id?: string;
}

export interface UserAdapterRecord {
  adapter_id: string;
  template: AdapterTemplateId;
  params: UserAdapterParams;
  removed?: boolean;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface AdapterStoreFile {
  schema_version: 1;
  adapters: UserAdapterRecord[];
}

const ALLOWED_PARAMS: Record<AdapterTemplateId, readonly string[]> = {
  dsh: ['profile'],
  claude: ['model_id'],
  codex: ['model_id'],
  kimi: ['model_id'],
  opencode: ['model_id'],
  zcode: ['model_id'],
  pi: ['model_id'],
  agy: ['model_id'],
};

export function loadAdapterStore(storePath: string): UserAdapterRecord[] {
  try {
    if (!existsSync(storePath)) return [];
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as AdapterStoreFile;
    if (!Array.isArray(parsed.adapters)) return [];
    return parsed.adapters.filter((entry) => entry !== null && typeof entry === 'object');
  } catch {
    // 文件缺失/损坏 fail-closed：不加载任何用户覆盖。
    return [];
  }
}

export function saveAdapterStore(storePath: string, adapters: UserAdapterRecord[]): void {
  mkdirSync(path.dirname(path.resolve(storePath)), { recursive: true });
  const file: AdapterStoreFile = { schema_version: 1, adapters };
  writeFileSync(storePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
}

export function buildTemplateContract(template: AdapterTemplateId): AdapterContract {
  switch (template) {
    case 'dsh':
      return buildDeepSeekContract('dsh');
    case 'claude':
      return buildClaudeContract('claude-sonnet-5');
    case 'codex':
      return buildCodexContract();
    case 'kimi':
      return buildKimiContract();
    case 'opencode':
      return buildOpencodeContract();
    case 'zcode':
      return buildZcodeContract();
    case 'pi':
      return buildPiContract();
    case 'agy':
      return buildAgyContract();
  }
}

/** 模板对应的 verified 基础通道（codex/opencode 因 F-50/未验证不在此列）。 */
export const VERIFIED_TEMPLATES: ReadonlySet<AdapterTemplateId> = new Set<AdapterTemplateId>([
  'dsh',
  'claude',
  'kimi',
  'zcode',
  'agy',
]);

export function applyUserAdapterParams(
  template: AdapterTemplateId,
  adapterId: string,
  params: UserAdapterParams,
): AdapterContract {
  const base = buildTemplateContract(template);
  let contract = validateAdapterContract({ ...base, adapter_id: adapterId });
  if (params.profile !== undefined) {
    if (!contract.arguments.includes('--profile')) {
      throw new Error(`template '${template}' does not support profile`);
    }
    const args = [...contract.arguments];
    const index = args.indexOf('--profile');
    if (index + 1 >= args.length) throw new Error(`template '${template}' has malformed --profile default`);
    args[index + 1] = params.profile;
    contract = validateAdapterContract({ ...contract, arguments: args });
  }
  if (params.model_id !== undefined) {
    contract = validateAdapterContract({
      ...contract,
      expected_model_id: params.model_id,
      ...(contract.model_flag !== undefined && contract.arguments.includes(contract.model_flag)
        ? {
            arguments: contract.arguments.map((arg, index) =>
              index > 0 && contract.arguments[index - 1] === contract.model_flag ? params.model_id! : arg,
            ),
          }
        : {}),
      ...(contract.variants !== undefined && !contract.variants.includes(params.model_id)
        ? { variants: [...contract.variants, params.model_id] }
        : {}),
    });
  }
  return contract;
}

export function validateAdapterUpsert(input: unknown): { template: AdapterTemplateId; adapterId: string; params: UserAdapterParams } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('body must be a JSON object');
  }
  const body = input as Record<string, unknown>;
  const template = body.template;
  if (typeof template !== 'string' || !ADAPTER_TEMPLATES.includes(template as AdapterTemplateId)) {
    throw new Error(`template must be one of ${ADAPTER_TEMPLATES.join('|')}`);
  }
  const adapterId = typeof body.adapter_id === 'string' ? body.adapter_id.trim() : '';
  if (adapterId === '' || !/^[A-Za-z0-9._-]+$/.test(adapterId)) {
    throw new Error('adapter_id must be a non-blank [A-Za-z0-9._-]+ string');
  }
  const rawParams = body.params === undefined ? {} : body.params;
  if (rawParams === null || typeof rawParams !== 'object' || Array.isArray(rawParams)) {
    throw new Error('params must be an object when present');
  }
  const allowed = ALLOWED_PARAMS[template as AdapterTemplateId];
  const params: UserAdapterParams = {};
  for (const key of Object.keys(rawParams as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      throw new Error(`field '${key}' is not allowed for template '${template}'`);
    }
  }
  if (rawParams.profile !== undefined) {
    if (typeof rawParams.profile !== 'string' || rawParams.profile.trim() === '') {
      throw new Error("params.profile must be a non-blank string");
    }
    params.profile = rawParams.profile.trim();
  }
  if (rawParams.model_id !== undefined) {
    if (typeof rawParams.model_id !== 'string' || rawParams.model_id.trim() === '') {
      throw new Error("params.model_id must be a non-blank string");
    }
    params.model_id = rawParams.model_id.trim();
  }
  return { template: template as AdapterTemplateId, adapterId, params };
}

export function inferTemplateForAdapterId(adapterId: string, adapters: UserAdapterRecord[]): AdapterTemplateId | null {
  const existing = adapters.find((entry) => entry.adapter_id === adapterId);
  if (existing !== undefined) return existing.template;
  const known: Record<string, AdapterTemplateId> = {
    'deepseek-dsh': 'dsh',
    'head-dog': 'dsh',
    'claude-code': 'claude',
    codex: 'codex',
    'kimi-code': 'kimi',
    opencode: 'opencode',
    zcode: 'zcode',
    pi: 'pi',
    agy: 'agy',
    'agy-cli': 'agy',
    antigravity: 'agy',
  };
  return known[adapterId] ?? null;
}
