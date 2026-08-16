/**
 * mush Board API v1 — 派发管线（GOAL-006）。
 *
 * 契约：src/web/api-contract.md POST /api/dispatch 等。
 * 流程：schema 校验 → 合同解析 → USD admission 门（事件化，JSONL append-only）
 *      → dry-run/real 执行 → 回执落盘 → 派发生命周期事件。
 * real=true 必须先有 owner approval 记录（否则 BLOCKED_WAITING_OWNER）。
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsdBudgetLedger, type UsdAdmissionEntry } from '../core/budget.ts';
import { validateAdapterContract, type AdapterContract } from '../adapters/contract.ts';
import { buildDeepSeekContract } from '../adapters/deepseek.ts';
import { buildClaudeContract } from '../adapters/claude.ts';
import { buildZcodeContract } from '../adapters/zcode.ts';
import { buildCodexContract } from '../adapters/codex.ts';
import { buildOpencodeContract } from '../adapters/opencode.ts';
import { runT1, type SpawnFn } from '../adapters/t1-runner.ts';

export type DispatchStatus =
  | 'ADMITTED'
  | 'DRY_RUN'
  | 'BLOCKED_WAITING_OWNER'
  | 'BLOCKED_ENV'
  | 'FAIL'
  | 'PASS';

export interface DispatchLifecycleEvent {
  kind: 'dispatch';
  phase: 'ADMISSION' | 'EXECUTE' | 'REPORT' | 'REVIEW';
  status: DispatchStatus;
  adapter_id: string;
  at_utc: string;
  dispatch_id: string;
  payload: Record<string, unknown>;
}

export interface DispatchRecord {
  dispatch_id: string;
  adapter_id: string;
  status: DispatchStatus;
  receipt_path: string | null;
  admission: { decision: string; remaining_usd: number } | null;
  events: DispatchLifecycleEvent[];
  error: string | null;
  /** G7B-E1（契约 v1.1 向后兼容新增）：只读输出摘要，REPORT 后填充。 */
  stdout_tail: { text: string; truncated: boolean } | null;
  stderr_tail: { text: string; truncated: boolean } | null;
}

/** 尾部截断（UTF-8 字符安全）：超长保留末段并标记 truncated。 */
export function tailOf(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(text.length - maxChars), truncated: true };
}

export interface RunAdapterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  childKilled: boolean;
}

export type RunAdapterFn = (
  contract: AdapterContract,
  prompt: string,
  opts: { workspaceRoot: string; receiptPath: string; timeoutMs: number },
) => Promise<RunAdapterResult>;

export interface DispatchPipelineOptions {
  workspaceRoot: string;
  approvalRoot: string;
  /** G009：real-dispatch 犬只批准目录；缺省 <workspaceRoot>/goals/receipts/dispatch-approvals。 */
  dispatchApprovalRoot?: string;
  ledgerPath: string;
  contracts?: Record<string, AdapterContract>;
  runAdapter?: RunAdapterFn;
  spawn?: SpawnFn;
  onEvent?: (event: DispatchLifecycleEvent) => void;
  now?: () => Date;
  /** G010：能力注册表路径；缺省 <workspaceRoot>/runtime/capability-registry.json。 */
  registryPath?: string;
}

export interface WorkspaceInfo {
  path: string;
  is_git: boolean;
  mush_managed: boolean;
  /** G7B-E2（契约 v1.1 向后兼容新增）：是否为当前选中 workspace。 */
  selected: boolean;
}

function baseContracts(): Record<string, AdapterContract> {
  return {
    'fake-t1': validateAdapterContract({
      adapter_id: 'fake-t1',
      executable: 'fake.exe',
      arguments: ['--headless'],
      protocol: 't1',
      prompt_transport: 'stdin',
      expected_provider: 'fake-provider',
      expected_model_id: 'fake-model',
    }),
    'deepseek-dsh': buildDeepSeekContract('dsh'),
    // 默认 sonnet-5：claude-real-011 实证该变体身份+nonce 双通过。
    'claude-code': buildClaudeContract('claude-sonnet-5'),
    zcode: buildZcodeContract(),
    codex: buildCodexContract(),
    opencode: buildOpencodeContract(),
  };
}

export interface RegistryFile {
  adapters?: Array<{ adapter_id: string; models?: string[] }>;
}

/** G010：静态合同 + cc-switch 注册表合成。注册表缺省时回退静态（fail-closed 不猜测）；
 * 注册表只增补 variants 与 provider 归属，executable/协议等敏感细节不来自外部数据。 */
export function buildContracts(registry?: RegistryFile | null): Record<string, AdapterContract> {
  const contracts = baseContracts();
  for (const entry of registry?.adapters ?? []) {
    const base = contracts[entry.adapter_id];
    if (base === undefined || entry.models === undefined || entry.models.length === 0) continue;
    const variants = [...new Set([...(base.variants ?? []), ...entry.models.filter((model) => typeof model === 'string' && model.trim() !== '' && model !== 'UNKNOWN')])];
    if (variants.length === 0) continue;
    contracts[entry.adapter_id] = validateAdapterContract({
      ...base,
      variants,
    });
  }
  return contracts;
}

function loadRegistry(registryPath: string): RegistryFile | undefined {
  try {
    const text = readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(text) as RegistryFile;
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined; // 损坏的注册表 fail-closed 回退静态
    return undefined; // 文件缺失/不可读同回退
  }
}

/** G009：应用模型变体——更新身份期望；有 model_flag 的通道同步重写 CLI 参数
 *（旗标值替换为变体名）。无 flag 通道仅记录身份期望（切换能力见 F-G9-02）。 */
function applyModelVariant(contract: AdapterContract, modelId: string): AdapterContract {
  const arguments_ =
    contract.model_flag !== undefined && contract.arguments.includes(contract.model_flag)
      ? contract.arguments.map((arg, index) =>
          index > 0 && contract.arguments[index - 1] === contract.model_flag ? modelId : arg,
        )
      : contract.arguments;
  return validateAdapterContract({
    ...contract,
    arguments: arguments_,
    expected_model_id: modelId,
  });
}

const EFFORTS = new Set(['LOW', 'HIGH', 'XHIGH']);

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

export class DispatchPipeline {
  readonly workspaceRoot: string;
  readonly approvalRoot: string;
  private readonly dispatchApprovalRoot: string;
  readonly ledgerPath: string;
  private readonly contracts: Record<string, AdapterContract>;
  private readonly runAdapter: RunAdapterFn;
  private onEvent: (event: DispatchLifecycleEvent) => void;
  private readonly ledger = new UsdBudgetLedger();
  private readonly records = new Map<string, DispatchRecord>();
  private selectedWorkspace: string | null = null;
  private now: () => Date;

  constructor(options: DispatchPipelineOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.approvalRoot = path.resolve(options.approvalRoot);
    // G009 修复：real-dispatch 的犬只批准目录与看板审批视图（approval-requests）
    // 是两类记录，默认分开——犬只批准在 dispatch-approvals（D6 惯例）。
    this.dispatchApprovalRoot = path.resolve(
      options.dispatchApprovalRoot ?? path.join(this.workspaceRoot, 'goals', 'receipts', 'dispatch-approvals'),
    );
    this.ledgerPath = path.resolve(options.ledgerPath);
    this.contracts =
      options.contracts ??
      buildContracts(
        loadRegistry(options.registryPath ?? path.join(this.workspaceRoot, 'runtime', 'capability-registry.json')),
      );
    this.onEvent = options.onEvent ?? (() => {});
    this.now = options.now ?? (() => new Date());
    this.runAdapter =
      options.runAdapter ??
      (async (contract, prompt, opts) => {
        try {
          const result = await runT1({
            contract,
            prompt,
            workspaceRoot: opts.workspaceRoot,
            receiptPath: opts.receiptPath,
            timeoutMs: opts.timeoutMs,
            spawn: options.spawn,
          });
          return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
            childKilled: result.childKilled,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            timedOut: false,
            childKilled: false,
          };
        }
      });
  }

  /** 让宿主（board server SSE）重新挂接生命周期事件监听。 */
  setEventListener(listener: (event: DispatchLifecycleEvent) => void): void {
    this.onEvent = listener;
  }

  private emit(record: DispatchRecord, phase: DispatchLifecycleEvent['phase'], status: DispatchStatus, payload: Record<string, unknown>): void {
    const event: DispatchLifecycleEvent = {
      kind: 'dispatch',
      phase,
      status,
      adapter_id: record.adapter_id,
      dispatch_id: record.dispatch_id,
      at_utc: this.now().toISOString(),
      payload,
    };
    record.events.push(event);
    this.onEvent(event);
  }

  private appendLedger(entry: UsdAdmissionEntry): void {
    mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
    writeFileSync(this.ledgerPath, JSON.stringify(entry) + '\n', { flag: 'a', encoding: 'utf8' });
  }

  /** schema fail-closed：任何字段违规抛 InputError（HTTP 400）。 */
  async dispatch(input: unknown): Promise<DispatchRecord> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new InputError('body must be a JSON object');
    }
    const body = input as Record<string, unknown>;
    const adapterId = typeof body.adapter_id === 'string' ? body.adapter_id : '';
    const contract = this.contracts[adapterId];
    if (contract === undefined) throw new InputError(`unknown adapter: ${adapterId}`);
    // G009：模型变体选择——必须属于合同声明的 variants（fail-closed）。
    let effectiveContract = contract;
    if (body.model_id !== undefined) {
      const modelId = String(body.model_id);
      if (contract.variants === undefined || !contract.variants.includes(modelId)) {
        throw new InputError(`model_id '${modelId}' not in variants of ${adapterId}`);
      }
      effectiveContract = applyModelVariant(contract, modelId);
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (prompt.trim() === '' || prompt.length > 64000) throw new InputError('prompt must be 1..64000 chars');
    const effort = body.effort === undefined ? 'LOW' : String(body.effort).toUpperCase();
    if (!EFFORTS.has(effort)) throw new InputError("effort must be LOW|HIGH|XHIGH");
    const capUsd = body.cap_usd === undefined ? 5 : Number(body.cap_usd);
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new InputError('cap_usd must be > 0');
    const amountUsd = body.amount_usd === undefined ? 0 : Number(body.amount_usd);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new InputError('amount_usd must be >= 0');
    const real = body.real === true;
    const workspace = typeof body.workspace === 'string' && body.workspace.trim() !== '' ? path.resolve(body.workspace) : this.workspaceRoot;
    if (!existsSync(workspace)) throw new InputError(`workspace does not exist: ${workspace}`);

    const dispatchId = randomUUID().replace(/-/g, '');
    const record: DispatchRecord = {
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      status: 'ADMITTED',
      receipt_path: null,
      admission: null,
      events: [],
      error: null,
      stdout_tail: null,
      stderr_tail: null,
    };

    const admission = this.ledger.admit({
      actorId: adapterId,
      capUsd,
      amountUsd,
      meta: { dispatch_id: dispatchId, effort, real, prompt_sha256: sha256Hex(prompt) },
    });
    record.admission = { decision: admission.decision, remaining_usd: admission.remainingUsd };
    this.appendLedger(admission);
    this.emit(record, 'ADMISSION', admission.decision === 'ADMITTED' ? 'ADMITTED' : 'FAIL', {
      decision: admission.decision,
      remaining_usd: admission.remainingUsd,
    });
    this.records.set(dispatchId, record);
    if (admission.decision !== 'ADMITTED') {
      record.status = 'FAIL';
      record.error = 'budget admission denied';
      this.emit(record, 'REVIEW', 'FAIL', { reason: 'budget admission denied' });
      return record;
    }

    if (real) {
      const approvalPath = path.join(this.dispatchApprovalRoot, adapterId + '.approved.json');
      if (!existsSync(approvalPath)) {
        record.status = 'BLOCKED_WAITING_OWNER';
        record.error = 'real dispatch requires owner approval record (D6)';
        this.emit(record, 'EXECUTE', 'BLOCKED_WAITING_OWNER', { approval_path: approvalPath });
        this.emit(record, 'REVIEW', 'BLOCKED_WAITING_OWNER', { reason: record.error });
        return record;
      }
    }

    const receiptDir = path.join(workspace, '.mush-receipts');
    mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, `dispatch-${dispatchId}.json`);
    this.emit(record, 'EXECUTE', real ? 'ADMITTED' : 'DRY_RUN', { workspace });
    const run = await this.runAdapter(effectiveContract, prompt, {
      workspaceRoot: workspace,
      receiptPath,
      timeoutMs: real ? 120_000 : 5_000,
    });
    record.receipt_path = receiptPath;
    record.stdout_tail = tailOf(run.stdout, 2048);
    record.stderr_tail = tailOf(run.stderr, 256);
    const receipt = {
      schema_version: 1,
      dispatch_id: dispatchId,
      adapter_id: adapterId,
      prompt_sha256: sha256Hex(prompt),
      effort,
      real,
      exit_code: run.exitCode,
      timed_out: run.timedOut,
      child_killed: run.childKilled,
      stdout_sha256: sha256Hex(run.stdout),
      stderr_sha256: sha256Hex(run.stderr),
      finished_at_utc: this.now().toISOString(),
    };
    writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', 'utf8');
    const pass = run.exitCode === 0 && !run.timedOut;
    record.status = pass ? (real ? 'PASS' : 'DRY_RUN') : run.timedOut ? 'BLOCKED_ENV' : 'FAIL';
    record.error = pass ? null : run.stderr || `runner exit ${run.exitCode}`;
    this.emit(record, 'REPORT', record.status, { receipt_path: receiptPath, exit_code: run.exitCode });
    this.emit(record, 'REVIEW', record.status, { verdict: pass ? 'PASS' : 'FAIL' });
    return record;
  }

  get(dispatchId: string): DispatchRecord | null {
    return this.records.get(dispatchId) ?? null;
  }

  /** G009：在册犬只名册（派发下拉/看板视图的取数源）——合同表投影，
   * 只含身份字段，不含 executable 路径等敏感细节。 */
  roster(): Array<{ adapter_id: string; protocol: string; expected_provider: string; expected_model_id: string; variants?: string[]; model_flag?: string }> {
    return Object.values(this.contracts).map((contract) => ({
      adapter_id: contract.adapter_id,
      protocol: contract.protocol,
      expected_provider: contract.expected_provider,
      expected_model_id: contract.expected_model_id,
      ...(contract.variants !== undefined ? { variants: [...contract.variants] } : {}),
      ...(contract.model_flag !== undefined ? { model_flag: contract.model_flag } : {}),
    }));
  }

  recent(limit = 20): DispatchRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  budgetProjection(): { actors: Array<{ actor_id: string; spent_usd: number; cap_usd: number; entries: UsdAdmissionEntry[] }> } {
    const actorIds = new Set<string>([...this.contracts ? Object.keys(this.contracts) : []]);
    for (const entry of this.ledger.allEntries()) actorIds.add(entry.actorId);
    return {
      actors: [...actorIds].map((actorId) => ({
        actor_id: actorId,
        spent_usd: this.ledger.spentUsd(actorId),
        cap_usd: 5,
        entries: this.ledger.entries(actorId) as UsdAdmissionEntry[],
      })),
    };
  }

  listWorkspaces(extraCandidates: string[] = []): WorkspaceInfo[] {
    const candidates = new Set<string>([this.workspaceRoot]);
    if (this.selectedWorkspace !== null) candidates.add(this.selectedWorkspace);
    // G009 修复：已知工作区持久化列表（<repoRoot>/.mush/known-workspaces.json），
    // 解决列表只含服务 cwd、冷启动选不到其他工作区的问题。
    for (const known of this.knownWorkspaces()) candidates.add(known);
    for (const candidate of extraCandidates) candidates.add(path.resolve(candidate));
    const result: WorkspaceInfo[] = [];
    for (const candidate of candidates) {
      try {
        if (!existsSync(candidate)) continue;
        const stat = statSync(candidate);
        if (!stat.isDirectory()) continue;
        result.push({
          path: candidate,
          is_git: existsSync(path.join(candidate, '.git')),
          mush_managed: existsSync(path.join(candidate, '.mush')),
          selected: this.selectedWorkspace !== null && candidate === this.selectedWorkspace,
        });
      } catch {
        // 不可读目录 fail-closed：不返回。
      }
    }
    return result;
  }

  selectWorkspace(target: string): string {
    const resolved = path.resolve(target);
    if (!existsSync(resolved)) throw new InputError(`workspace does not exist: ${resolved}`);
    if (!statSync(resolved).isDirectory()) throw new InputError(`not a directory: ${resolved}`);
    this.selectedWorkspace = resolved;
    const mushDir = path.join(resolved, '.mush');
    mkdirSync(mushDir, { recursive: true });
    writeFileSync(
      path.join(mushDir, 'workspace.json'),
      JSON.stringify({ schema_version: 1, selected: resolved, selected_at_utc: this.now().toISOString() }) + '\n',
      'utf8',
    );
    this.rememberWorkspace(resolved);
    return resolved;
  }

  /** G009：选中即记住（append 到 repo 侧 known-workspaces.json，去重）。 */
  private rememberWorkspace(resolved: string): void {
    const known = new Set(this.knownWorkspaces());
    known.add(resolved);
    const mushDir = path.join(this.workspaceRoot, '.mush');
    mkdirSync(mushDir, { recursive: true });
    writeFileSync(
      path.join(mushDir, 'known-workspaces.json'),
      JSON.stringify({ schema_version: 1, workspaces: [...known].sort() }, null, 2) + '\n',
      'utf8',
    );
  }

  private knownWorkspaces(): string[] {
    const file = path.join(this.workspaceRoot, '.mush', 'known-workspaces.json');
    try {
      if (!existsSync(file)) return [];
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { workspaces?: unknown };
      return Array.isArray(parsed.workspaces)
        ? parsed.workspaces.filter((item): item is string => typeof item === 'string')
        : [];
    } catch (error) {
      if (error instanceof SyntaxError) return []; // JSON 损坏 fail-closed
      throw error; // 编程错误（如未导入符号）不得静默吞掉
    }
  }
}

export class InputError extends Error {}
