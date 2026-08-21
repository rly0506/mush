/**
 * tests/g046-red-blue-verification-studio.test.ts
 *
 * 验证 GOAL-046：红蓝对抗验证室与闭环自动打回流
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { VerifierLoopEngine, VerifierDecouplingError } from '../src/orchestration/verifier-loop.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-046: Red-Blue Verification Studio', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g046-test-'));
  const approvalRoot = path.join(tmpDir, 'approvals');
  let server: BoardServer | null = null;

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. VerifierLoopEngine Core: Physical Decoupling, Attack Injection, Correction Loop & Circuit Breaker', () => {
    const engine = new VerifierLoopEngine(tmpDir);

    // 1. Generator === Verifier 物理硬隔离拦截
    assert.throws(
      () => {
        engine.createSession({
          taskTitle: '实现分布式锁',
          workspaceRoot: tmpDir,
          generatorDog: 'claude-code',
          verifierDog: 'claude-code', // 同犬自审违规！
          initialCode: { summary: '锁实现', code: 'export class Lock {}' },
        });
      },
      VerifierDecouplingError,
      '必须拦截同犬自审'
    );

    // 2. 正常初始化红蓝对抗会话
    const session = engine.createSession({
      taskTitle: '实现无死锁异步队列',
      workspaceRoot: tmpDir,
      generatorDog: 'agy',
      verifierDog: 'deepseek-code',
      initialCode: { summary: '初始队列实现', code: 'export class AsyncQueue { async pop() {} }' },
      maxRetries: 2,
    });

    assert.ok(session.session_id.startsWith('verify-'));
    assert.strictEqual(session.status, 'IN_PROGRESS');
    assert.strictEqual(session.current_round, 1);
    assert.strictEqual(session.generator_dog, 'agy');
    assert.strictEqual(session.verifier_dog, 'deepseek-code');

    // 3. 第 1 轮红方攻击发现并发死锁 Bug
    const r1 = engine.submitAttackRound(session.session_id, {
      redCases: [
        { test_name: 'test_concurrency_deadlock', test_code: 'it("deadlock", async () => {...})', attack_type: 'concurrency' },
        { test_name: 'test_boundary_empty_pop', test_code: 'it("empty", async () => {...})', attack_type: 'boundary' },
      ],
      passed: false,
      failedTests: [
        { test_name: 'test_concurrency_deadlock', error_message: 'Timeout: 10000ms exceeded due to lock contention' },
      ],
      feedback: '并发消费时未释放锁导致死锁，请在 finally 块中释放锁',
    });

    assert.strictEqual(r1.status, 'IN_PROGRESS');
    assert.strictEqual(r1.rounds[0].passed, false);
    assert.strictEqual(r1.rounds[0].failed_tests?.length, 1);

    // 4. 蓝方提交修复代码 (Correction Loop)
    const r2BeforeAttack = engine.submitBlueCorrection(session.session_id, {
      codeArtifact: {
        summary: '修复死锁 Bug：引入 try/finally 锁释放机制',
        code: 'export class AsyncQueue { async pop() { try {} finally { this.unlock(); } } }',
      },
    });

    assert.strictEqual(r2BeforeAttack.current_round, 2);
    assert.strictEqual(r2BeforeAttack.rounds.length, 2);

    // 5. 第 2 轮红方再次进行破坏性攻击 -> 全绿通过
    const r2AfterAttack = engine.submitAttackRound(session.session_id, {
      redCases: [
        { test_name: 'test_concurrency_deadlock', test_code: '...', attack_type: 'concurrency' },
        { test_name: 'test_memory_leak_pressure', test_code: '...', attack_type: 'memory' },
      ],
      passed: true,
    });

    assert.strictEqual(r2AfterAttack.status, 'PASSED');
    assert.ok(r2AfterAttack.final_summary?.includes('全量验证通过'));

    // 6. 熔断保护测试：连续失败达到上限触发 FAILED_CIRCUIT_BREAKER
    const breakerSession = engine.createSession({
      taskTitle: '实现抗碰撞哈希算法',
      workspaceRoot: tmpDir,
      generatorDog: 'claude-code',
      verifierDog: 'zcode',
      initialCode: { summary: '哈希实现', code: 'export function hash() {}' },
      maxRetries: 1, // 仅允许 1 轮重试
    });

    const failedR1 = engine.submitAttackRound(breakerSession.session_id, {
      redCases: [{ test_name: 'test_collision', test_code: '...', attack_type: 'security' }],
      passed: false,
      failedTests: [{ test_name: 'test_collision', error_message: 'Collision detected with prefix attack' }],
    });

    assert.strictEqual(failedR1.status, 'FAILED_CIRCUIT_BREAKER');
    assert.ok(failedR1.final_summary?.includes('熔断保护'));
  });

  await t.test('2. Server Endpoints: Full Red-Blue REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-redblue-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/verify/red-blue (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/verify/red-blue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_title: '验证网络协议' }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 2. POST /api/verify/red-blue (同犬自审 -> 400)
    const selfVerifyRes = await fetch(`${base}/api/verify/red-blue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        task_title: '验证网络协议',
        generator_dog: 'agy',
        verifier_dog: 'agy', // 同犬违规
      }),
    });
    assert.strictEqual(selfVerifyRes.status, 400);

    // 3. POST /api/verify/red-blue (有效鉴权与异构犬 -> 200)
    const createRes = await fetch(`${base}/api/verify/red-blue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        task_title: '验证网络协议',
        generator_dog: 'agy',
        verifier_dog: 'deepseek-code',
        initial_code: { summary: '初始网络协议', code: 'export class Protocol {}' },
        max_retries: 3,
      }),
    });
    assert.strictEqual(createRes.status, 200);
    const createData = (await createRes.json()) as { ok: boolean; session: { session_id: string; task_title: string } };
    assert.strictEqual(createData.ok, true);
    const sessionId = createData.session.session_id;

    // 4. GET /api/verify/red-blue & GET /api/verify/red-blue/:id
    const listRes = await fetch(`${base}/api/verify/red-blue`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; sessions: unknown[]; total: number };
    assert.ok(listData.total >= 1);

    const detailRes = await fetch(`${base}/api/verify/red-blue/${sessionId}`);
    assert.strictEqual(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { ok: boolean; session: { session_id: string; status: string } };
    assert.strictEqual(detailData.session.session_id, sessionId);
    assert.strictEqual(detailData.session.status, 'IN_PROGRESS');

    // 5. POST /api/verify/red-blue/:id/attack (红方注入攻击用例)
    const attackRes = await fetch(`${base}/api/verify/red-blue/${sessionId}/attack`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        red_cases: [{ test_name: 'test_packet_fuzzing', test_code: '...', attack_type: 'fuzzing' }],
        passed: false,
        failed_tests: [{ test_name: 'test_packet_fuzzing', error_message: 'Buffer overflow detected' }],
        feedback: '数据包超长时未做边界校验',
      }),
    });
    assert.strictEqual(attackRes.status, 200);
    const attackData = (await attackRes.json()) as { ok: boolean; session: { status: string; rounds: Array<{ passed: boolean }> } };
    assert.strictEqual(attackData.session.status, 'IN_PROGRESS');
    assert.strictEqual(attackData.session.rounds[0].passed, false);

    // 6. POST /api/verify/red-blue/:id/correct (蓝方打回修复)
    const correctRes = await fetch(`${base}/api/verify/red-blue/${sessionId}/correct`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({
        code_artifact: {
          summary: '加入数据包长度硬截断保护',
          code: 'export class Protocol { parse(buf) { if (buf.length > 1024) throw new Error("overflow"); } }',
        },
      }),
    });
    assert.strictEqual(correctRes.status, 200);
    const correctData = (await correctRes.json()) as { ok: boolean; session: { current_round: number } };
    assert.strictEqual(correctData.session.current_round, 2);
  });
});
