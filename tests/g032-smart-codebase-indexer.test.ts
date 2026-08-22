/**
 * GOAL-032 / GP-19 轻量 AST 依赖分析与上下文自动装配器测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractModuleSymbols,
  resolveDependencyTree,
  findAssociatedTests,
  assembleContext,
} from '../src/orchestration/indexer.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

describe('GOAL-032: Smart Codebase Indexer & Context Assembler', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let server: BoardServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g032-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    mkdirSync(approvalRoot, { recursive: true });

    // 构建一个模拟的迷你源码结构
    mkdirSync(path.join(tmpDir, 'src', 'models'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

    // 1. 数据模型文件
    writeFileSync(
      path.join(tmpDir, 'src', 'models', 'user.ts'),
      `export interface User { id: string; name: string; email: string; }\nexport type UserRole = 'ADMIN' | 'MEMBER';\n`,
      'utf8',
    );

    // 2. 工具类文件
    writeFileSync(
      path.join(tmpDir, 'src', 'utils', 'helper.ts'),
      `import { User } from '../models/user.ts';\nexport function formatUser(u: User): string { return u.name; }\n`,
      'utf8',
    );

    // 3. 业务服务文件（入口）
    writeFileSync(
      path.join(tmpDir, 'src', 'service.ts'),
      `import { User } from './models/user.ts';\nimport { formatUser } from './utils/helper.ts';\nexport class UserService {\n  getUser(): User { return { id: '1', name: 'Alice', email: 'a@a.com' }; }\n}\n`,
      'utf8',
    );

    // 4. 关联测试文件
    writeFileSync(
      path.join(tmpDir, 'tests', 'service.test.ts'),
      `import { test } from 'node:test';\nimport { UserService } from '../src/service.ts';\ntest('UserService smoke', () => {});\n`,
      'utf8',
    );
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. Module Symbol & Signature Extraction', () => {
    const code = `
      import { A, B as B1 } from './dep.ts';
      import * as C from './all.ts';
      export interface Config { timeout: number; retries?: number; }
      export type Status = 'OK' | 'ERR';
      export async function runJob(cfg: Config): Promise<Status> { return 'OK'; }
      export class Runner {}
    `;
    const symbols = extractModuleSymbols(code);
    assert.ok(symbols.exports.includes('Config'));
    assert.ok(symbols.exports.includes('Status'));
    assert.ok(symbols.exports.includes('runJob'));
    assert.ok(symbols.exports.includes('Runner'));
    assert.strictEqual(symbols.imports.length, 2);
    assert.ok(symbols.signatures.some((s) => s.includes('interface Config')));
    assert.ok(symbols.signatures.some((s) => s.includes('function runJob')));
  });

  test('2. Dependency Tree Resolution & Circular Import Safety', () => {
    // 注入循环依赖
    writeFileSync(
      path.join(tmpDir, 'src', 'models', 'cycle.ts'),
      `import { formatUser } from '../utils/helper.ts';\nexport const cycle = true;\n`,
      'utf8',
    );
    const deps = resolveDependencyTree(tmpDir, ['src/service.ts'], 3);
    assert.ok(deps.length >= 2);
    const rels = deps.map((d) => d.relative_path);
    assert.ok(rels.includes('src/service.ts'));
    assert.ok(rels.includes('src/models/user.ts'));
    assert.ok(rels.includes('src/utils/helper.ts'));
  });

  test('3. Associated Test Discovery', () => {
    const tests = findAssociatedTests(tmpDir, 'src/service.ts');
    assert.strictEqual(tests.length, 1);
    assert.strictEqual(tests[0], 'tests/service.test.ts');
  });

  test('4. Complete Context Assembly with Budget Management', () => {
    const context = assembleContext({
      workspaceRoot: tmpDir,
      targetFiles: ['src/service.ts'],
      maxTokensBudget: 5000,
      includeTests: true,
    });

    assert.strictEqual(context.target_files.length, 1);
    assert.strictEqual(context.target_files[0].relative_path, 'src/service.ts');
    assert.ok(context.dependencies.length >= 2);
    assert.strictEqual(context.associated_tests.length, 1);
    assert.ok(context.prompt_block.includes('## 📦 智能代码上下文包'));
    assert.ok(context.prompt_block.includes('Target Files'));
    assert.ok(context.prompt_block.includes('Dependencies & Type Signatures'));
    assert.ok(context.prompt_block.includes('Associated Tests'));
    assert.ok(context.estimated_tokens > 0 && context.estimated_tokens <= 5000);
  });

  test('5. Server API POST /api/context/assemble with Caller Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-context-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    // 1. 无 Token 拦截 401
    const unauthed = await fetch(`http://127.0.0.1:${server.port}/api/context/assemble`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: ['src/service.ts'] }),
    });
    assert.strictEqual(unauthed.status, 401);

    // 2. 有效 Token 成功装配 200
    const authed = await fetch(`http://127.0.0.1:${server.port}/api/context/assemble`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        workspace: tmpDir,
        files: ['src/service.ts'],
        max_tokens: 3000,
      }),
    });
    assert.strictEqual(authed.status, 200);
    const data = (await authed.json()) as {
      ok: boolean;
      context: { target_files: Array<{ relative_path: string }> };
    };
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.context.target_files[0].relative_path, 'src/service.ts');
  });
});
