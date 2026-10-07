/** GOAL-084: project-local pure-text configuration. This module does not grant admission or dispatch. */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { runT1 } from './t1-runner.ts';
import { validateAdapterContract, type AdapterContract } from './contract.ts';

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const AGY_DISCUSSION_DENY = ['read_file(*)', 'write_file(*)', 'command(*)', 'mcp(*)',
  'read_url(*)', 'execute_url(*)', 'unsandboxed(*)'] as const;
export interface AgyDiscussionInputs {
  workspace: string; projectId: string; projectFile: string; agentFile: string;
  nativeVersion: string; modelId: string;
}

function verifyAssets(input: AgyDiscussionInputs): { projectHash: string; agentHash: string; hooksHash: string; gateHash: string } {
  const projectBytes = readFileSync(input.projectFile);
  const project = JSON.parse(projectBytes.toString());
  const folders = project.projectResources?.resources;
  if (project.id !== input.projectId || !Array.isArray(folders) || folders.length !== 1 ||
      typeof folders[0].folderUri !== 'string' ||
      folders[0].folderUri.replace(/^file:\/\//, '').replaceAll('\\', '/').toLowerCase() !==
      path.resolve(input.workspace).replaceAll('\\', '/').toLowerCase()) throw new Error('agy project workspace binding mismatch');
  const grants = project.permissionGrants?.permissionGrants;
  if (!Array.isArray(grants?.deny) || AGY_DISCUSSION_DENY.some(rule => !grants.deny.includes(rule)) ||
      (grants.allow?.length ?? 0) !== 0) throw new Error('agy project missing mandatory deny rules');
  const agentPath = path.join(path.resolve(input.workspace), '.agents', 'agents', 'mush-discussion.md');
  const relative = path.relative(realpathSync(input.workspace), realpathSync(input.agentFile));
  if (path.resolve(input.agentFile) !== agentPath || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('agy agent must be the project-local discussion definition');
  }
  const agentBytes = readFileSync(input.agentFile);
  const header = agentBytes.toString().match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const expected: Record<string, string> = { name: 'mush-discussion', mainAgent: 'true', subagent: 'false',
    commandExecutionPolicy: 'off', mcpServers: '[]', skills: '[]', plugins: '[]' };
  const seen = new Map<string, string>();
  for (const line of (header ?? '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z]+):\s*(.+)$/);
    if (!m || seen.has(m[1]) || (m[1] !== 'description' && m[1] !== 'tools' && !(m[1] in expected))) throw new Error('invalid closed agy agent definition');
    seen.set(m[1], m[2].trim());
  }
  // Exactly one pure answer terminator is permitted; no resource tool or generic allowlist.
  if (!seen.has('description') || !['[]', '[finish]'].includes(seen.get('tools') ?? '') || Object.entries(expected).some(([key, value]) => seen.get(key) !== value)) {
    throw new Error('agy agent capabilities are not closed');
  }
  const hooksFile = path.join(input.workspace, '.agents', 'hooks.json');
  const gateFile = path.join(input.workspace, '.agents', 'deny-tools.mjs');
  for (const file of [hooksFile, gateFile]) {
    const relative = path.relative(realpathSync(input.workspace), realpathSync(file));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('agy hook escapes workspace');
  }
  const hooksBytes = readFileSync(hooksFile), gateBytes = readFileSync(gateFile);
  const hooks = JSON.parse(hooksBytes.toString());
  const configured = hooks['mush-controlled-discussion'];
  const entry = configured?.PreToolUse?.[0], handler = entry?.hooks?.[0];
  if (Object.keys(hooks).length !== 1 || configured?.enabled !== true ||
      Object.keys(configured).some(key => key !== 'enabled' && key !== 'PreToolUse') ||
      configured.PreToolUse?.length !== 1 || entry.matcher !== '*' || entry.hooks?.length !== 1 ||
      handler.type !== 'command' || handler.timeout !== 5 || handler.command !== 'node ' + gateFile.replaceAll('\\', '/') ||
      digest(gateBytes) !== digest(readFileSync(new URL('./agy-discussion-gate.mjs', import.meta.url)))) {
    throw new Error('agy discussion hard tool gate is not configured');
  }
  return { projectHash: digest(projectBytes), agentHash: digest(agentBytes), hooksHash: digest(hooksBytes), gateHash: digest(gateBytes) };
}

export function buildAgyDiscussionProfile(options: AgyDiscussionInputs & { contract: AdapterContract }): { contract: AdapterContract } {
  const base = validateAdapterContract(options.contract);
  if (base.adapter_id !== 'agy' || !/^[a-f0-9-]{36}$/i.test(options.projectId) || !options.nativeVersion.trim() ||
      (options.modelId !== base.expected_model_id && !base.variants?.includes(options.modelId))) throw new Error('invalid agy project profile');
  const hashes = verifyAssets(options);
  const contract = validateAdapterContract({ ...base,
    tool_restriction_args: ['--sandbox', '--disable-slash-commands', '--project', options.projectId, '--agent', 'mush-discussion'],
    output_schema_args: ['--output-format', 'stream-json'],
    agy_discussion_profile: { model_id: options.modelId, native_version: options.nativeVersion,
      workspace_root: path.resolve(options.workspace), project_id: options.projectId,
      project_file: path.resolve(options.projectFile), project_sha256: hashes.projectHash,
      agent_file: path.resolve(options.agentFile), agent_sha256: hashes.agentHash,
      hooks_file: path.join(path.resolve(options.workspace), '.agents', 'hooks.json'), hooks_sha256: hashes.hooksHash,
      tool_gate_file: path.join(path.resolve(options.workspace), '.agents', 'deny-tools.mjs'), tool_gate_sha256: hashes.gateHash } });
  return { contract };
}

/** D96: host-owned, explicitly listed patch-version acceptance. No built-in exemptions. */
export interface AgyVersionDriftAcceptance {
  schema_version: 1;
  decision: string;
  accepted_by: string;
  accepted_at_utc: string;
  frozen_native_version: string;
  accepted_versions: string[];
}

export function readAgyVersionDriftAcceptanceDir(directory: string): AgyVersionDriftAcceptance | null {
  try {
    const value = JSON.parse(readFileSync(path.join(path.resolve(directory), 'version-drift-acceptance.json'), 'utf8')) as Partial<AgyVersionDriftAcceptance>;
    if (value.schema_version !== 1 || typeof value.decision !== 'string' || !value.decision.trim()
      || typeof value.accepted_by !== 'string' || !value.accepted_by.trim()
      || typeof value.accepted_at_utc !== 'string' || !value.accepted_at_utc.trim()
      || typeof value.frozen_native_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.frozen_native_version)
      || !Array.isArray(value.accepted_versions)
      || !value.accepted_versions.every(version => typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version))) return null;
    return value as AgyVersionDriftAcceptance;
  } catch { return null; }
}

export function verifyAgyDiscussionBinding(contract: AdapterContract, modelId: string, version?: string,
  acceptance?: AgyVersionDriftAcceptance | null): { drift_accepted?: {
    decision: string; accepted_by: string; frozen_native_version: string; observed_native_version: string;
  } } {
  const p = contract.agy_discussion_profile;
  if (!p || p.model_id !== modelId) throw new Error('agy discussion model mismatch');
  let drift: { decision: string; accepted_by: string; frozen_native_version: string; observed_native_version: string } | undefined;
  if (version !== undefined && version !== p.native_version) {
    if (acceptance?.frozen_native_version !== p.native_version || !acceptance.accepted_versions.includes(version)) {
      throw new Error(`agy discussion native version mismatch (frozen ${p.native_version}, observed ${version})`);
    }
    drift = { decision: acceptance.decision, accepted_by: acceptance.accepted_by,
      frozen_native_version: p.native_version, observed_native_version: version };
  }
  const args = ['--sandbox', '--disable-slash-commands', '--project', p.project_id, '--agent', 'mush-discussion'];
  if (JSON.stringify(contract.tool_restriction_args) !== JSON.stringify(args)) throw new Error('agy discussion execution arguments mismatch');
  if (digest(readFileSync(p.project_file)) !== p.project_sha256 || digest(readFileSync(p.agent_file)) !== p.agent_sha256 ||
      digest(readFileSync(p.hooks_file)) !== p.hooks_sha256 || digest(readFileSync(p.tool_gate_file)) !== p.tool_gate_sha256) {
    throw new Error('agy discussion asset hash mismatch');
  }
  verifyAssets({ workspace: p.workspace_root, projectId: p.project_id, projectFile: p.project_file,
    agentFile: p.agent_file, modelId, nativeVersion: p.native_version });
  return drift === undefined ? {} : { drift_accepted: drift };
}

export type AgyDiscussionInspector = (contract: AdapterContract, dataRoot: string) => Promise<string>;
export const inspectAgyDiscussionVersion: AgyDiscussionInspector = async (contract, dataRoot) => {
  const p = contract.agy_discussion_profile!;
  const result = await runT1({ contract: validateAdapterContract({ adapter_id: 'agy-version-metadata',
    executable: contract.executable, arguments: ['--version'], protocol: 't1', prompt_transport: 'stdin',
    expected_provider: contract.expected_provider, expected_model_id: 'UNKNOWN' }), prompt: '', workspaceRoot: p.workspace_root,
    receiptPath: path.join(dataRoot, 'runtime', 'native-capability-checks', randomUUID() + '.json'), timeoutMs: 8000 });
  if (result.exitCode !== 0 || result.timedOut) throw new Error('agy version cannot be verified');
  return result.stdout.trim();
};

/** The setup manifest contains only project/agent asset locations, model and native version; never credentials. */
export function readAgyDiscussionInputs(runtimeRoot: string): AgyDiscussionInputs {
  return JSON.parse(readFileSync(path.join(runtimeRoot, 'collaboration-admission', 'agy', 'profile.json'), 'utf8')) as AgyDiscussionInputs;
}
