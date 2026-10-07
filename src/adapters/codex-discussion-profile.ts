/** GOAL-084: staged Codex discussion configuration. This module never dispatches or grants admission. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runT1 } from './t1-runner.ts';
import { randomUUID } from 'node:crypto';
import { contractPermissionFingerprint, validateAdapterContract, type AdapterContract } from './contract.ts';

export interface CodexDiscussionProfile {
  readonly modelId: string;
  readonly nativeVersion: string;
  readonly catalogPath: string;
  readonly catalogSha256: string;
  readonly contractSha256: string;
  readonly disabledMcpNames: readonly string[];
  readonly contract: AdapterContract;
}
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const disabledFeatures = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'browser_use',
  'computer_use', 'code_mode_host', 'hooks', 'memories', 'skill_mcp_dependency_install', 'skill_search',
  'view_image', 'goals', 'tool_suggest', 'sleep_tool', 'image_generation', 'remote_plugin'];

export function buildCodexDiscussionProfile(options: {
  directory: string; contract: AdapterContract; modelId: string; catalog: unknown;
  nativeVersion: string; mcpNames: readonly string[];
}): CodexDiscussionProfile {
  const base = validateAdapterContract(options.contract);
  if (base.adapter_id !== 'codex') throw new Error('closed profile requires the codex adapter');
  if (options.modelId !== base.expected_model_id && !base.variants?.includes(options.modelId)) {
    throw new Error('closed profile requires a registered model');
  }
  if (typeof options.nativeVersion !== 'string' || !options.nativeVersion.trim() || options.nativeVersion.length > 128) {
    throw new Error('closed profile requires a native version');
  }
  if (!Array.isArray(options.mcpNames) || options.mcpNames.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name))) {
    throw new Error('unsupported MCP identifier in closed profile');
  }
  const data = JSON.parse(JSON.stringify(options.catalog)) as { models?: Array<Record<string, unknown>> };
  if (!data || !Array.isArray(data.models) || data.models.some(model => !model || typeof model !== 'object')) {
    throw new Error('invalid native model catalog');
  }
  const selected = data.models.filter(model => model.slug === options.modelId);
  if (selected.length !== 1) throw new Error('native catalog must contain the selected model exactly once');
  selected[0].apply_patch_tool_type = null;
  const bytes = JSON.stringify(data, null, 2) + '\n';
  const catalogSha256 = digest(bytes);
  if (options.directory.startsWith('\\\\') || options.directory.startsWith('//')) throw new Error('nonlocal catalog directory rejected');
  const directory = path.resolve(options.directory);
  const catalogPath = path.join(directory, 'catalog-' + catalogSha256 + '.json');
  mkdirSync(directory, { recursive: true });
  if (existsSync(catalogPath)) {
    if (digest(readFileSync(catalogPath)) !== catalogSha256) throw new Error('existing catalog hash mismatch; refusing overwrite');
  } else {
    writeFileSync(catalogPath, bytes, { flag: 'wx' });
  }
  const disabledMcpNames = [...new Set(options.mcpNames)].sort();
  const args = ['--sandbox', 'read-only', '-c', 'approval_policy="never"',
    ...disabledFeatures.flatMap(name => ['-c', 'features.' + name + '=false']),
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '-c', 'features.skip_host_skill_discovery=true', '-c', 'skills.max_context_tokens=1',
    '-c', 'developer_instructions=""',
    '-c', 'model_catalog_json=' + JSON.stringify(catalogPath.replaceAll('\\', '/')),
    ...disabledMcpNames.flatMap(name => ['-c', 'mcp_servers.' + name + '.enabled=false']),
  ];
  const contract = validateAdapterContract({ ...base, prompt_transport: 'stdin', tool_restriction_args: args,
    codex_discussion_profile: { model_id: options.modelId, native_version: options.nativeVersion,
      catalog_path: catalogPath, catalog_sha256: catalogSha256 } });
  Object.freeze(contract.arguments);
  Object.freeze(contract.tool_restriction_args);
  Object.freeze(contract);
  return Object.freeze({ modelId: options.modelId, nativeVersion: options.nativeVersion,
    catalogPath, catalogSha256, contractSha256: contractPermissionFingerprint(contract),
    disabledMcpNames: Object.freeze(disabledMcpNames), contract });
}

/** Must be called with fresh host observations before future activation/spawn. This is not live capability evidence. */
export function verifyCodexDiscussionProfile(profile: CodexDiscussionProfile, observed: {
  nativeVersion: string; modelId: string; mcps: readonly { name: string; enabled: boolean }[];
}): void {
  if (observed.modelId !== profile.modelId) throw new Error('closed profile model mismatch');
  if (observed.nativeVersion !== profile.nativeVersion) throw new Error('closed profile native version mismatch');
  if (contractPermissionFingerprint(profile.contract) !== profile.contractSha256) throw new Error('closed profile contract hash mismatch');
  if (digest(readFileSync(profile.catalogPath)) !== profile.catalogSha256) throw new Error('closed profile catalog hash mismatch');
  if (!Array.isArray(observed.mcps) || observed.mcps.some(server => !server || typeof server.name !== 'string' || server.enabled !== false)) {
    throw new Error('closed profile has an enabled or unverifiable MCP server');
  }
}

export type CodexDiscussionInspector = (contract: AdapterContract, workspace: string, dataRoot: string) => Promise<{
  nativeVersion: string; mcps: readonly { name: string; enabled: boolean }[];
}>;

export function verifyCodexDiscussionBinding(contract: AdapterContract, modelId: string,
  observed?: { nativeVersion: string; mcps: readonly { name: string; enabled: boolean }[] }): void {
  const p = contract.codex_discussion_profile;
  if (p === undefined) throw new Error('closed profile binding missing');
  if (modelId !== p.model_id) throw new Error('closed profile model mismatch');
  if (digest(readFileSync(p.catalog_path)) !== p.catalog_sha256) throw new Error('closed profile catalog hash mismatch');
  if (observed !== undefined) {
    if (observed.nativeVersion !== p.native_version) throw new Error('closed profile native version mismatch');
    if (!Array.isArray(observed.mcps) || observed.mcps.some(s => !s || typeof s.name !== 'string' || s.enabled !== false)) {
      throw new Error('closed profile has an enabled or unverifiable MCP server');
    }
  }
}

/** Uses the same executable/config arguments as the runner. No prompt, model request, or raw metadata logging. */
export const inspectCodexDiscussionRuntime: CodexDiscussionInspector = async (contract, workspace, dataRoot) => {
  const query = async (tail: string[]): Promise<string> => {
    const result = await runT1({
      contract: validateAdapterContract({ adapter_id: 'codex-native-metadata', executable: contract.executable,
        arguments: [...(contract.tool_restriction_args ?? []), ...tail], protocol: 't1', prompt_transport: 'stdin',
        expected_provider: contract.expected_provider, expected_model_id: 'UNKNOWN' }),
      prompt: '', workspaceRoot: workspace,
      receiptPath: path.join(dataRoot, 'runtime', 'native-capability-checks', randomUUID() + '.json'), timeoutMs: 60_000,
    });
    if (result.exitCode !== 0 || result.timedOut) throw new Error('native Codex metadata verification failed');
    return result.stdout;
  };
  const nativeVersion = (await query(['--version'])).trim();
  let rows: unknown;
  try { rows = JSON.parse(await query(['mcp', 'list', '--json'])); } catch { throw new Error('native MCP metadata is not verifiable'); }
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.name !== 'string' || typeof r.enabled !== 'boolean')) {
    throw new Error('native MCP metadata is not verifiable');
  }
  return { nativeVersion, mcps: rows.map(r => ({ name: r.name as string, enabled: r.enabled as boolean })) };
};

/** Model-free native inputs for constructing a fresh profile. No raw MCP configuration is returned. */
export async function readCodexDiscussionInputs(contract: AdapterContract, workspace: string, dataRoot: string): Promise<{
  nativeVersion: string; catalog: unknown; mcpNames: string[];
}> {
  const query = async (arguments_: string[]): Promise<string> => {
    const result = await runT1({ contract: validateAdapterContract({ adapter_id: 'codex-profile-input',
      executable: contract.executable, arguments: arguments_, protocol: 't1', prompt_transport: 'stdin',
      expected_provider: contract.expected_provider, expected_model_id: 'UNKNOWN' }), prompt: '', workspaceRoot: workspace,
      receiptPath: path.join(dataRoot, 'runtime', 'native-capability-checks', randomUUID() + '.json'), timeoutMs: 60_000 });
    if (result.exitCode !== 0 || result.timedOut) throw new Error('cannot collect native Codex profile inputs');
    return result.stdout;
  };
  const nativeVersion = (await query(['--version'])).trim();
  const catalog: unknown = JSON.parse(await query(['debug', 'models', '--bundled']));
  const rows: unknown = JSON.parse(await query(['mcp', 'list', '--json']));
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.name !== 'string' || typeof r.enabled !== 'boolean')) throw new Error('native MCP inventory is not verifiable');
  return { nativeVersion, catalog, mcpNames: rows.map(r => r.name as string) };
}
