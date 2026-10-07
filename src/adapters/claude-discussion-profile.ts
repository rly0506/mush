/** GOAL-085: Claude Code 讨论通道配置（受控）。本模块不授予准入、不派发、不写普通账号配置。
 *
 * 与 agy 档案同构：绑定版本、模型、限制参数与必要资产哈希，派发前与批准重跑时复核漂移。
 * 受控参数集（本机 claude 2.1.286 `--help` 实录，逐条语义）：
 *   --safe-mode            跳过 CLAUDE.md/skills/plugins/hooks/MCP/custom commands&agents 等自定义
 *   --tools ""             禁用全部内建工具（help: 'Use "" to disable all tools'）
 *   --strict-mcp-config    只用 --mcp-config 声明的 MCP
 *   --mcp-config <空配置>  宿主生成的空 MCP 清单（配合上一条=无 MCP 服务器）
 *   --settings <空设置>    显式空 settings（配合 --strict-mcp-config 压住用户/项目 settings）
 *   --disable-slash-commands  禁用全部 skills
 *   --permission-mode dontAsk 非交互，不弹权限询问
 *   --no-session-persistence  不落会话持久化
 * 不采用 --bare（会改变加载与认证来源）；普通聊天配置保持原样。 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runT1 } from './t1-runner.ts';
import { randomUUID } from 'node:crypto';
import { contractPermissionFingerprint, validateAdapterContract, type AdapterContract } from './contract.ts';

const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** 冻结进合同的受限参数（顺序即 argv 顺序；--mcp-config/--settings 由宿主生成后填入）。 */
export function claudeDiscussionRestrictionArgs(options: { mcpConfigPath: string; settingsPath: string }): string[] {
  return [
    '--safe-mode',
    '--tools', '',
    '--strict-mcp-config',
    '--mcp-config', options.mcpConfigPath.replaceAll('\\', '/'),
    '--settings', options.settingsPath.replaceAll('\\', '/'),
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
  ];
}

const EMPTY_MCP_CONFIG = '{"mcpServers":{}}\n';
const EMPTY_SETTINGS = '{}\n';

export interface ClaudeDiscussionInputs {
  /** 受控讨论工作目录（独立于普通聊天工作区）。 */
  workspace: string;
  /** 原生版本（`claude --version` 实测）。 */
  nativeVersion: string;
  modelId: string;
}

export interface ClaudeDiscussionAssets {
  directory: string;
  mcpConfigPath: string;
  settingsPath: string;
  mcpConfigSha256: string;
  settingsSha256: string;
}

/** 生成（或复核）宿主自有的空 MCP 配置与空 settings，返回路径与哈希。
 *  已存在但内容不符即拒绝覆盖（fail-closed）。 */
function ensureAssets(directory: string): ClaudeDiscussionAssets {
  if (directory.startsWith('\\\\') || directory.startsWith('//')) throw new Error('nonlocal Claude profile directory rejected');
  const resolved = path.resolve(directory);
  mkdirSync(resolved, { recursive: true });
  const mcpConfigPath = path.join(resolved, 'mcp-config.empty.json');
  const settingsPath = path.join(resolved, 'settings.empty.json');
  for (const [file, expected] of [[mcpConfigPath, EMPTY_MCP_CONFIG], [settingsPath, EMPTY_SETTINGS]] as const) {
    if (existsSync(file)) {
      if (readFileSync(file, 'utf8') !== expected) throw new Error('existing Claude profile asset mismatch; refusing overwrite');
    } else {
      writeFileSync(file, expected, { flag: 'wx' });
    }
  }
  return {
    directory: resolved, mcpConfigPath, settingsPath,
    mcpConfigSha256: digest(readFileSync(mcpConfigPath)),
    settingsSha256: digest(readFileSync(settingsPath)),
  };
}

/** 原生版本规范化：`claude --version` 实测输出形如 "2.1.286 (Claude Code)"，
 *  只取数字版本号入库/比对，避免把发行方附加文案冻结进指纹。 */
export function normalizeClaudeVersion(observed: string): string {
  const match = /(\d+\.\d+\.\d+)/.exec(observed);
  if (match === null) throw new Error('Claude native version could not be parsed');
  return match[1];
}

/** 版本比对口径统一走规范化：绑定值必须是规范化后的数字版本。 */
function sameVersion(observed: string, bound: string): boolean {
  try {
    return normalizeClaudeVersion(observed) === bound;
  } catch {
    return false;
  }
}

export function buildClaudeDiscussionProfile(options: ClaudeDiscussionInputs & {
  contract: AdapterContract; directory: string;
}): { contract: AdapterContract; assets: ClaudeDiscussionAssets } {
  const base = validateAdapterContract(options.contract);
  if (base.adapter_id !== 'claude-code') throw new Error('Claude discussion profile requires the claude-code adapter');
  const known = [base.expected_model_id, ...(base.variants ?? [])];
  if (!known.includes(options.modelId)) throw new Error('Claude discussion profile requires a registered model');
  if (typeof options.nativeVersion !== 'string' || !options.nativeVersion.trim() || options.nativeVersion.length > 128) {
    throw new Error('Claude discussion profile requires a native version');
  }
  const boundVersion = normalizeClaudeVersion(options.nativeVersion);
  const workspace = path.resolve(options.workspace);
  if (workspace.startsWith('\\\\') || workspace.startsWith('//')) throw new Error('nonlocal Claude discussion workspace rejected');
  mkdirSync(workspace, { recursive: true });
  const assets = ensureAssets(options.directory);
  const contract = validateAdapterContract({
    ...base,
    // 讨论通道只用流式 JSON + inline schema；模型与强度按席位独立冻结。
    arguments: ['--output-format', 'stream-json', '--verbose'],
    tool_restriction_args: claudeDiscussionRestrictionArgs({ mcpConfigPath: assets.mcpConfigPath, settingsPath: assets.settingsPath }),
    output_schema_flag: '--json-schema',
    output_schema_inline: true,
    claude_discussion_profile: {
      model_id: options.modelId,
      native_version: boundVersion,
      workspace_root: workspace,
      mcp_config_file: assets.mcpConfigPath, mcp_config_sha256: assets.mcpConfigSha256,
      settings_file: assets.settingsPath, settings_sha256: assets.settingsSha256,
    },
  });
  return { contract, assets };
}

/** GOAL-085 D95（owner 2026-10-05 裁定）：**显式接受原生版本漂移**的登记文件。
 *  这是**政策接受**，不是新证据：证据条目仍只属冻结指纹；本文件只把派发时的版本门
 *  针对**逐个列出的**观察版本放行，未列出的版本照旧 fail-closed。
 *  文件位置：`<runtimeRoot>/collaboration-admission/claude/version-drift-acceptance.json`。
 *  撤销 = 删除该文件或从列表移除版本；**不在代码里内置任何默认放行**。 */
export interface ClaudeVersionDriftAcceptance {
  schema_version: number;
  decision: string;
  accepted_by: string;
  accepted_at_utc: string;
  /** 被接受漂移所对应的**冻结**原生版本（必须与合同绑定的 native_version 一致才生效）。 */
  frozen_native_version: string;
  /** 明确列出的可放行观察版本（规范化数字版本）。 */
  accepted_versions: string[];
  scope?: string;
  not_claimed?: string[];
}

/** 读取版本漂移接受登记；缺失/不可解析/形态非法一律返回 null（该情形按原样 fail-closed）。
 *  `admissionDir` 是**准入目录**（`…/collaboration-admission/claude`，即 `profile.json` 所在目录；
 *  可由合同的 `claude_discussion_profile.workspace_root` 的父目录确定性推出）。 */
export function readClaudeVersionDriftAcceptanceDir(admissionDir: string): ClaudeVersionDriftAcceptance | null {
  const file = path.join(path.resolve(admissionDir), 'version-drift-acceptance.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ClaudeVersionDriftAcceptance>;
    if (typeof parsed.decision !== 'string' || parsed.decision.trim() === '') return null;
    if (typeof parsed.accepted_by !== 'string' || parsed.accepted_by.trim() === '') return null;
    if (typeof parsed.frozen_native_version !== 'string' || parsed.frozen_native_version.trim() === '') return null;
    if (!Array.isArray(parsed.accepted_versions) || parsed.accepted_versions.some((v) => typeof v !== 'string')) return null;
    return {
      schema_version: typeof parsed.schema_version === 'number' ? parsed.schema_version : 1,
      decision: parsed.decision,
      accepted_by: parsed.accepted_by,
      accepted_at_utc: typeof parsed.accepted_at_utc === 'string' ? parsed.accepted_at_utc : '',
      frozen_native_version: parsed.frozen_native_version,
      accepted_versions: parsed.accepted_versions.map((v) => String(v).trim()).filter((v) => v !== ''),
      ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
      ...(Array.isArray(parsed.not_claimed) ? { not_claimed: parsed.not_claimed.filter((v): v is string => typeof v === 'string') } : {}),
    };
  } catch {
    return null;
  }
}

/** 便捷入口：按 runtime 根读取（`<runtimeRoot>/collaboration-admission/claude/version-drift-acceptance.json`）。 */
export function readClaudeVersionDriftAcceptance(runtimeRoot: string): ClaudeVersionDriftAcceptance | null {
  return readClaudeVersionDriftAcceptanceDir(path.join(path.resolve(runtimeRoot), 'collaboration-admission', 'claude'));
}

/** 本条派发实际用到版本漂移接受的记录（进派发记录，供审批/审计可见）。 */
export interface ClaudeBindingDrift {
  decision: string;
  accepted_by: string;
  frozen_native_version: string;
  observed_native_version: string;
}

/** 派发前/重跑前复核：模型、原生版本（可选）、参数形态与资产哈希。任一不符即抛（fail-closed）。
 *  唯一例外是 owner 登记的**显式版本漂移接受**：仅当登记里的 frozen_native_version 与本合同绑定值
 *  一致、且观察版本被逐个列出时放行，并在返回值里如实报出所用依据；其余一律抛错。 */
export function verifyClaudeDiscussionBinding(
  contract: AdapterContract, modelId: string, version?: string, driftAcceptance?: ClaudeVersionDriftAcceptance | null,
): { drift_accepted?: ClaudeBindingDrift } {
  const p = contract.claude_discussion_profile;
  if (p === undefined) throw new Error('Claude discussion binding missing');
  if (p.model_id !== modelId) throw new Error('Claude discussion model mismatch');
  let drift: ClaudeBindingDrift | undefined;
  if (version !== undefined && !sameVersion(version, p.native_version)) {
    const observed = (() => {
      try { return normalizeClaudeVersion(version); } catch { return null; }
    })();
    const accepted = observed !== null
      && driftAcceptance !== undefined && driftAcceptance !== null
      && driftAcceptance.frozen_native_version === p.native_version
      && driftAcceptance.accepted_versions.includes(observed);
    if (!accepted) throw new Error('Claude discussion native version mismatch');
    drift = {
      decision: driftAcceptance.decision, accepted_by: driftAcceptance.accepted_by,
      frozen_native_version: p.native_version, observed_native_version: observed,
    };
  }
  const expected = claudeDiscussionRestrictionArgs({ mcpConfigPath: p.mcp_config_file, settingsPath: p.settings_file });
  if (JSON.stringify(contract.tool_restriction_args) !== JSON.stringify(expected)) {
    throw new Error('Claude discussion execution arguments mismatch');
  }
  if (digest(readFileSync(p.mcp_config_file)) !== p.mcp_config_sha256) throw new Error('Claude discussion MCP config hash mismatch');
  if (digest(readFileSync(p.settings_file)) !== p.settings_sha256) throw new Error('Claude discussion settings hash mismatch');
  return drift === undefined ? {} : { drift_accepted: drift };
}

/** 只读原生版本探测（零模型调用；与 runner 同可执行文件）。 */
export type ClaudeDiscussionInspector = (contract: AdapterContract, dataRoot: string) => Promise<string>;

/** **不需要绑定**的版本探测：首次接入时合同里还没有 `claude_discussion_profile`，
 *  此时以普通合同的可执行文件在给定工作目录做只读 `--version`（零模型调用）。
 *  这是装配顺序的硬要求——先探测版本、再据以装配绑定，不能反过来要求绑定已存在。 */
export async function probeClaudeNativeVersion(
  contract: AdapterContract, workspaceRoot: string, dataRoot: string,
): Promise<string> {
  const result = await runT1({
    contract: validateAdapterContract({
      adapter_id: 'claude-version-metadata', executable: contract.executable, arguments: ['--version'],
      protocol: 't1', prompt_transport: 'stdin', expected_provider: contract.expected_provider, expected_model_id: 'UNKNOWN',
    }),
    prompt: '', workspaceRoot,
    receiptPath: path.join(dataRoot, 'runtime', 'native-capability-checks', randomUUID() + '.json'), timeoutMs: 8_000,
  });
  if (result.exitCode !== 0 || result.timedOut) throw new Error('Claude version cannot be verified');
  return result.stdout.trim();
}

export const inspectClaudeDiscussionVersion: ClaudeDiscussionInspector = async (contract, dataRoot) => {
  const p = contract.claude_discussion_profile;
  if (p === undefined) throw new Error('Claude discussion binding missing');
  return probeClaudeNativeVersion(contract, p.workspace_root, dataRoot);
};

/** 宿主登记文件（只含目录/模型/版本，绝不含凭据）。 */
export function readClaudeDiscussionInputs(runtimeRoot: string): ClaudeDiscussionInputs {
  return JSON.parse(readFileSync(path.join(runtimeRoot, 'collaboration-admission', 'claude', 'profile.json'), 'utf8')) as ClaudeDiscussionInputs;
}

/** 宿主写登记文件（仅首次或内容一致时）。 */
export function writeClaudeDiscussionInputs(runtimeRoot: string, inputs: ClaudeDiscussionInputs): string {
  const file = path.join(path.resolve(runtimeRoot), 'collaboration-admission', 'claude', 'profile.json');
  const bytes = JSON.stringify(inputs, null, 2) + '\n';
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== bytes) throw new Error('existing Claude profile registration mismatch; refusing overwrite');
    return file;
  }
  writeFileSync(file, bytes, { flag: 'wx' });
  return file;
}

export { contractPermissionFingerprint };
