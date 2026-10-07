/** GOAL-085 第三阶段第三片（薄 skill）聚焦回归：
 *  skills/collab/SKILL.md 是文档面回归——文档引用的命令、旗标与红线必须与实际
 *  CLI/MCP 实现一致（防文档漂移）；示例命令在 fixture 看板上逐条实跑验证；
 *  不包装逻辑、不全局安装。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KNOWN_FLAGS, runCli } from '../src/cli.ts';
import { mcpCollabTools } from '../src/mcp-collab.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { CollaborationBlackboard, type CollabCapabilityEvidence, type EvidenceRecord, type EvidenceStoreLike } from '../src/orchestration/collaboration-blackboard.ts';
import { buildCodexDiscussionProfile } from '../src/adapters/codex-discussion-profile.ts';
import { buildClaudeDiscussionProfile } from '../src/adapters/claude-discussion-profile.ts';
import { buildClaudeContract } from '../src/adapters/claude.ts';
import { contractPermissionFingerprint, type AdapterContract } from '../src/adapters/contract.ts';

const SKILL_PATH = path.resolve(process.cwd(), 'skills', 'collab', 'SKILL.md');
const skill = readFileSync(SKILL_PATH, 'utf8');

test('skill：五个子命令齐全，入口是仓库本地 node bin/mush（不全局安装）', () => {
  for (const sub of ['check', 'create', 'status', 'result', 'stop']) {
    assert.ok(skill.includes(`collab ${sub}`), `SKILL.md 必须说明 collab ${sub}`);
  }
  assert.ok(skill.includes('node bin/mush'), '入口必须是仓库本地 node bin/mush');
  assert.ok(!/npm\s+(install|i|add)[^]*?(-g|--global)/.test(skill), '不得包含全局安装指引');
  assert.match(skill, /不全局安装/);
  assert.ok(skill.includes('mush mcp'), 'SKILL.md 必须提及 MCP 备选入口');
});

test('skill：文档中出现的全部 --旗标 必须在 CLI 合法旗标集合内（防漂移）', () => {
  const flags = [...skill.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)/g)].map(m => m[1]!);
  assert.ok(flags.length > 0, '文档应包含旗标示例');
  const unknown = flags.filter(f => !KNOWN_FLAGS.has(f));
  assert.deepEqual(unknown, [], `文档使用了 CLI 不存在的旗标：${unknown.join(', ')}`);
  for (const required of ['adapter-a', 'model-a', 'effort-a', 'adapter-b', 'model-b', 'effort-b', 'topic', 'material', 'session', 'format', 'board-url', 'port']) {
    assert.ok(flags.includes(required), `文档缺少 --${required} 示例`);
  }
});

test('skill：Windows 示例全部单行（无 Bash 续行符）；启动备选命令固定 4790 端口', () => {
  // Codex 复核缺口 2：PowerShell 不支持 Bash 的行尾 "\" 续行——文档必须单行。
  const continuation = skill.split('\n').filter(l => /\\\s*$/.test(l) && !/```/.test(l));
  assert.deepEqual(continuation, [], `发现 Bash 续行符行：${JSON.stringify(continuation)}`);
  assert.match(skill, /node bin\/mush board --port 4790/, '启动备选命令必须固定端口（board 默认随机端口）');
});

test('skill：审批门与红线必须写明（等待上限、owner_decision、交还用户、三态费用、换道限定）', () => {
  // Codex 复核缺口 1：等待必须有上限，审批以 owner_decision 为准，交还用户。
  assert.match(skill, /PENDING_OWNER_APPROVAL/);
  assert.match(skill, /owner_decision/);
  assert.match(skill, /交还给用户/);
  assert.match(skill, /轮询必须设上限/);
  assert.match(skill, /不自动批准|没有批准入口|approve\/reject/);
  // Codex 复核缺口 4：费用三态完整描述，区分申报金额/账号额度/真实账单。
  assert.match(skill, /DECLARED/);
  assert.match(skill, /PARTIAL/);
  assert.match(skill, /UNKNOWN/);
  assert.match(skill, /不是 0/);
  assert.match(skill, /真实账单/);
  assert.match(skill, /退出码/);
  assert.match(skill, /`2` 看板业务拒绝/);
  assert.match(skill, /`3` 看板不可达/);
  assert.match(skill, /`64` 用法错误/);
});

test('skill：换道限定与强度示例（Codex 复核缺口 3）', () => {
  // "不换模型"必须限定为失败后不自动换道、不改已批准配置；初始选择遵从用户。
  assert.match(skill, /不在失败后自动换道/);
  assert.match(skill, /不修改已批准配置/);
  assert.match(skill, /遵从用户/);
  // 强度参数示例必须出现。
  assert.match(skill, /--effort-a/);
  assert.match(skill, /--effort-b/);
});

test('skill：MCP 工具面与文档一致（五工具、无文件系统、无 board_url、无批准工具）', () => {
  const tools = mcpCollabTools();
  const toolNames = tools.map(t => t.name);
  for (const name of toolNames) {
    assert.ok(skill.includes(name), `SKILL.md 应提及 MCP 工具 ${name}`);
  }
  const toolsJson = JSON.stringify(tools);
  assert.ok(!toolsJson.includes('board_url'), '工具入参不得暴露 board_url（文档声称与实现一致）');
  assert.ok(!toolsJson.includes('"out"'), '工具面不含 out 落盘（文档声称与实现一致）');
  assert.ok(!toolsJson.includes('"path"'), '工具面不含 path 读文件（文档声称与实现一致）');
  assert.ok(!toolNames.some(n => /approve|reject/.test(n)), '不存在批准/否决工具');
  // 文档中 MCP 材料说明只用 content，不用 path。
  assert.ok(!/materials[^]*?path\s*=/.test(skill), 'MCP 材料说明不得引导使用 path');
});

// ---- 文档示例逐条实跑（Codex 复核：补四处文档并验示例） ----

function fixtureRoot(tag: string): string {
  const root = path.resolve(process.cwd(), '.test-fixtures', `g085-skill-doc-${tag}`, `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  return root;
}

function syntheticEvidence(): { store: EvidenceStoreLike; forParticipant: (adapterId: string, fingerprint: string) => CollabCapabilityEvidence[] } {
  const records = new Map<string, EvidenceRecord>();
  const dimensions = ['write_protection', 'tool_scope', 'read_scope', 'mcp_scope', 'recursion'];
  const forParticipant = (adapterId: string, fingerprint: string): CollabCapabilityEvidence[] =>
    dimensions.map((dimension) => {
      const source = `fixture://g085-skill-doc/${adapterId}/${fingerprint}/${dimension}`;
      records.set(source, {
        source, adapter_id: adapterId, dimension, method: 'dispatch_receipt', subject: 'synthetic fixture',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint, verification: 'behavior',
        artifact_sha256: 'a'.repeat(64), result: 'pass', recorded_at_utc: new Date().toISOString(),
      });
      return { source, adapter_id: adapterId, dimension, subject: 'synthetic fixture', method: 'dispatch_receipt',
        coverage: 'synthetic', tool_version: 'fixture', config_fingerprint: fingerprint,
        verification: 'behavior' as const, status: 'live_verified' as const };
    });
  return { store: { resolve: (s: string) => records.get(s), failuresFor: () => [] }, forParticipant };
}

/** 从 SKILL.md 抽取 `node bin/mush collab ...` 示例行（按文档原样）。 */
function docCollabLines(): string[] {
  return skill.split('\n').map(l => l.trim()).filter(l => l.startsWith('node bin/mush collab '));
}

function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ' ' && !inQuote) { if (cur !== '') { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** 文档占位符 → fixture 实参（示例形态不变，只替换环境相关值）。 */
function toArgv(line: string, sessionId: string, materialPath: string, outPath: string): string[] {
  const map: Array<[string, string]> = [
    ['<议题>', '文档示例验议题'],
    ['材料名=本地文件路径', `示例材料=${materialPath}`],
    ['<公共约束>', '示例约束'],
    ['<session_id>', sessionId],
    ['结果文件.md', outPath],
    // fixture 无 agy 契约：参与者映射为夹具支持的组合（命令形态不变）。
    ['gemini-3.7-flash-high', 'claude-sonnet-5'],
    ['agy', 'claude-code'],
  ];
  return tokenize(line).slice(2).map(token => {
    let t = token;
    for (const [from, to] of map) t = t.split(from).join(to);
    return t;
  });
}

test('skill：文档五条示例命令在 fixture 看板上逐条实跑通过（退出码与文档语义一致）', async () => {
  const root = fixtureRoot('doc-examples');
  const materialPath = path.join(root, 'material.txt');
  const outPath = path.join(root, '结果文件.md');
  const lines = docCollabLines();
  assert.equal(lines.length, 5, `SKILL.md 应有恰 5 条 collab 示例命令，实际 ${lines.length}`);

  const { store, forParticipant } = syntheticEvidence();
  const board = CollaborationBlackboard.open(root, { evidenceStore: store });
  const base = new DispatchPipeline({ workspaceRoot: root, approvalRoot: path.join(root, 'a'), ledgerPath: path.join(root, 'l.jsonl') });
  const codex = buildCodexDiscussionProfile({
    directory: path.join(root, 'codex-profile'), contract: base.getContractMap().codex!,
    modelId: 'gpt-5.5', catalog: { models: [{ slug: 'gpt-5.5' }] }, nativeVersion: '0.160.0', mcpNames: [],
  }).contract;
  const claude = buildClaudeDiscussionProfile({
    workspace: path.join(root, 'claude-workspace'), nativeVersion: '2.1.286', modelId: 'claude-sonnet-5',
    contract: buildClaudeContract('claude-sonnet-5'), directory: path.join(root, 'claude-profile'),
  }).contract;
  const emitScript = path.join(root, 'emit.mjs');
  writeFileSync(emitScript, "process.stdout.write('{}');\n", 'utf8');
  const pipeline = new DispatchPipeline({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), approvalRequestRoot: path.join(root, 'approvals'),
    ledgerPath: path.join(root, 'ledger.jsonl'), collabBlackboard: board, contracts: { codex, 'claude-code': claude },
    codexDiscussionInspector: async () => ({ nativeVersion: '0.160.0', mcps: [] }),
    claudeDiscussionInspector: async () => '2.1.286 (Claude Code)',
    runAdapter: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false, childKilled: false }),
  });
  const server = await startBoardServer({
    workspaceRoot: root, approvalRoot: path.join(root, 'approvals'), runtimeRoot: path.join(root, 'runtime'),
    ledgerPath: path.join(root, 'ledger.jsonl'), runId: 'g085-skill-doc', assignmentEpoch: 1, dispatch: pipeline, port: 0,
    enforceCallerToken: true, collaborationEvidenceStore: store,
    collaborationEvidence: (p, c) => forParticipant(p.adapter_id, contractPermissionFingerprint(c)),
  });
  try {
    const url = `http://127.0.0.1:${server.port}`;
    writeFileSync(materialPath, '文档示例材料正文', 'utf8');
    const argvOf = (line: string, sessionId: string): string[] => toArgv(line, sessionId, materialPath, outPath);

    // ① check 示例
    const check = await runCli(argvOf(lines[0]!, '').concat(['--board-url', url]));
    assert.equal(check.exitCode, 0, `check 示例应 exit 0：${check.stdout.slice(0, 200)}`);
    const checkData = JSON.parse(check.stdout) as Record<string, unknown>;
    assert.equal(typeof checkData.ready, 'boolean', 'check 示例应返回 ready 布尔');

    // ② create 示例（文档原样的参数形态）
    const create = await runCli(argvOf(lines[1]!, '').concat(['--board-url', url]));
    assert.equal(create.exitCode, 0, `create 示例应 exit 0：${create.stdout.slice(0, 300)}`);
    const created = JSON.parse(create.stdout) as Record<string, unknown>;
    assert.equal(created.approval, 'PENDING_OWNER_APPROVAL', 'create 示例应返回待批准语义');
    const sessionId = String(created.session_id);
    assert.equal(board.getSession(sessionId).call_count, 0, '批准前零模型调用');

    // ③ status 示例（以真实 session_id 替换占位符）
    const status = await runCli(argvOf(lines[2]!, sessionId).concat(['--board-url', url]));
    assert.equal(status.exitCode, 0, `status 示例应 exit 0：${status.stdout.slice(0, 200)}`);
    const statusData = JSON.parse(status.stdout) as Record<string, unknown>;
    assert.equal(statusData.owner_decision !== undefined, true, 'status 应含 owner_decision 字段');

    // ④ result 示例（--out 原子排他）
    const result = await runCli(argvOf(lines[3]!, sessionId).concat(['--board-url', url]));
    assert.equal(result.exitCode, 0, `result 示例应 exit 0：${result.stdout.slice(0, 200)}`);
    assert.ok(existsSync(outPath), 'result --out 应创建结果文件');
    assert.ok(readFileSync(outPath, 'utf8').startsWith('# 协作会话结果：文档示例验议题'), '结果文件应为 Markdown 导出');

    // ⑤ stop 示例
    const stop = await runCli(argvOf(lines[4]!, sessionId).concat(['--board-url', url]));
    assert.equal(stop.exitCode, 0, `stop 示例应 exit 0：${stop.stdout.slice(0, 200)}`);
    assert.equal(board.getSession(sessionId).status, 'cancelled', 'stop 示例应取消待批会话');
  } finally {
    await server.close();
    board.close();
  }
});
